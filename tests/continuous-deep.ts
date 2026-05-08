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
import { createContinuousMarket, createBinaryMarket } from "./helpers/market-helper";
import { SCALE } from "./helpers/constants";

// ── Helpers ──────────────────────────────────────────────────────────

async function getVaultBalance(vault: PublicKey): Promise<number> {
  return Number((await getAccount(ctx.provider.connection, vault)).amount);
}

async function fundTrader(trader: Keypair, amount: bigint = BigInt(100_000_000)): Promise<PublicKey> {
  const ata = await getOrCreateAta(ctx.collateralMint, trader.publicKey, trader);
  await mintTokens(ctx.collateralMint, ata, (ctx.superadmin as any).payer, amount);
  return ata;
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

async function sellDistribution(
  trader: Keypair,
  traderAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
  mu: BN,
  sigma: BN,
  tokenAmount: BN,
) {
  const [userPositionPda] = findUserPosition(marketPda, trader.publicKey, ctx.program.programId);
  await ctx.program.methods
    .sellDistribution({ mu, sigma, tokenAmount })
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

/** Compute expected bin index for a value in [rangeMin, rangeMax] with numBins bins */
function expectedBin(value: number, rangeMin: number, rangeMax: number, numBins: number): number {
  if (value <= rangeMin) return 0;
  if (value >= rangeMax) return numBins - 1;
  return Math.floor((value - rangeMin) * numBins / (rangeMax - rangeMin));
}

// ── Test Suites ──────────────────────────────────────────────────────

describe("Continuous Deep — Distribution Shape Validation", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  const NUM_BINS = 32;
  const RANGE_MIN_VAL = 0;
  const RANGE_MAX_VAL = 100;
  const RANGE_MIN = new BN(RANGE_MIN_VAL).mul(SCALE);
  const RANGE_MAX = new BN(RANGE_MAX_VAL).mul(SCALE);

  before(async () => {
    await ensureSetup();
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 180,
      liquidity: new BN(20_000_000),
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("narrow sigma concentrates tokens near mu", async () => {
    const traderAta = await fundTrader(ctx.traderA);
    await buyDistribution(
      ctx.traderA, traderAta, marketPda, vaultAuthority, vault,
      new BN(50).mul(SCALE), new BN(3).mul(SCALE), new BN(3_000_000),
    );

    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const position = await ctx.program.account.userPosition.fetch(posA);
    const holdings = position.holdings.map((h: any) => h.toNumber());

    const muBin = expectedBin(50, RANGE_MIN_VAL, RANGE_MAX_VAL, NUM_BINS);

    // Center bin must have tokens
    expect(holdings[muBin]).to.be.greaterThan(0,
      `Bin ${muBin} (mu=50) must have tokens`);

    // With narrow sigma, tokens near center should outweigh tokens far from center
    // Note: AMM price impact can shift the exact peak, so we compare regions not single bins
    const nearCenter = holdings.slice(Math.max(0, muBin - 4), Math.min(NUM_BINS, muBin + 5))
      .reduce((s, h) => s + h, 0);
    const total = holdings.reduce((s, h) => s + h, 0);
    expect(nearCenter / total).to.be.greaterThan(0.3,
      "A meaningful portion of tokens should be near the center");
  });

  it("wide sigma spreads tokens across many bins", async () => {
    const traderAta = await fundTrader(ctx.traderB);
    await buyDistribution(
      ctx.traderB, traderAta, marketPda, vaultAuthority, vault,
      new BN(50).mul(SCALE), new BN(40).mul(SCALE), new BN(3_000_000),
    );

    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const position = await ctx.program.account.userPosition.fetch(posB);
    const holdings = position.holdings.map((h: any) => h.toNumber());

    const nonZeroBins = holdings.filter((h: number) => h > 0).length;
    // Wide sigma should populate most bins
    expect(nonZeroBins).to.be.greaterThan(NUM_BINS / 2,
      "Wide sigma should populate more than half the bins");
  });

  it("mu at range boundary still works (mu = rangeMin)", async () => {
    // Create a fresh market so positions don't conflict
    const mkt2 = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 180,
      liquidity: new BN(20_000_000),
    });

    const traderAta = await fundTrader(ctx.traderA);
    await buyDistribution(
      ctx.traderA, traderAta, mkt2.marketPda, mkt2.vaultAuthority, mkt2.vault,
      new BN(0).mul(SCALE), new BN(10).mul(SCALE), new BN(2_000_000),
    );

    const [posA] = findUserPosition(mkt2.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const position = await ctx.program.account.userPosition.fetch(posA);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s, h) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Edge distribution should still allocate tokens");

    // Tokens should be skewed toward bin 0
    expect(holdings[0]).to.be.greaterThan(0, "Bin 0 must have tokens when mu=rangeMin");
  });

  it("mu at range boundary (mu = rangeMax)", async () => {
    const mkt3 = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 180,
      liquidity: new BN(20_000_000),
    });

    const traderAta = await fundTrader(ctx.traderA);
    await buyDistribution(
      ctx.traderA, traderAta, mkt3.marketPda, mkt3.vaultAuthority, mkt3.vault,
      new BN(100).mul(SCALE), new BN(10).mul(SCALE), new BN(2_000_000),
    );

    const [posA] = findUserPosition(mkt3.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const position = await ctx.program.account.userPosition.fetch(posA);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s, h) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Edge distribution should still allocate tokens");

    // Tokens should be skewed toward last bin
    expect(holdings[NUM_BINS - 1]).to.be.greaterThan(0, "Last bin must have tokens when mu=rangeMax");
  });

  it("mu outside range still allocates tokens (skewed to nearest edge)", async () => {
    const mkt4 = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 180,
      liquidity: new BN(20_000_000),
    });

    const traderAta = await fundTrader(ctx.traderA);
    // mu = 150, way outside [0, 100] — should skew to high bins
    await buyDistribution(
      ctx.traderA, traderAta, mkt4.marketPda, mkt4.vaultAuthority, mkt4.vault,
      new BN(150).mul(SCALE), new BN(20).mul(SCALE), new BN(2_000_000),
    );

    const [posA] = findUserPosition(mkt4.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const position = await ctx.program.account.userPosition.fetch(posA);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s, h) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Out-of-range mu should still allocate tokens");

    // Most weight should be in the upper bins
    const topHalf = holdings.slice(NUM_BINS / 2).reduce((s, h) => s + h, 0);
    expect(topHalf / total).to.be.greaterThan(0.5,
      "Out-of-range high mu should concentrate in upper bins");
  });
});

