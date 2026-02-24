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
import { MARKET_TYPE_CONTINUOUS, SCALE, MIN_TRADE, randomAmount } from "./helpers/constants";

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
    const totalTokens = position.holdings.reduce(
      (sum: number, h: any) => sum + h.toNumber(), 0
    );
    expect(totalTokens).to.be.greaterThan(0);
  });

  it("trader B buys distribution N(200, 10)", async () => {
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
    const totalTokens = position.holdings.reduce(
      (sum: number, h: any) => sum + h.toNumber(), 0
    );
    expect(totalTokens).to.be.greaterThan(0);
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
  });

  it("trader A claims payout from continuous market", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const market = await ctx.program.account.market.fetch(marketPda);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    const positionBefore = await ctx.program.account.userPosition.fetch(posA);
    const winningBin = market.resolvedOutcome;
    const winningTokens = positionBefore.holdings[winningBin].toNumber();

    if (winningTokens > 0) {
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
    }
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
    const totalAfterSell = positionAfterSell.holdings.reduce(
      (sum: number, h: any) => sum + h.toNumber(), 0
    );
    expect(totalAfterSell).to.be.lessThan(totalBought);

    const ataBalAfter = (await getAccount(ctx.provider.connection, traderAAta)).amount;
    expect(Number(ataBalAfter)).to.be.greaterThan(Number(ataBalBefore));
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
