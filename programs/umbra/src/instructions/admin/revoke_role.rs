use anchor_lang::prelude::*;
use crate::state::{ProtocolConfig, UserRole};
use crate::constants::*;

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
        has_one = user @ crate::errors::UmbraError::Unauthorized,
    )]
    pub user_role: Account<'info, UserRole>,
}
