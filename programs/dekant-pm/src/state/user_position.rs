use anchor_lang::prelude::*;

/// A trader's token holdings in a specific market.
/// Seeds: ["user_position", market_pubkey, user_pubkey]
#[account]
pub struct UserPosition {
    /// Schema version.
    pub version: u8,

    /// The market this position belongs to.
    pub market: Pubkey,

    /// The trader's wallet.
    pub user: Pubkey,

    /// Cumulative collateral deposited into this market by this trader.
    pub total_deposited: u64,

    /// Cumulative collateral withdrawn from this market by this trader.
    pub total_withdrawn: u64,

    /// Whether the post-resolution payout has been claimed.
    pub claimed: bool,

    /// PDA bump seed.
    pub bump: u8,

    /// Reserved for future fields.
    pub _padding: [u8; 16],

    /// Token holdings per outcome/bin.
    /// Length = market.num_outcomes.
    /// holdings[i] = number of outcome-i tokens this trader owns.
    pub holdings: Vec<u64>,
}

impl UserPosition {
    /// Total account size for a position with `n` outcomes/bins.
    pub fn space(n: u16) -> usize {
        8   // discriminator
        + 1   // version
        + 32  // market
        + 32  // user
        + 8   // total_deposited
        + 8   // total_withdrawn
        + 1   // claimed
        + 1   // bump
        + 16  // _padding
        + 4   // vec length prefix
        + (n as usize) * 8  // holdings data
    }

    /// Sum of all holdings across outcomes/bins.
    pub fn total_holdings(&self) -> u64 {
        self.holdings.iter().sum()
    }

    /// Whether this position has any non-zero holdings.
    pub fn has_holdings(&self) -> bool {
        self.holdings.iter().any(|&h| h > 0)
    }
}
