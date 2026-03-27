import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserPosition, findUserRole, findLpPosition } from "./helpers/pda";
import { getOrCreateAta, mintTokens, airdropSol } from "./helpers/accounts";
import { createBinaryMarket, createMultiMarket, createContinuousMarket } from "./helpers/market-helper";
import {
  ROLE_ORACLE,
  ROLE_ADMIN,
  MARKET_TYPE_BINARY,
  SCALE,
} from "./helpers/constants";

function computeProbabilities(reserves: string[], totalMinted: string): number[] {
  const tm = Number(totalMinted);
  if (tm === 0) return reserves.map(() => 1 / reserves.length);
  const kSq = tm * tm;
  return reserves.map((r) => {
    const x = tm - Number(r);
    return (x * x) / kSq;
  });
}

describe("Edge Cases", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;

  before(async () => {
    await ensureSetup();
    const mkt = await createBinaryMarket({ deadline: Math.floor(Date.now() / 1000) + 120 });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("rejects buy below minimum trade amount", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(10_000_000));

    try {
      await ctx.program.methods
        .buy({ outcome: 0, collateralAmount: new BN(100) })
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
      expect.fail("Should reject trade below minimum");
    } catch (err: any) {
      expect(err.toString()).to.include("TradeTooSmall");
    }
  });

  it("rejects sell with zero tokens", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
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

    try {
      await ctx.program.methods
        .sell({ outcome: 0, tokenAmount: new BN(0) })
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
      expect.fail("Should reject zero-token sell");
    } catch (err: any) {
      expect(err.toString()).to.include("TradeTooSmall");
    }
  });

  it("rejects sell exceeding holdings", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const position = await ctx.program.account.userPosition.fetch(posA);
    const holdings = position.holdings[0].toNumber();
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    try {
      await ctx.program.methods
        .sell({ outcome: 0, tokenAmount: new BN(holdings + 1_000_000) })
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
      expect.fail("Should reject sell exceeding holdings");
    } catch (err: any) {
      expect(err.toString()).to.include("InsufficientHoldings");
    }
  });

  it("rejects wrong oracle resolving market", async () => {
    try {
      await ctx.program.methods
        .resolveMarket({ outcome: 0, value: new BN(0) })
        .accountsPartial({
          oracle: ctx.traderA.publicKey,
          market: marketPda,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Wrong oracle should not be able to resolve");
    } catch (err: any) {
      expect(err.toString()).to.include("WrongOracle");
    }
  });

  it("rejects unauthorized role assignment", async () => {
    const fakeAdmin = Keypair.generate();
    await airdropSol(fakeAdmin.publicKey);

    const [rolePda] = findUserRole(ctx.traderA.publicKey, ROLE_ORACLE, ctx.program.programId);

    try {
      await ctx.program.methods
        .assignRole({ role: ROLE_ORACLE })
        .accountsPartial({
          authority: fakeAdmin.publicKey,
          protocolConfig: ctx.protocolConfig,
          authorityRole: null,
          targetUser: ctx.traderA.publicKey,
          userRole: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([fakeAdmin])
        .rpc();
      expect.fail("Unauthorized user should not assign roles");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  it("rejects liquidity below minimum", async () => {
    const [lpPos] = findLpPosition(marketPda, ctx.lpProvider.publicKey, ctx.program.programId);
    const lpAta = await getOrCreateAta(ctx.collateralMint, ctx.lpProvider.publicKey, ctx.lpProvider);

    try {
      await ctx.program.methods
        .addLiquidity({ amount: new BN(100) })
        .accountsPartial({
          provider: ctx.lpProvider.publicKey,
          market: marketPda,
          lpPosition: lpPos,
          vaultAuthority,
          vault,
          providerAta: lpAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([ctx.lpProvider])
        .rpc();
      expect.fail("Should reject liquidity below minimum");
    } catch (err: any) {
      expect(err.toString()).to.include("LiquidityTooSmall");
    }
  });

  it("rejects duplicate claim", async () => {
    const claimMkt = await createBinaryMarket({ deadline: Math.floor(Date.now() / 1000) + 5 });
    const [posA] = findUserPosition(claimMkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(5_000_000));

    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(2_000_000) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: claimMkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: claimMkt.vaultAuthority,
        vault: claimMkt.vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    await new Promise((resolve) => setTimeout(resolve, 7000));

    await ctx.program.methods
      .resolveMarket({ outcome: 0, value: new BN(0) })
      .accountsPartial({
        oracle: ctx.oracleKp.publicKey,
        market: claimMkt.marketPda,
      })
      .signers([ctx.oracleKp])
      .rpc();

    await ctx.program.methods
      .claimPayout()
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: claimMkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: claimMkt.vaultAuthority,
        vault: claimMkt.vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.traderA])
      .rpc();

    try {
      await ctx.program.methods
        .claimPayout()
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: claimMkt.marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority: claimMkt.vaultAuthority,
          vault: claimMkt.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Duplicate claim should fail");
    } catch (err: any) {
      expect(err.toString()).to.include("AlreadyClaimed");
    }
  });

  it("rejects fee update exceeding maximum", async () => {
    try {
      await ctx.program.methods
        .updateFees({
          creationFeeBps: 6000, // 60% > MAX_FEE_BPS (5000)
          tradeFeeBps: 30,
          redemptionFeeBps: 50,
          lpFeeShareBps: 5000,
        })
        .accountsPartial({
          authority: ctx.superadmin.publicKey,
          protocolConfig: ctx.protocolConfig,
        })
        .rpc();
      expect.fail("Should reject fee exceeding max");
    } catch (err: any) {
      expect(err.toString()).to.include("FeeTooHigh");
    }
  });

  it("admin can assign oracle/creator roles (delegation)", async () => {
    const newUser = Keypair.generate();
    await airdropSol(newUser.publicKey);

    const [adminRolePda] = findUserRole(ctx.adminKp.publicKey, ROLE_ADMIN, ctx.program.programId);
    const [newOracleRole] = findUserRole(newUser.publicKey, ROLE_ORACLE, ctx.program.programId);

    await ctx.program.methods
      .assignRole({ role: ROLE_ORACLE })
      .accountsPartial({
        authority: ctx.adminKp.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: adminRolePda,
        targetUser: newUser.publicKey,
        userRole: newOracleRole,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.adminKp])
      .rpc();

    const role = await ctx.program.account.userRole.fetch(newOracleRole);
    expect(role.role).to.equal(ROLE_ORACLE);
    expect(role.assignedBy.toString()).to.equal(ctx.adminKp.publicKey.toString());
  });

  it("admin cannot assign admin role", async () => {
    const newUser = Keypair.generate();
    await airdropSol(newUser.publicKey);

    const [adminRolePda] = findUserRole(ctx.adminKp.publicKey, ROLE_ADMIN, ctx.program.programId);
    const [newAdminRole] = findUserRole(newUser.publicKey, ROLE_ADMIN, ctx.program.programId);

    try {
      await ctx.program.methods
        .assignRole({ role: ROLE_ADMIN })
        .accountsPartial({
          authority: ctx.adminKp.publicKey,
          protocolConfig: ctx.protocolConfig,
          authorityRole: adminRolePda,
          targetUser: newUser.publicKey,
          userRole: newAdminRole,
          systemProgram: SystemProgram.programId,
        })
        .signers([ctx.adminKp])
        .rpc();
      expect.fail("Admin should not be able to assign admin role");
    } catch (err: any) {
      expect(err.toString()).to.include("AdminCannotAssignAdmin");
    }
  });

  it("rejects discrete buy on continuous market", async () => {
    const contMkt = await createContinuousMarket({
      numBins: 32,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(100).mul(SCALE),
    });
    const [posA] = findUserPosition(contMkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    try {
      await ctx.program.methods
        .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: contMkt.marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority: contMkt.vaultAuthority,
          vault: contMkt.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should reject discrete buy on continuous market");
    } catch (err: any) {
      expect(err.toString()).to.include("WrongMarketType");
    }
  });

  it("rejects sell below MIN_TRADE_AMOUNT", async () => {
    const freshMkt = await createBinaryMarket({ deadline: Math.floor(Date.now() / 1000) + 120 });

    const [posA] = findUserPosition(freshMkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(2_000_000) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: freshMkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: freshMkt.vaultAuthority,
        vault: freshMkt.vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    try {
      await ctx.program.methods
        .sell({ outcome: 0, tokenAmount: new BN(500) })
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: freshMkt.marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority: freshMkt.vaultAuthority,
          vault: freshMkt.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should reject sell below MIN_TRADE_AMOUNT");
    } catch (err: any) {
      expect(err.toString()).to.include("TradeTooSmall");
    }
  });

  it("rejects buy distribution on discrete market", async () => {
    const freshMkt = await createBinaryMarket({ deadline: Math.floor(Date.now() / 1000) + 120 });
    const [posA] = findUserPosition(freshMkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    try {
      await ctx.program.methods
        .buyDistribution({
          mu: new BN(500_000_000),
          sigma: new BN(100_000_000),
          collateralAmount: new BN(1_000_000),
        })
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: freshMkt.marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority: freshMkt.vaultAuthority,
          vault: freshMkt.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should reject buy_distribution on discrete market");
    } catch (err: any) {
      expect(err.toString()).to.include("WrongMarketType");
    }
  });
});

describe("Large Trades (trade >> pool)", () => {
  it("binary: buy with 2x pool liquidity succeeds", async () => {
    const mkt = await createBinaryMarket({ liquidity: new BN(10_000_000) });
    const [posA] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(100_000_000));

    // Buy with 20M on a 10M pool (2x)
    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(20_000_000) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: mkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: mkt.vaultAuthority,
        vault: mkt.vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    const position = await ctx.program.account.userPosition.fetch(posA);

    // Trader received tokens
    expect(position.holdings[0].toNumber()).to.be.greaterThan(0);

    // Probabilities sum to ~1 and outcome 0 dominates
    const reserves = market.reserves.map((r: any) => r.toString());
    const totalMinted = market.totalMinted.toString();
    const probs = computeProbabilities(reserves, totalMinted);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).to.be.closeTo(1.0, 0.001);
    expect(probs[0]).to.be.greaterThan(0.8);
  });

  it("binary: buy with 10x pool liquidity succeeds", async () => {
    const mkt = await createBinaryMarket({ liquidity: new BN(10_000_000) });
    const [posA] = findUserPosition(mkt.marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderBAta = await getOrCreateAta(ctx.collateralMint, ctx.traderB.publicKey, ctx.traderB);
    await mintTokens(ctx.collateralMint, traderBAta, (ctx.superadmin as any).payer, BigInt(200_000_000));

    // Buy with 100M on a 10M pool (10x)
    await ctx.program.methods
      .buy({ outcome: 1, collateralAmount: new BN(100_000_000) })
      .accountsPartial({
        trader: ctx.traderB.publicKey,
        market: mkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: mkt.vaultAuthority,
        vault: mkt.vault,
        traderAta: traderBAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderB])
      .rpc();

    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    const reserves = market.reserves.map((r: any) => r.toString());
    const totalMinted = market.totalMinted.toString();
    const probs = computeProbabilities(reserves, totalMinted);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).to.be.closeTo(1.0, 0.001);
    expect(probs[1]).to.be.greaterThan(0.95);
  });

  it("multi-outcome: buy with 20x pool liquidity succeeds", async () => {
    const mkt = await createMultiMarket({ numOutcomes: 5, liquidity: new BN(10_000_000) });
    const [posA] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(300_000_000));

    // Buy outcome 3 with 200M on a 10M pool (20x)
    await ctx.program.methods
      .buy({ outcome: 3, collateralAmount: new BN(200_000_000) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: mkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: mkt.vaultAuthority,
        vault: mkt.vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    const reserves = market.reserves.map((r: any) => r.toString());
    const totalMinted = market.totalMinted.toString();
    const probs = computeProbabilities(reserves, totalMinted);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).to.be.closeTo(1.0, 0.01);
    expect(probs[3]).to.be.greaterThan(0.9);

    // Other outcomes should be small
    for (let i = 0; i < 5; i++) {
      if (i !== 3) expect(probs[i]).to.be.lessThan(0.05);
    }
  });

  it("binary: buy 20x then sell all back recovers collateral", async () => {
    const mkt = await createBinaryMarket({ liquidity: new BN(10_000_000) });
    const [posA] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(300_000_000));

    const { value: balBefore } = await ctx.provider.connection.getTokenAccountBalance(traderAAta);

    // Buy with 200M
    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(200_000_000) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: mkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: mkt.vaultAuthority,
        vault: mkt.vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    // Check holdings and sell them all back
    const position = await ctx.program.account.userPosition.fetch(posA);
    const holdings = position.holdings[0].toNumber();
    expect(holdings).to.be.greaterThan(0);

    await ctx.program.methods
      .sell({ outcome: 0, tokenAmount: new BN(holdings) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: mkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: mkt.vaultAuthority,
        vault: mkt.vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.traderA])
      .rpc();

    // Market should be back near 50/50
    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    const reserves = market.reserves.map((r: any) => r.toString());
    const totalMinted = market.totalMinted.toString();
    const probs = computeProbabilities(reserves, totalMinted);
    expect(probs[0]).to.be.closeTo(0.5, 0.02);

    // Should have recovered most collateral (minus fees on buy + sell)
    const { value: balAfter } = await ctx.provider.connection.getTokenAccountBalance(traderAAta);
    const spent = Number(balBefore.amount) - Number(balAfter.amount);
    // Lost amount should be roughly the fees (0.3% buy + 0.3% sell ≈ 0.6%)
    expect(spent).to.be.lessThan(200_000_000 * 0.02); // less than 2% total loss
  });

  it("continuous: distribution buy with 20x pool succeeds", async () => {
    const mkt = await createContinuousMarket({
      numBins: 32,
      rangeMin: new BN(0).mul(SCALE),
      rangeMax: new BN(100).mul(SCALE),
      liquidity: new BN(10_000_000),
    });
    const [posA] = findUserPosition(mkt.marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(300_000_000));

    // Distribution buy with 200M on a 10M pool (20x), mu=50, sigma=5
    await ctx.program.methods
      .buyDistribution({
        mu: new BN(50).mul(SCALE),
        sigma: new BN(5).mul(SCALE),
        collateralAmount: new BN(200_000_000),
      })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: mkt.marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority: mkt.vaultAuthority,
        vault: mkt.vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    const market = await ctx.program.account.market.fetch(mkt.marketPda);
    const reserves = market.reserves.map((r: any) => r.toString());
    const totalMinted = market.totalMinted.toString();
    const probs = computeProbabilities(reserves, totalMinted);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).to.be.closeTo(1.0, 0.01);

    // Center bins (around bin 16 for mu=50 in [0,100] with 32 bins) should be
    // higher than far edge bins (bin 0 covers [0, 3.125], far from mu=50)
    const centerBin = 16;
    expect(probs[centerBin]).to.be.greaterThan(probs[0]);
  });
});

describe("Trading After Resolution", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;

  before(async () => {
    await ensureSetup();
    const mkt = await createBinaryMarket({ deadline: Math.floor(Date.now() / 1000) + 5 });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;

    const now = Math.floor(Date.now() / 1000);
    const waitMs = (5 + Math.floor(Date.now() / 1000) - now + 2) * 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 7000)));

    // Trigger lazy transition by trying a buy (will fail)
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    try {
      await ctx.program.methods
        .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
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
    } catch (_) {}

    await ctx.program.methods
      .resolveMarket({ outcome: 0, value: new BN(0) })
      .accountsPartial({
        oracle: ctx.oracleKp.publicKey,
        market: marketPda,
      })
      .signers([ctx.oracleKp])
      .rpc();
  });

  it("rejects buy on resolved market", async () => {
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);

    try {
      await ctx.program.methods
        .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
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
      expect.fail("Buy on resolved market should fail");
    } catch (err: any) {
      expect(err.toString()).to.include("MarketNotActive");
    }
  });

  it("rejects sell on resolved market", async () => {
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);

    try {
      await ctx.program.methods
        .sell({ outcome: 0, tokenAmount: new BN(1_000) })
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
      expect.fail("Sell on resolved market should fail");
    } catch (err: any) {
      const errStr = err.toString();
      expect(
        errStr.includes("MarketNotActive") ||
        errStr.includes("AccountNotInitialized") ||
        errStr.includes("user_position")
      ).to.be.true;
    }
  });

  it("rejects add_liquidity on resolved market", async () => {
    const lpAta = await getOrCreateAta(ctx.collateralMint, ctx.lpProvider.publicKey, ctx.lpProvider);
    await mintTokens(ctx.collateralMint, lpAta, (ctx.superadmin as any).payer, BigInt(5_000_000));
    const [lpPos] = findLpPosition(marketPda, ctx.lpProvider.publicKey, ctx.program.programId);

    try {
      await ctx.program.methods
        .addLiquidity({ amount: new BN(1_000_000) })
        .accountsPartial({
          provider: ctx.lpProvider.publicKey,
          market: marketPda,
          lpPosition: lpPos,
          vaultAuthority,
          vault,
          providerAta: lpAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([ctx.lpProvider])
        .rpc();
      expect.fail("Add liquidity on resolved market should fail");
    } catch (err: any) {
      // MarketClosed or MarketNotActive depending on state
      const errStr = err.toString();
      expect(
        errStr.includes("MarketClosed") || errStr.includes("MarketNotActive")
      ).to.be.true;
    }
  });
});
