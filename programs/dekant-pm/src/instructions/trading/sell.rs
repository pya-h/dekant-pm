use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::TradePlaced;
use crate::engine::amm;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SellArgs {
    /// Which outcome to sell (0..num_outcomes-1).
    pub outcome: u16,

    /// Number of outcome tokens to sell back to the AMM.
    pub token_amount: u64,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Sell<'info> {
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

    #[account(
        mut,
        seeds = [USER_POSITION_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump = user_position.bump,
        has_one = market,
        constraint = user_position.user == trader.key() @ DekantPmError::Unauthorized,
    )]
    pub user_position: Account<'info, UserPosition>,

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

    /// Trader's collateral token account (receives payment).
    #[account(
        mut,
        constraint = trader_ata.mint == market.collateral_mint,
        constraint = trader_ata.owner == trader.key(),
    )]
    pub trader_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_sell(ctx: Context<Sell>, args: SellArgs) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // ── Guards ────────────────────────────────────────────────────────
    if market.is_active() && market.is_expired(clock.unix_timestamp) {
        market.transition_to_pending()?;
        return Err(error!(DekantPmError::MarketClosed));
    }
    market.require_trading_allowed(clock.unix_timestamp)?;
    market.require_discrete()?;
    market.validate_outcome(args.outcome)?;
    require!(args.token_amount >= MIN_TRADE_AMOUNT, DekantPmError::TradeTooSmall);

    require!(
        ctx.accounts.user_position.holdings[args.outcome as usize] >= args.token_amount,
        DekantPmError::InsufficientHoldings
    );

    // compute_sell returns gross collateral before fees.
    let total_minted = market.total_minted;
    let collateral_out = amm::compute_sell(
        &mut market.reserves,
        total_minted,
        args.outcome as usize,
        args.token_amount,
    )?;

    // ── Fees on returned collateral ──────────────────────────────────
    let fees = Market::compute_fees(
        collateral_out,
        ctx.accounts.protocol_config.trade_fee_bps,
        ctx.accounts.protocol_config.lp_fee_share_bps,
    )?;

    market.total_minted = market
        .total_minted
        .checked_sub(collateral_out as u128)
        .ok_or_else(|| error!(DekantPmError::InsufficientLiquidity))?;
    market.k_squared = market
        .total_minted
        .checked_mul(market.total_minted)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    market.accrue_fees(&fees)?;

    let position = &mut ctx.accounts.user_position;
    position.holdings[args.outcome as usize] = position.holdings[args.outcome as usize]
        .checked_sub(args.token_amount)
        .ok_or_else(|| error!(DekantPmError::InsufficientHoldings))?;
    position.total_withdrawn = position
        .total_withdrawn
        .checked_add(fees.net_amount)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

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
                to: ctx.accounts.trader_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        fees.net_amount,
    )?;

    emit!(TradePlaced {
        market_id: ctx.accounts.market.market_id,
        trader: ctx.accounts.trader.key(),
        is_buy: false,
        collateral_amount: collateral_out,
        outcome_index: args.outcome,
        mu: 0,
        sigma: 0,
        tokens_transacted: args.token_amount,
        fee_paid: fees.total_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
