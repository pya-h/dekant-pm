use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;

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
