/// L2-norm constant-function AMM engine.
///
/// All functions are pure computation — no Anchor context, no account access.
/// They operate on slices of reserves and return computed values.
///
/// Invariant: Σ reserves[i]² = k_squared (within INVARIANT_TOLERANCE).
///
/// Implementation in tasks P-5 (discrete) and P-6 (distribution).

use anchor_lang::prelude::*;
use crate::errors::UmbraError;
use crate::constants::SCALE;

// ── Invariant ────────────────────────────────────────────────────────

/// Verify that the L2-norm invariant holds: |Σ reserves[i]² - k_squared| ≤ tolerance.
pub fn verify_invariant(reserves: &[u64], k_squared: u128) -> Result<()> {
    let actual = sum_of_squares(reserves);
    let diff = if actual > k_squared {
        actual - k_squared
    } else {
        k_squared - actual
    };
    require!(
        diff <= crate::constants::INVARIANT_TOLERANCE,
        UmbraError::InvariantViolation
    );
    Ok(())
}

/// Compute Σ reserves[i]².
pub fn sum_of_squares(reserves: &[u64]) -> u128 {
    reserves.iter().map(|&r| (r as u128) * (r as u128)).sum()
}

// ── Discrete Buy ─────────────────────────────────────────────────────

/// Buy outcome tokens for a single outcome index on a discrete market.
///
/// Mutates `reserves` in place. Returns the number of outcome tokens
/// the trader receives.
///
/// Algorithm (TDD §5.3):
/// 1. Mint `effective_collateral` complete sets (add to all reserves).
/// 2. Drain outcome `i` until invariant is restored.
/// 3. Return the drained amount as tokens_out.
pub fn compute_buy(
    reserves: &mut [u64],
    k_squared: u128,
    outcome: usize,
    effective_collateral: u64,
) -> Result<u64> {
    // Implementation in task P-5.
    todo!()
}

// ── Discrete Sell ────────────────────────────────────────────────────

/// Sell outcome tokens for a single outcome index.
///
/// Mutates `reserves` in place. Returns the collateral amount
/// returned to the trader (before fees).
///
/// Algorithm (TDD §5.3):
/// 1. Add `tokens_in` to reserves[outcome].
/// 2. Solve quadratic for burn amount C.
/// 3. Subtract C from all reserves.
/// 4. Return C as collateral_out.
pub fn compute_sell(
    reserves: &mut [u64],
    k_squared: u128,
    outcome: usize,
    tokens_in: u64,
) -> Result<u64> {
    // Implementation in task P-5.
    todo!()
}

// ── Distribution Buy ─────────────────────────────────────────────────

/// Buy across multiple bins proportional to `weights` (continuous market).
///
/// Mutates `reserves` in place. Returns tokens_out per bin.
///
/// Algorithm (TDD §5.4):
/// 1. Mint complete sets.
/// 2. Solve quadratic for λ.
/// 3. Distribute λ * weight[b] tokens per bin.
pub fn compute_distribution_buy(
    reserves: &mut [u64],
    k_squared: u128,
    weights: &[u64],
    effective_collateral: u64,
) -> Result<Vec<u64>> {
    // Implementation in task P-6.
    todo!()
}

// ── Distribution Sell ────────────────────────────────────────────────

/// Sell across multiple bins proportional to `weights` (continuous market).
///
/// Mutates `reserves` in place. Returns total collateral_out (before fees).
pub fn compute_distribution_sell(
    reserves: &mut [u64],
    k_squared: u128,
    weights: &[u64],
    total_tokens: u64,
) -> Result<u64> {
    // Implementation in task P-6.
    todo!()
}

// ── Quadratic Solver ─────────────────────────────────────────────────

/// Solve for the burn amount C after tokens have been added to reserves:
///   N·C² - 2S·C + (R2 - k²) = 0
/// where R2 = Σ reserves[i]², S = Σ reserves[i], N = reserves.len().
///
/// Returns the smaller positive root.
pub fn solve_burn_amount(reserves: &[u64], k_squared: u128) -> Result<u64> {
    // Implementation in task P-5.
    todo!()
}

// ── Pricing ──────────────────────────────────────────────────────────

/// Compute implied probabilities for all outcomes.
///
/// Returns Vec of probabilities scaled to SCALE, summing to SCALE (±rounding).
/// probability[i] = reserves[i]² * SCALE / k_squared.
pub fn compute_probabilities(reserves: &[u64], k_squared: u128) -> Vec<u128> {
    reserves
        .iter()
        .map(|&r| {
            let r_sq = (r as u128) * (r as u128);
            r_sq * SCALE / k_squared
        })
        .collect()
}

// ── Liquidity ────────────────────────────────────────────────────────

/// Scale all reserves proportionally for an LP deposit/withdrawal.
///
/// `numerator` and `denominator` define the scaling fraction:
///   - Add liquidity: reserves[i] = reserves[i] * (total + deposit) / total
///   - Remove liquidity: reserves[i] = reserves[i] * (total - withdrawal) / total
///
/// Returns the new k_squared value.
pub fn scale_reserves(
    reserves: &mut [u64],
    numerator: u128,
    denominator: u128,
) -> Result<u128> {
    // Implementation in task P-5.
    todo!()
}
