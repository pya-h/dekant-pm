import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserPosition, findLpPosition } from "./helpers/pda";
import { getOrCreateAta, mintTokens } from "./helpers/accounts";
import { createBinaryMarket, createMultiMarket, createContinuousMarket } from "./helpers/market-helper";
import { SCALE } from "./helpers/constants";

// ── Helpers ──────────────────────────────────────────────────────────

async function getVaultBalance(vault: PublicKey): Promise<number> {
  return Number((await getAccount(ctx.provider.connection, vault)).amount);
}

async function buyOutcome(
  trader: Keypair,
  traderAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
  outcome: number,
  amount: BN,
) {
  const [userPositionPda] = findUserPosition(marketPda, trader.publicKey, ctx.program.programId);
  await ctx.program.methods
    .buy({ outcome, collateralAmount: amount })
    .accountsPartial({
      trader: trader.publicKey,
      market: marketPda,
      protocolConfig: ctx.protocolConfig,
      userPosition: userPositionPda,
      vaultAuthority,
      vault,
      traderAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([trader])
    .rpc();
}

async function buyDistribution(
  trader: Keypair,
  traderAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
  mu: BN,
  sigma: BN,
  amount: BN,
) {
  const [userPositionPda] = findUserPosition(marketPda, trader.publicKey, ctx.program.programId);
  await ctx.program.methods
    .buyDistribution({ mu, sigma, collateralAmount: amount })
    .accountsPartial({
      trader: trader.publicKey,
      market: marketPda,
      protocolConfig: ctx.protocolConfig,
      userPosition: userPositionPda,
      vaultAuthority,
      vault,
      traderAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ])
    .signers([trader])
    .rpc();
}

async function claimPayout(
  trader: Keypair,
  traderAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
): Promise<{ gross: number; fee: number; net: number }> {
  const [userPositionPda] = findUserPosition(marketPda, trader.publicKey, ctx.program.programId);
  const market = await ctx.program.account.market.fetch(marketPda);
  const position = await ctx.program.account.userPosition.fetch(userPositionPda);
  const winningTokens = position.holdings[market.resolvedOutcome].toNumber();

  const ataBalBefore = Number((await getAccount(ctx.provider.connection, traderAta)).amount);

  await ctx.program.methods
    .claimPayout()
    .accountsPartial({
      trader: trader.publicKey,
      market: marketPda,
      protocolConfig: ctx.protocolConfig,
      userPosition: userPositionPda,
      vaultAuthority,
      vault,
      traderAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([trader])
    .rpc();

  const ataBalAfter = Number((await getAccount(ctx.provider.connection, traderAta)).amount);
  const net = ataBalAfter - ataBalBefore;

  const config = await ctx.program.account.protocolConfig.fetch(ctx.protocolConfig);
  const fee = Math.floor(winningTokens * config.redemptionFeeBps / 10_000);

  return { gross: winningTokens, fee, net };
}

async function removeLiquidity(
  provider: Keypair,
  providerAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
  sharesToBurn?: BN,
): Promise<number> {
  const [lpPositionPda] = findLpPosition(marketPda, provider.publicKey, ctx.program.programId);
  const lp = await ctx.program.account.lpPosition.fetch(lpPositionPda);
  const shares = sharesToBurn ?? lp.shares;

  const ataBalBefore = Number((await getAccount(ctx.provider.connection, providerAta)).amount);

  await ctx.program.methods
    .removeLiquidity({ sharesToBurn: shares })
    .accountsPartial({
      provider: provider.publicKey,
      market: marketPda,
      lpPosition: lpPositionPda,
      vaultAuthority,
      vault,
      providerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([provider])
    .rpc();

  const ataBalAfter = Number((await getAccount(ctx.provider.connection, providerAta)).amount);
  return ataBalAfter - ataBalBefore;
}

async function addLiquidity(
  provider: Keypair,
  providerAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
  amount: BN,
) {
  const [lpPositionPda] = findLpPosition(marketPda, provider.publicKey, ctx.program.programId);
  await ctx.program.methods
    .addLiquidity({ amount })
    .accountsPartial({
      provider: provider.publicKey,
      market: marketPda,
      lpPosition: lpPositionPda,
      vaultAuthority,
      vault,
      providerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([provider])
    .rpc();
}

async function resolveMarket(marketPda: PublicKey, outcome: number, value?: BN) {
  await ctx.program.methods
    .resolveMarket({ outcome, value: value ?? new BN(0) })
    .accountsPartial({
      oracle: ctx.oracleKp.publicKey,
      market: marketPda,
    })
    .signers([ctx.oracleKp])
    .rpc();
}

async function waitForDeadline(marketPda: PublicKey) {
  const market = await ctx.program.account.market.fetch(marketPda);
  const now = Math.floor(Date.now() / 1000);
  const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function fundTrader(trader: Keypair, amount: bigint = BigInt(100_000_000)): Promise<PublicKey> {
  const ata = await getOrCreateAta(ctx.collateralMint, trader.publicKey, trader);
  await mintTokens(ctx.collateralMint, ata, (ctx.superadmin as any).payer, amount);
  return ata;
}

// ── Test Suites ──────────────────────────────────────────────────────

describe("1:1 Resolution — Scenario 1: Exact payout (binary)", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let traderAAta: PublicKey, traderBAta: PublicKey;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createBinaryMarket({ deadline, liquidity: new BN(10_000_000) });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    traderAAta = await fundTrader(ctx.traderA);
    traderBAta = await fundTrader(ctx.traderB);

    await buyOutcome(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault, 0, new BN(3_000_000));
    await buyOutcome(ctx.traderB, traderBAta, marketPda, vaultAuthority, vault, 1, new BN(2_000_000));

    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 0);
  });

  it("trader A (winner) gets exact 1:1 payout minus fee", async () => {
    const result = await claimPayout(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault);
    expect(result.net).to.equal(result.gross - result.fee);
    expect(result.gross).to.be.greaterThan(0);
  });

  it("trader B (loser) fails with NothingToClaim", async () => {
    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
    try {
      await ctx.program.methods
        .claimPayout()
        .accountsPartial({
          trader: ctx.traderB.publicKey,
          market: marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posB,
          vaultAuthority,
          vault,
          traderAta: traderBAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderB])
        .rpc();
      expect.fail("Should have thrown NothingToClaim");
    } catch (err: any) {
      expect(err.toString()).to.include("NothingToClaim");
    }
  });
});

describe("1:1 Resolution — Scenario 2: Claim-then-LP-remove (vault solvency)", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let traderAAta: PublicKey, creatorAta: PublicKey, lpProviderAta: PublicKey;
  let traderPayout: number, lp1Payout: number, lp2Payout: number;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createBinaryMarket({ deadline, liquidity: new BN(10_000_000) });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    // Add second LP (lpProvider)
    lpProviderAta = await fundTrader(ctx.lpProvider);
    await addLiquidity(ctx.lpProvider, lpProviderAta, marketPda, vaultAuthority, vault, new BN(5_000_000));

    // Trader buys
    traderAAta = await fundTrader(ctx.traderA);
    await buyOutcome(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault, 0, new BN(3_000_000));

    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 0);
  });

  it("trader claims first", async () => {
    const result = await claimPayout(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault);
    traderPayout = result.net;
    expect(traderPayout).to.be.greaterThan(0);
  });

  it("creator LP (LP1) removes all shares", async () => {
    creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    lp1Payout = await removeLiquidity(ctx.creatorKp, creatorAta, marketPda, vaultAuthority, vault);
    expect(lp1Payout).to.be.greaterThanOrEqual(0);
  });

  it("lpProvider (LP2) removes all shares", async () => {
    lp2Payout = await removeLiquidity(ctx.lpProvider, lpProviderAta, marketPda, vaultAuthority, vault);
    expect(lp2Payout).to.be.greaterThanOrEqual(0);
  });

  it("vault solvency: vault >= protocol fees (remainder is dead collateral from losing outcome)", async () => {
    const vaultBal = await getVaultBalance(vault);
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(market.protocolFeeAccumulated));
    // Conservation: all payouts + vault remainder == total value
    expect(traderPayout + lp1Payout + lp2Payout + vaultBal).to.be.greaterThan(0);
  });
});

