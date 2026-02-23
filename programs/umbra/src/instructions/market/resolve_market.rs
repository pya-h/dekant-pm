use anchor_lang::prelude::*;
use crate::state::Market;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ResolveMarketArgs {
    /// Winning outcome index (binary: 0 or 1, multi: 0..N-1).
    /// For continuous markets, this is ignored (computed from `value`).
    pub outcome: u16,

    /// Exact resolved value for continuous markets (scaled same as range_min/max).
    /// Set to 0 for binary/multi markets.
    pub value: i64,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    /// The assigned oracle. Must match market.oracle.
    pub oracle: Signer<'info>,

    #[account(
        mut,
        constraint = market.oracle == oracle.key()
            @ crate::errors::UmbraError::WrongOracle,
    )]
    pub market: Account<'info, Market>,
}
