use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::UmbraError;
use crate::engine::amm::sum_of_squares;
use crate::engine::fixed_point::mul_div;

// ── Fee Computation ──────────────────────────────────────────────────────

/// Ephemeral result of splitting a trade fee into LP and protocol portions.
/// Not stored on-chain — used by instruction handlers during trade execution.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeeBreakdown {
    /// Total fee deducted from the trader's gross collateral.
    pub total_fee: u64,
    /// Portion of the fee accruing to the LP pool.
    pub lp_fee: u64,
    /// Portion of the fee accruing to the protocol treasury.
    pub protocol_fee: u64,
    /// Collateral remaining after fee deduction (gross - total_fee).
    pub net_amount: u64,
}

// ── Market Account ───────────────────────────────────────────────────────

/// A prediction market with its AMM state.
/// Unified struct for binary, multi-outcome, and continuous (binned) markets.
/// Seeds: ["market", market_id.to_le_bytes()]
#[account]
pub struct Market {
    /// Schema version for upgrade-safe deserialization.
    pub version: u8,

    /// Unique, auto-incremented market identifier.
    pub market_id: u64,

    /// 0 = Binary, 1 = Multi-outcome, 2 = Continuous. See MarketType.
    pub market_type: u8,

    /// Current lifecycle state. See MarketState.
    pub state: u8,

    /// Wallet that created this market.
    pub creator: Pubkey,

    /// Oracle wallet authorized to resolve this market.
    pub oracle: Pubkey,

    /// SPL token mint used as collateral (e.g. USDC).
    pub collateral_mint: Pubkey,

    /// Address of the SPL token vault holding collateral.
    pub vault: Pubkey,

    /// Unix timestamp after which trading stops and resolution can begin.
    pub deadline: i64,

    /// Unix timestamp of market creation.
    pub created_at: i64,

    /// Unix timestamp of resolution (0 until resolved).
    pub resolved_at: i64,

    // ── AMM Parameters ───────────────────────────────────────────────

    /// Number of outcomes (binary = 2, multi ≤ 32) or bins (continuous ≤ 256).
    /// Determines the length of the `reserves` vector.
    pub num_outcomes: u16,

    /// Squared L2-norm invariant: Σ reserves[i]² = k_squared.
    /// Stored as u128 to avoid overflow on sums of u64 squares.
    pub k_squared: u128,

    /// Total collateral deposited as complete sets (token-native units).
    /// At any time: ∀ i, total_minted = reserves[i] + Σ_users(holdings[i]).
    pub total_minted: u128,

    /// Total outstanding LP shares across all providers.
    pub lp_shares_total: u128,

    /// Accumulated LP fee portion (collateral-native units).
    /// Paid out proportionally when LPs remove liquidity.
    pub lp_fee_accumulated: u128,

    /// Accumulated protocol fee (collateral-native units).
    /// Swept to treasury via `collect_fees` instruction.
    pub protocol_fee_accumulated: u64,

    // ── Continuous-Specific ──────────────────────────────────────────

    /// Lower bound of the continuous outcome range (scaled by 10^9).
    /// 0 for discrete markets.
    pub range_min: i64,

    /// Upper bound of the continuous outcome range (scaled by 10^9).
    /// 0 for discrete markets.
    pub range_max: i64,

    // ── Resolution ───────────────────────────────────────────────────

    /// Index of the winning outcome (binary/multi) or winning bin (continuous).
    /// Only meaningful when state == Resolved.
    pub resolved_outcome: u16,

    /// Exact resolved value for continuous markets (same scale as range_min/max).
    /// 0 for discrete markets.
    pub resolved_value: i64,

    // ── PDA ──────────────────────────────────────────────────────────

    /// Market PDA bump seed.
    pub bump: u8,

    /// Vault authority PDA bump seed (for CPI signing).
    pub vault_authority_bump: u8,

    /// Reserved for future schema versions. Consumed from the front
    /// when new fields are added; total byte offset of `reserves` stays
    /// constant for a given padding size.
    pub _padding: [u8; 30],

    // ── Variable-Length ──────────────────────────────────────────────

    /// AMM reserves per outcome/bin.
    /// Length = num_outcomes. Serialized as Borsh Vec (4-byte length prefix + data).
    pub reserves: Vec<u64>,
}