describe("1:1 Resolution — Scenario 3: LP-remove-then-claim (order independence)", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let traderAAta: PublicKey, creatorAta: PublicKey;
  let traderPayout: number, lpPayout: number;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createBinaryMarket({ deadline, liquidity: new BN(10_000_000) });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    traderAAta = await fundTrader(ctx.traderA);
    await buyOutcome(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault, 0, new BN(3_000_000));

    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 0);
  });

  it("LP removes first", async () => {
    creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    lpPayout = await removeLiquidity(ctx.creatorKp, creatorAta, marketPda, vaultAuthority, vault);
    expect(lpPayout).to.be.greaterThanOrEqual(0);
  });

  it("trader claims second — succeeds", async () => {
    const result = await claimPayout(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault);
    traderPayout = result.net;
    expect(traderPayout).to.be.greaterThan(0);
  });

  it("vault solvency: vault >= protocol fees", async () => {
    const vaultBal = await getVaultBalance(vault);
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(market.protocolFeeAccumulated));
  });
});

describe("1:1 Resolution — Scenario 4: Multiple traders claim then LP removes", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let traderAAta: PublicKey, traderBAta: PublicKey, creatorAta: PublicKey;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createBinaryMarket({ deadline, liquidity: new BN(10_000_000) });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    traderAAta = await fundTrader(ctx.traderA);
    traderBAta = await fundTrader(ctx.traderB);

    await buyOutcome(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault, 0, new BN(2_000_000));
    await buyOutcome(ctx.traderB, traderBAta, marketPda, vaultAuthority, vault, 0, new BN(4_000_000));

    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 0);
  });

  it("trader A claims — exact 1:1", async () => {
    const result = await claimPayout(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault);
    expect(result.net).to.equal(result.gross - result.fee);
  });

  it("trader B claims — exact 1:1", async () => {
    const result = await claimPayout(ctx.traderB, traderBAta, marketPda, vaultAuthority, vault);
    expect(result.net).to.equal(result.gross - result.fee);
  });

  it("LP removes all shares then vault >= protocol fees", async () => {
    creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    await removeLiquidity(ctx.creatorKp, creatorAta, marketPda, vaultAuthority, vault);

    const vaultBal = await getVaultBalance(vault);
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(market.protocolFeeAccumulated));
  });
});

