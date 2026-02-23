use anchor_lang::prelude::*;
use crate::state::Market;
use crate::errors::UmbraError;
use crate::events::MarketResolved;
use crate::constants::*;

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
            @ UmbraError::WrongOracle,
    )]
    pub market: Account<'info, Market>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_resolve_market(
    ctx: Context<ResolveMarket>,
    args: ResolveMarketArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // Lazy deadline enforcement: transition to PendingResolution if expired,
    // so the oracle can resolve in a single tx.
    if (market.state == STATE_ACTIVE || market.state == STATE_PAUSED)
        && clock.unix_timestamp >= market.deadline
    {
        market.transition_to_pending()?;
    }

    // Market::resolve validates state, outcome bounds, and range for continuous.
    market.resolve(args.outcome, args.value, clock.unix_timestamp)?;

    emit!(MarketResolved {
        market_id: market.market_id,
        oracle: ctx.accounts.oracle.key(),
        resolved_outcome: market.resolved_outcome,
        resolved_value: market.resolved_value,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
