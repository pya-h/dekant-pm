use anchor_lang::prelude::*;
use crate::state::{ProtocolConfig, UserRole, Role};
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::RoleAssigned;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AssignRoleArgs {
    /// Role to assign (1=Admin, 2=Oracle, 3=Creator).
    pub role: u8,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(args: AssignRoleArgs)]
pub struct AssignRole<'info> {
    /// The admin or superadmin assigning the role. Must be mut (pays rent).
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Protocol config — used to check if authority is superadmin.
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// The authority's own role PDA (proves they are admin).
    /// Optional: not needed if authority == superadmin.
    /// Validated in handler logic, not in constraints, because it's conditional.
    /// CHECK: Deserialized and validated manually in the handler.
    pub authority_role: Option<UncheckedAccount<'info>>,

    /// The wallet receiving the role.
    /// CHECK: Any valid pubkey. Does not need to sign.
    pub target_user: UncheckedAccount<'info>,

    /// UserRole PDA to be created.
    #[account(
        init,
        payer = authority,
        space = UserRole::SIZE,
        seeds = [USER_ROLE_SEED, target_user.key().as_ref(), &[args.role]],
        bump,
    )]
    pub user_role: Account<'info, UserRole>,

    pub system_program: Program<'info, System>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_assign_role(ctx: Context<AssignRole>, args: AssignRoleArgs) -> Result<()> {
    let role = Role::from_u8(args.role).ok_or(error!(DekantPmError::InvalidRole))?;

    // Superadmin can assign any role. Admin can only assign Oracle/Creator.
    let is_superadmin = ctx.accounts.authority.key() == ctx.accounts.protocol_config.superadmin;

    if !is_superadmin {
        let role_info = ctx
            .accounts
            .authority_role
            .as_ref()
            .ok_or(error!(DekantPmError::Unauthorized))?;

        require!(
            role_info.owner == ctx.program_id,
            DekantPmError::Unauthorized
        );

        let data = role_info.try_borrow_data()?;
        let mut data_ref: &[u8] = &data;
        let admin_role = UserRole::try_deserialize(&mut data_ref)
            .map_err(|_| error!(DekantPmError::Unauthorized))?;

        require!(admin_role.role == ROLE_ADMIN, DekantPmError::Unauthorized);
        require!(
            admin_role.user == ctx.accounts.authority.key(),
            DekantPmError::Unauthorized
        );

        // Re-derive PDA (O(1) with stored bump) to verify account key.
        let expected = Pubkey::create_program_address(
            &[
                USER_ROLE_SEED,
                ctx.accounts.authority.key().as_ref(),
                &[ROLE_ADMIN],
                &[admin_role.bump],
            ],
            ctx.program_id,
        )
        .map_err(|_| error!(DekantPmError::Unauthorized))?;

        require!(role_info.key() == expected, DekantPmError::Unauthorized);

        require!(role.admin_can_assign(), DekantPmError::AdminCannotAssignAdmin);
    }

    let clock = Clock::get()?;
    let user_role = &mut ctx.accounts.user_role;
    user_role.version = SCHEMA_VERSION;
    user_role.user = ctx.accounts.target_user.key();
    user_role.role = args.role;
    user_role.assigned_by = ctx.accounts.authority.key();
    user_role.assigned_at = clock.unix_timestamp;
    user_role.bump = ctx.bumps.user_role;

    emit!(RoleAssigned {
        user: ctx.accounts.target_user.key(),
        role: args.role,
        assigned_by: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