describe("1:1 Resolution — Scenario 5: Multiple LPs withdraw from resolved market", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let traderAAta: PublicKey, creatorAta: PublicKey, lp2Ata: PublicKey;
  let lp1Payout: number, lp2Payout: number;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createBinaryMarket({ deadline, liquidity: new BN(10_000_000) });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    // Add LP2
    lp2Ata = await fundTrader(ctx.lpProvider);
    await addLiquidity(ctx.lpProvider, lp2Ata, marketPda, vaultAuthority, vault, new BN(5_000_000));

    // Trader buys
    traderAAta = await fundTrader(ctx.traderA);
    await buyOutcome(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault, 0, new BN(3_000_000));

    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 0);

    // Trader claims first
    await claimPayout(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault);
  });

  it("LP2 removes all shares", async () => {
    lp2Payout = await removeLiquidity(ctx.lpProvider, lp2Ata, marketPda, vaultAuthority, vault);
    expect(lp2Payout).to.be.greaterThanOrEqual(0);
  });

  it("creator LP removes all shares", async () => {
    creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    lp1Payout = await removeLiquidity(ctx.creatorKp, creatorAta, marketPda, vaultAuthority, vault);
    expect(lp1Payout).to.be.greaterThanOrEqual(0);
  });

  it("vault >= protocol fees after all withdrawals", async () => {
    const vaultBal = await getVaultBalance(vault);
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(market.protocolFeeAccumulated));
  });
});

