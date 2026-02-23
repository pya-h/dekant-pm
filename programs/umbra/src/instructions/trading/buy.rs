use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::state::*;
use crate::constants::*;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BuyArgs {
    /// Which outcome to buy (0..num_outcomes-1).
    pub outcome: u16,

    /// Amount of collateral to spend (token-native units, e.g. USDC micro-units).
    pub collateral_amount: u64,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Buy<'info> {
    /// The trader placing the buy.
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// Trader's position — created on first trade via init_if_needed.
    #[account(
        init_if_needed,
        payer = trader,
        space = UserPosition::space(market.num_outcomes),
        seeds = [USER_POSITION_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, UserPosition>,

    /// Vault authority PDA (signs CPI transfers from vault).
    /// CHECK: Derived from seeds.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, market.key().as_ref()],
        bump = market.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Market's collateral vault.
    #[account(
        mut,
        constraint = vault.key() == market.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Trader's collateral token account (source of payment).
    #[account(
        mut,
        constraint = trader_ata.mint == market.collateral_mint,
        constraint = trader_ata.owner == trader.key(),
    )]
    pub trader_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
