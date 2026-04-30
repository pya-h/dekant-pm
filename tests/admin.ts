import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserRole, findUserPosition } from "./helpers/pda";
import { getOrCreateAta, mintTokens } from "./helpers/accounts";
import { createBinaryMarket } from "./helpers/market-helper";
import { ROLE_ADMIN, randomAmount } from "./helpers/constants";

describe("Admin Operations", () => {
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

  it("admin pauses the market", async () => {
    const [adminRolePda] = findUserRole(ctx.adminKp.publicKey, ROLE_ADMIN, ctx.program.programId);

    await ctx.program.methods
      .pauseMarket()
      .accountsPartial({
        authority: ctx.adminKp.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: adminRolePda,
        market: marketPda,
      })
      .signers([ctx.adminKp])
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.state).to.equal(1);
  });

  it("trades fail while paused", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(10_000_000));

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
      expect.fail("Trade should fail while paused");
    } catch (err: any) {
      expect(err.toString()).to.include("MarketNotActive");
    }
  });

  it("admin unpauses the market", async () => {
    const [adminRolePda] = findUserRole(ctx.adminKp.publicKey, ROLE_ADMIN, ctx.program.programId);

    await ctx.program.methods
      .unpauseMarket()
      .accountsPartial({
        authority: ctx.adminKp.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: adminRolePda,
        market: marketPda,
      })
      .signers([ctx.adminKp])
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.state).to.equal(0);
  });

  it("trades succeed after unpause", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(randomAmount(1_000_000, 2_000_000)) })
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

    const position = await ctx.program.account.userPosition.fetch(posA);
    expect(position.holdings[0].toNumber()).to.be.greaterThan(0);
  });

  it("superadmin updates fees", async () => {
    await ctx.program.methods
      .updateFees({
        creationFeeBps: 100,
        tradeFeeBps: 50,
        redemptionFeeBps: 25,
        lpFeeShareBps: 6000,
      })
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
      })
      .rpc();

    const config = await ctx.program.account.protocolConfig.fetch(ctx.protocolConfig);
    expect(config.creationFeeBps).to.equal(100);
    expect(config.tradeFeeBps).to.equal(50);
    expect(config.redemptionFeeBps).to.equal(25);
    expect(config.lpFeeShareBps).to.equal(6000);
  });

  it("new trades use updated fee rates", async () => {
    const marketBefore = await ctx.program.account.market.fetch(marketPda);
    const feesBefore = marketBefore.protocolFeeAccumulated.toNumber();

    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    await ctx.program.methods
      .buy({ outcome: 1, collateralAmount: new BN(2_000_000) })
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

    const marketAfter = await ctx.program.account.market.fetch(marketPda);
    const feesAfter = marketAfter.protocolFeeAccumulated.toNumber();
    // Protocol fee should have increased (0.5% trade fee, 40% protocol share)
    expect(feesAfter).to.be.greaterThan(feesBefore);
  });

  it("anyone can collect protocol fees (permissionless)", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.protocolFeeAccumulated.toNumber()).to.be.greaterThan(0);

    let treasuryAta: PublicKey;
    try {
      treasuryAta = await createAssociatedTokenAccount(
        ctx.provider.connection,
        ctx.treasury,
        ctx.collateralMint,
        ctx.treasury.publicKey
      );
    } catch {
      treasuryAta = await getAssociatedTokenAddress(
        ctx.collateralMint,
        ctx.treasury.publicKey
      );
    }

    // Use traderA (non-admin) as payer to prove permissionless
    await ctx.program.methods
      .collectFees()
      .accountsPartial({
        payer: ctx.traderA.publicKey,
        protocolConfig: ctx.protocolConfig,
        market: marketPda,
        vaultAuthority,
        vault,
        treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.traderA])
      .rpc();

    const marketAfter = await ctx.program.account.market.fetch(marketPda);
    expect(marketAfter.protocolFeeAccumulated.toNumber()).to.equal(0);

    const treasuryBalance = (await getAccount(ctx.provider.connection, treasuryAta)).amount;
    expect(Number(treasuryBalance)).to.be.greaterThan(0);
  });

  after(async () => {
    await ctx.program.methods
      .updateFees({
        creationFeeBps: 50,
        tradeFeeBps: 30,
        redemptionFeeBps: 50,
        lpFeeShareBps: 5000,
      })
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
      })
      .rpc();
  });
});

