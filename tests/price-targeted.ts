import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserPosition } from "./helpers/pda";
import { getOrCreateAta, mintTokens } from "./helpers/accounts";
import { createBinaryMarket } from "./helpers/market-helper";

describe("Price-Targeted Trading", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;
  let traderAAta: PublicKey;
  let traderBAta: PublicKey;
  let posA: PublicKey;
  let posB: PublicKey;

  before(async () => {
    await ensureSetup();
    const mkt = await createBinaryMarket({
      deadline: Math.floor(Date.now() / 1000) + 600,
      liquidity: new BN(10_000_000),
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(50_000_000));
    traderBAta = await getOrCreateAta(ctx.collateralMint, ctx.traderB.publicKey, ctx.traderB);
    await mintTokens(ctx.collateralMint, traderBAta, (ctx.superadmin as any).payer, BigInt(50_000_000));

    [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
  });

  it("buyToPrice: trader A buys outcome 0 to 70%", async () => {
    await ctx.program.methods
      .buyToPrice({
        outcome: 0,
        targetProbability: new BN(700_000_000),
        maxCollateral: new BN(20_000_000),
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
      .signers([ctx.traderA])
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    const totalMinted = market.totalMinted.toNumber();
    const x0 = totalMinted - market.reserves[0].toNumber();
    // Linear displayed probability: x_0 / sum_j x_j.
    const sumX = market.reserves.reduce((s, r) => s + (totalMinted - r.toNumber()), 0);
    const prob0 = (x0 * 1_000_000_000) / sumX;
    expect(prob0).to.be.greaterThan(690_000_000);
    expect(prob0).to.be.lessThan(710_000_000);

    const position = await ctx.program.account.userPosition.fetch(posA);
    expect(position.holdings[0].toNumber()).to.be.greaterThan(0);
  });

  it("sellToPrice: trader A sells outcome 0 back to ~50%", async () => {
    await ctx.program.methods
      .sellToPrice({
        outcome: 0,
        targetProbability: new BN(500_000_000),
        minCollateralOut: new BN(0),
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

    const market = await ctx.program.account.market.fetch(marketPda);
    const totalMinted = market.totalMinted.toNumber();
    const x0 = totalMinted - market.reserves[0].toNumber();
    // Linear displayed probability: x_0 / sum_j x_j.
    const sumX = market.reserves.reduce((s, r) => s + (totalMinted - r.toNumber()), 0);
    const prob0 = (x0 * 1_000_000_000) / sumX;
    expect(prob0).to.be.greaterThan(490_000_000);
    expect(prob0).to.be.lessThan(510_000_000);
  });

  it("buyToPrice: error when target below current probability", async () => {
    try {
      await ctx.program.methods
        .buyToPrice({
          outcome: 0,
          targetProbability: new BN(300_000_000),
          maxCollateral: new BN(10_000_000),
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
        .signers([ctx.traderB])
        .rpc();
      expect.fail("Should have thrown TargetAlreadyMet error");
    } catch (err: any) {
      expect(err.toString()).to.include("TargetAlreadyMet");
    }
  });

  it("buyToPrice: error when max_collateral too low", async () => {
    try {
      await ctx.program.methods
        .buyToPrice({
          outcome: 0,
          targetProbability: new BN(900_000_000),
          maxCollateral: new BN(1_000),
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
        .signers([ctx.traderB])
        .rpc();
      expect.fail("Should have thrown MaxCollateralExceeded error");
    } catch (err: any) {
      expect(err.toString()).to.include("MaxCollateralExceeded");
    }
  });

  it("sellToPrice: error when target above current probability", async () => {
    await ctx.program.methods
      .buy({ outcome: 1, collateralAmount: new BN(2_000_000) })
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
      .signers([ctx.traderB])
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    const totalMinted = market.totalMinted.toNumber();
    const x1 = totalMinted - market.reserves[1].toNumber();
    const sumX = market.reserves.reduce((s, r) => s + (totalMinted - r.toNumber()), 0);
    const currentProb1 = Math.floor((x1 * 1_000_000_000) / sumX);

    try {
      await ctx.program.methods
        .sellToPrice({
          outcome: 1,
          targetProbability: new BN(currentProb1 + 100_000_000),
          minCollateralOut: new BN(0),
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
        })
        .signers([ctx.traderB])
        .rpc();
      expect.fail("Should have thrown TargetAlreadyMet error");
    } catch (err: any) {
      expect(err.toString()).to.include("TargetAlreadyMet");
    }
  });

  it("sellToPrice: error when min_collateral_out too high", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    const totalMinted = market.totalMinted.toNumber();
    const x1 = totalMinted - market.reserves[1].toNumber();
    const sumX = market.reserves.reduce((s, r) => s + (totalMinted - r.toNumber()), 0);
    const currentProb1 = Math.floor((x1 * 1_000_000_000) / sumX);
    const targetProb = Math.max(currentProb1 - 50_000_000, 1);

    try {
      await ctx.program.methods
        .sellToPrice({
          outcome: 1,
          targetProbability: new BN(targetProb),
          minCollateralOut: new BN(999_999_999),
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
        })
        .signers([ctx.traderB])
        .rpc();
      expect.fail("Should have thrown MinCollateralNotMet error");
    } catch (err: any) {
      expect(err.toString()).to.include("MinCollateralNotMet");
    }
  });
});
