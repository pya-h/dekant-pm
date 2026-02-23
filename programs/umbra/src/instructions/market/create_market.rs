use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::constants::*;

// ── Args ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateMarketArgs {
    /// 0 = Binary, 1 = Multi, 2 = Continuous.
    pub market_type: u8,

    /// Number of outcomes (binary=2, multi=3..32) or bins (continuous=2..256).
    pub num_outcomes: u16,

    /// Unix timestamp deadline.
    pub deadline: i64,

    /// Oracle wallet authorized to resolve.
    pub oracle: Pubkey,

    /// Collateral to deposit as initial liquidity (token-native units).
    pub initial_liquidity: u64,

    /// Lower bound of continuous range (scaled 10^9). 0 for discrete.
    pub range_min: i64,

    /// Upper bound of continuous range (scaled 10^9). 0 for discrete.
    pub range_max: i64,
}

// ── Accounts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(args: CreateMarketArgs)]
pub struct CreateMarket<'info> {
    /// Market creator. Pays rent and initial liquidity.
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Creator's role PDA (Creator, Admin, or Superadmin).
    /// CHECK: Validated in handler. May be the superadmin check via protocol_config.
    pub creator_role: Option<UncheckedAccount<'info>>,

    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// Oracle's role PDA — verifies the oracle has the Oracle role.
    #[account(
        seeds = [USER_ROLE_SEED, args.oracle.as_ref(), &[ROLE_ORACLE]],
        bump = oracle_role.bump,
    )]
    pub oracle_role: Account<'info, UserRole>,

    /// Market account to be created.
    #[account(
        init,
        payer = creator,
        space = Market::space(args.num_outcomes),
        seeds = [MARKET_SEED, protocol_config.market_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub market: Account<'info, Market>,

    /// The collateral token mint (e.g. USDC).
    pub collateral_mint: Account<'info, Mint>,

    /// Vault authority PDA — owns the vault token account. Does not hold data.
    /// CHECK: Derived from seeds; used as token account authority.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, market.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Vault token account — holds collateral for this market.
    #[account(
        init,
        payer = creator,
        token::mint = collateral_mint,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Creator's associated token account (source of initial liquidity).
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = creator,
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    /// LP position for the creator (receives initial LP shares).
    #[account(
        init,
        payer = creator,
        space = LpPosition::SIZE,
        seeds = [LP_POSITION_SEED, market.key().as_ref(), creator.key().as_ref()],
        bump,
    )]
    pub creator_lp_position: Account<'info, LpPosition>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