describe("Continuous Deep — Bin Mapping & Range Boundary Resolution", () => {
  const NUM_BINS = 16;
  const RANGE_MIN_VAL = 100;
  const RANGE_MAX_VAL = 300;
  const RANGE_MIN = new BN(RANGE_MIN_VAL).mul(SCALE);
  const RANGE_MAX = new BN(RANGE_MAX_VAL).mul(SCALE);

  it("resolve at range_min maps to bin 0", async () => {
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 10,
      liquidity: new BN(20_000_000),
    });

    const traderAta = await fundTrader(ctx.traderA);
    // Buy centered at rangeMin to have tokens in bin 0
    await buyDistribution(
      ctx.traderA, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      new BN(RANGE_MIN_VAL).mul(SCALE), new BN(20).mul(SCALE), new BN(2_000_000),
    );

    await waitForDeadline(mkt.marketPda);
    await resolveMarket(mkt.marketPda, 0, new BN(RANGE_MIN_VAL).mul(SCALE));

    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    expect(market.resolvedOutcome).to.equal(0, "Value at range_min should resolve to bin 0");
  });

  it("resolve at range_max maps to last bin", async () => {
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 10,
      liquidity: new BN(20_000_000),
    });

    const traderAta = await fundTrader(ctx.traderA);
    await buyDistribution(
      ctx.traderA, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      new BN(RANGE_MAX_VAL).mul(SCALE), new BN(20).mul(SCALE), new BN(2_000_000),
    );

    await waitForDeadline(mkt.marketPda);
    await resolveMarket(mkt.marketPda, 0, new BN(RANGE_MAX_VAL).mul(SCALE));

    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    expect(market.resolvedOutcome).to.equal(NUM_BINS - 1,
      "Value at range_max should resolve to last bin");
  });

  it("resolve at midpoint maps to correct bin", async () => {
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 10,
      liquidity: new BN(20_000_000),
    });

    const traderAta = await fundTrader(ctx.traderA);
    await buyDistribution(
      ctx.traderA, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      new BN(200).mul(SCALE), new BN(20).mul(SCALE), new BN(2_000_000),
    );

    await waitForDeadline(mkt.marketPda);
    const resolveValue = 200;
    await resolveMarket(mkt.marketPda, 0, new BN(resolveValue).mul(SCALE));

    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    const expected = expectedBin(resolveValue, RANGE_MIN_VAL, RANGE_MAX_VAL, NUM_BINS);
    expect(market.resolvedOutcome).to.equal(expected,
      `Value ${resolveValue} should resolve to bin ${expected}`);
  });

  it("resolve below range_min is rejected", async () => {
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 10,
      liquidity: new BN(20_000_000),
    });

    await waitForDeadline(mkt.marketPda);
    try {
      await resolveMarket(mkt.marketPda, 0, new BN(50).mul(SCALE));
      expect.fail("Should reject value below range_min");
    } catch (err: any) {
      expect(err.toString()).to.include("ResolvedValueOutOfRange");
    }
  });

  it("resolve above range_max is rejected", async () => {
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 10,
      liquidity: new BN(20_000_000),
    });

    await waitForDeadline(mkt.marketPda);
    try {
      await resolveMarket(mkt.marketPda, 0, new BN(500).mul(SCALE));
      expect.fail("Should reject value above range_max");
    } catch (err: any) {
      expect(err.toString()).to.include("ResolvedValueOutOfRange");
    }
  });
});

