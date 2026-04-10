use anchor_lang::prelude::*;
use crate::state::{ProtocolConfig, UserRole, Role};
use crate::constants::*;
use crate::errors::UmbraError;
use crate::events::RoleRevoked;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RevokeRoleArgs {
    /// Role to revoke (1=Admin, 2=Oracle, 3=Creator).
    pub role: u8,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(args: RevokeRoleArgs)]
pub struct RevokeRole<'info> {
    /// The admin or superadmin revoking the role. Receives reclaimed rent.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// Authority's own role PDA (if admin, not superadmin).
    /// CHECK: Validated manually in handler.
    pub authority_role: Option<UncheckedAccount<'info>>,

    /// The wallet whose role is being revoked.
    /// CHECK: Any valid pubkey.
    pub target_user: UncheckedAccount<'info>,

    /// UserRole PDA to be closed. Rent returned to authority.
    #[account(
        mut,
        close = authority,
        seeds = [USER_ROLE_SEED, target_user.key().as_ref(), &[args.role]],
        bump = user_role.bump,
        constraint = user_role.user == target_user.key() @ UmbraError::Unauthorized,
    )]
    pub user_role: Account<'info, UserRole>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_revoke_role(ctx: Context<RevokeRole>, args: RevokeRoleArgs) -> Result<()> {
    // Validate role type.
    let role = Role::from_u8(args.role).ok_or(error!(UmbraError::InvalidRole))?;

    // ── Authorization ──────────────────────────────────────────────────
    //
    // Superadmin can revoke any role. Admin can revoke Oracle/Creator only.
    let is_superadmin = ctx.accounts.authority.key() == ctx.accounts.protocol_config.superadmin;

    if !is_superadmin {
        let role_info = ctx
            .accounts
            .authority_role
            .as_ref()
            .ok_or(error!(UmbraError::Unauthorized))?;

        require!(
            role_info.owner == ctx.program_id,
            UmbraError::Unauthorized
        );

        let data = role_info.try_borrow_data()?;
        let mut data_ref: &[u8] = &data;
        let admin_role = UserRole::try_deserialize(&mut data_ref)
            .map_err(|_| error!(UmbraError::Unauthorized))?;

        require!(admin_role.role == ROLE_ADMIN, UmbraError::Unauthorized);
        require!(
            admin_role.user == ctx.accounts.authority.key(),
            UmbraError::Unauthorized
        );

        let expected = Pubkey::create_program_address(
            &[
                USER_ROLE_SEED,
                ctx.accounts.authority.key().as_ref(),
                &[ROLE_ADMIN],
                &[admin_role.bump],
            ],
            ctx.program_id,
        )
        .map_err(|_| error!(UmbraError::Unauthorized))?;

        require!(role_info.key() == expected, UmbraError::Unauthorized);

        // Admin cannot revoke the Admin role.
        require!(role.admin_can_assign(), UmbraError::AdminCannotAssignAdmin);
    }

    // ── Emit event ─────────────────────────────────────────────────────
    //
    // Anchor's `close = authority` handles zeroing data and transferring
    // lamports back to the authority.
    let clock = Clock::get()?;
    emit!(RoleRevoked {
        user: ctx.accounts.target_user.key(),
        role: args.role,
        revoked_by: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
