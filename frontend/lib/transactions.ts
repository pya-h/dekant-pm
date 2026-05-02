import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import type { DekantPm } from "./program/dekant_pm";
import {
  deriveProtocolConfig,
  deriveUserPosition,
  deriveLpPosition,
  deriveVaultAuthority,
} from "./solana";
import { USDC_DECIMALS, SCALE } from "./types";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** Derive Associated Token Address (mirrors @solana/spl-token). */
function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}

/** Human-readable amount → token base units (6 decimals for USDC).
 *  Uses string-based parsing to avoid floating-point truncation. */
function toBaseUnits(amount: string): BN {
  const trimmed = amount.trim();
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "000000").slice(0, USDC_DECIMALS);
  return new BN(whole + padded);
}

/** Human-readable value → SCALE-denominated BN (for distribution mu/sigma). */
function toScaled(value: number): BN {
  return new BN(Math.round(value * SCALE));
}

/** Resolve the common set of accounts needed for all trading instructions. */
async function resolveAccounts(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
) {
  const marketAccount = await program.account.market.fetch(marketPubkey);

  const [protocolConfig] = deriveProtocolConfig();
  const [userPosition] = deriveUserPosition(marketPubkey, trader);
  const [vaultAuthority] = deriveVaultAuthority(marketPubkey);
  const traderAta = getAta(marketAccount.collateralMint, trader);

  return {
    trader,
    market: marketPubkey,
    protocolConfig,
    userPosition,
    vaultAuthority,
    vault: marketAccount.vault as PublicKey,
    traderAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** Buy discrete outcome tokens (Binary / MultiOutcome markets). */
export async function executeBuy(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  outcome: number,
  amount: string,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return program.methods
    .buy({ outcome, collateralAmount: toBaseUnits(amount) })
    .accountsPartial({
      ...accounts,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** Sell discrete outcome tokens (Binary / MultiOutcome markets). */
export async function executeSell(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  outcome: number,
  amount: string,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return program.methods
    .sell({ outcome, tokenAmount: toBaseUnits(amount) })
    .accountsPartial(accounts)
    .rpc();
}

/** Buy distribution position (Continuous markets). */
export async function executeBuyDistribution(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  mu: number,
  sigma: number,
  amount: string,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return program.methods
    .buyDistribution({
      mu: toScaled(mu),
      sigma: toScaled(sigma),
      collateralAmount: toBaseUnits(amount),
    })
    .accountsPartial({
      ...accounts,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ])
    .rpc({ skipPreflight: true, maxRetries: 3 });
}

/** Claim payout from a resolved market. */
export async function executeClaimPayout(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return program.methods.claimPayout().accountsPartial(accounts).rpc();
}

/** Resolve a market (Oracle only). */
export async function executeResolveMarket(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  oracle: PublicKey,
  outcome: number,
  value: BN,
): Promise<string> {
  return program.methods
    .resolveMarket({ outcome, value })
    .accountsPartial({
      oracle,
      market: marketPubkey,
    })
    .rpc();
}

/** Buy outcome tokens to reach a target probability (Binary / MultiOutcome). */
export async function executeBuyToPrice(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  outcome: number,
  targetProbability: BN,
  maxCollateral: BN,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return program.methods
    .buyToPrice({ outcome, targetProbability, maxCollateral })
    .accountsPartial({
      ...accounts,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** Sell outcome tokens to reach a target probability (Binary / MultiOutcome). */
export async function executeSellToPrice(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  outcome: number,
  targetProbability: BN,
  minCollateralOut: BN,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return program.methods
    .sellToPrice({ outcome, targetProbability, minCollateralOut })
    .accountsPartial(accounts)
    .rpc();
}

/** Resolve accounts for LP instructions (different from trading accounts). */
async function resolveLpAccounts(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  provider: PublicKey,
) {
  const marketAccount = await program.account.market.fetch(marketPubkey);
  const [lpPosition] = deriveLpPosition(marketPubkey, provider);
  const [vaultAuthority] = deriveVaultAuthority(marketPubkey);
  const providerAta = getAta(marketAccount.collateralMint, provider);

  return {
    provider,
    market: marketPubkey,
    lpPosition,
    vaultAuthority,
    vault: marketAccount.vault as PublicKey,
    providerAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** Add liquidity to a market (deposit USDC, receive LP shares). */
export async function executeAddLiquidity(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  provider: PublicKey,
  amount: string,
): Promise<string> {
  const accounts = await resolveLpAccounts(program, marketPubkey, provider);
  return program.methods
    .addLiquidity({ amount: toBaseUnits(amount) })
    .accountsPartial({
      ...accounts,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** Remove liquidity from a market (burn LP shares, receive USDC). */
export async function executeRemoveLiquidity(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  provider: PublicKey,
  sharesToBurn: BN,
): Promise<string> {
  const accounts = await resolveLpAccounts(program, marketPubkey, provider);
  return program.methods
    .removeLiquidity({ sharesToBurn })
    .accountsPartial(accounts)
    .rpc();
}

/** Sell distribution position (Continuous markets). */
export async function executeSellDistribution(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  mu: number,
  sigma: number,
  amount: string,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return program.methods
    .sellDistribution({
      mu: toScaled(mu),
      sigma: toScaled(sigma),
      tokenAmount: toBaseUnits(amount),
    })
    .accountsPartial(accounts)
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ])
    .rpc({ skipPreflight: true, maxRetries: 3 });
}