describe("Continuous Deep — Overlapping Distributions & Price Impact", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  const NUM_BINS = 32;
  const RANGE_MIN = new BN(0).mul(SCALE);
  const RANGE_MAX = new BN(100).mul(SCALE);

  before(async () => {
    await ensureSetup();
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 180,
      liquidity: new BN(20_000_000),
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("two traders with overlapping distributions both get tokens in shared bins", async () => {
    const traderAAta = await fundTrader(ctx.traderA);
    const traderBAta = await fundTrader(ctx.traderB);

    // Both buy centered at 50, same sigma
    await buyDistribution(
      ctx.traderA, traderAAta, marketPda, vaultAuthority, vault,
      new BN(50).mul(SCALE), new BN(15).mul(SCALE), new BN(3_000_000),
    );
    await buyDistribution(
      ctx.traderB, traderBAta, marketPda, vaultAuthority, vault,
      new BN(50).mul(SCALE), new BN(15).mul(SCALE), new BN(3_000_000),
    );

    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const holdingsA = (await ctx.program.account.userPosition.fetch(posA)).holdings.map((h: any) => h.toNumber());
    const holdingsB = (await ctx.program.account.userPosition.fetch(posB)).holdings.map((h: any) => h.toNumber());

    const muBin = expectedBin(50, 0, 100, NUM_BINS);

    // Both must have tokens in the center bin
    expect(holdingsA[muBin]).to.be.greaterThan(0);
    expect(holdingsB[muBin]).to.be.greaterThan(0);

    // Price impact: second buyer should get fewer tokens per collateral (same amount, same distribution)
    const totalA = holdingsA.reduce((s, h) => s + h, 0);
    const totalB = holdingsB.reduce((s, h) => s + h, 0);
    expect(totalB).to.be.lessThan(totalA,
      "Second buyer should get fewer tokens due to price impact from first buy");
  });

  it("buying in one region shifts reserves: bought bins gain less than distant bins", async () => {
    // In L2-norm CFAMM, buying mints complete sets across ALL bins, then drains bought bins.
    // Net effect: all reserves increase, but bought bins increase LESS than distant bins.
    const mkt2 = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 180,
      liquidity: new BN(20_000_000),
    });

    const traderAta = await fundTrader(ctx.traderA);
    const marketPre = await ctx.program.account.market.fetch(mkt2.marketPda);
    const reservesPre = marketPre.reserves.map((r: any) => r.toNumber());

    await buyDistribution(
      ctx.traderA, traderAta, mkt2.marketPda, mkt2.vaultAuthority, mkt2.vault,
      new BN(90).mul(SCALE), new BN(5).mul(SCALE), new BN(5_000_000),
    );

    const marketPost = await ctx.program.account.market.fetch(mkt2.marketPda);
    const reservesPost = marketPost.reserves.map((r: any) => r.toNumber());

    const highBin = expectedBin(90, 0, 100, NUM_BINS);
    const lowBin = expectedBin(10, 0, 100, NUM_BINS);

    const highBinGain = reservesPost[highBin] - reservesPre[highBin];
    const lowBinGain = reservesPost[lowBin] - reservesPre[lowBin];

    // Distant bins gain more reserves than the bought bins
    expect(lowBinGain).to.be.greaterThan(highBinGain,
      "Distant bins should gain more reserves than bought bins");

    // totalMinted must increase
    expect(marketPost.totalMinted.toNumber()).to.be.greaterThan(
      marketPre.totalMinted.toNumber()
    );
  });
});

