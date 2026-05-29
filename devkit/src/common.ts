import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createMint,
  getAccount,
} from "@solana/spl-token";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

// Load .env from devkit directory
config({ path: resolve(__dirname, "../.env") });

// ─── IDL & Types ─────────────────────────────────────────────────────────────
import type { DekantPm } from "../../target/types/dekant_pm";
const IDL_PATH = resolve(__dirname, "../../target/idl/dekant_pm.json");

// ─── Constants ───────────────────────────────────────────────────────────────
export const SCALE = new BN("1000000000"); // 10^9
export const USDC_DECIMALS = 6;

export const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config");
export const USER_ROLE_SEED = Buffer.from("user_role");
export const MARKET_SEED = Buffer.from("market");
export const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");
export const USER_POSITION_SEED = Buffer.from("user_position");
export const LP_POSITION_SEED = Buffer.from("lp_position");

export const ROLE_ADMIN = 1;
export const ROLE_ORACLE = 2;
export const ROLE_CREATOR = 3;

export const MARKET_TYPE_BINARY = 0;
export const MARKET_TYPE_MULTI = 1;
export const MARKET_TYPE_CONTINUOUS = 2;

export const MARKET_STATE_ACTIVE = 0;
export const MARKET_STATE_PAUSED = 1;
export const MARKET_STATE_PENDING = 2;
export const MARKET_STATE_RESOLVED = 3;

export const ROLE_NAMES: Record<number, string> = {
  [ROLE_ADMIN]: "Admin",
  [ROLE_ORACLE]: "Oracle",
  [ROLE_CREATOR]: "Creator",
};

export const MARKET_TYPE_NAMES: Record<number, string> = {
  [MARKET_TYPE_BINARY]: "Binary",
  [MARKET_TYPE_MULTI]: "Multi-outcome",
  [MARKET_TYPE_CONTINUOUS]: "Continuous",
};

export const MARKET_STATE_NAMES: Record<number, string> = {
  [MARKET_STATE_ACTIVE]: "Active",
  [MARKET_STATE_PAUSED]: "Paused",
  [MARKET_STATE_PENDING]: "PendingResolution",
  [MARKET_STATE_RESOLVED]: "Resolved",
};

// ─── PDA Derivation ──────────────────────────────────────────────────────────
export function findProtocolConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROTOCOL_CONFIG_SEED], programId);
}

export function findUserRole(
  user: PublicKey,
  role: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_ROLE_SEED, user.toBuffer(), Buffer.from([role])],
    programId
  );
}

export function findMarket(
  marketId: number | BN,
  programId: PublicKey
): [PublicKey, number] {
  const id = typeof marketId === "number" ? new BN(marketId) : marketId;
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, id.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

export function findVaultAuthority(
  market: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, market.toBuffer()],
    programId
  );
}

export function findUserPosition(
  market: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, market.toBuffer(), user.toBuffer()],
    programId
  );
}

export function findLpPosition(
  market: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, market.toBuffer(), user.toBuffer()],
    programId
  );
}

// ─── Environment & Connection ────────────────────────────────────────────────
export function getRpcUrl(): string {
  return process.env.RPC_URL || "http://localhost:8899";
}

export function getProgramId(): PublicKey {
  const id = process.env.PROGRAM_ID;
  if (!id) {
    throw new Error("PROGRAM_ID environment variable is not set. Set it in devkit/.env or export it directly.");
  }
  return new PublicKey(id);
}

