use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::constants::*;
use crate::errors::UmbraError;
use crate::events::TradePlaced;
use crate::engine::{amm, normal_pdf};

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BuyDistributionArgs {
    /// Center of the Normal distribution (same scale as market.range_min/max).
    pub mu: i64,

    /// Standard deviation of the Normal distribution (same scale, must be > 0).
    pub sigma: u64,

    /// Amount of collateral to spend (token-native units).
    pub collateral_amount: u64,
}

// ── Accounts ─────────────────────────────────────────────────────────

/// Identical account layout to Buy — the difference is in the args and handler logic.
#[derive(Accounts)]
pub struct BuyDistribution<'info> {
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
        init_if_needed,
        payer = trader,
        space = UserPosition::space(market.num_outcomes),
        seeds = [USER_POSITION_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump,
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
    pub system_program: Program<'info, System>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_buy_distribution(
    ctx: Context<BuyDistribution>,
    args: BuyDistributionArgs,
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
    require!(
        args.collateral_amount >= MIN_TRADE_AMOUNT,
        UmbraError::TradeTooSmall
    );

    let weights = normal_pdf::compute_bin_weights(
        market.range_min,
        market.range_max,
        market.num_outcomes,
        args.mu,
        args.sigma,
    );

    let fees = Market::compute_fees(
        args.collateral_amount,
        ctx.accounts.protocol_config.trade_fee_bps,
        ctx.accounts.protocol_config.lp_fee_share_bps,
    )?;

    let k_sq = market.k_squared;
    let tokens_out = amm::compute_distribution_buy(
        &mut market.reserves,
        k_sq,
        &weights,
        fees.net_amount,
    )?;

    market.total_minted = market
        .total_minted
        .checked_add(fees.net_amount as u128)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;
    market.k_squared = amm::sum_of_squares(&market.reserves);
    market.accrue_fees(&fees)?;

    let position = &mut ctx.accounts.user_position;
    if position.version == 0 {
        position.version = SCHEMA_VERSION;
        position.market = market.key();
        position.user = ctx.accounts.trader.key();
        position.bump = ctx.bumps.user_position;
        position._padding = [0u8; 16];
        position.holdings = vec![0u64; market.num_outcomes as usize];
    }

    let mut total_tokens: u64 = 0;
    for (i, &out) in tokens_out.iter().enumerate() {
        position.holdings[i] = position.holdings[i]
            .checked_add(out)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
        total_tokens = total_tokens
            .checked_add(out)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
    }
    position.total_deposited = position
        .total_deposited
        .checked_add(args.collateral_amount)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.trader_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        args.collateral_amount,
    )?;

    emit!(TradePlaced {
        market_id: market.market_id,
        trader: ctx.accounts.trader.key(),
        is_buy: true,
        collateral_amount: args.collateral_amount,
        outcome_index: 0,
        mu: args.mu,
        sigma: args.sigma,
        tokens_transacted: total_tokens,
        fee_paid: fees.total_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
