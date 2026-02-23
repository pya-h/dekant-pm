use anchor_lang::prelude::*;

/// An LP's share in a specific market's liquidity pool.
/// Seeds: ["lp_position", market_pubkey, user_pubkey]
#[account]
pub struct LpPosition {
    /// Schema version.
    pub version: u8,

    /// The market this LP position belongs to.
    pub market: Pubkey,

    /// The LP's wallet.
    pub user: Pubkey,

    /// Number of LP shares held. Proportional to the LP's fraction of the pool.
    pub shares: u128,

    /// Cumulative collateral deposited as liquidity.
    pub deposited_collateral: u64,

    /// PDA bump seed.
    pub bump: u8,

    /// Reserved for future fields.
    pub _padding: [u8; 16],
}

impl LpPosition {
    pub const SIZE: usize = 8  // discriminator
        + 1   // version
        + 32  // market
        + 32  // user
        + 16  // shares
        + 8   // deposited_collateral
        + 1   // bump
        + 16; // _padding
    // = 114 bytes
}
