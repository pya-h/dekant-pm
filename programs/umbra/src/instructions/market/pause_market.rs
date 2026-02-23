use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;

// ── Accounts ─────────────────────────────────────────────────────────

/// No args needed — just transitions state to Paused.
#[derive(Accounts)]
pub struct PauseMarket<'info> {
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
