use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::MarketPaused;

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

    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_pause_market(ctx: Context<PauseMarket>) -> Result<()> {
    validate_admin_authority(
        &ctx.accounts.authority,
        &ctx.accounts.protocol_config,
        &ctx.accounts.authority_role,
        ctx.program_id,
    )?;

    let market = &mut ctx.accounts.market;
    market.pause()?;

    let clock = Clock::get()?;
    emit!(MarketPaused {
        market_id: market.market_id,
        admin: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ── Shared Admin Authorization ───────────────────────────────────────

/// Validate that the signer is either the superadmin or holds an Admin role.
///
/// Used by pause_market and unpause_market. Same 5-layer validation
/// pattern as create_market / assign_role, but requires ROLE_ADMIN only.
pub fn validate_admin_authority<'info>(
    authority: &Signer<'info>,
    protocol_config: &Account<'info, ProtocolConfig>,
    authority_role: &Option<UncheckedAccount<'info>>,
    program_id: &Pubkey,
) -> Result<()> {
    let is_superadmin = authority.key() == protocol_config.superadmin;

    if !is_superadmin {
        let role_info = authority_role
            .as_ref()
            .ok_or(error!(DekantPmError::Unauthorized))?;

        require!(role_info.owner == program_id, DekantPmError::Unauthorized);

        let data = role_info.try_borrow_data()?;
        let mut data_ref: &[u8] = &data;
        let user_role = UserRole::try_deserialize(&mut data_ref)
            .map_err(|_| error!(DekantPmError::Unauthorized))?;

        require!(user_role.role == ROLE_ADMIN, DekantPmError::Unauthorized);

        require!(
            user_role.user == authority.key(),
            DekantPmError::Unauthorized
        );

        // Re-derive PDA (O(1) with stored bump).
        let expected_key = Pubkey::create_program_address(
            &[
                USER_ROLE_SEED,
                authority.key().as_ref(),
                &[ROLE_ADMIN],
                &[user_role.bump],
            ],
            program_id,
        )
        .map_err(|_| error!(DekantPmError::Unauthorized))?;

        require!(role_info.key() == expected_key, DekantPmError::Unauthorized);
    }

    Ok(())
}
