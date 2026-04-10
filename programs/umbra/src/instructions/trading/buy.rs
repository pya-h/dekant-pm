use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::constants::*;
use crate::errors::UmbraError;
use crate::events::TradePlaced;
use crate::engine::amm;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BuyArgs {
    /// Which outcome to buy (0..num_outcomes-1).
    pub outcome: u16,

    /// Amount of collateral to spend (token-native units, e.g. USDC micro-units).
    pub collateral_amount: u64,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Buy<'info> {
    /// The trader placing the buy.
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

    /// Trader's position — created on first trade via init_if_needed.
    #[account(
        init_if_needed,
        payer = trader,
        space = UserPosition::space(market.num_outcomes),
        seeds = [USER_POSITION_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, UserPosition>,

    /// Vault authority PDA (signs CPI transfers from vault).
    /// CHECK: Derived from seeds.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, market.key().as_ref()],
        bump = market.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Market's collateral vault.
    #[account(
        mut,
        constraint = vault.key() == market.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Trader's collateral token account (source of payment).
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

pub fn handle_buy(ctx: Context<Buy>, args: BuyArgs) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // ── Guards ────────────────────────────────────────────────────────
    // Lazy deadline enforcement: if expired, transition to PendingResolution.
    if market.is_active() && market.is_expired(clock.unix_timestamp) {
        market.transition_to_pending()?;
        return Err(error!(UmbraError::MarketClosed));
    }
    market.require_trading_allowed(clock.unix_timestamp)?;
    market.require_discrete()?;
    market.validate_outcome(args.outcome)?;
    require!(
        args.collateral_amount >= MIN_TRADE_AMOUNT,
        UmbraError::TradeTooSmall
    );

    // ── Fees ─────────────────────────────────────────────────────────
    let fees = Market::compute_fees(
        args.collateral_amount,
        ctx.accounts.protocol_config.trade_fee_bps,
        ctx.accounts.protocol_config.lp_fee_share_bps,
    )?;

    // ── AMM computation ──────────────────────────────────────────────
    let tokens_out = amm::compute_buy(
        &mut market.reserves,
        market.k_squared,
        args.outcome as usize,
        fees.net_amount,
    )?;

    // Update market state.
    market.total_minted = market
        .total_minted
        .checked_add(fees.net_amount as u128)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;
    market.k_squared = amm::sum_of_squares(&market.reserves);
    market.accrue_fees(&fees)?;

    // ── UserPosition ─────────────────────────────────────────────────
    let position = &mut ctx.accounts.user_position;
    if position.version == 0 {
        // First trade: initialize the position.
        position.version = SCHEMA_VERSION;
        position.market = market.key();
        position.user = ctx.accounts.trader.key();
        position.bump = ctx.bumps.user_position;
        position._padding = [0u8; 16];
        position.holdings = vec![0u64; market.num_outcomes as usize];
    }
    position.holdings[args.outcome as usize] = position.holdings[args.outcome as usize]
        .checked_add(tokens_out)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;
    position.total_deposited = position
        .total_deposited
        .checked_add(args.collateral_amount)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;

    // ── CPI: transfer collateral from trader to vault ────────────────
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

    // ── Event ────────────────────────────────────────────────────────
    emit!(TradePlaced {
        market_id: market.market_id,
        trader: ctx.accounts.trader.key(),
        is_buy: true,
        collateral_amount: args.collateral_amount,
        outcome_index: args.outcome,
        mu: 0,
        sigma: 0,
        tokens_transacted: tokens_out,
        fee_paid: fees.total_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
