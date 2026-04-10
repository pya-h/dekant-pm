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
import { createBinaryMarket, createContinuousMarket } from "./helpers/market-helper";
import {
  ROLE_ORACLE,
  ROLE_ADMIN,
  MARKET_TYPE_BINARY,
  SCALE,
} from "./helpers/constants";

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
    const market = await ctx.program.account.market.fetch(marketPda);
    const now = Math.floor(Date.now() / 1000);
    const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    await ctx.program.methods
      .resolveMarket({ outcome: 0, value: new BN(0) })
      .accountsPartial({
        oracle: ctx.oracleKp.publicKey,
        market: marketPda,
      })
      .signers([ctx.oracleKp])
      .rpc();

    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

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
