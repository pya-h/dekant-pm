use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::state::*;
use crate::constants::*;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RemoveLiquidityArgs {
    /// Number of LP shares to burn.
    pub shares_to_burn: u128,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [LP_POSITION_SEED, market.key().as_ref(), provider.key().as_ref()],
        bump = lp_position.bump,
        has_one = market,
        constraint = lp_position.user == provider.key() @ crate::errors::UmbraError::Unauthorized,
    )]
    pub lp_position: Account<'info, LpPosition>,

    /// CHECK: Vault authority PDA.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, market.key().as_ref()],
        bump = market.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = vault.key() == market.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = provider_ata.mint == market.collateral_mint,
        constraint = provider_ata.owner == provider.key(),
    )]
    pub provider_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
