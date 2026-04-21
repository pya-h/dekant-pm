import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserPosition } from "./helpers/pda";
import { getOrCreateAta, mintTokens } from "./helpers/accounts";
import { createMultiMarket } from "./helpers/market-helper";
import { MARKET_TYPE_MULTI, randomAmount } from "./helpers/constants";

describe("Multi-Outcome Market Lifecycle", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;
  const NUM_OUTCOMES = 5;
  const initialLiquidity = new BN(20_000_000);
  const buyAmountA = randomAmount(1_500_000, 4_000_000);
  const buyAmountB = randomAmount(1_500_000, 4_000_000);
  const outcomeA = 2;
  const outcomeB = 4;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 30;
    const mkt = await createMultiMarket({
      numOutcomes: NUM_OUTCOMES,
      deadline,
      liquidity: initialLiquidity,
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("creates a 5-outcome multi market with correct state", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.marketType).to.equal(MARKET_TYPE_MULTI);
    expect(market.numOutcomes).to.equal(NUM_OUTCOMES);
    expect(market.reserves.length).to.equal(NUM_OUTCOMES);
    expect(market.state).to.equal(0);
  });

  it("multiple traders buy different outcomes", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(50_000_000));

    const marketBefore = await ctx.program.account.market.fetch(marketPda);

    await ctx.program.methods
      .buy({ outcome: outcomeA, collateralAmount: new BN(buyAmountA) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority,
        vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: require("@solana/web3.js").SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    const marketAfterA = await ctx.program.account.market.fetch(marketPda);

    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderBAta = await getOrCreateAta(ctx.collateralMint, ctx.traderB.publicKey, ctx.traderB);
    await mintTokens(ctx.collateralMint, traderBAta, (ctx.superadmin as any).payer, BigInt(50_000_000));

    await ctx.program.methods
      .buy({ outcome: outcomeB, collateralAmount: new BN(buyAmountB) })
      .accountsPartial({
        trader: ctx.traderB.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posB,
        vaultAuthority,
        vault,
        traderAta: traderBAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: require("@solana/web3.js").SystemProgram.programId,
      })
      .signers([ctx.traderB])
      .rpc();

    const marketAfterB = await ctx.program.account.market.fetch(marketPda);
    const positionA = await ctx.program.account.userPosition.fetch(posA);
    const positionB = await ctx.program.account.userPosition.fetch(posB);

    // Tokens received must be substantial
    expect(positionA.holdings[outcomeA].toNumber()).to.be.greaterThan(buyAmountA / 10);
    expect(positionB.holdings[outcomeB].toNumber()).to.be.greaterThan(buyAmountB / 10);

    // Other outcomes must be zero for each trader
    for (let i = 0; i < NUM_OUTCOMES; i++) {
      if (i !== outcomeA) expect(positionA.holdings[i].toNumber()).to.equal(0);
      if (i !== outcomeB) expect(positionB.holdings[i].toNumber()).to.equal(0);
    }

    // Reserves for bought outcomes must decrease; totalMinted must grow
    expect(marketAfterA.reserves[outcomeA].toNumber()).to.be.lessThan(
      marketBefore.reserves[outcomeA].toNumber()
    );
    expect(marketAfterB.reserves[outcomeB].toNumber()).to.be.lessThan(
      marketAfterA.reserves[outcomeB].toNumber()
    );
    expect(marketAfterB.totalMinted.toNumber()).to.be.greaterThan(
      marketBefore.totalMinted.toNumber()
    );
  });

  it("oracle resolves multi-outcome market (outcome 2 wins)", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    const now = Math.floor(Date.now() / 1000);
    const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    await ctx.program.methods
      .resolveMarket({ outcome: outcomeA, value: new BN(0) })
      .accountsPartial({
        oracle: ctx.oracleKp.publicKey,
        market: marketPda,
      })
      .signers([ctx.oracleKp])
      .rpc();

    const resolved = await ctx.program.account.market.fetch(marketPda);
    expect(resolved.state).to.equal(3);
    expect(resolved.resolvedOutcome).to.equal(outcomeA);
  });

  it("winner (trader A) claims; loser (trader B) fails to claim", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    // Fetch position BEFORE claiming to get winning token count
    const positionBefore = await ctx.program.account.userPosition.fetch(posA);
    const winningTokens = positionBefore.holdings[outcomeA].toNumber();

    const ataBalBefore = (await getAccount(ctx.provider.connection, traderAAta)).amount;

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

    const positionA = await ctx.program.account.userPosition.fetch(posA);
    expect(positionA.claimed).to.be.true;

    // Exact 1:1 payout: winning_tokens minus redemption fee
    const config = await ctx.program.account.protocolConfig.fetch(ctx.protocolConfig);
    const redemptionFeeBps = config.redemptionFeeBps;
    const expectedFee = Math.floor(winningTokens * redemptionFeeBps / 10_000);
    const expectedNet = winningTokens - expectedFee;

    const ataBalAfter = (await getAccount(ctx.provider.connection, traderAAta)).amount;
    expect(Number(ataBalAfter) - Number(ataBalBefore)).to.equal(expectedNet);

    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderBAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderB.publicKey);

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
      expect.fail("Loser should not be able to claim");
    } catch (err: any) {
      expect(err.toString()).to.include("NothingToClaim");
    }
  });
});