describe("Continuous Deep — LP Lifecycle on Continuous Markets", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  const NUM_BINS = 16;
  const RANGE_MIN = new BN(0).mul(SCALE);
  const RANGE_MAX = new BN(200).mul(SCALE);

  before(async () => {
    await ensureSetup();
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 30,
      liquidity: new BN(20_000_000),
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("LP adds liquidity to continuous market and gets proportional shares", async () => {
    const lpAta = await fundTrader(ctx.lpProvider);
    const marketBefore = await ctx.program.account.market.fetch(marketPda);

    await addLiquidity(ctx.lpProvider, lpAta, marketPda, vaultAuthority, vault, new BN(10_000_000));

    const [lpPos] = findLpPosition(marketPda, ctx.lpProvider.publicKey, ctx.program.programId);
    const lp = await ctx.program.account.lpPosition.fetch(lpPos);
    const marketAfter = await ctx.program.account.market.fetch(marketPda);

    // Shares should be proportional
    const expectedShares = Math.floor(
      10_000_000 * marketBefore.lpSharesTotal.toNumber() / marketBefore.totalMinted.toNumber()
    );
    expect(Math.abs(lp.shares.toNumber() - expectedShares)).to.be.lessThanOrEqual(1);

    // All reserves should scale up proportionally
    for (let i = 0; i < NUM_BINS; i++) {
      expect(marketAfter.reserves[i].toNumber()).to.be.greaterThan(
        marketBefore.reserves[i].toNumber()
      );
    }
  });

  it("trade + LP remove on active continuous market", async () => {
    const traderAta = await fundTrader(ctx.traderA);
    await buyDistribution(
      ctx.traderA, traderAta, marketPda, vaultAuthority, vault,
      new BN(100).mul(SCALE), new BN(30).mul(SCALE), new BN(3_000_000),
    );

    const lpAta = await getOrCreateAta(ctx.collateralMint, ctx.lpProvider.publicKey, ctx.lpProvider);
    const [lpPos] = findLpPosition(marketPda, ctx.lpProvider.publicKey, ctx.program.programId);
    const lpBefore = await ctx.program.account.lpPosition.fetch(lpPos);
    const halfShares = lpBefore.shares.div(new BN(2));

    const lpPayout = await removeLiquidity(ctx.lpProvider, lpAta, marketPda, vaultAuthority, vault, halfShares);
    expect(lpPayout).to.be.greaterThan(0, "LP partial removal should return collateral");

    const lpAfter = await ctx.program.account.lpPosition.fetch(lpPos);
    expect(lpAfter.shares.toNumber()).to.be.greaterThan(0, "LP should still have remaining shares");
  });

  it("resolve + LP full removal + trader claim — vault solvent", async () => {
    await waitForDeadline(marketPda);
    await resolveMarket(marketPda, 0, new BN(100).mul(SCALE));

    // Trader claims
    const traderAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const position = await ctx.program.account.userPosition.fetch(posA);
    const market = await ctx.program.account.market.fetch(marketPda);
    const winningTokens = position.holdings[market.resolvedOutcome].toNumber();

    if (winningTokens > 0) {
      const result = await claimPayout(ctx.traderA, traderAta, marketPda, vaultAuthority, vault);
      expect(result.net).to.equal(result.gross - result.fee);
    }

    // LP removes remaining shares
    const lpAta = await getOrCreateAta(ctx.collateralMint, ctx.lpProvider.publicKey, ctx.lpProvider);
    await removeLiquidity(ctx.lpProvider, lpAta, marketPda, vaultAuthority, vault);

    // Creator LP removes
    const creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    await removeLiquidity(ctx.creatorKp, creatorAta, marketPda, vaultAuthority, vault);

    // Vault solvent
    const vaultBal = await getVaultBalance(vault);
    const marketFinal = await ctx.program.account.market.fetch(marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(marketFinal.protocolFeeAccumulated));
  });
});

describe("Continuous Deep — Large Bin Count (128 bins)", () => {
  it("128-bin market: buy, resolve, claim full lifecycle", async () => {
    await ensureSetup();
    const NUM_BINS = 128;
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(1000).mul(SCALE),
      deadline: Math.floor(Date.now() / 1000) + 15,
      liquidity: new BN(30_000_000),
    });

    const traderAta = await fundTrader(ctx.traderA);
    await buyDistribution(
      ctx.traderA, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      new BN(500).mul(SCALE), new BN(50).mul(SCALE), new BN(5_000_000),
    );

    const [posA] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const position = await ctx.program.account.userPosition.fetch(posA);
    expect(position.holdings.length).to.equal(NUM_BINS);

    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s, h) => s + h, 0);
    expect(total).to.be.greaterThan(0);

    // Center bin for mu=500 in [0, 1000] with 128 bins → bin 64
    const muBin = expectedBin(500, 0, 1000, NUM_BINS);
    expect(holdings[muBin]).to.be.greaterThan(0);

    await waitForDeadline(mkt.marketPda);
    await resolveMarket(mkt.marketPda, 0, new BN(500).mul(SCALE));

    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    expect(market.resolvedOutcome).to.equal(muBin);

    const winningTokens = holdings[muBin];
    expect(winningTokens).to.be.greaterThan(0, "Must have tokens in winning bin");

    const result = await claimPayout(ctx.traderA, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
    expect(result.net).to.equal(result.gross - result.fee);
    expect(result.gross).to.equal(winningTokens);

    // LP removes and vault check
    const creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    await removeLiquidity(ctx.creatorKp, creatorAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);

    const vaultBal = await getVaultBalance(mkt.vault);
    const marketFinal = await ctx.program.account.market.fetch(mkt.marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(marketFinal.protocolFeeAccumulated));
  });
});

