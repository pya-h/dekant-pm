use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::LiquidityChanged;
use crate::engine::amm;

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

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_add_liquidity(ctx: Context<AddLiquidity>, args: AddLiquidityArgs) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // ── Guards ────────────────────────────────────────────────────────
    if market.is_active() && market.is_expired(clock.unix_timestamp) {
        market.transition_to_pending()?;
        return Err(error!(DekantPmError::MarketClosed));
    }
    market.require_trading_allowed(clock.unix_timestamp)?;
    require!(
        args.amount >= MIN_LIQUIDITY,
        DekantPmError::LiquidityTooSmall
    );

    let new_shares = market.compute_lp_shares_for_deposit(args.amount)?;

    let total_before = market.total_minted;
    let numerator = total_before
        .checked_add(args.amount as u128)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    let new_k_squared = amm::scale_reserves(
        &mut market.reserves,
        numerator,
        total_before,
    )?;

    market.k_squared = new_k_squared;
    market.total_minted = numerator;
    market.lp_shares_total = market
        .lp_shares_total
        .checked_add(new_shares)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    let lp = &mut ctx.accounts.lp_position;
    if lp.version == 0 {
        lp.version = SCHEMA_VERSION;
        lp.market = market.key();
        lp.user = ctx.accounts.provider.key();
        lp.bump = ctx.bumps.lp_position;
        lp._padding = [0u8; 16];
    }
    lp.shares = lp
        .shares
        .checked_add(new_shares)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    lp.deposited_collateral = lp
        .deposited_collateral
        .checked_add(args.amount)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.provider_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.provider.to_account_info(),
            },
        ),
        args.amount,
    )?;

    emit!(LiquidityChanged {
        market_id: market.market_id,
        provider: ctx.accounts.provider.key(),
        is_add: true,
        collateral_amount: args.amount,
        shares_changed: new_shares,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
