/**
 * Shared utilities adapted from devkit/src/common.ts for pure-JS usage.
 */
const anchor = require("@coral-xyz/anchor");
const { Program, AnchorProvider, Wallet, BN } = anchor;
const {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
} = require("@solana/web3.js");
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createMint,
  getAccount,
} = require("@solana/spl-token");
const { readFileSync } = require("fs");
const { resolve } = require("path");
const { config } = require("dotenv");

// Load .env from devkit directory
config({ path: resolve(__dirname, "../../../devkit/.env") });

// ─── IDL ─────────────────────────────────────────────────────────────────────
const IDL_PATH = resolve(__dirname, "../../../target/idl/dekant_pm.json");

// ─── Constants ───────────────────────────────────────────────────────────────
const SCALE = new BN("1000000000"); // 10^9
const USDC_DECIMALS = 6;

const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config");
const USER_ROLE_SEED = Buffer.from("user_role");
const MARKET_SEED = Buffer.from("market");
const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");
const USER_POSITION_SEED = Buffer.from("user_position");
const LP_POSITION_SEED = Buffer.from("lp_position");

const ROLE_ADMIN = 1;
const ROLE_ORACLE = 2;
const ROLE_CREATOR = 3;

const MARKET_TYPE_BINARY = 0;
const MARKET_TYPE_MULTI = 1;
const MARKET_TYPE_CONTINUOUS = 2;

const MARKET_STATE_ACTIVE = 0;
const MARKET_STATE_PAUSED = 1;
const MARKET_STATE_PENDING = 2;
const MARKET_STATE_RESOLVED = 3;

const ROLE_NAMES = {
  [ROLE_ADMIN]: "Admin",
  [ROLE_ORACLE]: "Oracle",
  [ROLE_CREATOR]: "Creator",
};

const MARKET_TYPE_NAMES = {
  [MARKET_TYPE_BINARY]: "Binary",
  [MARKET_TYPE_MULTI]: "Multi-outcome",
  [MARKET_TYPE_CONTINUOUS]: "Continuous",
};

const MARKET_STATE_NAMES = {
  [MARKET_STATE_ACTIVE]: "Active",
  [MARKET_STATE_PAUSED]: "Paused",
  [MARKET_STATE_PENDING]: "PendingResolution",
  [MARKET_STATE_RESOLVED]: "Resolved",
};

// ─── PDA Derivation ──────────────────────────────────────────────────────────
function findProtocolConfig(programId) {
  return PublicKey.findProgramAddressSync([PROTOCOL_CONFIG_SEED], programId);
}

function findUserRole(user, role, programId) {
  return PublicKey.findProgramAddressSync(
    [USER_ROLE_SEED, user.toBuffer(), Buffer.from([role])],
    programId
  );
}

function findMarket(marketId, programId) {
  const id = typeof marketId === "number" ? new BN(marketId) : marketId;
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, id.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

function findVaultAuthority(market, programId) {
  return PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, market.toBuffer()],
    programId
  );
}

function findUserPosition(market, user, programId) {
  return PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, market.toBuffer(), user.toBuffer()],
    programId
  );
}

function findLpPosition(market, user, programId) {
  return PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, market.toBuffer(), user.toBuffer()],
    programId
  );
}

// ─── Environment & Connection ────────────────────────────────────────────────
function getRpcUrl() {
  return process.env.RPC_URL || "http://localhost:8899";
}

function getProgramId() {
  return new PublicKey(
    process.env.PROGRAM_ID || "Fa2ookSb6meqem6F1oZcVv1PAxQzNtr7zkf1XiDBFgAf"
  );
}

