use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::state::*;
use crate::constants::*;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AddLiquidityArgs {
    /// Amount of collateral to deposit as liquidity (token-native units).
    pub amount: u64,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// LP position — created on first deposit.
    #[account(
        init_if_needed,
        payer = provider,
        space = LpPosition::SIZE,
        seeds = [LP_POSITION_SEED, market.key().as_ref(), provider.key().as_ref()],
        bump,
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
    pub system_program: Program<'info, System>,
}
