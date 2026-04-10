use anchor_lang::prelude::*;
use crate::state::ProtocolConfig;
use crate::constants::*;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeArgs {
    /// Wallet that receives protocol fees.
    pub treasury: Pubkey,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The deployer who becomes superadmin.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Protocol config singleton. Created once.
    #[account(
        init,
        payer = authority,
        space = ProtocolConfig::SIZE,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}
