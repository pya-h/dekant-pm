use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod state;
pub mod instructions;
pub mod engine;

use instructions::*;

declare_id!("UMBRAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

#[program]
pub mod umbra {
    use super::*;

    // ── Admin ────────────────────────────────────────────────────────

    /// One-time protocol initialization. Sets superadmin, treasury, and default fees.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        handle_initialize(ctx, args)
    }

    /// Assign a role (Admin, Oracle, Creator) to a wallet.
    pub fn assign_role(ctx: Context<AssignRole>, args: AssignRoleArgs) -> Result<()> {
        handle_assign_role(ctx, args)
    }

    /// Revoke a role from a wallet (closes the UserRole PDA).
    pub fn revoke_role(ctx: Context<RevokeRole>, args: RevokeRoleArgs) -> Result<()> {
        handle_revoke_role(ctx, args)
    }

    /// Update protocol fee parameters (superadmin only).
    pub fn update_fees(ctx: Context<UpdateFees>, args: UpdateFeesArgs) -> Result<()> {
        handle_update_fees(ctx, args)
    }

    // ── Market Management ────────────────────────────────────────────

    /// Create a new prediction market with initial liquidity.
    pub fn create_market(ctx: Context<CreateMarket>, args: CreateMarketArgs) -> Result<()> {
        handle_create_market(ctx, args)
    }

    /// Pause an active market (freezes all trading).
    pub fn pause_market(ctx: Context<PauseMarket>) -> Result<()> {
        handle_pause_market(ctx)
    }

    /// Unpause a paused market. If deadline has passed, transitions to PendingResolution.
    pub fn unpause_market(ctx: Context<UnpauseMarket>) -> Result<()> {
        handle_unpause_market(ctx)
    }

    /// Oracle submits the resolved outcome.
    pub fn resolve_market(ctx: Context<ResolveMarket>, args: ResolveMarketArgs) -> Result<()> {
        handle_resolve_market(ctx, args)
    }

    // ── Discrete Trading ─────────────────────────────────────────────

    /// Buy outcome tokens for a single discrete outcome.
    pub fn buy(ctx: Context<Buy>, args: BuyArgs) -> Result<()> {
        handle_buy(ctx, args)
    }

    /// Sell outcome tokens for a single discrete outcome.
    pub fn sell(ctx: Context<Sell>, args: SellArgs) -> Result<()> {
        handle_sell(ctx, args)
    }

    // ── Distribution Trading (Continuous) ────────────────────────────

    /// Buy across bins proportional to a Normal(mu, sigma) distribution.
    pub fn buy_distribution(
        ctx: Context<BuyDistribution>,
        args: BuyDistributionArgs,
    ) -> Result<()> {
        handle_buy_distribution(ctx, args)
    }

    /// Sell across bins proportional to a Normal(mu, sigma) distribution.
    pub fn sell_distribution(
        ctx: Context<SellDistribution>,
        args: SellDistributionArgs,
    ) -> Result<()> {
        handle_sell_distribution(ctx, args)
    }

    // ── Liquidity ────────────────────────────────────────────────────

    /// Deposit proportional liquidity into a market.
    pub fn add_liquidity(ctx: Context<AddLiquidity>, args: AddLiquidityArgs) -> Result<()> {
        handle_add_liquidity(ctx, args)
    }

    /// Withdraw proportional liquidity from a market.
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        args: RemoveLiquidityArgs,
    ) -> Result<()> {
        handle_remove_liquidity(ctx, args)
    }

    // ── Settlement ───────────────────────────────────────────────────

    /// Claim payout from a resolved market.
    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        handle_claim_payout(ctx)
    }
}
