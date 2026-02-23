use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::constants::*;
use crate::errors::UmbraError;
use crate::events::TradePlaced;
use crate::engine::{amm, normal_pdf};

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SellDistributionArgs {
    /// Center of the Normal distribution describing which bins to sell from.
    pub mu: i64,

    /// Standard deviation.
    pub sigma: u64,

    /// Total tokens to sell (distributed proportionally across bins).
    pub token_amount: u64,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SellDistribution<'info> {
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
        constraint = user_position.user == trader.key() @ UmbraError::Unauthorized,
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

pub fn handle_sell_distribution(
    ctx: Context<SellDistribution>,
    args: SellDistributionArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // ── Guards ────────────────────────────────────────────────────────
    if market.is_active() && market.is_expired(clock.unix_timestamp) {
        market.transition_to_pending()?;
        return Err(error!(UmbraError::MarketClosed));
    }
    market.require_trading_allowed(clock.unix_timestamp)?;
    market.require_continuous()?;
    require!(args.sigma > 0, UmbraError::InvalidSigma);
    require!(args.token_amount > 0, UmbraError::TradeTooSmall);

    // ── Compute bin weights ──────────────────────────────────────────
    let weights = normal_pdf::compute_bin_weights(
        market.range_min,
        market.range_max,
        market.num_outcomes,
        args.mu,
        args.sigma,
    );

    // ── Verify user has sufficient holdings for each bin ──────────────
    let position = &ctx.accounts.user_position;
    for (i, &w) in weights.iter().enumerate() {
        let tokens_for_bin = (args.token_amount as u128) * (w as u128) / SCALE;
        require!(
            position.holdings[i] >= tokens_for_bin as u64,
            UmbraError::InsufficientHoldings
        );
    }

    // ── AMM computation ──────────────────────────────────────────────
    let collateral_out = amm::compute_distribution_sell(
        &mut market.reserves,
        market.k_squared,
        &weights,
        args.token_amount,
    )?;

    // ── Fees on returned collateral ──────────────────────────────────
    let fees = Market::compute_fees(
        collateral_out,
        ctx.accounts.protocol_config.trade_fee_bps,
        ctx.accounts.protocol_config.lp_fee_share_bps,
    )?;

    // Update market state.
    market.total_minted = market
        .total_minted
        .checked_sub(collateral_out as u128)
        .ok_or_else(|| error!(UmbraError::InsufficientLiquidity))?;
    market.k_squared = amm::sum_of_squares(&market.reserves);
    market.accrue_fees(&fees)?;

    // ── UserPosition ─────────────────────────────────────────────────
    let position = &mut ctx.accounts.user_position;
    for (i, &w) in weights.iter().enumerate() {
        let tokens_for_bin = (args.token_amount as u128) * (w as u128) / SCALE;
        position.holdings[i] = position.holdings[i]
            .checked_sub(tokens_for_bin as u64)
            .ok_or_else(|| error!(UmbraError::InsufficientHoldings))?;
    }
    position.total_withdrawn = position
        .total_withdrawn
        .checked_add(fees.net_amount)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;

    // ── CPI: transfer net collateral from vault to trader ────────────
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

    // ── Event ────────────────────────────────────────────────────────
    emit!(TradePlaced {
        market_id: ctx.accounts.market.market_id,
        trader: ctx.accounts.trader.key(),
        is_buy: false,
        collateral_amount: collateral_out,
        outcome_index: 0,
        mu: args.mu,
        sigma: args.sigma,
        tokens_transacted: args.token_amount,
        fee_paid: fees.total_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
