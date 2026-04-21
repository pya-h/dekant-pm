import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
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
import { createContinuousMarket, createBinaryMarket } from "./helpers/market-helper";
import { MARKET_TYPE_CONTINUOUS, SCALE, MIN_TRADE } from "./helpers/constants";

describe("Continuous Market Lifecycle", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;
  const NUM_BINS = 64;
  const RANGE_MIN = new BN(100).mul(SCALE);
  const RANGE_MAX = new BN(300).mul(SCALE);
  const initialLiquidity = new BN(20_000_000);

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 15;
    const mkt = await createContinuousMarket({
      numBins: NUM_BINS,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      deadline,
      liquidity: initialLiquidity,
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("creates a 64-bin continuous market with correct state", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.marketType).to.equal(MARKET_TYPE_CONTINUOUS);
    expect(market.numOutcomes).to.equal(NUM_BINS);
    expect(market.reserves.length).to.equal(NUM_BINS);
    expect(market.rangeMin.toString()).to.equal(RANGE_MIN.toString());
    expect(market.rangeMax.toString()).to.equal(RANGE_MAX.toString());
  });

  it("trader A buys distribution N(150, 20)", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(50_000_000));

    const marketBefore = await ctx.program.account.market.fetch(marketPda);

    await ctx.program.methods
      .buyDistribution({
        mu: new BN(150).mul(SCALE),
        sigma: new BN(20).mul(SCALE),
        collateralAmount: new BN(5_000_000),
      })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority,
        vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .signers([ctx.traderA])
      .rpc();

    const position = await ctx.program.account.userPosition.fetch(posA);
    const marketAfter = await ctx.program.account.market.fetch(marketPda);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const totalTokens = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(totalTokens).to.be.greaterThan(0);

    // Distribution shape: mu=150 in range [100, 300] with 64 bins
    // Bin width = 200/64 = 3.125. mu=150 → bin index ~(150-100)/3.125 = 16
    const muBin = Math.floor((150 - 100) / ((300 - 100) / NUM_BINS));
    expect(holdings[muBin]).to.be.greaterThan(0,
      `Bin ${muBin} (center of distribution) must have tokens`);

    // Non-zero bins should cluster around the center (within ~2-3 sigma)
    const nonZeroBins = holdings.filter((h: number) => h > 0).length;
    expect(nonZeroBins).to.be.greaterThan(1, "Distribution should spread across multiple bins");
    expect(nonZeroBins).to.be.lessThan(NUM_BINS, "Distribution should not fill all bins equally");

    // totalMinted must increase
    expect(marketAfter.totalMinted.toNumber()).to.be.greaterThan(
      marketBefore.totalMinted.toNumber()
    );
  });

  it("trader B buys distribution N(200, 10) — narrower, different center", async () => {
    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderBAta = await getOrCreateAta(ctx.collateralMint, ctx.traderB.publicKey, ctx.traderB);
    await mintTokens(ctx.collateralMint, traderBAta, (ctx.superadmin as any).payer, BigInt(50_000_000));

    await ctx.program.methods
      .buyDistribution({
        mu: new BN(200).mul(SCALE),
        sigma: new BN(10).mul(SCALE),
        collateralAmount: new BN(3_000_000),
      })
      .accountsPartial({
        trader: ctx.traderB.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posB,
        vaultAuthority,
        vault,
        traderAta: traderBAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .signers([ctx.traderB])
      .rpc();

    const position = await ctx.program.account.userPosition.fetch(posB);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const totalTokens = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(totalTokens).to.be.greaterThan(0);

    // mu=200 in [100,300] with 64 bins → bin ~32
    const muBin = Math.floor((200 - 100) / ((300 - 100) / NUM_BINS));
    expect(holdings[muBin]).to.be.greaterThan(0,
      `Bin ${muBin} (center for mu=200) must have tokens`);

    // Narrower sigma (10 vs 20) → fewer non-zero bins than trader A
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const positionA = await ctx.program.account.userPosition.fetch(posA);
    const holdingsA = positionA.holdings.map((h: any) => h.toNumber());
    const nonZeroBinsA = holdingsA.filter((h: number) => h > 0).length;
    const nonZeroBinsB = holdings.filter((h: number) => h > 0).length;
    expect(nonZeroBinsB).to.be.lessThanOrEqual(nonZeroBinsA,
      "Narrower sigma should have fewer non-zero bins");
  });

  it("oracle resolves with value 155 (close to trader A's center)", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    const now = Math.floor(Date.now() / 1000);
    const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    // outcome param ignored for continuous — computed from value
    await ctx.program.methods
      .resolveMarket({ outcome: 0, value: new BN(155).mul(SCALE) })
      .accountsPartial({
        oracle: ctx.oracleKp.publicKey,
        market: marketPda,
      })
      .signers([ctx.oracleKp])
      .rpc();

    const resolved = await ctx.program.account.market.fetch(marketPda);
    expect(resolved.state).to.equal(3);
    expect(resolved.resolvedValue.toString()).to.equal(new BN(155).mul(SCALE).toString());

    // Validate bin mapping: value 155 in range [100, 300] with 64 bins
    // bin = floor((155 - 100) * 64 / (300 - 100)) = floor(55 * 64 / 200) = floor(17.6) = 17
    const expectedBin = Math.floor((155 - 100) * NUM_BINS / (300 - 100));
    expect(resolved.resolvedOutcome).to.equal(expectedBin,
      `Resolved outcome bin should be ${expectedBin} for value 155 in [100, 300] with ${NUM_BINS} bins`);
  });

  it("trader A claims payout from continuous market", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const market = await ctx.program.account.market.fetch(marketPda);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    const positionBefore = await ctx.program.account.userPosition.fetch(posA);
    const winningBin = market.resolvedOutcome;
    const winningTokens = positionBefore.holdings[winningBin].toNumber();

    // Hard assertion: distribution centered at 150 with resolve at 155 MUST populate the winning bin
    expect(winningTokens).to.be.greaterThan(0, "Distribution N(150,20) must have tokens in winning bin for resolve value 155");

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

    const positionAfter = await ctx.program.account.userPosition.fetch(posA);
    expect(positionAfter.claimed).to.be.true;

    // Exact 1:1 payout: winning_tokens minus redemption fee
    const config = await ctx.program.account.protocolConfig.fetch(ctx.protocolConfig);
    const redemptionFeeBps = config.redemptionFeeBps;
    const expectedFee = Math.floor(winningTokens * redemptionFeeBps / 10_000);
    const expectedNet = winningTokens - expectedFee;

    const ataBalAfter = (await getAccount(ctx.provider.connection, traderAAta)).amount;
    expect(Number(ataBalAfter) - Number(ataBalBefore)).to.equal(expectedNet);
  });
});

