use anchor_lang::prelude::*;

/// Singleton global configuration for the Umbra protocol.
/// Seeds: ["protocol_config"]
#[account]
pub struct ProtocolConfig {
    /// Schema version for future migrations.
    pub version: u8,

    /// Wallet with full administrative authority (role assignment, fee updates).
    pub superadmin: Pubkey,

    /// Destination wallet for collected protocol fees.
    pub treasury: Pubkey,

    /// Auto-incrementing counter; next market gets this ID, then it increments.
    pub market_count: u64,

    /// Fee charged when a new market is created (basis points of initial liquidity).
    pub creation_fee_bps: u16,

    /// Fee charged on every buy/sell trade (basis points of collateral amount).
    pub trade_fee_bps: u16,

    /// Fee charged when a trader redeems a winning payout (basis points of gross payout).
    pub redemption_fee_bps: u16,

    /// Fraction of the trade fee directed to LPs (basis points of the trade fee itself).
    /// Remainder goes to protocol_fee_accumulated.
    pub lp_fee_share_bps: u16,

    /// PDA bump seed.
    pub bump: u8,

    /// Reserved for future fields.
    pub _padding: [u8; 64],
}

impl ProtocolConfig {
    /// Discriminator (8) + all fields.
    pub const SIZE: usize = 8  // anchor discriminator
        + 1   // version
        + 32  // superadmin
        + 32  // treasury
        + 8   // market_count
        + 2   // creation_fee_bps
        + 2   // trade_fee_bps
        + 2   // redemption_fee_bps
        + 2   // lp_fee_share_bps
        + 1   // bump
        + 64; // _padding
    // = 154 bytes
}
