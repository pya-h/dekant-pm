use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::TradePlaced;
use crate::engine::amm;

use super::sell::Sell;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SellToPriceArgs {
    /// Which outcome to sell (0..num_outcomes-1).
    pub outcome: u16,

    /// Target probability for this outcome, scaled to SCALE (e.g. 300_000_000 = 30%).
    /// Use 0 to sell the entire position.
    pub target_probability: u64,

    /// Minimum net collateral the trader is willing to receive (slippage protection).
    pub min_collateral_out: u64,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_sell_to_price(ctx: Context<Sell>, args: SellToPriceArgs) -> Result<()> {
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

    // ── Compute required tokens to sell ───────────────────────────────
    let total_minted = market.total_minted;
    let tokens_in = amm::compute_tokens_for_target_prob(
        &market.reserves,
        total_minted,
        args.outcome as usize,
        args.target_probability as u128,
    )?;

    require!(
        ctx.accounts.user_position.holdings[args.outcome as usize] >= tokens_in,
        DekantPmError::InsufficientHoldings
    );

    // ── AMM computation ──────────────────────────────────────────────
    let collateral_out = amm::compute_sell(
        &mut market.reserves,
        total_minted,
        args.outcome as usize,
        tokens_in,
    )?;

    // ── Fees on returned collateral ──────────────────────────────────
    let fees = Market::compute_fees(
        collateral_out,
        ctx.accounts.protocol_config.trade_fee_bps,
        ctx.accounts.protocol_config.lp_fee_share_bps,
    )?;

    require!(
        fees.net_amount >= args.min_collateral_out,
        DekantPmError::MinCollateralNotMet
    );

    // ── Update market state ──────────────────────────────────────────
    market.total_minted = market
        .total_minted
        .checked_sub(collateral_out as u128)
        .ok_or_else(|| error!(DekantPmError::InsufficientLiquidity))?;
    market.k_squared = market
        .total_minted
        .checked_mul(market.total_minted)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    market.accrue_fees(&fees)?;
    market.trader_token_totals[args.outcome as usize] = market.trader_token_totals
        [args.outcome as usize]
        .checked_sub(tokens_in)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    // ── Update user position ──────────────────────────────────────────
    let position = &mut ctx.accounts.user_position;
    position.holdings[args.outcome as usize] = position.holdings[args.outcome as usize]
        .checked_sub(tokens_in)
        .ok_or_else(|| error!(DekantPmError::InsufficientHoldings))?;
    position.total_withdrawn = position
        .total_withdrawn
        .checked_add(fees.net_amount)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    // ── Transfer tokens ──────────────────────────────────────────────
    let market_key = ctx.accounts.market.key();
    let seeds = &[
        VAULT_AUTHORITY_SEED,
        market_key.as_ref(),
        &[ctx.accounts.market.vault_authority_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    anchor_spl::token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.trader_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        fees.net_amount,
    )?;

    // ── Emit event ───────────────────────────────────────────────────
    emit!(TradePlaced {
        market_id: ctx.accounts.market.market_id,
        trader: ctx.accounts.trader.key(),
        is_buy: false,
        collateral_amount: collateral_out,
        outcome_index: args.outcome,
        mu: 0,
        sigma: 0,
        tokens_transacted: tokens_in,
        fee_paid: fees.total_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