describe("Sell Distribution on Continuous Market", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;
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

  it("buy distribution then sell distribution", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(50_000_000));

    await ctx.program.methods
      .buyDistribution({
        mu: new BN(50).mul(SCALE),
        sigma: new BN(15).mul(SCALE),
        collateralAmount: new BN(5_000_000),
      })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority,
        vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .signers([ctx.traderA])
      .rpc();

    const positionAfterBuy = await ctx.program.account.userPosition.fetch(posA);
    const totalBought = positionAfterBuy.holdings.reduce(
      (sum: number, h: any) => sum + h.toNumber(), 0
    );
    expect(totalBought).to.be.greaterThan(0);

    const ataBalBefore = (await getAccount(ctx.provider.connection, traderAAta)).amount;

    const sellAmount = Math.floor(totalBought / 4);
    expect(sellAmount).to.be.greaterThan(MIN_TRADE.toNumber());

    await ctx.program.methods
      .sellDistribution({
        mu: new BN(50).mul(SCALE),
        sigma: new BN(15).mul(SCALE),
        tokenAmount: new BN(sellAmount),
      })
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
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .signers([ctx.traderA])
      .rpc();

    const positionAfterSell = await ctx.program.account.userPosition.fetch(posA);
    const holdingsAfterSell = positionAfterSell.holdings.map((h: any) => h.toNumber());
    const totalAfterSell = holdingsAfterSell.reduce((s: number, h: number) => s + h, 0);
    expect(totalAfterSell).to.be.lessThan(totalBought);

    // Per-bin validation: every bin's holdings must decrease or stay at 0
    const holdingsAfterBuy = positionAfterBuy.holdings.map((h: any) => h.toNumber());
    for (let i = 0; i < holdingsAfterBuy.length; i++) {
      expect(holdingsAfterSell[i]).to.be.lessThanOrEqual(holdingsAfterBuy[i],
        `Bin ${i} holdings must not increase after sell`);
    }

    // Bins that had tokens should have some removed (at least one bin should decrease)
    const decreasedBins = holdingsAfterBuy.filter(
      (h: number, i: number) => h > 0 && holdingsAfterSell[i] < h
    ).length;
    expect(decreasedBins).to.be.greaterThan(0, "At least one bin should have tokens removed");

    const ataBalAfter = (await getAccount(ctx.provider.connection, traderAAta)).amount;
    const collateralReceived = Number(ataBalAfter) - Number(ataBalBefore);
    expect(collateralReceived).to.be.greaterThan(0, "Sell should return collateral");
  });

  it("rejects sell distribution below MIN_TRADE_AMOUNT", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    try {
      await ctx.program.methods
        .sellDistribution({
          mu: new BN(50).mul(SCALE),
          sigma: new BN(15).mul(SCALE),
          tokenAmount: new BN(500),
        })
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
      expect.fail("Should reject sell distribution below MIN_TRADE_AMOUNT");
    } catch (err: any) {
      expect(err.toString()).to.include("TradeTooSmall");
    }
  });

  it("rejects sell distribution on discrete market", async () => {
    const binaryMkt = await createBinaryMarket();
    const [posA] = findUserPosition(binaryMkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(5_000_000));

    // Create user_position by buying first, so the account exists for sell_distribution
    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(2_000_000) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: binaryMkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: binaryMkt.vaultAuthority,
        vault: binaryMkt.vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    try {
      await ctx.program.methods
        .sellDistribution({
          mu: new BN(500_000_000),
          sigma: new BN(100_000_000),
          tokenAmount: new BN(2_000),
        })
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: binaryMkt.marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority: binaryMkt.vaultAuthority,
          vault: binaryMkt.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should reject sell_distribution on discrete market");
    } catch (err: any) {
      expect(err.toString()).to.include("WrongMarketType");
    }
  });

  it("rejects discrete sell on continuous market", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    try {
      await ctx.program.methods
        .sell({ outcome: 0, tokenAmount: new BN(2_000) })
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
      expect.fail("Should reject discrete sell on continuous market");
    } catch (err: any) {
      expect(err.toString()).to.include("WrongMarketType");
    }
  });
});
