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
import { findUserPosition, findLpPosition } from "./helpers/pda";
import { getOrCreateAta, mintTokens } from "./helpers/accounts";
import { createBinaryMarket } from "./helpers/market-helper";
import { MARKET_TYPE_BINARY, randomAmount } from "./helpers/constants";

describe("Binary Market Lifecycle", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;
  let traderAAta: PublicKey;
  let traderBAta: PublicKey;
  let lpProviderAta: PublicKey;
  const initialLiquidity = new BN(10_000_000);
  const buyAmountA = randomAmount(1_500_000, 4_000_000);
  const buyAmountB = randomAmount(1_500_000, 4_000_000);
  const lpAmount = randomAmount(3_000_000, 8_000_000);

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 30;
    const mkt = await createBinaryMarket({ deadline, liquidity: initialLiquidity });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("creates a binary market with correct state", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.marketType).to.equal(MARKET_TYPE_BINARY);
    expect(market.numOutcomes).to.equal(2);
    expect(market.state).to.equal(0);
    expect(market.oracle.toString()).to.equal(ctx.oracleKp.publicKey.toString());
    expect(market.reserves.length).to.equal(2);

    // creation fee = 0.5% of initialLiquidity, net = initialLiquidity - fee
    const netLiq = initialLiquidity.toNumber() - Math.floor(initialLiquidity.toNumber() * 50 / 10000);
    const n = 2;
    const xPer = Math.floor(Math.sqrt(netLiq * netLiq / n));
    const expectedReserve = netLiq - xPer;
    expect(market.reserves[0].toNumber()).to.equal(expectedReserve);
    expect(market.reserves[1].toNumber()).to.equal(expectedReserve);
    expect(market.protocolFeeAccumulated.toNumber()).to.equal(
      Math.floor(initialLiquidity.toNumber() * 50 / 10000)
    );
  });

  it("trader A buys outcome 0 (Yes)", async () => {
    traderAAta = await getOrCreateAta(
      ctx.collateralMint,
      ctx.traderA.publicKey,
      ctx.traderA
    );
    await mintTokens(
      ctx.collateralMint,
      traderAAta,
      (ctx.superadmin as any).payer,
      BigInt(50_000_000)
    );

    const [userPositionPda] = findUserPosition(
      marketPda,
      ctx.traderA.publicKey,
      ctx.program.programId
    );

    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(buyAmountA) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: userPositionPda,
        vaultAuthority,
        vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: require("@solana/web3.js").SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    const position = await ctx.program.account.userPosition.fetch(userPositionPda);
    expect(position.holdings[0].toNumber()).to.be.greaterThan(0);
    expect(position.holdings[1].toNumber()).to.equal(0);
    expect(position.totalDeposited.toNumber()).to.equal(buyAmountA);
  });

  it("trader B buys outcome 1 (No)", async () => {
    traderBAta = await getOrCreateAta(
      ctx.collateralMint,
      ctx.traderB.publicKey,
      ctx.traderB
    );
    await mintTokens(
      ctx.collateralMint,
      traderBAta,
      (ctx.superadmin as any).payer,
      BigInt(50_000_000)
    );

    const [userPositionPda] = findUserPosition(
      marketPda,
      ctx.traderB.publicKey,
      ctx.program.programId
    );

    await ctx.program.methods
      .buy({ outcome: 1, collateralAmount: new BN(buyAmountB) })
      .accountsPartial({
        trader: ctx.traderB.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: userPositionPda,
        vaultAuthority,
        vault,
        traderAta: traderBAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: require("@solana/web3.js").SystemProgram.programId,
      })
      .signers([ctx.traderB])
      .rpc();

    const position = await ctx.program.account.userPosition.fetch(userPositionPda);
    expect(position.holdings[1].toNumber()).to.be.greaterThan(0);
    expect(position.totalDeposited.toNumber()).to.equal(buyAmountB);
  });

  it("trader A sells partial position", async () => {
    const [userPositionPda] = findUserPosition(
      marketPda,
      ctx.traderA.publicKey,
      ctx.program.programId
    );
    const positionBefore = await ctx.program.account.userPosition.fetch(userPositionPda);
    const sellAmount = Math.floor(positionBefore.holdings[0].toNumber() / 2);
    expect(sellAmount).to.be.greaterThan(0);

    const ataBalBefore = (await getAccount(ctx.provider.connection, traderAAta)).amount;

    await ctx.program.methods
      .sell({ outcome: 0, tokenAmount: new BN(sellAmount) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: userPositionPda,
        vaultAuthority,
        vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.traderA])
      .rpc();

    const positionAfter = await ctx.program.account.userPosition.fetch(userPositionPda);
    expect(positionAfter.holdings[0].toNumber()).to.equal(
      positionBefore.holdings[0].toNumber() - sellAmount
    );
    const ataBalAfter = (await getAccount(ctx.provider.connection, traderAAta)).amount;
    expect(Number(ataBalAfter)).to.be.greaterThan(Number(ataBalBefore));
  });

  it("LP adds liquidity", async () => {
    lpProviderAta = await getOrCreateAta(
      ctx.collateralMint,
      ctx.lpProvider.publicKey,
      ctx.lpProvider
    );
    await mintTokens(
      ctx.collateralMint,
      lpProviderAta,
      (ctx.superadmin as any).payer,
      BigInt(50_000_000)
    );

    const [lpPositionPda] = findLpPosition(
      marketPda,
      ctx.lpProvider.publicKey,
      ctx.program.programId
    );
    const marketBefore = await ctx.program.account.market.fetch(marketPda);

    await ctx.program.methods
      .addLiquidity({ amount: new BN(lpAmount) })
      .accountsPartial({
        provider: ctx.lpProvider.publicKey,
        market: marketPda,
        lpPosition: lpPositionPda,
        vaultAuthority,
        vault,
        providerAta: lpProviderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: require("@solana/web3.js").SystemProgram.programId,
      })
      .signers([ctx.lpProvider])
      .rpc();

    const lp = await ctx.program.account.lpPosition.fetch(lpPositionPda);
    expect(lp.shares.toString()).to.not.equal("0");
    expect(lp.depositedCollateral.toNumber()).to.equal(lpAmount);

    const marketAfter = await ctx.program.account.market.fetch(marketPda);
    expect(marketAfter.lpSharesTotal.toString()).to.not.equal(
      marketBefore.lpSharesTotal.toString()
    );
  });

  it("rejects trade after deadline (lazy enforcement)", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    const now = Math.floor(Date.now() / 1000);
    const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const [userPositionPda] = findUserPosition(
      marketPda,
      ctx.traderA.publicKey,
      ctx.program.programId
    );

    try {
      await ctx.program.methods
        .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: userPositionPda,
          vaultAuthority,
          vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: require("@solana/web3.js").SystemProgram.programId,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should have thrown MarketClosed error");
    } catch (err: any) {
      expect(err.toString()).to.include("MarketClosed");
    }
  });

  it("oracle resolves the market (outcome 0 wins)", async () => {
    await ctx.program.methods
      .resolveMarket({ outcome: 0, value: new BN(0) })
      .accountsPartial({
        oracle: ctx.oracleKp.publicKey,
        market: marketPda,
      })
      .signers([ctx.oracleKp])
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.state).to.equal(3);
    expect(market.resolvedOutcome).to.equal(0);
  });

  it("trader A claims payout (winner)", async () => {
    const [userPositionPda] = findUserPosition(
      marketPda,
      ctx.traderA.publicKey,
      ctx.program.programId
    );
    const ataBalBefore = (await getAccount(ctx.provider.connection, traderAAta)).amount;

    await ctx.program.methods
      .claimPayout()
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: userPositionPda,
        vaultAuthority,
        vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.traderA])
      .rpc();

    const position = await ctx.program.account.userPosition.fetch(userPositionPda);
    expect(position.claimed).to.be.true;

    const ataBalAfter = (await getAccount(ctx.provider.connection, traderAAta)).amount;
    expect(Number(ataBalAfter)).to.be.greaterThan(Number(ataBalBefore));
  });

  it("trader B claim fails (NothingToClaim — wrong outcome)", async () => {
    const [userPositionPda] = findUserPosition(
      marketPda,
      ctx.traderB.publicKey,
      ctx.program.programId
    );

    try {
      await ctx.program.methods
        .claimPayout()
        .accountsPartial({
          trader: ctx.traderB.publicKey,
          market: marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: userPositionPda,
          vaultAuthority,
          vault,
          traderAta: traderBAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderB])
        .rpc();
      expect.fail("Should have thrown NothingToClaim error");
    } catch (err: any) {
      expect(err.toString()).to.include("NothingToClaim");
    }
  });

  it("LP removes liquidity from resolved market", async () => {
    const [lpPositionPda] = findLpPosition(
      marketPda,
      ctx.lpProvider.publicKey,
      ctx.program.programId
    );
    const lp = await ctx.program.account.lpPosition.fetch(lpPositionPda);
    const ataBalBefore = (await getAccount(ctx.provider.connection, lpProviderAta)).amount;

    await ctx.program.methods
      .removeLiquidity({ sharesToBurn: lp.shares })
      .accountsPartial({
        provider: ctx.lpProvider.publicKey,
        market: marketPda,
        lpPosition: lpPositionPda,
        vaultAuthority,
        vault,
        providerAta: lpProviderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.lpProvider])
      .rpc();

    const lpAfter = await ctx.program.account.lpPosition.fetch(lpPositionPda);
    expect(lpAfter.shares.toString()).to.equal("0");

    const ataBalAfter = (await getAccount(ctx.provider.connection, lpProviderAta)).amount;
    expect(Number(ataBalAfter)).to.be.greaterThan(Number(ataBalBefore));
  });
});
