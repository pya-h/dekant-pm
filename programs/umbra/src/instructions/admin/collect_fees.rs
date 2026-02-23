use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::constants::*;
use crate::errors::UmbraError;
use crate::events::FeesCollected;

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CollectFees<'info> {
    /// Must be the superadmin.
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
        constraint = protocol_config.superadmin == authority.key()
            @ UmbraError::Unauthorized,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

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

    /// Treasury's collateral token account (receives fees).
    #[account(
        mut,
        constraint = treasury_ata.mint == market.collateral_mint,
        constraint = treasury_ata.owner == protocol_config.treasury,
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_collect_fees(ctx: Context<CollectFees>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    let amount = market.protocol_fee_accumulated;
    require!(amount > 0, UmbraError::NoFeesToCollect);

    market.protocol_fee_accumulated = 0;

    let market_key = ctx.accounts.market.key();
    let seeds = &[
        VAULT_AUTHORITY_SEED,
        market_key.as_ref(),
        &[ctx.accounts.market.vault_authority_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.treasury_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    emit!(FeesCollected {
        market_id: ctx.accounts.market.market_id,
        collector: ctx.accounts.authority.key(),
        amount,
    });

    Ok(())
}
