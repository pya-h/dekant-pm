/**
 * BUG-001 regression: distribution buy must not overflow at high liquidity.
 *
 * Before the fix, compute_distribution_buy overflowed u128 when squaring
 * the SCALE-weighted dot product (xw²). Thresholds (uniform weights):
 *   n=2:   ~$26K USDC
 *   n=256: ~$295K USDC
 *
 * This test creates continuous markets with liquidity well above those
 * thresholds and verifies distribution buys succeed.
 */
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserPosition } from "./helpers/pda";
import { getOrCreateAta, mintTokens } from "./helpers/accounts";
import { createContinuousMarket } from "./helpers/market-helper";
import { SCALE } from "./helpers/constants";

describe("BUG-001: Distribution buy overflow at high liquidity", () => {
  before(async () => {
    await ensureSetup();
  });

  it("handles $50K USDC with 2 bins (above $26K overflow threshold)", async () => {
    const liquidity = new BN(50_000_000_000); // $50K USDC (6 decimals)
    const mkt = await createContinuousMarket({
      numBins: 2,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(100).mul(SCALE),
      liquidity,
    });

    const [pos] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAta, (ctx.superadmin as any).payer, BigInt(10_000_000_000));

    // Buy $1 worth — this is the smallest meaningful trade and exercises the
    // overflow path (xw² dominates for small trades on large pools).
    await ctx.program.methods
      .buyDistribution({
        mu: new BN(50).mul(SCALE),
        sigma: new BN(25).mul(SCALE),
        collateralAmount: new BN(1_000_000), // $1 USDC
      })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: mkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: pos,
        vaultAuthority: mkt.vaultAuthority,
        vault: mkt.vault,
        traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .signers([ctx.traderA])
      .rpc();

    const position = await ctx.program.account.userPosition.fetch(pos);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Should receive tokens at $50K liquidity");
  });

  it("handles $500K USDC with 256 bins (above $295K overflow threshold)", async () => {
    const liquidity = new BN(500_000_000_000); // $500K USDC
    const mkt = await createContinuousMarket({
      numBins: 256,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(1000).mul(SCALE),
      liquidity,
    });

    const [pos] = findUserPosition(mkt.marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderAta = await getOrCreateAta(ctx.collateralMint, ctx.traderB.publicKey, ctx.traderB);
    await mintTokens(ctx.collateralMint, traderAta, (ctx.superadmin as any).payer, BigInt(10_000_000_000));

    // 256 bins + U256 arithmetic needs >1M CU; use 1.4M (Solana tx max).
    await ctx.program.methods
      .buyDistribution({
        mu: new BN(500).mul(SCALE),
        sigma: new BN(100).mul(SCALE),
        collateralAmount: new BN(5_000_000), // $5 USDC
      })
      .accountsPartial({
        trader: ctx.traderB.publicKey,
        market: mkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: pos,
        vaultAuthority: mkt.vaultAuthority,
        vault: mkt.vault,
        traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ])
      .signers([ctx.traderB])
      .rpc();

    const position = await ctx.program.account.userPosition.fetch(pos);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Should receive tokens at $500K liquidity with 256 bins");
  });

  it("handles doubling trade on $30K pool (secondary w2*excess overflow)", async () => {
    const liquidity = new BN(30_000_000_000); // $30K USDC
    const mkt = await createContinuousMarket({
      numBins: 2,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(100).mul(SCALE),
      liquidity,
    });

    const [pos] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);
    await mintTokens(ctx.collateralMint, traderAta, (ctx.superadmin as any).payer, BigInt(50_000_000_000));

    // Doubling trade: buy $30K on a $30K pool — triggers w2*excess overflow.
    await ctx.program.methods
      .buyDistribution({
        mu: new BN(50).mul(SCALE),
        sigma: new BN(25).mul(SCALE),
        collateralAmount: new BN(30_000_000_000), // $30K — doubles the pool
      })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: mkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: pos,
        vaultAuthority: mkt.vaultAuthority,
        vault: mkt.vault,
        traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .signers([ctx.traderA])
      .rpc();

    const position = await ctx.program.account.userPosition.fetch(pos);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Doubling trade should succeed after fix");
  });

  it("handles $1M USDC with 64 bins — well above all thresholds", async () => {
    const liquidity = new BN(1_000_000_000_000); // $1M USDC
    const mkt = await createContinuousMarket({
      numBins: 64,
      rangeMin: new BN(100).mul(SCALE),
      rangeMax: new BN(500).mul(SCALE),
      liquidity,
    });

    const [pos] = findUserPosition(mkt.marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderB.publicKey);
    await mintTokens(ctx.collateralMint, traderAta, (ctx.superadmin as any).payer, BigInt(100_000_000_000));

    // Multiple buys at different distribution centers
    for (const [mu, sigma, amount] of [
      [200, 30, 10_000_000],     // $10 buy
      [350, 50, 50_000_000],     // $50 buy
      [250, 20, 100_000_000],    // $100 buy
    ] as [number, number, number][]) {
      await ctx.program.methods
        .buyDistribution({
          mu: new BN(mu).mul(SCALE),
          sigma: new BN(sigma).mul(SCALE),
          collateralAmount: new BN(amount),
        })
        .accountsPartial({
          trader: ctx.traderB.publicKey,
          market: mkt.marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: pos,
          vaultAuthority: mkt.vaultAuthority,
          vault: mkt.vault,
          traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
        ])
        .signers([ctx.traderB])
        .rpc();
    }

    const position = await ctx.program.account.userPosition.fetch(pos);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Multiple buys on $1M pool should all succeed");

    // Verify distribution shape: non-zero bins should cluster, not fill all equally
    const nonZero = holdings.filter((h: number) => h > 0).length;
    expect(nonZero).to.be.greaterThan(1, "Tokens should spread across multiple bins");
  });
});
