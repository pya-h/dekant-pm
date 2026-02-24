/// L2-norm constant-function AMM engine.
///
/// All functions are pure computation — no Anchor context, no account access.
/// They operate on slices of reserves and return computed values.
///
/// Invariant: Σ reserves[i]² = k_squared (within INVARIANT_TOLERANCE).
///
/// Implementation: tasks P-5 (discrete) and P-6 (distribution).

use anchor_lang::prelude::*;
use crate::errors::UmbraError;
use crate::constants::SCALE;
use crate::engine::sqrt::isqrt;

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
/// 2. Drain outcome `i` until invariant is restored:
///    new_r[i] = isqrt(k_squared - Σ_{j≠i} reserves[j]²)
/// 3. Return the drained amount as tokens_out.
pub fn compute_buy(
    reserves: &mut [u64],
    k_squared: u128,
    outcome: usize,
    effective_collateral: u64,
) -> Result<u64> {
    let n = reserves.len();
    require!(outcome < n, UmbraError::InvalidOutcome);
    require!(effective_collateral > 0, UmbraError::TradeTooSmall);

    for r in reserves.iter_mut() {
        *r = r
            .checked_add(effective_collateral)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
    }

    let mut sum_others_sq: u128 = 0;
    for (i, &r) in reserves.iter().enumerate() {
        if i != outcome {
            sum_others_sq += (r as u128) * (r as u128);
        }
    }

    // new_r[outcome] = isqrt(k² - Σ_{j≠outcome} r[j]²)
    require!(
        k_squared >= sum_others_sq,
        UmbraError::InsufficientLiquidity
    );
    let remainder = k_squared - sum_others_sq;
    let new_r = isqrt(remainder);

    // tokens_out = old reserves[outcome] (after mint) - new_r
    let old_r = reserves[outcome] as u128;
    require!(old_r >= new_r, UmbraError::InsufficientLiquidity);
    let tokens_out = (old_r - new_r) as u64;

    require!(tokens_out > 0, UmbraError::TradeTooSmall);

    reserves[outcome] = new_r as u64;

    Ok(tokens_out)
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
    let n = reserves.len();
    require!(outcome < n, UmbraError::InvalidOutcome);
    require!(tokens_in > 0, UmbraError::TradeTooSmall);

    reserves[outcome] = reserves[outcome]
        .checked_add(tokens_in)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;

    let burn = solve_burn_amount(reserves, k_squared)?;
    require!(burn > 0, UmbraError::TradeTooSmall);

    for r in reserves.iter_mut() {
        *r = r
            .checked_sub(burn)
            .ok_or_else(|| error!(UmbraError::InsufficientLiquidity))?;
    }

    Ok(burn)
}

// ── Distribution Buy ─────────────────────────────────────────────────

/// Buy across multiple bins proportional to `weights` (continuous market).
///
/// Mutates `reserves` in place. Returns tokens_out per bin.
///
/// Algorithm (TDD §5.4):
/// 1. Mint complete sets.
/// 2. Solve quadratic for λ:
///    W2·λ² - 2RW·λ + (R2 - k²) = 0
///    λ = (RW - sqrt(RW² - W2·(R2 - k²))) / W2
///    where R2 = Σ r[b]², RW = Σ r[b]·W[b], W2 = Σ W[b]²
/// 3. Distribute λ * weight[b] tokens per bin.
pub fn compute_distribution_buy(
    reserves: &mut [u64],
    k_squared: u128,
    weights: &[u64],
    effective_collateral: u64,
) -> Result<Vec<u64>> {
    let n = reserves.len();
    require!(weights.len() == n, UmbraError::InvalidNumOutcomes);
    require!(effective_collateral > 0, UmbraError::TradeTooSmall);

    for r in reserves.iter_mut() {
        *r = r
            .checked_add(effective_collateral)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
    }

    // Compute R2, RW, W2 for the quadratic.
    let r2 = sum_of_squares(reserves);

    let rw: u128 = reserves
        .iter()
        .zip(weights.iter())
        .map(|(&r, &w)| (r as u128) * (w as u128))
        .sum();

    let w2: u128 = weights
        .iter()
        .map(|&w| (w as u128) * (w as u128))
        .sum();

    require!(w2 > 0, UmbraError::DivisionByZero);

    // Solve quadratic for λ.
    // λ = (RW - sqrt(RW² - W2·(R2 - k²))) / W2
    require!(r2 >= k_squared, UmbraError::InsufficientLiquidity);
    let excess = r2 - k_squared;

    let rw_sq = rw
        .checked_mul(rw)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;
    let w2_excess = w2
        .checked_mul(excess)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;

    require!(rw_sq >= w2_excess, UmbraError::MathOverflow);
    let disc = rw_sq - w2_excess;
    let sqrt_disc = isqrt(disc);

    require!(rw >= sqrt_disc, UmbraError::MathOverflow);
    let numerator = rw - sqrt_disc;

    // tokens_out[b] = numerator * W[b] / W2
    let mut tokens_out = Vec::with_capacity(n);
    for (i, &w) in weights.iter().enumerate() {
        let out = numerator
            .checked_mul(w as u128)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?
            / w2;
        let out = out as u64;
        tokens_out.push(out);

        reserves[i] = reserves[i]
            .checked_sub(out)
            .ok_or_else(|| error!(UmbraError::InsufficientLiquidity))?;
    }

    Ok(tokens_out)
}

