use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::TradePlaced;
use crate::engine::amm;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SellAllArgs {
    /// Minimum collateral the trader expects to receive (slippage protection).
    /// Set to 0 to accept any amount.
    pub min_collateral_out: u64,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SellAll<'info> {
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

    #[account(
        mut,
        constraint = trader_ata.mint == market.collateral_mint,
        constraint = trader_ata.owner == trader.key(),
    )]
    pub trader_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_sell_all(
    ctx: Context<SellAll>,
    args: SellAllArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // ── Guards ────────────────────────────────────────────────────────
    if market.is_active() && market.is_expired(clock.unix_timestamp) {
        market.transition_to_pending()?;
        return Err(error!(DekantPmError::MarketClosed));
    }
    market.require_trading_allowed(clock.unix_timestamp)?;
    market.require_continuous()?;

    let position = &ctx.accounts.user_position;
    require!(position.has_holdings(), DekantPmError::InsufficientHoldings);

    // Snapshot holdings before mutation
    let holdings: Vec<u64> = position.holdings.clone();
    let total_tokens: u64 = holdings.iter().sum();

    let total_minted = market.total_minted;
    let collateral_out = amm::compute_sell_all(
        &mut market.reserves,
        total_minted,
        &holdings,
    )?;

    // ── Slippage check ───────────────────────────────────────────────
    require!(
        collateral_out >= args.min_collateral_out,
        DekantPmError::MinCollateralNotMet
    );

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

    // Update trader_token_totals
    for (i, &h) in holdings.iter().enumerate() {
        market.trader_token_totals[i] = market.trader_token_totals[i]
            .checked_sub(h)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    }

    // Zero out position holdings
    let position = &mut ctx.accounts.user_position;
    for h in position.holdings.iter_mut() {
        *h = 0;
    }
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
        outcome_index: 0,
        mu: 0,
        sigma: 0,
        tokens_transacted: total_tokens,
        fee_paid: fees.total_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
