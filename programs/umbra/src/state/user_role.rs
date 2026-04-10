use anchor_lang::prelude::*;
use crate::constants::*;

/// A role assignment for a single (user, role) pair.
/// Existence of this PDA means the role is active; closing it revokes the role.
/// Seeds: ["user_role", user_pubkey, role_type_u8]
#[account]
pub struct UserRole {
    /// Schema version.
    pub version: u8,

    /// The wallet this role is assigned to.
    pub user: Pubkey,

    /// Role type (see Role enum below).
    pub role: u8,

    /// Wallet that granted this role.
    pub assigned_by: Pubkey,

    /// Unix timestamp of assignment.
    pub assigned_at: i64,

    /// PDA bump seed.
    pub bump: u8,
}

impl UserRole {
    pub const SIZE: usize = 8  // discriminator
        + 1   // version
        + 32  // user
        + 1   // role
        + 32  // assigned_by
        + 8   // assigned_at
        + 1;  // bump
    // = 83 bytes
}

/// Role type discriminator.
/// Stored as u8 in UserRole.role and used as a PDA seed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Role {
    Admin = 1,
    Oracle = 2,
    Creator = 3,
}

impl Role {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            1 => Some(Role::Admin),
            2 => Some(Role::Oracle),
            3 => Some(Role::Creator),
            _ => None,
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }

    /// Whether an Admin (non-superadmin) is allowed to assign this role.
    pub fn admin_can_assign(self) -> bool {
        matches!(self, Role::Oracle | Role::Creator)
    }
}
