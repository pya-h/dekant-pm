use anchor_lang::prelude::*;
use crate::state::ProtocolConfig;
use crate::constants::*;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateFeesArgs {
    pub creation_fee_bps: u16,
    pub trade_fee_bps: u16,
    pub redemption_fee_bps: u16,
    pub lp_fee_share_bps: u16,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateFees<'info> {
    /// Must be the superadmin.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
        constraint = protocol_config.superadmin == authority.key()
            @ crate::errors::UmbraError::Unauthorized,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}
