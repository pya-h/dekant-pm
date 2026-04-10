use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::TradePlaced;
use crate::engine::amm;

use super::buy::Buy;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BuyToPriceArgs {
    /// Which outcome to buy (0..num_outcomes-1).
    pub outcome: u16,

    /// Target probability for this outcome, scaled to SCALE (e.g. 700_000_000 = 70%).
    pub target_probability: u64,

    /// Maximum gross collateral the trader is willing to pay (slippage protection).
    pub max_collateral: u64,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_buy_to_price(ctx: Context<Buy>, args: BuyToPriceArgs) -> Result<()> {
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

    // ── Compute required collateral ──────────────────────────────────
    let total_minted = market.total_minted;
    let effective_collateral = amm::compute_collateral_for_target_prob(
        &market.reserves,
        total_minted,
        args.outcome as usize,
        args.target_probability as u128,
    )?;

    // Invert fees: gross = ceil(effective * 10000 / (10000 - fee_bps))
    let fee_bps = ctx.accounts.protocol_config.trade_fee_bps as u128;
    let fee_denom = 10_000u128 - fee_bps;
    let gross_collateral = (effective_collateral as u128)
        .checked_mul(10_000)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?
        .div_ceil(fee_denom);
    let gross_collateral = gross_collateral as u64;

    require!(
        gross_collateral <= args.max_collateral,
        DekantPmError::MaxCollateralExceeded
    );
    require!(
        gross_collateral >= MIN_TRADE_AMOUNT,
        DekantPmError::TradeTooSmall
    );

    // ── Compute fees ──────────────────────────────────────────────────
    let fees = Market::compute_fees(
        gross_collateral,
        ctx.accounts.protocol_config.trade_fee_bps,
        ctx.accounts.protocol_config.lp_fee_share_bps,
    )?;

    // ── AMM computation ──────────────────────────────────────────────
    let tokens_out = amm::compute_buy(
        &mut market.reserves,
        total_minted,
        args.outcome as usize,
        fees.net_amount,
    )?;

    // ── Update market state ──────────────────────────────────────────
    market.total_minted = market
        .total_minted
        .checked_add(fees.net_amount as u128)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    market.k_squared = market
        .total_minted
        .checked_mul(market.total_minted)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    market.accrue_fees(&fees)?;
    market.trader_token_totals[args.outcome as usize] = market.trader_token_totals
        [args.outcome as usize]
        .checked_add(tokens_out)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    // ── Update user position ──────────────────────────────────────────
    let position = &mut ctx.accounts.user_position;
    if position.version == 0 {
        position.version = SCHEMA_VERSION;
        position.market = market.key();
        position.user = ctx.accounts.trader.key();
        position.bump = ctx.bumps.user_position;
        position._padding = [0u8; 16];
        position.holdings = vec![0u64; market.num_outcomes as usize];
    }
    position.holdings[args.outcome as usize] = position.holdings[args.outcome as usize]
        .checked_add(tokens_out)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    position.total_deposited = position
        .total_deposited
        .checked_add(gross_collateral)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    // ── Transfer tokens ──────────────────────────────────────────────
    anchor_spl::token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.trader_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        gross_collateral,
    )?;

    // ── Emit event ───────────────────────────────────────────────────
    emit!(TradePlaced {
        market_id: market.market_id,
        trader: ctx.accounts.trader.key(),
        is_buy: true,
        collateral_amount: gross_collateral,
        outcome_index: args.outcome,
        mu: 0,
        sigma: 0,
        tokens_transacted: tokens_out,
        fee_paid: fees.total_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
