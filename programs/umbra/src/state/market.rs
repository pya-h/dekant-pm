use anchor_lang::prelude::*;
use crate::constants::*;

/// A prediction market with its AMM state.
/// Unified struct for binary, multi-outcome, and continuous (binned) markets.
/// Seeds: ["market", market_id.to_le_bytes()]
#[account]
pub struct Market {
    /// Schema version.
    pub version: u8,

    /// Unique, auto-incremented market identifier.
    pub market_id: u64,

    /// 0 = Binary, 1 = Multi-outcome, 2 = Continuous. See MarketType.
    pub market_type: u8,

    /// Current lifecycle state. See MarketState.
    pub state: u8,

    /// Wallet that created this market.
    pub creator: Pubkey,

    /// Oracle wallet authorized to resolve this market.
    pub oracle: Pubkey,

    /// SPL token mint used as collateral (e.g. USDC).
    pub collateral_mint: Pubkey,

    /// Address of the SPL token vault holding collateral.
    pub vault: Pubkey,

    /// Unix timestamp after which trading stops and resolution can begin.
    pub deadline: i64,

    /// Unix timestamp of market creation.
    pub created_at: i64,

    /// Unix timestamp of resolution (0 until resolved).
    pub resolved_at: i64,

    // ── AMM Parameters ───────────────────────────────────────────────

    /// Number of outcomes (binary = 2, multi ≤ 32) or bins (continuous ≤ 256).
    /// Determines the length of the `reserves` vector.
    pub num_outcomes: u16,

    /// Squared L2-norm invariant: Σ reserves[i]² = k_squared.
    /// Stored as u128 to avoid overflow on sums of u64 squares.
    pub k_squared: u128,

    /// Total collateral deposited as complete sets (token-native units).
    /// At any time: ∀ i, total_minted = reserves[i] + Σ_users(holdings[i]).
    pub total_minted: u128,

    /// Total outstanding LP shares across all providers.
    pub lp_shares_total: u128,

    /// Accumulated LP fee portion (collateral-native units).
    /// Paid out proportionally when LPs remove liquidity.
    pub lp_fee_accumulated: u128,

    /// Accumulated protocol fee (collateral-native units).
    /// Swept to treasury via `collect_fees` instruction.
    pub protocol_fee_accumulated: u64,

    // ── Continuous-Specific ──────────────────────────────────────────

    /// Lower bound of the continuous outcome range (scaled by 10^9).
    /// 0 for discrete markets.
    pub range_min: i64,

    /// Upper bound of the continuous outcome range (scaled by 10^9).
    /// 0 for discrete markets.
    pub range_max: i64,

    // ── Resolution ───────────────────────────────────────────────────

    /// Index of the winning outcome (binary/multi) or winning bin (continuous).
    /// Only meaningful when state == Resolved.
    pub resolved_outcome: u16,

    /// Exact resolved value for continuous markets (same scale as range_min/max).
    /// 0 for discrete markets.
    pub resolved_value: i64,

    // ── PDA ──────────────────────────────────────────────────────────

    /// Market PDA bump seed.
    pub bump: u8,

    /// Vault authority PDA bump seed (for CPI signing).
    pub vault_authority_bump: u8,

    /// Reserved for future fields.
    pub _padding: [u8; 30],

    // ── Variable-Length ──────────────────────────────────────────────

    /// AMM reserves per outcome/bin.
    /// Length = num_outcomes. Serialized as Borsh Vec (4-byte length prefix + data).
    pub reserves: Vec<u64>,
}

impl Market {
    /// Total account size for a market with `n` outcomes/bins.
    pub fn space(n: u16) -> usize {
        8   // anchor discriminator
        + 1   // version
        + 8   // market_id
        + 1   // market_type
        + 1   // state
        + 32  // creator
        + 32  // oracle
        + 32  // collateral_mint
        + 32  // vault
        + 8   // deadline
        + 8   // created_at
        + 8   // resolved_at
        + 2   // num_outcomes
        + 16  // k_squared
        + 16  // total_minted
        + 16  // lp_shares_total
        + 16  // lp_fee_accumulated
        + 8   // protocol_fee_accumulated
        + 8   // range_min
        + 8   // range_max
        + 2   // resolved_outcome
        + 8   // resolved_value
        + 1   // bump
        + 1   // vault_authority_bump
        + 30  // _padding
        + 4   // vec length prefix
        + (n as usize) * 8  // reserves data
    }

    /// Whether the market accepts trades right now.
    pub fn is_active(&self) -> bool {
        self.state == STATE_ACTIVE
    }

    /// Whether the market is past its deadline.
    pub fn is_expired(&self, clock_timestamp: i64) -> bool {
        clock_timestamp >= self.deadline
    }

    /// Implied probability for outcome `i` as a SCALE-denominated value.
    /// Returns reserves[i]² * SCALE / k_squared.
    pub fn implied_probability(&self, i: u16) -> Option<u128> {
        let r = *self.reserves.get(i as usize)? as u128;
        let r_sq = r.checked_mul(r)?;
        r_sq.checked_mul(SCALE)?.checked_div(self.k_squared)
    }
}

// ── Enums ────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MarketType {
    Binary = 0,
    MultiOutcome = 1,
    Continuous = 2,
}

impl MarketType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Binary),
            1 => Some(Self::MultiOutcome),
            2 => Some(Self::Continuous),
            _ => None,
        }
    }

    /// Valid num_outcomes range for this market type.
    pub fn valid_num_outcomes(self, n: u16) -> bool {
        match self {
            Self::Binary => n == 2,
            Self::MultiOutcome => (3..=MAX_OUTCOMES).contains(&n),
            Self::Continuous => (2..=MAX_BINS).contains(&n),
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MarketState {
    Active = 0,
    Paused = 1,
    PendingResolution = 2,
    Resolved = 3,
}

impl MarketState {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Active),
            1 => Some(Self::Paused),
            2 => Some(Self::PendingResolution),
            3 => Some(Self::Resolved),
            _ => None,
        }
    }
}