function loadKeypair(path) {
  const keypairPath =
    path || process.env.KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`;
  const resolved = keypairPath.replace(/^~/, process.env.HOME || "");
  const raw = JSON.parse(readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function createConnection() {
  return new Connection(getRpcUrl(), "confirmed");
}

function createProvider(connection, keypair) {
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  return provider;
}

function loadProgram(provider) {
  const idl = JSON.parse(readFileSync(IDL_PATH, "utf-8"));
  return new Program(idl, provider);
}

// ─── Token Helpers ───────────────────────────────────────────────────────────
async function airdropSol(connection, pubkey, amount) {
  const amt = amount || 10 * LAMPORTS_PER_SOL;
  const sig = await connection.requestAirdrop(pubkey, amt);
  await connection.confirmTransaction(sig, "confirmed");
}

async function getOrCreateAta(connection, mint, owner, payer) {
  const account = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );
  return account.address;
}

async function mintTokens(connection, mint, dest, authority, amount) {
  await mintTo(connection, authority, mint, dest, authority, amount);
}

async function createCollateralMint(connection, payer) {
  return createMint(connection, payer, payer.publicKey, null, USDC_DECIMALS);
}

async function getTokenBalance(connection, tokenAccount) {
  const account = await getAccount(connection, tokenAccount);
  return account.amount;
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────
function formatTokenAmount(amount, decimals) {
  const d = decimals || USDC_DECIMALS;
  const n = typeof amount === "bigint" ? amount : BigInt(amount.toString());
  const divisor = BigInt(10 ** d);
  const whole = n / divisor;
  const frac = n % divisor;
  const fracStr = frac
    .toString()
    .padStart(d, "0")
    .replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

function parseTokenAmount(humanReadable, decimals) {
  const d = decimals || USDC_DECIMALS;
  const parts = humanReadable.split(".");
  const whole = parts[0];
  const frac = (parts[1] || "").padEnd(d, "0").slice(0, d);
  return new BN(whole + frac);
}

function formatProbability(prob) {
  return `${(prob * 100).toFixed(2)}%`;
}

function computeProbabilities(reserves, totalMinted) {
  const tm = Number(totalMinted.toString());
  if (tm === 0) return reserves.map(() => 0);
  return reserves.map((r) => {
    const x = tm - Number(r.toString());
    return (x * x) / (tm * tm);
  });
}

function parseDeadline(input) {
  const relMatch = input.match(/^\+(\d+)([hmd])$/);
  if (relMatch) {
    const value = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    const multipliers = { m: 60, h: 3600, d: 86400 };
    return Math.floor(Date.now() / 1000) + value * multipliers[unit];
  }
  if (/^\d{10,}$/.test(input)) {
    return parseInt(input, 10);
  }
  const date = new Date(input);
  if (!isNaN(date.getTime())) {
    return Math.floor(date.getTime() / 1000);
  }
  throw new Error(
    `Invalid deadline format: "${input}". Use +1h, +30m, +7d, ISO 8601, or unix timestamp.`
  );
}

function formatTimestamp(unix) {
  return new Date(unix * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
}

function outcomeLabel(marketType, index) {
  if (marketType === MARKET_TYPE_BINARY) return index === 0 ? "Yes" : "No";
  if (marketType === MARKET_TYPE_CONTINUOUS) return `Bin ${index}`;
  return `Outcome ${index}`;
}

module.exports = {
  // Constants
  SCALE,
  USDC_DECIMALS,
  ROLE_ADMIN,
  ROLE_ORACLE,
  ROLE_CREATOR,
  ROLE_NAMES,
  MARKET_TYPE_BINARY,
  MARKET_TYPE_MULTI,
  MARKET_TYPE_CONTINUOUS,
  MARKET_TYPE_NAMES,
  MARKET_STATE_ACTIVE,
  MARKET_STATE_PAUSED,
  MARKET_STATE_PENDING,
  MARKET_STATE_RESOLVED,
  MARKET_STATE_NAMES,
  // PDA
  findProtocolConfig,
  findUserRole,
  findMarket,
  findVaultAuthority,
  findUserPosition,
  findLpPosition,
  // Connection
  getRpcUrl,
  getProgramId,
  loadKeypair,
  createConnection,
  createProvider,
  loadProgram,
  // Token
  airdropSol,
  getOrCreateAta,
  mintTokens,
  createCollateralMint,
  getTokenBalance,
  // Format
  formatTokenAmount,
  parseTokenAmount,
  formatProbability,
  computeProbabilities,
  parseDeadline,
  formatTimestamp,
  outcomeLabel,
  // Re-exports
  BN,
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
};
