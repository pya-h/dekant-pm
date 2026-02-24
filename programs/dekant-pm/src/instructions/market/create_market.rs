use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::constants::*;
use crate::errors::DekantPmError;
use crate::events::MarketCreated;

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

// ── Handler ──────────────────────────────────────────────────────────

pub fn handle_create_market(ctx: Context<CreateMarket>, args: CreateMarketArgs) -> Result<()> {
    // Superadmin bypasses role check. Otherwise verify Creator or Admin role PDA
    // using create_program_address (O(1)) for compute efficiency.
    let is_superadmin = ctx.accounts.creator.key() == ctx.accounts.protocol_config.superadmin;

    if !is_superadmin {
        let role_info = ctx
            .accounts
            .creator_role
            .as_ref()
            .ok_or(error!(DekantPmError::Unauthorized))?;

        require!(
            role_info.owner == ctx.program_id,
            DekantPmError::Unauthorized
        );

        let data = role_info.try_borrow_data()?;
        let mut data_ref: &[u8] = &data;
        let user_role = UserRole::try_deserialize(&mut data_ref)
            .map_err(|_| error!(DekantPmError::Unauthorized))?;

        require!(
            user_role.role == ROLE_CREATOR || user_role.role == ROLE_ADMIN,
            DekantPmError::Unauthorized
        );

        require!(
            user_role.user == ctx.accounts.creator.key(),
            DekantPmError::Unauthorized
        );

        let expected_key = Pubkey::create_program_address(
            &[
                USER_ROLE_SEED,
                ctx.accounts.creator.key().as_ref(),
                &[user_role.role],
                &[user_role.bump],
            ],
            ctx.program_id,
        )
        .map_err(|_| error!(DekantPmError::Unauthorized))?;

        require!(role_info.key() == expected_key, DekantPmError::Unauthorized);
    }

    // Fee deducted from initial_liquidity. Net amount seeds the AMM;
    // fee stays in vault as protocol_fee_accumulated.
    let creation_fee_bps = ctx.accounts.protocol_config.creation_fee_bps;
    let creation_fee = ((args.initial_liquidity as u128)
        .checked_mul(creation_fee_bps as u128)
        .ok_or(error!(DekantPmError::MathOverflow))?)
        / 10_000;
    let creation_fee = creation_fee as u64;

    let net_liquidity = args
        .initial_liquidity
        .checked_sub(creation_fee)
        .ok_or(error!(DekantPmError::InsufficientBalance))?;

    // Full initial_liquidity transferred; the AMM/fee split is purely accounting.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.creator_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        args.initial_liquidity,
    )?;

    // AMM starts uniform: reserves[i] = net_liquidity, equal probabilities.
    let clock = Clock::get()?;
    let market_id = ctx.accounts.protocol_config.market_count;
    let market = &mut ctx.accounts.market;

    market.initialize(
        market_id,
        args.market_type,
        ctx.accounts.creator.key(),
        args.oracle,
        ctx.accounts.collateral_mint.key(),
        ctx.accounts.vault.key(),
        args.deadline,
        clock.unix_timestamp,
        args.num_outcomes,
        net_liquidity,
        args.range_min,
        args.range_max,
        ctx.bumps.market,
        ctx.bumps.vault_authority,
    )?;

    // Record creation fee (swept to treasury via collect_fees).
    market.protocol_fee_accumulated = creation_fee;

    // First LP gets shares = collateral.
    let lp = &mut ctx.accounts.creator_lp_position;
    lp.version = SCHEMA_VERSION;
    lp.market = market.key();
    lp.user = ctx.accounts.creator.key();
    lp.shares = net_liquidity as u128;
    lp.deposited_collateral = net_liquidity;
    lp.bump = ctx.bumps.creator_lp_position;
    lp._padding = [0u8; 16];

    // Sequential IDs: competing txs serialize on ProtocolConfig account lock.
    ctx.accounts.protocol_config.market_count = market_id
        .checked_add(1)
        .ok_or(error!(DekantPmError::MathOverflow))?;

    emit!(MarketCreated {
        market_id,
        market_type: args.market_type,
        creator: ctx.accounts.creator.key(),
        oracle: args.oracle,
        collateral_mint: ctx.accounts.collateral_mint.key(),
        deadline: args.deadline,
        num_outcomes: args.num_outcomes,
        initial_liquidity: args.initial_liquidity,
        range_min: args.range_min,
        range_max: args.range_max,
    });

    Ok(())
}