describe("Continuous Deep — Buy then Sell Distribution Round-trip", () => {
  it("buy and sell same distribution returns most collateral", async () => {
    await ensureSetup();
    const mkt = await createContinuousMarket({
      numBins: 32,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(100).mul(SCALE),
      deadline: Math.floor(Date.now() / 1000) + 180,
      liquidity: new BN(20_000_000),
    });

    const traderAta = await fundTrader(ctx.traderA);
    const ataBefore = Number((await getAccount(ctx.provider.connection, traderAta)).amount);

    const mu = new BN(50).mul(SCALE);
    const sigma = new BN(15).mul(SCALE);
    const buyAmount = new BN(5_000_000);

    await buyDistribution(
      ctx.traderA, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      mu, sigma, buyAmount,
    );

    const [posA] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const posAfterBuy = await ctx.program.account.userPosition.fetch(posA);
    const holdingsAfterBuy = posAfterBuy.holdings.map((h: any) => h.toNumber());
    const totalTokens = holdingsAfterBuy.reduce((s, h) => s + h, 0);

    // Sell back ~80% of tokens (leave some margin for rounding)
    const sellAmount = Math.floor(totalTokens * 8 / 10);
    expect(sellAmount).to.be.greaterThan(1000, "Must have enough tokens to sell");

    await sellDistribution(
      ctx.traderA, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      mu, sigma, new BN(sellAmount),
    );

    const posAfterSell = await ctx.program.account.userPosition.fetch(posA);
    const holdingsAfterSell = posAfterSell.holdings.map((h: any) => h.toNumber());
    const totalAfterSell = holdingsAfterSell.reduce((s, h) => s + h, 0);

    expect(totalAfterSell).to.be.lessThan(totalTokens);

    const ataAfter = Number((await getAccount(ctx.provider.connection, traderAta)).amount);
    const netCost = ataBefore - ataAfter;

    // Net cost should be positive (lost some to fees + slippage) but not extreme
    expect(netCost).to.be.greaterThan(0, "Round-trip should cost something (fees + slippage)");
    expect(netCost).to.be.lessThan(buyAmount.toNumber(),
      "Round-trip loss should be less than total buy amount");
  });
});

