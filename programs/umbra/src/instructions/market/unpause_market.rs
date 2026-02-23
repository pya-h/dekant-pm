use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::events::MarketUnpaused;
use super::pause_market::validate_admin_authority;

// ── Accounts ─────────────────────────────────────────────────────────

/// No args needed — transitions state from Paused back to Active
/// (or to PendingResolution if deadline has passed).
#[derive(Accounts)]
pub struct UnpauseMarket<'info> {
    /// Admin or superadmin.
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// Authority's admin role PDA (if not superadmin).
    /// CHECK: Validated in handler.
    pub authority_role: Option<UncheckedAccount<'info>>,

    #[account(mut)]
    pub market: Account<'info, Market>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_unpause_market(ctx: Context<UnpauseMarket>) -> Result<()> {
    // ── 1. Validate admin authorization ────────────────────────────────
    validate_admin_authority(
        &ctx.accounts.authority,
        &ctx.accounts.protocol_config,
        &ctx.accounts.authority_role,
        ctx.program_id,
    )?;

    // ── 2. Transition state ───────────────────────────────────────────
    //
    // Paused → Active if deadline has not passed.
    // Paused → PendingResolution if deadline has passed (lazy enforcement).
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    market.unpause(clock.unix_timestamp)?;

    // ── 3. Emit event ─────────────────────────────────────────────────
    emit!(MarketUnpaused {
        market_id: market.market_id,
        admin: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