describe("Paused Market Cannot Be Resolved", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;

  before(async () => {
    await ensureSetup();
    const mkt = await createBinaryMarket({ deadline: Math.floor(Date.now() / 1000) + 8 });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
  });

  it("admin pauses the market before deadline", async () => {
    const [adminRolePda] = findUserRole(ctx.adminKp.publicKey, ROLE_ADMIN, ctx.program.programId);

    await ctx.program.methods
      .pauseMarket()
      .accountsPartial({
        authority: ctx.adminKp.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: adminRolePda,
        market: marketPda,
      })
      .signers([ctx.adminKp])
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.state).to.equal(1);
  });

  it("oracle cannot resolve paused market after deadline", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    const now = Math.floor(Date.now() / 1000);
    const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    try {
      await ctx.program.methods
        .resolveMarket({ outcome: 0, value: new BN(0) })
        .accountsPartial({
          oracle: ctx.oracleKp.publicKey,
          market: marketPda,
        })
        .signers([ctx.oracleKp])
        .rpc();
      expect.fail("Oracle should not be able to resolve a paused market");
    } catch (err: any) {
      expect(err.toString()).to.include("MarketNotPendingResolution");
    }

    // Lazy transition did NOT fire — market is still paused
    const marketAfter = await ctx.program.account.market.fetch(marketPda);
    expect(marketAfter.state).to.equal(1);
  });

  it("admin unpauses, then oracle can resolve", async () => {
    const [adminRolePda] = findUserRole(ctx.adminKp.publicKey, ROLE_ADMIN, ctx.program.programId);

    await ctx.program.methods
      .unpauseMarket()
      .accountsPartial({
        authority: ctx.adminKp.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: adminRolePda,
        market: marketPda,
      })
      .signers([ctx.adminKp])
      .rpc();

    // Deadline already passed, so unpause goes directly to PendingResolution
    const marketUnpaused = await ctx.program.account.market.fetch(marketPda);
    expect(marketUnpaused.state).to.equal(2);

    await ctx.program.methods
      .resolveMarket({ outcome: 0, value: new BN(0) })
      .accountsPartial({
        oracle: ctx.oracleKp.publicKey,
        market: marketPda,
      })
      .signers([ctx.oracleKp])
      .rpc();

    const resolved = await ctx.program.account.market.fetch(marketPda);
    expect(resolved.state).to.equal(3);
    expect(resolved.resolvedOutcome).to.equal(0);
  });
});

describe("Superadmin Pause & Unauthorized Pause", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;

  before(async () => {
    await ensureSetup();
    const mkt = await createBinaryMarket({ deadline: Math.floor(Date.now() / 1000) + 120 });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
  });

  it("non-admin cannot pause market", async () => {
    try {
      await ctx.program.methods
        .pauseMarket()
        .accountsPartial({
          authority: ctx.traderA.publicKey,
          protocolConfig: ctx.protocolConfig,
          authorityRole: null,
          market: marketPda,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Non-admin should not be able to pause");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  it("superadmin can pause market without a role PDA", async () => {
    await ctx.program.methods
      .pauseMarket()
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        market: marketPda,
      })
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.state).to.equal(1);
  });

  it("superadmin can unpause market without a role PDA", async () => {
    await ctx.program.methods
      .unpauseMarket()
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        market: marketPda,
      })
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.state).to.equal(0);
  });

  it("non-admin cannot unpause market", async () => {
    await ctx.program.methods
      .pauseMarket()
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        market: marketPda,
      })
      .rpc();

    try {
      await ctx.program.methods
        .unpauseMarket()
        .accountsPartial({
          authority: ctx.traderA.publicKey,
          protocolConfig: ctx.protocolConfig,
          authorityRole: null,
          market: marketPda,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Non-admin should not be able to unpause");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }

    await ctx.program.methods
      .unpauseMarket()
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        market: marketPda,
      })
      .rpc();
  });
});
