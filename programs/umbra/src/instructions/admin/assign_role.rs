use anchor_lang::prelude::*;
use crate::state::{ProtocolConfig, UserRole};
use crate::constants::*;

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
