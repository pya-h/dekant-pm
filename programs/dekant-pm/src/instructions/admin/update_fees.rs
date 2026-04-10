use anchor_lang::prelude::*;
use crate::state::ProtocolConfig;
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::FeesUpdated;

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
            @ DekantPmError::Unauthorized,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_update_fees(ctx: Context<UpdateFees>, args: UpdateFeesArgs) -> Result<()> {
    require!(args.creation_fee_bps <= MAX_FEE_BPS, DekantPmError::FeeTooHigh);
    require!(args.trade_fee_bps <= MAX_FEE_BPS, DekantPmError::FeeTooHigh);
    require!(args.redemption_fee_bps <= MAX_FEE_BPS, DekantPmError::FeeTooHigh);
    // LP fee share can be up to 100% of the trade fee (10_000 bps).
    require!(args.lp_fee_share_bps <= 10_000, DekantPmError::FeeTooHigh);

    let config = &mut ctx.accounts.protocol_config;
    config.creation_fee_bps = args.creation_fee_bps;
    config.trade_fee_bps = args.trade_fee_bps;
    config.redemption_fee_bps = args.redemption_fee_bps;
    config.lp_fee_share_bps = args.lp_fee_share_bps;

    emit!(FeesUpdated {
        authority: ctx.accounts.authority.key(),
        creation_fee_bps: args.creation_fee_bps,
        trade_fee_bps: args.trade_fee_bps,
        redemption_fee_bps: args.redemption_fee_bps,
        lp_fee_share_bps: args.lp_fee_share_bps,
    });

    Ok(())
}
