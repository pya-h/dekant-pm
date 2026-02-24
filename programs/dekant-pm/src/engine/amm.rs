/// L2-norm constant-function AMM engine.
///
/// All functions are pure computation — no Anchor context, no account access.
/// They operate on slices of reserves and return computed values.
///
/// Invariant: Σ (total_minted - reserves[i])² = total_minted² (within tolerance).
/// The L2-norm is on positions x[i] = total_minted - reserves[i], not on reserves.
///
/// Implementation: tasks P-5 (discrete) and P-6 (distribution).

use anchor_lang::prelude::*;
use crate::errors::DekantPmError;
use crate::constants::SCALE;
use crate::engine::sqrt::isqrt;

// ── Invariant ────────────────────────────────────────────────────────

/// Verify that the L2-norm invariant holds on positions:
/// |Σ (total_minted - reserves[i])² - total_minted²| ≤ tolerance.
pub fn verify_invariant(reserves: &[u64], total_minted: u128) -> Result<()> {
    let actual = sum_of_position_squares(reserves, total_minted);
    let expected = total_minted
        .checked_mul(total_minted)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    let diff = if actual > expected {
        actual - expected
    } else {
        expected - actual
    };
    require!(
        diff <= crate::constants::INVARIANT_TOLERANCE,
        DekantPmError::InvariantViolation
    );
    Ok(())
}

