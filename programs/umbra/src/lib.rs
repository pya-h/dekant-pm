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
        // Implementation in task P-15.
        todo!()
    }

    /// Unpause a paused market. If deadline has passed, transitions to PendingResolution.
    pub fn unpause_market(ctx: Context<UnpauseMarket>) -> Result<()> {
        // Implementation in task P-15.
        todo!()
    }

    /// Oracle submits the resolved outcome.
    pub fn resolve_market(ctx: Context<ResolveMarket>, args: ResolveMarketArgs) -> Result<()> {
        // Implementation in task P-16.
        todo!()
    }

    // ── Discrete Trading ─────────────────────────────────────────────

    /// Buy outcome tokens for a single discrete outcome.
    pub fn buy(ctx: Context<Buy>, args: BuyArgs) -> Result<()> {
        // Implementation in task P-10.
        todo!()
    }

    /// Sell outcome tokens for a single discrete outcome.
    pub fn sell(ctx: Context<Sell>, args: SellArgs) -> Result<()> {
        // Implementation in task P-11.
        todo!()
    }

    // ── Distribution Trading (Continuous) ────────────────────────────

    /// Buy across bins proportional to a Normal(mu, sigma) distribution.
    pub fn buy_distribution(
        ctx: Context<BuyDistribution>,
        args: BuyDistributionArgs,
    ) -> Result<()> {
        // Implementation in task P-12.
        todo!()
    }

    /// Sell across bins proportional to a Normal(mu, sigma) distribution.
    pub fn sell_distribution(
        ctx: Context<SellDistribution>,
        args: SellDistributionArgs,
    ) -> Result<()> {
        // Implementation in task P-13.
        todo!()
    }

    // ── Liquidity ────────────────────────────────────────────────────

    /// Deposit proportional liquidity into a market.
    pub fn add_liquidity(ctx: Context<AddLiquidity>, args: AddLiquidityArgs) -> Result<()> {
        // Implementation in task P-14.
        todo!()
    }

    /// Withdraw proportional liquidity from a market.
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        args: RemoveLiquidityArgs,
    ) -> Result<()> {
        // Implementation in task P-14.
        todo!()
    }

    // ── Settlement ───────────────────────────────────────────────────

    /// Claim payout from a resolved market.
    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        // Implementation in task P-17.
        todo!()
    }
}