// ── Distribution Sell ────────────────────────────────────────────────

/// Sell across multiple bins proportional to `weights` (continuous market).
///
/// Mutates `reserves` in place. Returns total collateral_out (before fees).
///
/// Algorithm:
/// 1. Add tokens back to reserves proportionally: reserves[b] += total_tokens * W[b] / SCALE.
/// 2. Solve quadratic for burn amount C (same formula as discrete sell).
/// 3. Subtract C from all reserves.
/// 4. Return C as collateral_out.
pub fn compute_distribution_sell(
    reserves: &mut [u64],
    k_squared: u128,
    weights: &[u64],
    total_tokens: u64,
) -> Result<u64> {
    let n = reserves.len();
    require!(weights.len() == n, UmbraError::InvalidNumOutcomes);
    require!(total_tokens > 0, UmbraError::TradeTooSmall);

    for (i, &w) in weights.iter().enumerate() {
        let tokens_for_bin = (total_tokens as u128)
            .checked_mul(w as u128)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?
            / SCALE;
        reserves[i] = reserves[i]
            .checked_add(tokens_for_bin as u64)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?;
    }

    let burn = solve_burn_amount(reserves, k_squared)?;
    require!(burn > 0, UmbraError::TradeTooSmall);

    for r in reserves.iter_mut() {
        *r = r
            .checked_sub(burn)
            .ok_or_else(|| error!(UmbraError::InsufficientLiquidity))?;
    }

    Ok(burn)
}

// ── Quadratic Solver ─────────────────────────────────────────────────

/// Solve for the burn amount C after tokens have been added to reserves:
///   N·C² - 2S·C + (R2 - k²) = 0
/// where R2 = Σ reserves[i]², S = Σ reserves[i], N = reserves.len().
///
/// Returns the smaller positive root:
///   C = (S - sqrt(S² - N·(R2 - k²))) / N
pub fn solve_burn_amount(reserves: &[u64], k_squared: u128) -> Result<u64> {
    let n = reserves.len() as u128;
    require!(n > 0, UmbraError::InvalidNumOutcomes);

    let r2 = sum_of_squares(reserves);
    let s: u128 = reserves.iter().map(|&r| r as u128).sum();

    // R2 > k² required for a positive burn amount.
    require!(r2 >= k_squared, UmbraError::InvariantViolation);
    let excess = r2 - k_squared;

    // discriminant = S² - N * (R2 - k²)
    let s_sq = s
        .checked_mul(s)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;
    let n_excess = n
        .checked_mul(excess)
        .ok_or_else(|| error!(UmbraError::MathOverflow))?;

    require!(s_sq >= n_excess, UmbraError::MathOverflow);
    let disc = s_sq - n_excess;
    let sqrt_disc = isqrt(disc);

    // C = (S - sqrt(disc)) / N
    require!(s >= sqrt_disc, UmbraError::MathOverflow);
    let burn = (s - sqrt_disc) / n;

    Ok(burn as u64)
}

// ── Pricing ──────────────────────────────────────────────────────────

/// Compute implied probabilities for all outcomes.
///
/// Returns Vec of probabilities scaled to SCALE, summing to SCALE (±rounding).
/// probability[i] = reserves[i]² * SCALE / k_squared.
///
/// Returns all zeros if k_squared is 0 or if any intermediate overflows.
pub fn compute_probabilities(reserves: &[u64], k_squared: u128) -> Vec<u128> {
    if k_squared == 0 {
        return vec![0; reserves.len()];
    }
    reserves
        .iter()
        .map(|&r| {
            let r_sq = (r as u128).checked_mul(r as u128);
            match r_sq.and_then(|sq| sq.checked_mul(SCALE)) {
                Some(v) => v / k_squared,
                None => 0, // Overflow: reserve too large for fixed-point pricing.
            }
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
/// Returns the new k_squared value (recomputed from scaled reserves).
pub fn scale_reserves(
    reserves: &mut [u64],
    numerator: u128,
    denominator: u128,
) -> Result<u128> {
    require!(denominator > 0, UmbraError::DivisionByZero);

    for r in reserves.iter_mut() {
        let new_r = (*r as u128)
            .checked_mul(numerator)
            .ok_or_else(|| error!(UmbraError::MathOverflow))?
            / denominator;
        *r = new_r as u64;
    }

    Ok(sum_of_squares(reserves))
}
