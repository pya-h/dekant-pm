use anchor_lang::prelude::*;

// ── Market Events ────────────────────────────────────────────────────

#[event]
pub struct MarketCreated {
    pub market_id: u64,
    pub market_type: u8,
    pub creator: Pubkey,
    pub oracle: Pubkey,
    pub collateral_mint: Pubkey,
    pub deadline: i64,
    pub num_outcomes: u16,
    pub initial_liquidity: u64,
    pub range_min: i64,
    pub range_max: i64,
}

#[event]
pub struct MarketPaused {
    pub market_id: u64,
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MarketUnpaused {
    pub market_id: u64,
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MarketResolved {
    pub market_id: u64,
    pub oracle: Pubkey,
    pub resolved_outcome: u16,
    pub resolved_value: i64,
    pub timestamp: i64,
}

// ── Trading Events ───────────────────────────────────────────────────

#[event]
pub struct TradePlaced {
    pub market_id: u64,
    pub trader: Pubkey,
    pub is_buy: bool,
    /// Collateral paid (buy) or received (sell), before/after fees.
    pub collateral_amount: u64,
    /// Outcome index for discrete trades; 0 for distribution trades.
    pub outcome_index: u16,
    /// Distribution center (continuous only; 0 for discrete).
    pub mu: i64,
    /// Distribution width (continuous only; 0 for discrete).
    pub sigma: u64,
    /// Total outcome tokens transacted across all bins/outcomes.
    pub tokens_transacted: u64,
    pub fee_paid: u64,
    pub timestamp: i64,
}

// ── Settlement Events ────────────────────────────────────────────────

#[event]
pub struct PayoutClaimed {
    pub market_id: u64,
    pub trader: Pubkey,
    pub gross_amount: u64,
    pub fee_paid: u64,
    pub net_amount: u64,
}

// ── Liquidity Events ─────────────────────────────────────────────────

#[event]
pub struct LiquidityChanged {
    pub market_id: u64,
    pub provider: Pubkey,
    pub is_add: bool,
    pub collateral_amount: u64,
    pub shares_changed: u128,
    pub timestamp: i64,
}

// ── Fee Events ───────────────────────────────────────────────────────

#[event]
pub struct FeesCollected {
    pub market_id: u64,
    pub collector: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FeesUpdated {
    pub authority: Pubkey,
    pub creation_fee_bps: u16,
    pub trade_fee_bps: u16,
    pub redemption_fee_bps: u16,
    pub lp_fee_share_bps: u16,
}

// ── Role Events ──────────────────────────────────────────────────────

#[event]
pub struct RoleAssigned {
    pub user: Pubkey,
    pub role: u8,
    pub assigned_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RoleRevoked {
    pub user: Pubkey,
    pub role: u8,
    pub revoked_by: Pubkey,
    pub timestamp: i64,
}