/// Compute Σ (total_minted - reserves[i])², i.e. sum of squared positions.
pub fn sum_of_position_squares(reserves: &[u64], total_minted: u128) -> u128 {
    reserves
        .iter()
        .map(|&h| {
            let x = total_minted.saturating_sub(h as u128);
            x * x
        })
        .sum()
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
/// Algorithm (position-based, per Distribution Markets article):
/// 1. Compute positions x[j] = total_minted - h[j].
/// 2. Mint `effective_collateral` complete sets (add to all reserves).
/// 3. k_new = total_minted + effective_collateral.
/// 4. x_new[i] = isqrt(k_new² - Σ_{j≠i} x[j]²).
/// 5. tokens_out = x_new[i] - x[i].
/// 6. Set reserves[i] = k_new - x_new[i].
pub fn compute_buy(
    reserves: &mut [u64],
    total_minted: u128,
    outcome: usize,
    effective_collateral: u64,
) -> Result<u64> {
    let n = reserves.len();
    require!(outcome < n, DekantPmError::InvalidOutcome);
    require!(effective_collateral > 0, DekantPmError::TradeTooSmall);

    // Compute positions BEFORE mint (invariant under complete-set minting).
    let x_i = total_minted.saturating_sub(reserves[outcome] as u128);
    let mut sum_others_x_sq: u128 = 0;
    for (j, &h) in reserves.iter().enumerate() {
        if j != outcome {
            let x = total_minted.saturating_sub(h as u128);
            sum_others_x_sq += x * x;
        }
    }

    // Mint complete sets (add effective_collateral to all reserves).
    for r in reserves.iter_mut() {
        *r = r
            .checked_add(effective_collateral)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    }

    // k_new = total_minted + C; k_new² = k_new * k_new
    let k_new = total_minted + effective_collateral as u128;
    let k_new_sq = k_new
        .checked_mul(k_new)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    // x_new[i] = isqrt(k_new² - Σ_{j≠i} x[j]²)
    require!(
        k_new_sq >= sum_others_x_sq,
        DekantPmError::InsufficientLiquidity
    );
    let x_new_i = isqrt(k_new_sq - sum_others_x_sq);

    // tokens_out = x_new[i] - x[i] (position grows → trader receives tokens)
    require!(x_new_i >= x_i, DekantPmError::InsufficientLiquidity);
    let tokens_out = (x_new_i - x_i) as u64;
    require!(tokens_out > 0, DekantPmError::TradeTooSmall);

    // Set reserve for outcome i: h_final = k_new - x_new_i
    reserves[outcome] = (k_new - x_new_i) as u64;

    Ok(tokens_out)
}

// ── Discrete Sell ────────────────────────────────────────────────────

/// Sell outcome tokens for a single outcome index.
///
/// Mutates `reserves` in place. Returns the collateral amount
/// returned to the trader (before fees).
///
/// Algorithm (position-based, no quadratic needed):
/// 1. x[i] = total_minted - h[i]; require x[i] ≥ tokens_in.
/// 2. Add tokens_in to reserves[i].
/// 3. Compute k_new_sq = Σ (total_minted - h_new[j])².
/// 4. k_new = isqrt(k_new_sq).
/// 5. collateral_out = total_minted - k_new.
/// 6. Subtract collateral_out from all reserves.
pub fn compute_sell(
    reserves: &mut [u64],
    total_minted: u128,
    outcome: usize,
    tokens_in: u64,
) -> Result<u64> {
    let n = reserves.len();
    require!(outcome < n, DekantPmError::InvalidOutcome);
    require!(tokens_in > 0, DekantPmError::TradeTooSmall);

    // Current position for outcome i.
    let x_i = total_minted.saturating_sub(reserves[outcome] as u128);
    require!(
        x_i >= tokens_in as u128,
        DekantPmError::InsufficientLiquidity
    );

    // Add tokens back to reserves[outcome].
    reserves[outcome] = reserves[outcome]
        .checked_add(tokens_in)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    // Compute k_new_sq = Σ (total_minted - h_new[j])²
    let mut k_new_sq: u128 = 0;
    for &h in reserves.iter() {
        let x = total_minted.saturating_sub(h as u128);
        k_new_sq += x * x;
    }

    let k_new = isqrt(k_new_sq);
    require!(
        total_minted >= k_new,
        DekantPmError::InsufficientLiquidity
    );
    let collateral_out = (total_minted - k_new) as u64;
    require!(collateral_out > 0, DekantPmError::TradeTooSmall);

    // Burn complete sets: subtract collateral_out from all reserves.
    for r in reserves.iter_mut() {
        *r = r
            .checked_sub(collateral_out)
            .ok_or_else(|| error!(DekantPmError::InsufficientLiquidity))?;
    }

    Ok(collateral_out)
}

// ── Distribution Buy ─────────────────────────────────────────────────

/// Buy across multiple bins proportional to `weights` (continuous market).
///
/// Mutates `reserves` in place. Returns tokens_out per bin.
///
/// Algorithm (position-based):
/// 1. Compute positions x[b] = total_minted - h[b].
/// 2. Mint complete sets.
/// 3. Solve quadratic for λ:
///    W2·λ² + 2·XW·λ + (k² - k_new²) = 0
///    λ = (sqrt(XW² + W2·(k_new² - k²)) - XW) / W2
///    where XW = Σ x[b]·W[b], W2 = Σ W[b]²
/// 4. tokens_out[b] = numerator · W[b] / W2.
pub fn compute_distribution_buy(
    reserves: &mut [u64],
    total_minted: u128,
    weights: &[u64],
    effective_collateral: u64,
) -> Result<Vec<u64>> {
    let n = reserves.len();
    require!(weights.len() == n, DekantPmError::InvalidNumOutcomes);
    require!(effective_collateral > 0, DekantPmError::TradeTooSmall);

    // Compute XW = Σ x[b]*w[b] and W2 = Σ w[b]² BEFORE mint.
    let mut xw: u128 = 0;
    let mut w2: u128 = 0;
    for (&h, &w) in reserves.iter().zip(weights.iter()) {
        let x = total_minted.saturating_sub(h as u128);
        xw += x * (w as u128);
        w2 += (w as u128) * (w as u128);
    }

    require!(w2 > 0, DekantPmError::DivisionByZero);

    // Mint complete sets.
    for r in reserves.iter_mut() {
        *r = r
            .checked_add(effective_collateral)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    }

    // k_new = total_minted + C
    let k_new = total_minted + effective_collateral as u128;
    let k_new_sq = k_new
        .checked_mul(k_new)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    let k_old_sq = total_minted
        .checked_mul(total_minted)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    let excess = k_new_sq - k_old_sq; // always positive

    // disc = XW² + W2 * excess
    let xw_sq = xw
        .checked_mul(xw)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    let w2_excess = w2
        .checked_mul(excess)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    let disc = xw_sq
        .checked_add(w2_excess)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

    let sqrt_disc = isqrt(disc);

    // numerator = sqrt(disc) - XW (always ≥ 0 since disc ≥ XW²)
    require!(sqrt_disc >= xw, DekantPmError::MathOverflow);
    let numerator = sqrt_disc - xw;

    // tokens_out[b] = numerator * W[b] / W2
    let mut tokens_out = Vec::with_capacity(n);
    for (i, &w) in weights.iter().enumerate() {
        let out = numerator
            .checked_mul(w as u128)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?
            / w2;
        let out = out as u64;
        tokens_out.push(out);

        reserves[i] = reserves[i]
            .checked_sub(out)
            .ok_or_else(|| error!(DekantPmError::InsufficientLiquidity))?;
    }

    Ok(tokens_out)
}

// ── Distribution Sell ────────────────────────────────────────────────

/// Sell across multiple bins proportional to `weights` (continuous market).
///
/// Mutates `reserves` in place. Returns total collateral_out (before fees).
///
/// Algorithm (position-based, no quadratic needed):
/// 1. Add tokens back: reserves[b] += total_tokens * W[b] / SCALE.
/// 2. Compute new positions: x_new[b] = total_minted - reserves_new[b].
/// 3. k_new_sq = Σ x_new[b]², k_new = isqrt(k_new_sq).
/// 4. collateral_out = total_minted - k_new.
/// 5. Subtract collateral_out from all reserves.
pub fn compute_distribution_sell(
    reserves: &mut [u64],
    total_minted: u128,
    weights: &[u64],
    total_tokens: u64,
) -> Result<u64> {
    let n = reserves.len();
    require!(weights.len() == n, DekantPmError::InvalidNumOutcomes);
    require!(total_tokens > 0, DekantPmError::TradeTooSmall);

    // Add tokens back to reserves and compute k_new_sq from new positions.
    let mut k_new_sq: u128 = 0;
    for (i, &w) in weights.iter().enumerate() {
        let tokens_for_bin = (total_tokens as u128)
            .checked_mul(w as u128)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?
            / SCALE;
        reserves[i] = reserves[i]
            .checked_add(tokens_for_bin as u64)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

        let x_new = total_minted.saturating_sub(reserves[i] as u128);
        k_new_sq += x_new * x_new;
    }

    let k_new = isqrt(k_new_sq);
    require!(
        total_minted >= k_new,
        DekantPmError::InsufficientLiquidity
    );
    let collateral_out = (total_minted - k_new) as u64;
    require!(collateral_out > 0, DekantPmError::TradeTooSmall);

    // Burn complete sets: subtract collateral_out from all reserves.
    for r in reserves.iter_mut() {
        *r = r
            .checked_sub(collateral_out)
            .ok_or_else(|| error!(DekantPmError::InsufficientLiquidity))?;
    }

    Ok(collateral_out)
}

// ── Pricing ──────────────────────────────────────────────────────────

/// Compute implied probabilities for all outcomes.
///
/// Returns Vec of probabilities scaled to SCALE, summing to SCALE (±rounding).
/// probability[i] = (total_minted - reserves[i])² * SCALE / total_minted².
///
/// Returns all zeros if total_minted is 0 or if any intermediate overflows.
pub fn compute_probabilities(reserves: &[u64], total_minted: u128) -> Vec<u128> {
    if total_minted == 0 {
        return vec![0; reserves.len()];
    }
    let k_sq = total_minted * total_minted;
    reserves
        .iter()
        .map(|&h| {
            let x = total_minted.saturating_sub(h as u128);
            let x_sq = x.checked_mul(x);
            match x_sq.and_then(|sq| sq.checked_mul(SCALE)) {
                Some(v) => v / k_sq,
                None => 0,
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
/// Returns the new k_squared value: numerator² (= total_minted_new²).
pub fn scale_reserves(
    reserves: &mut [u64],
    numerator: u128,
    denominator: u128,
) -> Result<u128> {
    require!(denominator > 0, DekantPmError::DivisionByZero);

    for r in reserves.iter_mut() {
        let new_r = (*r as u128)
            .checked_mul(numerator)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?
            / denominator;
        *r = new_r as u64;
    }

    // k_squared = total_minted_new² = numerator²
    numerator
        .checked_mul(numerator)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))
}
