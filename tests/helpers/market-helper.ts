import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ctx } from "./context";
import { findMarket, findVaultAuthority, findLpPosition, findUserRole } from "./pda";
import { getOrCreateAta, mintTokens } from "./accounts";
import {
  ROLE_ORACLE,
  ROLE_CREATOR,
  MARKET_TYPE_BINARY,
  MARKET_TYPE_MULTI,
  MARKET_TYPE_CONTINUOUS,
  SCALE,
} from "./constants";

export interface MarketAccounts {
  marketPda: PublicKey;
  vaultAuthority: PublicKey;
  vault: PublicKey;
  marketId: number;
}

export async function createBinaryMarket(opts?: {
  deadline?: number;
  liquidity?: BN;
}): Promise<MarketAccounts> {
  const config = await ctx.program.account.protocolConfig.fetch(ctx.protocolConfig);
  const marketId = config.marketCount.toNumber();
  const deadline = opts?.deadline ?? Math.floor(Date.now() / 1000) + 120;
  const liquidity = opts?.liquidity ?? new BN(10_000_000);

  const [marketPda] = findMarket(marketId, ctx.program.programId);
  const [vaultAuthority] = findVaultAuthority(marketPda, ctx.program.programId);
  const vaultKp = Keypair.generate();

  const creatorAta = await getOrCreateAta(
    ctx.collateralMint,
    ctx.creatorKp.publicKey,
    ctx.creatorKp
  );
  await mintTokens(
    ctx.collateralMint,
    creatorAta,
    (ctx.superadmin as any).payer,
    BigInt(50_000_000)
  );

  const [oracleRolePda] = findUserRole(ctx.oracleKp.publicKey, ROLE_ORACLE, ctx.program.programId);
  const [creatorRolePda] = findUserRole(ctx.creatorKp.publicKey, ROLE_CREATOR, ctx.program.programId);
  const [creatorLpPos] = findLpPosition(marketPda, ctx.creatorKp.publicKey, ctx.program.programId);

  await ctx.program.methods
    .createMarket({
      marketType: MARKET_TYPE_BINARY,
      numOutcomes: 2,
      deadline: new BN(deadline),
      oracle: ctx.oracleKp.publicKey,
      initialLiquidity: liquidity,
      rangeMin: new BN(0),
      rangeMax: new BN(0),
      kernelWidth: 0,
    })
    .accountsPartial({
      creator: ctx.creatorKp.publicKey,
      creatorRole: creatorRolePda,
      protocolConfig: ctx.protocolConfig,
      oracleRole: oracleRolePda,
      market: marketPda,
      collateralMint: ctx.collateralMint,
      vaultAuthority,
      vault: vaultKp.publicKey,
      creatorAta,
      creatorLpPosition: creatorLpPos,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([ctx.creatorKp, vaultKp])
    .rpc();

  const market = await ctx.program.account.market.fetch(marketPda);
  return { marketPda, vaultAuthority, vault: market.vault, marketId };
}

export async function createMultiMarket(opts?: {
  numOutcomes?: number;
  deadline?: number;
  liquidity?: BN;
}): Promise<MarketAccounts> {
  const config = await ctx.program.account.protocolConfig.fetch(ctx.protocolConfig);
  const marketId = config.marketCount.toNumber();
  const deadline = opts?.deadline ?? Math.floor(Date.now() / 1000) + 120;
  const liquidity = opts?.liquidity ?? new BN(20_000_000);
  const numOutcomes = opts?.numOutcomes ?? 5;

  const [marketPda] = findMarket(marketId, ctx.program.programId);
  const [vaultAuthority] = findVaultAuthority(marketPda, ctx.program.programId);
  const vaultKp = Keypair.generate();

  const creatorAta = await getOrCreateAta(
    ctx.collateralMint,
    ctx.creatorKp.publicKey,
    ctx.creatorKp
  );
  await mintTokens(
    ctx.collateralMint,
    creatorAta,
    (ctx.superadmin as any).payer,
    BigInt(100_000_000)
  );

  const [oracleRolePda] = findUserRole(ctx.oracleKp.publicKey, ROLE_ORACLE, ctx.program.programId);
  const [creatorRolePda] = findUserRole(ctx.creatorKp.publicKey, ROLE_CREATOR, ctx.program.programId);
  const [creatorLpPos] = findLpPosition(marketPda, ctx.creatorKp.publicKey, ctx.program.programId);

  await ctx.program.methods
    .createMarket({
      marketType: MARKET_TYPE_MULTI,
      numOutcomes,
      deadline: new BN(deadline),
      oracle: ctx.oracleKp.publicKey,
      initialLiquidity: liquidity,
      rangeMin: new BN(0),
      rangeMax: new BN(0),
      kernelWidth: 0,
    })
    .accountsPartial({
      creator: ctx.creatorKp.publicKey,
      creatorRole: creatorRolePda,
      protocolConfig: ctx.protocolConfig,
      oracleRole: oracleRolePda,
      market: marketPda,
      collateralMint: ctx.collateralMint,
      vaultAuthority,
      vault: vaultKp.publicKey,
      creatorAta,
      creatorLpPosition: creatorLpPos,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([ctx.creatorKp, vaultKp])
    .rpc();

  const market = await ctx.program.account.market.fetch(marketPda);
  return { marketPda, vaultAuthority, vault: market.vault, marketId };
}

export async function createContinuousMarket(opts?: {
  numBins?: number;
  rangeMin?: BN;
  rangeMax?: BN;
  deadline?: number;
  liquidity?: BN;
  /** Smooth settlement kernel width. 0 = winner-take-all (default). */
  kernelWidth?: number;
}): Promise<MarketAccounts> {
  const config = await ctx.program.account.protocolConfig.fetch(ctx.protocolConfig);
  const marketId = config.marketCount.toNumber();
  const deadline = opts?.deadline ?? Math.floor(Date.now() / 1000) + 180;
  const liquidity = opts?.liquidity ?? new BN(20_000_000);
  const numBins = opts?.numBins ?? 64;
  const rangeMin = opts?.rangeMin ?? new BN(100).mul(SCALE);
  const rangeMax = opts?.rangeMax ?? new BN(300).mul(SCALE);
  const kernelWidth = opts?.kernelWidth ?? 0;

  const [marketPda] = findMarket(marketId, ctx.program.programId);
  const [vaultAuthority] = findVaultAuthority(marketPda, ctx.program.programId);
  const vaultKp = Keypair.generate();

  const creatorAta = await getOrCreateAta(
    ctx.collateralMint,
    ctx.creatorKp.publicKey,
    ctx.creatorKp
  );
  const mintAmount = BigInt(liquidity.toString()) + BigInt(100_000_000);
  await mintTokens(
    ctx.collateralMint,
    creatorAta,
    (ctx.superadmin as any).payer,
    mintAmount
  );

  const [oracleRolePda] = findUserRole(ctx.oracleKp.publicKey, ROLE_ORACLE, ctx.program.programId);
  const [creatorRolePda] = findUserRole(ctx.creatorKp.publicKey, ROLE_CREATOR, ctx.program.programId);
  const [creatorLpPos] = findLpPosition(marketPda, ctx.creatorKp.publicKey, ctx.program.programId);

  await ctx.program.methods
    .createMarket({
      marketType: MARKET_TYPE_CONTINUOUS,
      numOutcomes: numBins,
      deadline: new BN(deadline),
      oracle: ctx.oracleKp.publicKey,
      initialLiquidity: liquidity,
      rangeMin,
      rangeMax,
      kernelWidth,
    })
    .accountsPartial({
      creator: ctx.creatorKp.publicKey,
      creatorRole: creatorRolePda,
      protocolConfig: ctx.protocolConfig,
      oracleRole: oracleRolePda,
      market: marketPda,
      collateralMint: ctx.collateralMint,
      vaultAuthority,
      vault: vaultKp.publicKey,
      creatorAta,
      creatorLpPosition: creatorLpPos,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([ctx.creatorKp, vaultKp])
    .rpc();

  const market = await ctx.program.account.market.fetch(marketPda);
  return { marketPda, vaultAuthority, vault: market.vault, marketId };
}
