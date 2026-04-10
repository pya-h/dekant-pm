import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
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
import { randomAmount } from "./helpers/constants";

describe("LP Withdrawal Edge Cases", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;
  const initialLiquidity = new BN(10_000_000);

  before(async () => {
    await ensureSetup();
    const mkt = await createBinaryMarket({
      deadline: Math.floor(Date.now() / 1000) + 60,
      liquidity: initialLiquidity,
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("second LP adds liquidity and gets proportional shares", async () => {
    const lpAta = await getOrCreateAta(
      ctx.collateralMint,
      ctx.lpProvider.publicKey,
      ctx.lpProvider
    );
    await mintTokens(
      ctx.collateralMint,
      lpAta,
      (ctx.superadmin as any).payer,
      BigInt(10_000_000)
    );

    const [lpPos] = findLpPosition(marketPda, ctx.lpProvider.publicKey, ctx.program.programId);

    await ctx.program.methods
      .addLiquidity({ amount: new BN(5_000_000) })
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

    const lpPosition = await ctx.program.account.lpPosition.fetch(lpPos);
    expect(Number(lpPosition.shares)).to.be.greaterThan(0);

    const marketAfter = await ctx.program.account.market.fetch(marketPda);
    expect(Number(marketAfter.lpSharesTotal)).to.be.greaterThan(
      Number(initialLiquidity)
    );
  });

  it("LP withdrawal includes fee share after trades", async () => {
    const traderAAta = await getOrCreateAta(
      ctx.collateralMint,
      ctx.traderA.publicKey,
      ctx.traderA
    );
    await mintTokens(
      ctx.collateralMint,
      traderAAta,
      (ctx.superadmin as any).payer,
      BigInt(5_000_000)
    );
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);

    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(2_000_000) })
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

    const marketAfterTrade = await ctx.program.account.market.fetch(marketPda);
    expect(Number(marketAfterTrade.lpFeeAccumulated)).to.be.greaterThan(0);

    const lpAta = await getAssociatedTokenAddress(
      ctx.collateralMint,
      ctx.lpProvider.publicKey
    );
    const [lpPos] = findLpPosition(marketPda, ctx.lpProvider.publicKey, ctx.program.programId);
    const lpBefore = await ctx.program.account.lpPosition.fetch(lpPos);
    const sharesToBurn = lpBefore.shares.div(new BN(2));

    const ataBalBefore = (await getAccount(ctx.provider.connection, lpAta)).amount;

    await ctx.program.methods
      .removeLiquidity({ sharesToBurn })
      .accountsPartial({
        provider: ctx.lpProvider.publicKey,
        market: marketPda,
        lpPosition: lpPos,
        vaultAuthority,
        vault,
        providerAta: lpAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.lpProvider])
      .rpc();

    const ataBalAfter = (await getAccount(ctx.provider.connection, lpAta)).amount;
    expect(Number(ataBalAfter)).to.be.greaterThan(Number(ataBalBefore));
  });
});

describe("Vault Balance Consistency", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vaultPubkey: PublicKey;
  const initialLiquidity = new BN(20_000_000);

  before(async () => {
    await ensureSetup();
    const mkt = await createBinaryMarket({
      deadline: Math.floor(Date.now() / 1000) + 60,
      liquidity: initialLiquidity,
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vaultPubkey = mkt.vault;
  });

  it("vault balance >= total_minted + protocol_fees after trades", async () => {
    const traderAAta = await getOrCreateAta(
      ctx.collateralMint,
      ctx.traderA.publicKey,
      ctx.traderA
    );
    await mintTokens(
      ctx.collateralMint,
      traderAAta,
      (ctx.superadmin as any).payer,
      BigInt(20_000_000)
    );
    const traderBAta = await getOrCreateAta(
      ctx.collateralMint,
      ctx.traderB.publicKey,
      ctx.traderB
    );
    await mintTokens(
      ctx.collateralMint,
      traderBAta,
      (ctx.superadmin as any).payer,
      BigInt(20_000_000)
    );

    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);

    const buyA = randomAmount(2_000_000, 5_000_000);
    const buyB = randomAmount(1_500_000, 4_000_000);

    await ctx.program.methods
      .buy({ outcome: 0, collateralAmount: new BN(buyA) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority,
        vault: vaultPubkey,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    await ctx.program.methods
      .buy({ outcome: 1, collateralAmount: new BN(buyB) })
      .accountsPartial({
        trader: ctx.traderB.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posB,
        vaultAuthority,
        vault: vaultPubkey,
        traderAta: traderBAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ctx.traderB])
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    const vaultAccount = await getAccount(ctx.provider.connection, vaultPubkey);
    const vaultBalance = Number(vaultAccount.amount);
    const totalMinted = Number(market.totalMinted);
    const protocolFees = Number(market.protocolFeeAccumulated);

    expect(vaultBalance).to.be.greaterThanOrEqual(totalMinted + protocolFees);
  });

  it("fee accumulation matches expected values", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    const protocolFees = Number(market.protocolFeeAccumulated);
    const lpFees = Number(market.lpFeeAccumulated);

    expect(protocolFees).to.be.greaterThan(0);
    expect(lpFees).to.be.greaterThan(0);

    // protocolFees = creationFee + tradeFees/2, lpFees = tradeFees/2
    // protocolFees - lpFees ~= creationFee = initialLiquidity * 50 / 10000
    const creationFee = initialLiquidity.toNumber() * 50 / 10_000;
    const diff = Math.abs(protocolFees - lpFees - creationFee);
    expect(diff).to.be.lessThanOrEqual(10);
  });
});