export function loadKeypair(path?: string): Keypair {
  const keypairPath = path || process.env.KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`;
  const resolved = keypairPath.replace(/^~/, process.env.HOME || "");
  const raw = JSON.parse(readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function createConnection(): Connection {
  return new Connection(getRpcUrl(), "confirmed");
}

export function createProvider(connection: Connection, keypair: Keypair): AnchorProvider {
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  return provider;
}

export function loadProgram(provider: AnchorProvider): Program<DekantPm> {
  const idl = JSON.parse(readFileSync(IDL_PATH, "utf-8"));
  return new Program<DekantPm>(idl, provider);
}

/** Convenience: load connection, keypair, provider, and program in one call. */
export function loadContext(keypairPath?: string) {
  const connection = createConnection();
  const keypair = loadKeypair(keypairPath);
  const provider = createProvider(connection, keypair);
  const program = loadProgram(provider);
  const programId = getProgramId();
  return { connection, keypair, provider, program, programId };
}

// ─── Token Helpers ───────────────────────────────────────────────────────────
export async function airdropSol(
  connection: Connection,
  pubkey: PublicKey,
  amount = 10 * LAMPORTS_PER_SOL
) {
  const sig = await connection.requestAirdrop(pubkey, amount);
  await connection.confirmTransaction(sig, "confirmed");
}

export async function getOrCreateAta(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: Keypair
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );
  return account.address;
}

export async function mintTokens(
  connection: Connection,
  mint: PublicKey,
  dest: PublicKey,
  authority: Keypair,
  amount: number | bigint
) {
  await mintTo(connection, authority, mint, dest, authority, amount);
}

export async function createCollateralMint(
  connection: Connection,
  payer: Keypair
): Promise<PublicKey> {
  return createMint(connection, payer, payer.publicKey, null, USDC_DECIMALS);
}

export async function getTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  const account = await getAccount(connection, tokenAccount);
  return account.amount;
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────
export function formatTokenAmount(amount: number | bigint | BN, decimals = USDC_DECIMALS): string {
  const n = typeof amount === "bigint" ? amount : BigInt(amount.toString());
  const divisor = BigInt(10 ** decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

export function parseTokenAmount(humanReadable: string, decimals = USDC_DECIMALS): BN {
  const parts = humanReadable.split(".");
  const whole = parts[0];
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return new BN(whole + frac);
}

export function formatProbability(prob: number): string {
  return `${(prob * 100).toFixed(2)}%`;
}

// Linear probability display: p_i = x_i / sum(x_j), where x_i = totalMinted - reserves[i].
// Exact at equilibrium; see specs/details/improved/LINEAR_DISPLAY_EXPLAINED.md.
export function computeProbabilities(reserves: BN[], totalMinted: BN): number[] {
  const tm = Number(totalMinted.toString());
  if (tm === 0) return reserves.map(() => 0);
  const xs = reserves.map((r) => tm - Number(r.toString()));
  const sumX = xs.reduce((acc, x) => acc + x, 0);
  if (sumX === 0) return reserves.map(() => 1 / reserves.length);
  return xs.map((x) => x / sumX);
}

/** Parse deadline: relative (+1h, +30m, +7d) or absolute ISO 8601 or unix seconds. */
export function parseDeadline(input: string): number {
  // Relative format: +Nh, +Nm, +Nd
  const relMatch = input.match(/^\+(\d+)([hmd])$/);
  if (relMatch) {
    const value = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    const multipliers: Record<string, number> = { m: 60, h: 3600, d: 86400 };
    return Math.floor(Date.now() / 1000) + value * multipliers[unit];
  }
  // Unix timestamp (all digits)
  if (/^\d{10,}$/.test(input)) {
    return parseInt(input, 10);
  }
  // ISO 8601
  const date = new Date(input);
  if (!isNaN(date.getTime())) {
    return Math.floor(date.getTime() / 1000);
  }
  throw new Error(`Invalid deadline format: "${input}". Use +1h, +30m, +7d, ISO 8601, or unix timestamp.`);
}

export function formatTimestamp(unix: number): string {
  return new Date(unix * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

/** Pretty-print a table of key-value pairs. */
export function printTable(rows: [string, string][]) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    console.log(`  ${key.padEnd(maxKey)}  ${value}`);
  }
}

/** Human-readable label for an outcome/bin index given market type. */
export function outcomeLabel(marketType: number, index: number): string {
  if (marketType === MARKET_TYPE_BINARY) return index === 0 ? "Yes" : "No";
  if (marketType === MARKET_TYPE_CONTINUOUS) return `Bin ${index}`;
  return `Outcome ${index}`;
}

// Re-export for convenience
export { BN, PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };
