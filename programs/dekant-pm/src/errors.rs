use anchor_lang::prelude::*;

#[error_code]
pub enum DekantPmError {
    // ── Authorization ────────────────────────────────────────────────
    #[msg("Signer does not have the required role")]
    Unauthorized,

    #[msg("Invalid role type")]
    InvalidRole,

    #[msg("This role is already assigned to the target wallet")]
    RoleAlreadyAssigned,

    #[msg("Admin cannot assign the Admin role; only superadmin can")]
    AdminCannotAssignAdmin,

    // ── Market Lifecycle ─────────────────────────────────────────────
    #[msg("Market is not in Active state")]
    MarketNotActive,

    #[msg("Market deadline has passed; no more trading")]
    MarketClosed,

    #[msg("Market is not in PendingResolution state")]
    MarketNotPendingResolution,

    #[msg("Market has already been resolved")]
    MarketAlreadyResolved,

    #[msg("Market is paused")]
    MarketPaused,

    #[msg("Market is not paused")]
    MarketNotPaused,

    #[msg("Market is not in Resolved state")]
    MarketNotResolved,

    // ── Market Creation Validation ───────────────────────────────────
    #[msg("Invalid outcome index")]
    InvalidOutcome,

    #[msg("range_max must be greater than range_min")]
    InvalidRange,

    #[msg("Deadline must be in the future")]
    InvalidDeadline,

    #[msg("Number of outcomes is out of allowed bounds")]
    InvalidNumOutcomes,

    #[msg("Invalid market type")]
    InvalidMarketType,

    #[msg("Bin count exceeds maximum")]
    BinCountExceeded,

    #[msg("kernel_width must be < num_outcomes for continuous markets, and 0 for binary/multi")]
    InvalidKernelWidth,

    // ── Trading ──────────────────────────────────────────────────────
    #[msg("Insufficient collateral balance")]
    InsufficientBalance,

    #[msg("Insufficient liquidity in the AMM")]
    InsufficientLiquidity,

    #[msg("Insufficient token holdings to sell")]
    InsufficientHoldings,

    #[msg("Trade amount is below the minimum")]
    TradeTooSmall,

    #[msg("Sigma must be greater than zero")]
    InvalidSigma,

    #[msg("This instruction is not valid for this market type")]
    WrongMarketType,

    #[msg("Target probability out of valid range")]
    InvalidProbability,

    #[msg("Target probability is already met or on the wrong side of current price")]
    TargetAlreadyMet,

    #[msg("Required collateral exceeds max_collateral")]
    MaxCollateralExceeded,

    #[msg("Returned collateral is below min_collateral_out")]
    MinCollateralNotMet,

    // ── Settlement ───────────────────────────────────────────────────
    #[msg("Payout has already been claimed")]
    AlreadyClaimed,

    #[msg("No winning tokens held; nothing to claim")]
    NothingToClaim,

    // ── Math ─────────────────────────────────────────────────────────
    #[msg("L2-norm invariant violated after operation")]
    InvariantViolation,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Division by zero")]
    DivisionByZero,

    #[msg("Square root computation failed")]
    SqrtFailed,

    // ── Fees ─────────────────────────────────────────────────────────
    #[msg("Fee exceeds the maximum allowed basis points")]
    FeeTooHigh,

    #[msg("No protocol fees to collect")]
    NoFeesToCollect,

    // ── LP ───────────────────────────────────────────────────────────
    #[msg("Cannot remove more LP shares than held")]
    InsufficientShares,

    #[msg("Liquidity amount is below the minimum")]
    LiquidityTooSmall,

    // ── Resolution ───────────────────────────────────────────────────
    #[msg("Resolved value is outside the market range")]
    ResolvedValueOutOfRange,

    #[msg("Signer is not the assigned oracle for this market")]
    WrongOracle,
}
