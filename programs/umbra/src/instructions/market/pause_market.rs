use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::UmbraError;
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

    #[account(mut)]
    pub market: Account<'info, Market>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_pause_market(ctx: Context<PauseMarket>) -> Result<()> {
    // ── 1. Validate admin authorization ────────────────────────────────
    //
    // Superadmin bypasses role PDA check. Non-superadmin must hold an
    // Admin role PDA, validated via the same 5-layer pattern used across
    // all admin instructions.
    validate_admin_authority(
        &ctx.accounts.authority,
        &ctx.accounts.protocol_config,
        &ctx.accounts.authority_role,
        ctx.program_id,
    )?;

    // ── 2. Transition state: Active → Paused ──────────────────────────
    let market = &mut ctx.accounts.market;
    market.pause()?;

    // ── 3. Emit event ─────────────────────────────────────────────────
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
            .ok_or(error!(UmbraError::Unauthorized))?;

        // Must be owned by this program (prevents cross-program forgery).
        require!(role_info.owner == program_id, UmbraError::Unauthorized);

        // Deserialize with discriminator check (prevents account type confusion).
        let data = role_info.try_borrow_data()?;
        let mut data_ref: &[u8] = &data;
        let user_role = UserRole::try_deserialize(&mut data_ref)
            .map_err(|_| error!(UmbraError::Unauthorized))?;

        // Must hold Admin role.
        require!(user_role.role == ROLE_ADMIN, UmbraError::Unauthorized);

        // Role must belong to the signer.
        require!(
            user_role.user == authority.key(),
            UmbraError::Unauthorized
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
        .map_err(|_| error!(UmbraError::Unauthorized))?;

        require!(role_info.key() == expected_key, UmbraError::Unauthorized);
    }

    Ok(())
}
