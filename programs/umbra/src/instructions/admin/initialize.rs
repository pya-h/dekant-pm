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

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    let config = &mut ctx.accounts.protocol_config;

    config.version = SCHEMA_VERSION;
    config.superadmin = ctx.accounts.authority.key();
    config.treasury = args.treasury;
    config.market_count = 0;
    config.creation_fee_bps = DEFAULT_CREATION_FEE_BPS;
    config.trade_fee_bps = DEFAULT_TRADE_FEE_BPS;
    config.redemption_fee_bps = DEFAULT_REDEMPTION_FEE_BPS;
    config.lp_fee_share_bps = DEFAULT_LP_FEE_SHARE_BPS;
    config.bump = ctx.bumps.protocol_config;
    config._padding = [0u8; 64];

    Ok(())
}