impl Market {
    // ── Space Calculation ────────────────────────────────────────────

    /// Total account size for a market with `n` outcomes/bins.
    pub fn space(n: u16) -> usize {
        8   // anchor discriminator
        + 1   // version
        + 8   // market_id
        + 1   // market_type
        + 1   // state
        + 32  // creator
        + 32  // oracle
        + 32  // collateral_mint
        + 32  // vault
        + 8   // deadline
        + 8   // created_at
        + 8   // resolved_at
        + 2   // num_outcomes
        + 16  // k_squared
        + 16  // total_minted
        + 16  // lp_shares_total
        + 16  // lp_fee_accumulated
        + 8   // protocol_fee_accumulated
        + 8   // range_min
        + 8   // range_max
        + 2   // resolved_outcome
        + 8   // resolved_value
        + 1   // bump
        + 1   // vault_authority_bump
        + 30  // _padding
        + 4   // vec length prefix
        + (n as usize) * 8  // reserves data
    }

    // ── Initialization ───────────────────────────────────────────────

    /// Populate a freshly-allocated Market account and set up uniform AMM state.
    ///
    /// After this call: `reserves[i] = initial_liquidity` for all i,
    /// `k_squared = num_outcomes * initial_liquidity²`, and the creating LP
    /// receives `initial_liquidity` shares.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        market_id: u64,
        market_type: u8,
        creator: Pubkey,
        oracle: Pubkey,
        collateral_mint: Pubkey,
        vault: Pubkey,
        deadline: i64,
        created_at: i64,
        num_outcomes: u16,
        initial_liquidity: u64,
        range_min: i64,
        range_max: i64,
        bump: u8,
        vault_authority_bump: u8,
    ) -> Result<()> {
        let mtype = MarketType::from_u8(market_type)
            .ok_or_else(|| error!(UmbraError::InvalidMarketType))?;

        require!(
            mtype.valid_num_outcomes(num_outcomes),
            UmbraError::InvalidNumOutcomes
        );
        require!(
            initial_liquidity >= MIN_LIQUIDITY,
            UmbraError::LiquidityTooSmall
        );
        require!(deadline > created_at, UmbraError::InvalidDeadline);

        if mtype.is_continuous() {
            require!(range_max > range_min, UmbraError::InvalidRange);
        }

        self.version = SCHEMA_VERSION;
        self.market_id = market_id;
        self.market_type = market_type;
        self.state = STATE_ACTIVE;
        self.creator = creator;
        self.oracle = oracle;
        self.collateral_mint = collateral_mint;
        self.vault = vault;
        self.deadline = deadline;
        self.created_at = created_at;
        self.resolved_at = 0;
        self.num_outcomes = num_outcomes;
        self.protocol_fee_accumulated = 0;
        self.lp_fee_accumulated = 0;
        self.resolved_outcome = 0;
        self.resolved_value = 0;
        self.bump = bump;
        self.vault_authority_bump = vault_authority_bump;
        self._padding = [0u8; 30];

        if mtype.is_continuous() {
            self.range_min = range_min;
            self.range_max = range_max;
        } else {
            self.range_min = 0;
            self.range_max = 0;
        }

        // ── AMM initial state (uniform distribution) ─────────────────
        let liq = initial_liquidity as u128;
        let n = num_outcomes as u128;

        let liq_sq = liq
            .checked_mul(liq)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
        let k_squared = n
            .checked_mul(liq_sq)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;

        self.reserves = vec![initial_liquidity; num_outcomes as usize];
        self.k_squared = k_squared;
        self.total_minted = liq;
        self.lp_shares_total = liq;

        Ok(())
    }

    // ── State Predicates ─────────────────────────────────────────────

    pub fn is_active(&self) -> bool {
        self.state == STATE_ACTIVE
    }

    pub fn is_paused(&self) -> bool {
        self.state == STATE_PAUSED
    }

    pub fn is_pending_resolution(&self) -> bool {
        self.state == STATE_PENDING_RESOLUTION
    }

    pub fn is_resolved(&self) -> bool {
        self.state == STATE_RESOLVED
    }

    pub fn is_expired(&self, clock_timestamp: i64) -> bool {
        clock_timestamp >= self.deadline
    }

    // ── State Transitions ────────────────────────────────────────────

    /// Active → Paused.
    pub fn pause(&mut self) -> Result<()> {
        require!(self.state == STATE_ACTIVE, UmbraError::MarketNotActive);
        self.state = STATE_PAUSED;
        Ok(())
    }

    /// Paused → Active, or Paused → PendingResolution if deadline has passed.
    pub fn unpause(&mut self, clock_timestamp: i64) -> Result<()> {
        require!(self.state == STATE_PAUSED, UmbraError::MarketNotPaused);
        if clock_timestamp >= self.deadline {
            self.state = STATE_PENDING_RESOLUTION;
        } else {
            self.state = STATE_ACTIVE;
        }
        Ok(())
    }

    /// Active|Paused → PendingResolution.
    ///
    /// Used for lazy deadline enforcement: the first instruction to touch
    /// the market after deadline calls this to transition the state.
    pub fn transition_to_pending(&mut self) -> Result<()> {
        require!(
            self.state == STATE_ACTIVE || self.state == STATE_PAUSED,
            UmbraError::MarketAlreadyResolved
        );
        self.state = STATE_PENDING_RESOLUTION;
        Ok(())
    }

    /// PendingResolution → Resolved.
    ///
    /// For discrete markets, `outcome` is the winning index.
    /// For continuous markets, `value` is the realized value and the
    /// winning bin is derived via [`value_to_bin`].
    pub fn resolve(
        &mut self,
        outcome: u16,
        value: i64,
        clock_timestamp: i64,
    ) -> Result<()> {
        require!(
            self.state == STATE_PENDING_RESOLUTION,
            UmbraError::MarketNotPendingResolution
        );

        let mtype = MarketType::from_u8(self.market_type)
            .ok_or_else(|| error!(UmbraError::InvalidMarketType))?;

        match mtype {
            MarketType::Binary | MarketType::MultiOutcome => {
                require!(outcome < self.num_outcomes, UmbraError::InvalidOutcome);
                self.resolved_outcome = outcome;
                self.resolved_value = 0;
            }
            MarketType::Continuous => {
                require!(
                    value >= self.range_min && value <= self.range_max,
                    UmbraError::ResolvedValueOutOfRange
                );
                self.resolved_value = value;
                self.resolved_outcome = self.value_to_bin(value)?;
            }
        }

        self.state = STATE_RESOLVED;
        self.resolved_at = clock_timestamp;
        Ok(())
    }

    // ── Trading Guards ───────────────────────────────────────────────

    /// Assert the market is Active and before its deadline.
    pub fn require_trading_allowed(&self, clock_timestamp: i64) -> Result<()> {
        require!(self.state == STATE_ACTIVE, UmbraError::MarketNotActive);
        require!(clock_timestamp < self.deadline, UmbraError::MarketClosed);
        Ok(())
    }

    /// Assert `outcome` is a valid index for this market.
    pub fn validate_outcome(&self, outcome: u16) -> Result<()> {
        require!(outcome < self.num_outcomes, UmbraError::InvalidOutcome);
        Ok(())
    }

    /// Assert this is a discrete (binary or multi-outcome) market.
    pub fn require_discrete(&self) -> Result<()> {
        require!(
            self.market_type == MARKET_TYPE_BINARY
                || self.market_type == MARKET_TYPE_MULTI,
            UmbraError::WrongMarketType
        );
        Ok(())
    }

    /// Assert this is a continuous (binned) market.
    pub fn require_continuous(&self) -> Result<()> {
        require!(
            self.market_type == MARKET_TYPE_CONTINUOUS,
            UmbraError::WrongMarketType
        );
        Ok(())
    }

    /// Assert the market has been resolved.
    pub fn require_resolved(&self) -> Result<()> {
        require!(self.state == STATE_RESOLVED, UmbraError::MarketNotResolved);
        Ok(())
    }

    /// Assert the reserves Vec length matches num_outcomes.
    /// Call after deserialization to catch corrupt account data.
    pub fn validate_reserves_integrity(&self) -> Result<()> {
        require!(
            self.reserves.len() == self.num_outcomes as usize,
            UmbraError::InvalidNumOutcomes
        );
        Ok(())
    }

    // ── Fee Computation ──────────────────────────────────────────────

    /// Split a gross collateral amount into fee components.
    ///
    /// Fee parameters come from ProtocolConfig (not Market), so this is
    /// an associated function.
    ///
    /// `trade_fee_bps`: total fee (0–5000 bps).
    /// `lp_fee_share_bps`: LP share of fee (0–10000 bps).
    ///
    /// Fees are floored (favorable to trader). The protocol receives
    /// `total_fee - lp_fee`, absorbing any rounding remainder.
    pub fn compute_fees(
        gross_amount: u64,
        trade_fee_bps: u16,
        lp_fee_share_bps: u16,
    ) -> Result<FeeBreakdown> {
        // u128 intermediate: max u64 * 5000 ≈ 9.2e22, fits in u128.
        let total_fee = (gross_amount as u128)
            .checked_mul(trade_fee_bps as u128)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?
            / 10_000;
        // total_fee ≤ gross_amount / 2, always fits u64.
        let total_fee = total_fee as u64;

        let lp_fee = (total_fee as u128)
            .checked_mul(lp_fee_share_bps as u128)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?
            / 10_000;
        let lp_fee = lp_fee as u64;

        // lp_fee ≤ total_fee by construction (share ≤ 10_000).
        let protocol_fee = total_fee - lp_fee;

        let net_amount = gross_amount
            .checked_sub(total_fee)
            .ok_or_else(|| error!(UmbraError::InsufficientBalance))?;

        Ok(FeeBreakdown {
            total_fee,
            lp_fee,
            protocol_fee,
            net_amount,
        })
    }

    /// Add fee amounts to the market's accumulators.
    pub fn accrue_fees(&mut self, fees: &FeeBreakdown) -> Result<()> {
        self.lp_fee_accumulated = self
            .lp_fee_accumulated
            .checked_add(fees.lp_fee as u128)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
        self.protocol_fee_accumulated = self
            .protocol_fee_accumulated
            .checked_add(fees.protocol_fee)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
        Ok(())
    }

    // ── Continuous Market Helpers ─────────────────────────────────────

    /// Convert a realized continuous value to a bin index.
    ///
    /// `bin = (value - range_min) * num_outcomes / (range_max - range_min)`,
    /// clamped to `[0, num_outcomes - 1]`.
    ///
    /// Uses i128 intermediates to avoid overflow when the range spans
    /// a large portion of the i64 domain.
    pub fn value_to_bin(&self, value: i64) -> Result<u16> {
        if value <= self.range_min {
            return Ok(0);
        }
        if value >= self.range_max {
            return Ok(self.num_outcomes.saturating_sub(1));
        }

        let lo = self.range_min as i128;
        let hi = self.range_max as i128;
        let span = hi - lo; // Positive: range_max > range_min validated at init.

        let offset = (value as i128) - lo; // Non-negative after the clamp above.
        let n = self.num_outcomes as i128;

        // Max offset * n: (2^64) * 256 = 2^72, fits in i128.
        let bin = offset
            .checked_mul(n)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?
            / span;

        let bin = (bin as u16).min(self.num_outcomes.saturating_sub(1));
        Ok(bin)
    }

    // ── AMM Queries ──────────────────────────────────────────────────

    /// Implied probability for outcome `i`, scaled to SCALE (10^9).
    ///
    /// `price[i] = reserves[i]² * SCALE / k_squared`.
    /// Returns error if `i` is out of bounds, k_squared is zero, or
    /// the intermediate multiplication overflows (reserves above ~10^14).
    pub fn implied_probability(&self, i: u16) -> Result<u128> {
        let r = *self
            .reserves
            .get(i as usize)
            .ok_or_else(|| error!(UmbraError::InvalidOutcome))? as u128;
        let r_sq = r
            .checked_mul(r)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
        r_sq.checked_mul(SCALE)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?
            .checked_div(self.k_squared)
            .ok_or_else(|| error!(UmbraError::DivisionByZero))
    }

    /// Recompute `k_squared` from current reserves.
    ///
    /// Safe for practical reserve values (≤ 10^12 per bin, 256 bins).
    pub fn recompute_k_squared(&mut self) {
        self.k_squared = sum_of_squares(&self.reserves);
    }

    // ── AMM Mutations ────────────────────────────────────────────────

    /// Add `amount` to every reserve and increase `total_minted`.
    ///
    /// Step 1 of the buy algorithm (mint complete sets). After this call
    /// the L2-norm invariant is violated; the caller must drain tokens
    /// from the target outcome to restore it.
    pub fn mint_complete_sets(&mut self, amount: u64) -> Result<()> {
        for r in self.reserves.iter_mut() {
            *r = r
                .checked_add(amount)
                .ok_or_else(|| error!(UmbraError::MathOverflow))?;
        }
        self.total_minted = self
            .total_minted
            .checked_add(amount as u128)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
        Ok(())
    }

    /// Subtract `amount` from every reserve and decrease `total_minted`.
    ///
    /// Burn step of the sell algorithm. After this call the invariant
    /// may not hold; the caller should verify via `verify_invariant`.
    pub fn burn_complete_sets(&mut self, amount: u64) -> Result<()> {
        for r in self.reserves.iter_mut() {
            *r = r
                .checked_sub(amount)
                .ok_or_else(|| error!(UmbraError::InsufficientLiquidity))?;
        }
        self.total_minted = self
            .total_minted
            .checked_sub(amount as u128)
            .ok_or_else(|| error!(UmbraError::InsufficientLiquidity))?;
        Ok(())
    }

    /// Compute proportional LP shares for a new deposit.
    ///
    /// First LP (when `lp_shares_total == 0`) receives shares = collateral.
    /// Subsequent LPs receive `lp_shares_total * collateral / total_minted`.
    pub fn compute_lp_shares_for_deposit(&self, collateral: u64) -> Result<u128> {
        if self.lp_shares_total == 0 {
            return Ok(collateral as u128);
        }
        mul_div(
            self.lp_shares_total,
            collateral as u128,
            self.total_minted,
        )
        .ok_or_else(|| error!(UmbraError::MathOverflow))
    }

    /// Compute collateral returned for burning LP shares.
    ///
    /// Returns `total_minted * shares / lp_shares_total`.
    pub fn compute_collateral_for_withdrawal(&self, shares: u128) -> Result<u128> {
        require!(
            shares <= self.lp_shares_total,
            UmbraError::InsufficientShares
        );
        mul_div(self.total_minted, shares, self.lp_shares_total)
            .ok_or_else(|| error!(UmbraError::MathOverflow))
    }

    /// Compute the LP fee share for a withdrawal.
    ///
    /// Returns `lp_fee_accumulated * shares / lp_shares_total`.
    pub fn compute_lp_fee_share(&self, shares: u128) -> Result<u128> {
        if self.lp_fee_accumulated == 0 {
            return Ok(0);
        }
        mul_div(self.lp_fee_accumulated, shares, self.lp_shares_total)
            .ok_or_else(|| error!(UmbraError::MathOverflow))
    }
}

