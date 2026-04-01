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
    const collateralAmount = 1_000_000; // $1 USDC
    const mkt = await createContinuousMarket({
      numBins: 2,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(100).mul(SCALE),
      liquidity,
    });

    const [pos] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAta, (ctx.superadmin as any).payer, BigInt(10_000_000_000));

    // Snapshot balances before trade
    const traderBalBefore = (await ctx.provider.connection.getTokenAccountBalance(traderAta)).value.amount;
    const vaultBalBefore = (await ctx.provider.connection.getTokenAccountBalance(mkt.vault)).value.amount;
    const marketBefore = await ctx.program.account.market.fetch(mkt.marketPda);

    // Buy $1 worth — this is the smallest meaningful trade and exercises the
    // overflow path (xw² dominates for small trades on large pools).
    await ctx.program.methods
      .buyDistribution({
        mu: new BN(50).mul(SCALE),
        sigma: new BN(25).mul(SCALE),
        collateralAmount: new BN(collateralAmount),
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

    // Verify balance changes
    const traderBalAfter = (await ctx.provider.connection.getTokenAccountBalance(traderAta)).value.amount;
    const vaultBalAfter = (await ctx.provider.connection.getTokenAccountBalance(mkt.vault)).value.amount;
    expect(Number(traderBalBefore) - Number(traderBalAfter)).to.equal(collateralAmount,
      "trader should pay exactly collateralAmount");
    expect(Number(vaultBalAfter) - Number(vaultBalBefore)).to.equal(collateralAmount,
      "vault should receive exactly collateralAmount");

    // Verify market totalMinted increased by netAmount (collateral - 0.3% fee)
    const marketAfter = await ctx.program.account.market.fetch(mkt.marketPda);
    const fee = Math.floor(collateralAmount * 30 / 10_000); // 0.3% trade fee
    const netAmount = collateralAmount - fee;
    const mintedIncrease = marketAfter.totalMinted.sub(marketBefore.totalMinted).toNumber();
    expect(mintedIncrease).to.equal(netAmount, "totalMinted should increase by netAmount");

    // Verify holdings
    const position = await ctx.program.account.userPosition.fetch(pos);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Should receive tokens");

    // mu=50 centered in [0,100] with sigma=25 → both bins get tokens
    expect(holdings[0]).to.be.greaterThan(0, "bin 0 should get tokens");
    expect(holdings[1]).to.be.greaterThan(0, "bin 1 should get tokens");

    // Symmetric Gaussian → roughly equal per bin (within 10% of each other)
    const maxH = Math.max(...holdings);
    const minH = Math.min(...holdings);
    expect(maxH - minH).to.be.lessThanOrEqual(Math.ceil(maxH * 0.1),
      `bins should be roughly equal: ${holdings}`);
  });

  it("handles $500K USDC with 256 bins (above $295K overflow threshold)", async () => {
    const liquidity = new BN(500_000_000_000); // $500K USDC
    const collateralAmount = 5_000_000; // $5 USDC
    const mkt = await createContinuousMarket({
      numBins: 256,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(1000).mul(SCALE),
      liquidity,
    });

    const [pos] = findUserPosition(mkt.marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderAta = await getOrCreateAta(ctx.collateralMint, ctx.traderB.publicKey, ctx.traderB);
    await mintTokens(ctx.collateralMint, traderAta, (ctx.superadmin as any).payer, BigInt(10_000_000_000));

    // Snapshot balances before trade
    const traderBalBefore = (await ctx.provider.connection.getTokenAccountBalance(traderAta)).value.amount;
    const vaultBalBefore = (await ctx.provider.connection.getTokenAccountBalance(mkt.vault)).value.amount;
    const marketBefore = await ctx.program.account.market.fetch(mkt.marketPda);

    // 256 bins + U256 arithmetic needs >1M CU; use 1.4M (Solana tx max).
    await ctx.program.methods
      .buyDistribution({
        mu: new BN(500).mul(SCALE),
        sigma: new BN(100).mul(SCALE),
        collateralAmount: new BN(collateralAmount),
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

    // Verify balance changes
    const traderBalAfter = (await ctx.provider.connection.getTokenAccountBalance(traderAta)).value.amount;
    const vaultBalAfter = (await ctx.provider.connection.getTokenAccountBalance(mkt.vault)).value.amount;
    expect(Number(traderBalBefore) - Number(traderBalAfter)).to.equal(collateralAmount,
      "trader should pay exactly collateralAmount");
    expect(Number(vaultBalAfter) - Number(vaultBalBefore)).to.equal(collateralAmount,
      "vault should receive exactly collateralAmount");

    // Verify market totalMinted increased by netAmount
    const marketAfter = await ctx.program.account.market.fetch(mkt.marketPda);
    const fee = Math.floor(collateralAmount * 30 / 10_000);
    const netAmount = collateralAmount - fee;
    const mintedIncrease = marketAfter.totalMinted.sub(marketBefore.totalMinted).toNumber();
    expect(mintedIncrease).to.equal(netAmount, "totalMinted should increase by netAmount");

    // Verify holdings
    const position = await ctx.program.account.userPosition.fetch(pos);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Should receive tokens at $500K liquidity with 256 bins");

    // Wide sigma=100 on range 0-1000 with 256 bins → tokens spread across many bins
    const nonZero = holdings.filter((h: number) => h > 0).length;
    expect(nonZero).to.be.greaterThan(50, "wide sigma should fill many bins");

    // Total tokens should be reasonable relative to netAmount
    // L2-norm: total ≈ netAmount * sqrt(nonZero_effective)
    expect(total).to.be.greaterThan(netAmount, "total tokens should exceed netAmount for multi-bin buy");
  });

  it("handles doubling trade on $30K pool (secondary w2*excess overflow)", async () => {
    const liquidity = new BN(30_000_000_000); // $30K USDC
    const collateralAmount = 30_000_000_000; // $30K — doubles the pool
    const mkt = await createContinuousMarket({
      numBins: 2,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(100).mul(SCALE),
      liquidity,
    });

    const [pos] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);
    await mintTokens(ctx.collateralMint, traderAta, (ctx.superadmin as any).payer, BigInt(50_000_000_000));

    // Snapshot balances before trade
    const traderBalBefore = (await ctx.provider.connection.getTokenAccountBalance(traderAta)).value.amount;
    const vaultBalBefore = (await ctx.provider.connection.getTokenAccountBalance(mkt.vault)).value.amount;
    const marketBefore = await ctx.program.account.market.fetch(mkt.marketPda);

    // Doubling trade: buy $30K on a $30K pool — triggers w2*excess overflow.
    await ctx.program.methods
      .buyDistribution({
        mu: new BN(50).mul(SCALE),
        sigma: new BN(25).mul(SCALE),
        collateralAmount: new BN(collateralAmount),
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

    // Verify balance changes
    const traderBalAfter = (await ctx.provider.connection.getTokenAccountBalance(traderAta)).value.amount;
    const vaultBalAfter = (await ctx.provider.connection.getTokenAccountBalance(mkt.vault)).value.amount;
    expect(Number(traderBalBefore) - Number(traderBalAfter)).to.equal(collateralAmount,
      "trader should pay exactly collateralAmount");
    expect(Number(vaultBalAfter) - Number(vaultBalBefore)).to.equal(collateralAmount,
      "vault should receive exactly collateralAmount");

    // Verify market totalMinted increased by netAmount
    const marketAfter = await ctx.program.account.market.fetch(mkt.marketPda);
    const fee = Math.floor(collateralAmount * 30 / 10_000);
    const netAmount = collateralAmount - fee;
    const mintedIncrease = marketAfter.totalMinted.sub(marketBefore.totalMinted).toNumber();
    expect(mintedIncrease).to.equal(netAmount, "totalMinted should increase by netAmount");

    // Verify holdings
    const position = await ctx.program.account.userPosition.fetch(pos);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Doubling trade should succeed after fix");

    // Both bins should receive significant tokens
    expect(holdings[0]).to.be.greaterThan(0, "bin 0 should get tokens");
    expect(holdings[1]).to.be.greaterThan(0, "bin 1 should get tokens");

    // Doubling trade on L2-norm AMM yields total > netAmount (pool expansion effect)
    expect(total).to.be.greaterThan(netAmount,
      `total tokens (${total}) should exceed netAmount (${netAmount}) for doubling trade`);
    expect(total).to.be.lessThan(netAmount * 2,
      `total tokens (${total}) should be < 2x netAmount`);
  });

  it("handles $1M USDC with 64 bins — well above all thresholds", async () => {
    const liquidity = new BN(1_000_000_000_000); // $1M USDC
    const trades: [number, number, number][] = [
      [200, 30, 10_000_000],     // $10 buy centered at 200
      [350, 50, 50_000_000],     // $50 buy centered at 350
      [250, 20, 100_000_000],    // $100 buy centered at 250
    ];
    const totalCollateral = trades.reduce((s, [,,a]) => s + a, 0); // 160_000_000

    const mkt = await createContinuousMarket({
      numBins: 64,
      rangeMin: new BN(100).mul(SCALE),
      rangeMax: new BN(500).mul(SCALE),
      liquidity,
    });

    const [pos] = findUserPosition(mkt.marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderB.publicKey);
    await mintTokens(ctx.collateralMint, traderAta, (ctx.superadmin as any).payer, BigInt(100_000_000_000));

    // Snapshot balances before trades
    const traderBalBefore = (await ctx.provider.connection.getTokenAccountBalance(traderAta)).value.amount;
    const vaultBalBefore = (await ctx.provider.connection.getTokenAccountBalance(mkt.vault)).value.amount;
    const marketBefore = await ctx.program.account.market.fetch(mkt.marketPda);

    // Multiple buys at different distribution centers
    for (const [mu, sigma, amount] of trades) {
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

    // Verify total balance changes across all 3 trades
    const traderBalAfter = (await ctx.provider.connection.getTokenAccountBalance(traderAta)).value.amount;
    const vaultBalAfter = (await ctx.provider.connection.getTokenAccountBalance(mkt.vault)).value.amount;
    expect(Number(traderBalBefore) - Number(traderBalAfter)).to.equal(totalCollateral,
      "trader should pay sum of all collateralAmounts");
    expect(Number(vaultBalAfter) - Number(vaultBalBefore)).to.equal(totalCollateral,
      "vault should receive sum of all collateralAmounts");

    // Verify market totalMinted increased by sum of netAmounts
    const marketAfter = await ctx.program.account.market.fetch(mkt.marketPda);
    const totalNet = trades.reduce((s, [,,a]) => s + a - Math.floor(a * 30 / 10_000), 0);
    const mintedIncrease = marketAfter.totalMinted.sub(marketBefore.totalMinted).toNumber();
    expect(mintedIncrease).to.equal(totalNet, "totalMinted should increase by sum of netAmounts");

    // Verify holdings
    const position = await ctx.program.account.userPosition.fetch(pos);
    const holdings = position.holdings.map((h: any) => h.toNumber());
    const total = holdings.reduce((s: number, h: number) => s + h, 0);
    expect(total).to.be.greaterThan(0, "Multiple buys on $1M pool should all succeed");

    // Tokens should spread across many bins (3 overlapping Gaussians, range 100-500)
    const nonZero = holdings.filter((h: number) => h > 0).length;
    expect(nonZero).to.be.greaterThan(10, "tokens should spread across many bins");

    // Max holding should not be at the edges (buys centered at 200, 250, 350)
    const maxIdx = holdings.indexOf(Math.max(...holdings));
    expect(maxIdx).to.be.greaterThan(0, "max bin shouldn't be at left edge");
    expect(maxIdx).to.be.lessThan(63, "max bin shouldn't be at right edge");
  });
});
