use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::constants::*;
use crate::engine::kernel;
use crate::errors::DekantPmError;
use crate::events::PayoutClaimed;

// ── Accounts ─────────────────────────────────────────────────────────

/// No args — payout is computed from on-chain state.
#[derive(Accounts)]
pub struct ClaimPayout<'info> {
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

    /// Trader's collateral token account (receives payout).
    #[account(
        mut,
        constraint = trader_ata.mint == market.collateral_mint,
        constraint = trader_ata.owner == trader.key(),
    )]
    pub trader_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
    let market = &ctx.accounts.market;
    let position = &ctx.accounts.user_position;

    // ── Guards ────────────────────────────────────────────────────────
    market.require_resolved()?;
    require!(!position.claimed, DekantPmError::AlreadyClaimed);

    let win = market.resolved_outcome as usize;

    // Branch on kernel mode. Binary/multi always force kernel_width = 0 at
    // market creation, so they take the WTA path here unconditionally; only
    // continuous markets with kernel_width > 0 enter the smooth-kernel branch.
    let gross_payout: u128 = if market.market_type == MARKET_TYPE_CONTINUOUS
        && market.kernel_width > 0
    {
        // Smooth kernel: each bin contributes `holdings[i] * K(i, win, w)`,
        // then the per-market scaling factor (set at resolution) dilutes the
        // aggregate to keep the vault solvent. A trader whose holdings are
        // all outside the kernel's support gets 0 and falls through to the
        // NothingToClaim guard below.
        kernel::compute_kernel_payout(
            &position.holdings,
            win,
            market.kernel_width,
            market.scaling_factor,
        )?
    } else {
        // WTA 1:1: only the winning bin pays, one collateral unit per token.
        position.holdings[win] as u128
    };

    require!(gross_payout > 0, DekantPmError::NothingToClaim);

    let gross_payout_u64 = u64::try_from(gross_payout)
        .map_err(|_| error!(DekantPmError::MathOverflow))?;

    // ── Redemption fee ───────────────────────────────────────────────
    let redemption_fee_bps = ctx.accounts.protocol_config.redemption_fee_bps;
    let fee = gross_payout
        .checked_mul(redemption_fee_bps as u128)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?
        / 10_000;
    let fee_u64 = u64::try_from(fee)
        .map_err(|_| error!(DekantPmError::MathOverflow))?;
    let net_payout = gross_payout_u64
        .checked_sub(fee_u64)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    let position = &mut ctx.accounts.user_position;
    position.claimed = true;
    position.total_withdrawn = position
        .total_withdrawn
        .checked_add(net_payout)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    // Accumulate protocol fee from redemption.
    let market = &mut ctx.accounts.market;
    market.protocol_fee_accumulated = market
        .protocol_fee_accumulated
        .checked_add(fee_u64)
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
        net_payout,
    )?;

    emit!(PayoutClaimed {
        market_id: ctx.accounts.market.market_id,
        trader: ctx.accounts.trader.key(),
        gross_amount: gross_payout_u64,
        fee_paid: fee_u64,
        net_amount: net_payout,
    });

    Ok(())
}
