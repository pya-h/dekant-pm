use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::LiquidityChanged;
use crate::engine::amm;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RemoveLiquidityArgs {
    /// Number of LP shares to burn.
    pub shares_to_burn: u128,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [LP_POSITION_SEED, market.key().as_ref(), provider.key().as_ref()],
        bump = lp_position.bump,
        has_one = market,
        constraint = lp_position.user == provider.key() @ DekantPmError::Unauthorized,
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
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_remove_liquidity(
    ctx: Context<RemoveLiquidity>,
    args: RemoveLiquidityArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // ── Guards ────────────────────────────────────────────────────────
    // Lazy deadline enforcement: if expired, transition to PendingResolution.
    // Unlike buy/sell, we do NOT return an error — LPs must always be able to withdraw.
    if market.is_active() && market.is_expired(clock.unix_timestamp) {
        market.transition_to_pending()?;
    }
    // LPs can remove liquidity from Active, PendingResolution, or Resolved markets.
    require!(
        market.is_active() || market.is_pending_resolution() || market.is_resolved(),
        DekantPmError::MarketPaused
    );
    require!(args.shares_to_burn > 0, DekantPmError::InsufficientShares);
    require!(
        ctx.accounts.lp_position.shares >= args.shares_to_burn,
        DekantPmError::InsufficientShares
    );

    // ── Compute collateral owed to LP ────────────────────────────────
    let collateral_out = if market.is_resolved() {
        // Resolved: LP's share of the residual winning-outcome reserves.
        // In 1:1 mode, traders claim x[winning], leaving reserves[winning] for LPs.
        market.compute_lp_resolved_payout(args.shares_to_burn)?
    } else {
        // Active/PendingResolution: proportional share of total_minted (existing AMM logic).
        market.compute_collateral_for_withdrawal(args.shares_to_burn)?
    };

    let fee_share = market.compute_lp_fee_share(args.shares_to_burn)?;
    let total_payout = collateral_out
        .checked_add(fee_share)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    // ── Update market state ──────────────────────────────────────────
    if market.is_resolved() {
        // Scale ALL reserves proportionally by remaining LP ownership.
        // Only reserves[winning] has monetary value, but we keep all reserves
        // consistent so market state remains mathematically correct after withdrawal.
        let remaining = market.lp_shares_total
            .checked_sub(args.shares_to_burn)
            .ok_or_else(|| error!(DekantPmError::InsufficientShares))?;
        // k_squared is irrelevant post-resolution; discard it.
        let _ = amm::scale_reserves(
            &mut market.reserves,
            remaining,
            market.lp_shares_total,
        )?;
    } else {
        // Active/PendingResolution: scale all reserves proportionally.
        let total_before = market.total_minted;
        let numerator = total_before
            .checked_sub(collateral_out)
            .ok_or_else(|| error!(DekantPmError::InsufficientLiquidity))?;

        let new_k_squared = amm::scale_reserves(
            &mut market.reserves,
            numerator,
            total_before,
        )?;

        market.k_squared = new_k_squared;
        market.total_minted = numerator;
    }
    market.lp_shares_total = market
        .lp_shares_total
        .checked_sub(args.shares_to_burn)
        .ok_or_else(|| error!(DekantPmError::InsufficientShares))?;
    market.lp_fee_accumulated = market
        .lp_fee_accumulated
        .checked_sub(fee_share)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    let lp = &mut ctx.accounts.lp_position;
    lp.shares = lp
        .shares
        .checked_sub(args.shares_to_burn)
        .ok_or_else(|| error!(DekantPmError::InsufficientShares))?;

    // ── CPI: transfer collateral + fee share from vault to provider ──
    // total_payout may exceed u64 in extreme cases; it's u128 from compute_collateral.
    // In practice, total_minted fits in u64 since it's deposited collateral.
    let payout_u64 = u64::try_from(total_payout)
        .map_err(|_| error!(DekantPmError::MathOverflow))?;

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
                to: ctx.accounts.provider_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        payout_u64,
    )?;

    emit!(LiquidityChanged {
        market_id: ctx.accounts.market.market_id,
        provider: ctx.accounts.provider.key(),
        is_add: false,
        collateral_amount: payout_u64,
        shares_changed: args.shares_to_burn,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