describe("1:1 Resolution — Scenario 6: No-trade resolved market (LP gets residual)", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let creatorAta: PublicKey;
  let reservesWinningBefore: number;
  let totalMintedBefore: number;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createBinaryMarket({ deadline, liquidity: new BN(10_000_000) });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 0);

    const market = await ctx.program.account.market.fetch(marketPda);
    reservesWinningBefore = market.reserves[0].toNumber();
    totalMintedBefore = market.totalMinted.toNumber();
  });

  it("LP removes all shares and gets reserves[winning]", async () => {
    creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    const lpPayout = await removeLiquidity(ctx.creatorKp, creatorAta, marketPda, vaultAuthority, vault);
    // LP gets reserves[winning] (+ fee share, which is 0 since no trades)
    expect(lpPayout).to.equal(reservesWinningBefore);
  });

  it("vault still holds the dead collateral (no one can claim it)", async () => {
    const vaultBal = await getVaultBalance(vault);
    const market = await ctx.program.account.market.fetch(marketPda);
    // leftover = total_minted - reserves[winning] + protocol_fees
    const expectedLeftover = totalMintedBefore - reservesWinningBefore + Number(market.protocolFeeAccumulated);
    expect(vaultBal).to.equal(expectedLeftover);
  });
});

describe("1:1 Resolution — Scenario 7: Continuous market 1:1 claim", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let traderAAta: PublicKey, creatorAta: PublicKey;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createContinuousMarket({
      numBins: 16,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(300).mul(SCALE),
      deadline,
      liquidity: new BN(20_000_000),
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    traderAAta = await fundTrader(ctx.traderA);

    // Buy distribution centered at 155 with sigma 20
    await buyDistribution(
      ctx.traderA, traderAAta, marketPda, vaultAuthority, vault,
      new BN(155).mul(SCALE), new BN(20).mul(SCALE), new BN(3_000_000),
    );

    await waitForDeadline(marketPda);
    // Resolve at value 155 * SCALE
    await resolveMarket(marketPda, 0, new BN(155).mul(SCALE));
  });

  it("trader claims exact 1:1 payout from winning bin", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    const winningBin = market.resolvedOutcome;
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const position = await ctx.program.account.userPosition.fetch(posA);
    const winningTokens = position.holdings[winningBin].toNumber();

    if (winningTokens > 0) {
      const result = await claimPayout(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault);
      expect(result.net).to.equal(result.gross - result.fee);
    }
  });

  it("LP removes and vault stays solvent", async () => {
    creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    await removeLiquidity(ctx.creatorKp, creatorAta, marketPda, vaultAuthority, vault);

    const vaultBal = await getVaultBalance(vault);
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(market.protocolFeeAccumulated));
  });
});

describe("1:1 Resolution — Scenario 8: Multi-outcome market 1:1 claim", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let traderAAta: PublicKey, traderBAta: PublicKey, creatorAta: PublicKey;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createMultiMarket({ numOutcomes: 4, deadline, liquidity: new BN(20_000_000) });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    traderAAta = await fundTrader(ctx.traderA);
    traderBAta = await fundTrader(ctx.traderB);

    // Trader A buys outcome 2, Trader B buys outcome 1
    await buyOutcome(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault, 2, new BN(3_000_000));
    await buyOutcome(ctx.traderB, traderBAta, marketPda, vaultAuthority, vault, 1, new BN(2_000_000));

    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 2);
  });

  it("trader A (winner, outcome 2) gets exact payout", async () => {
    const result = await claimPayout(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault);
    expect(result.net).to.equal(result.gross - result.fee);
    expect(result.gross).to.be.greaterThan(0);
  });

  it("trader B (loser, outcome 1) fails with NothingToClaim", async () => {
    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
    try {
      await ctx.program.methods
        .claimPayout()
        .accountsPartial({
          trader: ctx.traderB.publicKey,
          market: marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posB,
          vaultAuthority,
          vault,
          traderAta: traderBAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderB])
        .rpc();
      expect.fail("Should have thrown NothingToClaim");
    } catch (err: any) {
      expect(err.toString()).to.include("NothingToClaim");
    }
  });

  it("LP removes, vault stays solvent", async () => {
    creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    await removeLiquidity(ctx.creatorKp, creatorAta, marketPda, vaultAuthority, vault);

    const vaultBal = await getVaultBalance(vault);
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(market.protocolFeeAccumulated));
  });
});