// ── Enums ────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MarketType {
    Binary = 0,
    MultiOutcome = 1,
    Continuous = 2,
}

impl MarketType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Binary),
            1 => Some(Self::MultiOutcome),
            2 => Some(Self::Continuous),
            _ => None,
        }
    }

    /// Valid num_outcomes range for this market type.
    pub fn valid_num_outcomes(self, n: u16) -> bool {
        match self {
            Self::Binary => n == 2,
            Self::MultiOutcome => (3..=MAX_OUTCOMES).contains(&n),
            Self::Continuous => (2..=MAX_BINS).contains(&n),
        }
    }

    pub fn is_continuous(self) -> bool {
        matches!(self, Self::Continuous)
    }

    /// Whether this market type requires range_min/range_max to be set.
    pub fn requires_range(self) -> bool {
        matches!(self, Self::Continuous)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MarketState {
    Active = 0,
    Paused = 1,
    PendingResolution = 2,
    Resolved = 3,
}

impl MarketState {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Active),
            1 => Some(Self::Paused),
            2 => Some(Self::PendingResolution),
            3 => Some(Self::Resolved),
            _ => None,
        }
    }

    /// Whether trading is allowed in this state.
    pub fn can_trade(self) -> bool {
        matches!(self, Self::Active)
    }

    /// Whether the market can be resolved from this state.
    pub fn can_resolve(self) -> bool {
        matches!(self, Self::PendingResolution)
    }

    /// Whether the market is in a terminal state.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Resolved)
    }
}