describe("Continuous Deep — Multiple Traders Full Resolution", () => {
  it("3 traders buy different distributions, resolve, all claim or fail correctly", async () => {
    await ensureSetup();
    const NUM_BINS = 32;
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(100).mul(SCALE),
      deadline: Math.floor(Date.now() / 1000) + 15,
      liquidity: new BN(20_000_000),
    });

    const traderAAta = await fundTrader(ctx.traderA);
    const traderBAta = await fundTrader(ctx.traderB);
    const lpAta = await fundTrader(ctx.lpProvider); // use lpProvider as third trader

    // Trader A: low range, mu=20
    await buyDistribution(
      ctx.traderA, traderAAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      new BN(20).mul(SCALE), new BN(10).mul(SCALE), new BN(3_000_000),
    );
    // Trader B: mid range, mu=50
    await buyDistribution(
      ctx.traderB, traderBAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      new BN(50).mul(SCALE), new BN(10).mul(SCALE), new BN(3_000_000),
    );
    // Trader C (lpProvider): high range, mu=80
    await buyDistribution(
      ctx.lpProvider, lpAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      new BN(80).mul(SCALE), new BN(10).mul(SCALE), new BN(3_000_000),
    );

    await waitForDeadline(mkt.marketPda);
    // Resolve at 50 — trader B should win
    await resolveMarket(mkt.marketPda, 0, new BN(50).mul(SCALE));

    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    const winningBin = market.resolvedOutcome;
    const expBin = expectedBin(50, 0, 100, NUM_BINS);
    expect(winningBin).to.equal(expBin);

    // Check each trader's holdings in winning bin
    const [posA] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const [posB] = findUserPosition(mkt.marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const [posC] = findUserPosition(mkt.marketPda, ctx.lpProvider.publicKey, ctx.program.programId);

    const holdingsA = (await ctx.program.account.userPosition.fetch(posA)).holdings.map((h: any) => h.toNumber());
    const holdingsB = (await ctx.program.account.userPosition.fetch(posB)).holdings.map((h: any) => h.toNumber());
    const holdingsC = (await ctx.program.account.userPosition.fetch(posC)).holdings.map((h: any) => h.toNumber());

    // All three traders should have tokens in the winning bin (sigma=10 covers ±30 units)
    // Note: AMM price impact means first buyer gets more tokens per collateral,
    // so we can't reliably compare absolute amounts between traders
    expect(holdingsB[winningBin]).to.be.greaterThan(0,
      "Trader B (mu=50, centered on winning bin) must have winning tokens");

    // Trader B claims
    const resultB = await claimPayout(ctx.traderB, traderBAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
    expect(resultB.gross).to.equal(holdingsB[winningBin]);
    expect(resultB.net).to.equal(resultB.gross - resultB.fee);

    // Traders A and C: claim if they have winning tokens, fail if they don't
    if (holdingsA[winningBin] > 0) {
      const resultA = await claimPayout(ctx.traderA, traderAAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
      expect(resultA.gross).to.equal(holdingsA[winningBin]);
    } else {
      try {
        await claimPayout(ctx.traderA, traderAAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
        expect.fail("Trader A with 0 winning tokens should fail");
      } catch (err: any) {
        expect(err.toString()).to.include("NothingToClaim");
      }
    }

    if (holdingsC[winningBin] > 0) {
      const resultC = await claimPayout(ctx.lpProvider, lpAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
      expect(resultC.gross).to.equal(holdingsC[winningBin]);
    } else {
      try {
        await claimPayout(ctx.lpProvider, lpAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
        expect.fail("Trader C with 0 winning tokens should fail");
      } catch (err: any) {
        expect(err.toString()).to.include("NothingToClaim");
      }
    }

    // LP (creator) removes and vault check
    const creatorAta = await getOrCreateAta(ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp);
    await removeLiquidity(ctx.creatorKp, creatorAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);

    const vaultBal = await getVaultBalance(mkt.vault);
    const marketFinal = await ctx.program.account.market.fetch(mkt.marketPda);
    expect(vaultBal).to.be.greaterThanOrEqual(Number(marketFinal.protocolFeeAccumulated));
  });
});

// ══════════════════════════════════════════════════════════════════════
// sell_all instruction tests
// ══════════════════════════════════════════════════════════════════════

describe("Continuous Deep — sell_all instruction", () => {
  let marketPda: PublicKey, vaultAuthority: PublicKey, vault: PublicKey;
  const NUM_BINS = 32;
  const RANGE_MIN = new BN(0).mul(SCALE);
  const RANGE_MAX = new BN(100).mul(SCALE);

  before(async () => {
    await ensureSetup();
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline: Math.floor(Date.now() / 1000) + 180,
      liquidity: new BN(20_000_000),
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("sells entire position in one call after a single buy", async () => {
    const traderAta = await fundTrader(ctx.traderA);
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);

    // Buy distribution N(50, 15)
    await buyDistribution(
      ctx.traderA, traderAta, marketPda, vaultAuthority, vault,
      new BN(50).mul(SCALE), new BN(15).mul(SCALE), new BN(5_000_000),
    );

    const posBefore = await ctx.program.account.userPosition.fetch(posA);
    const holdingsBefore = posBefore.holdings.map((h: any) => h.toNumber());
    const totalTokens = holdingsBefore.reduce((s: number, h: number) => s + h, 0);
    expect(totalTokens).to.be.greaterThan(0, "should have tokens after buy");

    const ataBalBefore = Number((await getAccount(ctx.provider.connection, traderAta)).amount);

    // sell_all — sells entire position with no distribution fitting needed
    await ctx.program.methods
      .sellAll({ minCollateralOut: new BN(0) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority,
        vault,
        traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .signers([ctx.traderA])
      .rpc();

    // Position should be zeroed out
    const posAfter = await ctx.program.account.userPosition.fetch(posA);
    const holdingsAfter = posAfter.holdings.map((h: any) => h.toNumber());
    expect(holdingsAfter.every((h: number) => h === 0)).to.be.true;

    // Should have received collateral
    const ataBalAfter = Number((await getAccount(ctx.provider.connection, traderAta)).amount);
    const collateralReceived = ataBalAfter - ataBalBefore;
    expect(collateralReceived).to.be.greaterThan(0, "should receive collateral");
  });

  it("sells entire position after multiple buys with different curves", async () => {
    const traderBata = await fundTrader(ctx.traderB);
    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);

    // Buy #1: N(30, 10)
    await buyDistribution(
      ctx.traderB, traderBata, marketPda, vaultAuthority, vault,
      new BN(30).mul(SCALE), new BN(10).mul(SCALE), new BN(3_000_000),
    );
    // Buy #2: N(70, 10)
    await buyDistribution(
      ctx.traderB, traderBata, marketPda, vaultAuthority, vault,
      new BN(70).mul(SCALE), new BN(10).mul(SCALE), new BN(3_000_000),
    );

    const posBefore = await ctx.program.account.userPosition.fetch(posB);
    const holdingsBefore = posBefore.holdings.map((h: any) => h.toNumber());
    const totalTokens = holdingsBefore.reduce((s: number, h: number) => s + h, 0);
    expect(totalTokens).to.be.greaterThan(0);

    // Non-Gaussian shape: tokens should be in two peaks
    const leftPeak = holdingsBefore[Math.floor(30 * NUM_BINS / 100)];
    const rightPeak = holdingsBefore[Math.floor(70 * NUM_BINS / 100)];
    expect(leftPeak).to.be.greaterThan(0, "left peak should have tokens");
    expect(rightPeak).to.be.greaterThan(0, "right peak should have tokens");

    const ataBalBefore = Number((await getAccount(ctx.provider.connection, traderBata)).amount);

    // sell_all handles any shape — no Gaussian fitting needed
    await ctx.program.methods
      .sellAll({ minCollateralOut: new BN(0) })
      .accountsPartial({
        trader: ctx.traderB.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posB,
        vaultAuthority,
        vault,
        traderAta: traderBata,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .signers([ctx.traderB])
      .rpc();

    // Position zeroed
    const posAfter = await ctx.program.account.userPosition.fetch(posB);
    expect(posAfter.holdings.every((h: any) => h.toNumber() === 0)).to.be.true;

    // Received collateral
    const ataBalAfter = Number((await getAccount(ctx.provider.connection, traderBata)).amount);
    expect(ataBalAfter - ataBalBefore).to.be.greaterThan(0);
  });

  it("respects min_collateral_out slippage protection", async () => {
    const traderAta = await fundTrader(ctx.traderA);
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);

    // Buy a small amount
    await buyDistribution(
      ctx.traderA, traderAta, marketPda, vaultAuthority, vault,
      new BN(50).mul(SCALE), new BN(15).mul(SCALE), new BN(1_000_000),
    );

    // Attempt sell_all with absurdly high min_collateral_out
    try {
      await ctx.program.methods
        .sellAll({ minCollateralOut: new BN(999_999_999) })
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault,
          traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
        ])
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should reject when min_collateral_out exceeds actual");
    } catch (err: any) {
      expect(err.toString()).to.include("MinCollateralNotMet");
    }

    // Clean up: sell_all with no slippage protection
    await ctx.program.methods
      .sellAll({ minCollateralOut: new BN(0) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority,
        vault,
        traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .signers([ctx.traderA])
      .rpc();
  });

  it("rejects sell_all when position has no holdings", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);

    // Position should be empty from previous test
    try {
      await ctx.program.methods
        .sellAll({ minCollateralOut: new BN(0) })
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault,
          traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should reject sell_all with empty position");
    } catch (err: any) {
      expect(err.toString()).to.include("InsufficientHoldings");
    }
  });

  it("rejects sell_all on discrete (binary) markets", async () => {
    const binMkt = await createBinaryMarket({
      deadline: Math.floor(Date.now() / 1000) + 60,
      liquidity: new BN(10_000_000),
    });
    const traderAta = await fundTrader(ctx.traderA);
    const [posA] = findUserPosition(binMkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);

    // Buy first to create position
    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: binMkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: binMkt.vaultAuthority,
        vault: binMkt.vault,
        traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    // sell_all should reject for non-continuous markets
    try {
      await ctx.program.methods
        .sellAll({ minCollateralOut: new BN(0) })
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: binMkt.marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority: binMkt.vaultAuthority,
          vault: binMkt.vault,
          traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should reject sell_all on binary market");
    } catch (err: any) {
      expect(err.toString()).to.include("WrongMarketType");
    }
  });
});