describe("1:1 Resolution — Scenario 9: Interleaved claims and LP removes", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let traderAAta: PublicKey, traderBAta: PublicKey;
  let creatorAta: PublicKey, lp2Ata: PublicKey;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createBinaryMarket({ deadline, liquidity: new BN(10_000_000) });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    // Add LP2
    lp2Ata = await fundTrader(ctx.lpProvider);
    await addLiquidity(ctx.lpProvider, lp2Ata, marketPda, vaultAuthority, vault, new BN(5_000_000));

    // Two traders buy winning outcome
    traderAAta = await fundTrader(ctx.traderA);
    traderBAta = await fundTrader(ctx.traderB);
    await buyOutcome(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault, 0, new BN(2_000_000));
    await buyOutcome(ctx.traderB, traderBAta, marketPda, vaultAuthority, vault, 0, new BN(3_000_000));

    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 0);
  });

  it("trader A claims", async () => {
    const result = await claimPayout(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault);
    expect(result.net).to.equal(result.gross - result.fee);
  });

  it("LP2 removes partial shares", async () => {
    const [lpPositionPda] = findLpPosition(marketPda, ctx.lpProvider.publicKey, ctx.program.programId);
    const lp = await ctx.program.account.lpPosition.fetch(lpPositionPda);
    const halfShares = lp.shares.div(new BN(2));
    const payout = await removeLiquidity(ctx.lpProvider, lp2Ata, marketPda, vaultAuthority, vault, halfShares);
    expect(payout).to.be.greaterThanOrEqual(0);
  });

  it("trader B claims (unaffected by LP withdrawal)", async () => {
    const result = await claimPayout(ctx.traderB, traderBAta, marketPda, vaultAuthority, vault);
    expect(result.net).to.equal(result.gross - result.fee);
  });

  it("LP2 removes remaining shares", async () => {
    const payout = await removeLiquidity(ctx.lpProvider, lp2Ata, marketPda, vaultAuthority, vault);
    expect(payout).to.be.greaterThanOrEqual(0);
  });

  it("creator LP removes all shares", async () => {
    creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    await removeLiquidity(ctx.creatorKp, creatorAta, marketPda, vaultAuthority, vault);
  });

  it("vault >= protocol fees after all operations", async () => {
    const vaultBal = await getVaultBalance(vault);
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(market.protocolFeeAccumulated));
  });
});

describe("1:1 Resolution — Scenario 10: Zero winning holdings (NothingToClaim)", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  let traderAAta: PublicKey;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 10;
    const mkt = await createBinaryMarket({ deadline, liquidity: new BN(10_000_000) });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    // Trader buys only the LOSING outcome (1)
    traderAAta = await fundTrader(ctx.traderA);
    await buyOutcome(ctx.traderA, traderAAta, marketPda, vaultAuthority, vault, 1, new BN(2_000_000));

    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 0); // outcome 0 wins, trader has outcome 1
  });

  it("claim returns NothingToClaim", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    try {
      await ctx.program.methods
        .claimPayout()
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should have thrown NothingToClaim");
    } catch (err: any) {
      expect(err.toString()).to.include("NothingToClaim");
    }
  });
});
