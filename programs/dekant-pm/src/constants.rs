// ── PDA Seed Prefixes ────────────────────────────────────────────────

pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config";
pub const USER_ROLE_SEED: &[u8] = b"user_role";
pub const MARKET_SEED: &[u8] = b"market";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const USER_POSITION_SEED: &[u8] = b"user_position";
pub const LP_POSITION_SEED: &[u8] = b"lp_position";

// ── Numeric Limits ───────────────────────────────────────────────────

/// Maximum discrete outcomes (multi-outcome markets).
pub const MAX_OUTCOMES: u16 = 32;

/// Maximum bins for continuous markets.
pub const MAX_BINS: u16 = 256;

/// Minimum initial liquidity in collateral-native units (e.g. 1 USDC = 1_000_000).
pub const MIN_LIQUIDITY: u64 = 1_000_000; // 1 USDC

/// Minimum trade amount in collateral-native units.
pub const MIN_TRADE_AMOUNT: u64 = 1_000; // 0.001 USDC

/// Maximum fee in basis points (50%).
pub const MAX_FEE_BPS: u16 = 5_000;

// ── Fixed-Point Scale ────────────────────────────────────────────────

/// Scale factor for fixed-point arithmetic (10^9).
/// Probability weights and intermediate ratios are scaled to this.
pub const SCALE: u128 = 1_000_000_000;

/// Tolerance for invariant checks: |actual - expected| ≤ INVARIANT_TOLERANCE.
/// Accounts for rounding in integer square root and division.
pub const INVARIANT_TOLERANCE: u128 = 256;

// ── Fee Defaults (basis points) ──────────────────────────────────────

pub const DEFAULT_CREATION_FEE_BPS: u16 = 50;   // 0.5%
pub const DEFAULT_TRADE_FEE_BPS: u16 = 30;      // 0.3%
pub const DEFAULT_REDEMPTION_FEE_BPS: u16 = 50;  // 0.5%
pub const DEFAULT_LP_FEE_SHARE_BPS: u16 = 5_000; // 50% of trade fee → LPs

// ── Market Types ─────────────────────────────────────────────────────

pub const MARKET_TYPE_BINARY: u8 = 0;
pub const MARKET_TYPE_MULTI: u8 = 1;
pub const MARKET_TYPE_CONTINUOUS: u8 = 2;

// ── Market States ────────────────────────────────────────────────────

pub const STATE_ACTIVE: u8 = 0;
pub const STATE_PAUSED: u8 = 1;
pub const STATE_PENDING_RESOLUTION: u8 = 2;
pub const STATE_RESOLVED: u8 = 3;

// ── Role Types ───────────────────────────────────────────────────────

pub const ROLE_ADMIN: u8 = 1;
pub const ROLE_ORACLE: u8 = 2;
pub const ROLE_CREATOR: u8 = 3;

// ── Normal PDF ───────────────────────────────────────────────────────

/// Tail cutoff for Gaussian: bins with |z| > Z_CUTOFF have weight 0.
pub const Z_CUTOFF: u64 = 5;

// ── Schema Versions ──────────────────────────────────────────────────

pub const SCHEMA_VERSION: u8 = 1;
