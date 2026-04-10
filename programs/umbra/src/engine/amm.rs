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
            let r_sq = (r as u128).saturating_mul(r as u128);
            r_sq.saturating_mul(SCALE) / k_squared
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

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Invariant ────────────────────────────────────────────────────

    #[test]
    fn test_verify_invariant_ok() {
        let reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        verify_invariant(&reserves, k_squared).unwrap();
    }

    #[test]
    fn test_verify_invariant_fail() {
        let reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2) + 1000;
        assert!(verify_invariant(&reserves, k_squared).is_err());
    }

    // ── Discrete Buy ────────────────────────────────────────────────

    #[test]
    fn test_compute_buy_binary() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);

        let tokens = compute_buy(&mut reserves, k_squared, 0, 100_000).unwrap();

        // Trader gets tokens of outcome 0.
        assert!(tokens > 0, "tokens_out={tokens}");
        // Reserve 0 decreased (tokens drained), reserve 1 increased (mint).
        assert!(reserves[0] < 1_100_000);
        assert_eq!(reserves[1], 1_100_000);
        // Price of outcome 0 should increase.
        let p0 = (reserves[0] as u128).pow(2) * SCALE / sum_of_squares(&reserves);
        let p1 = (reserves[1] as u128).pow(2) * SCALE / sum_of_squares(&reserves);
        assert!(p0 < p1, "p0={p0}, p1={p1} — bought 0, so r0 < r1, so p0 < p1");
    }

    #[test]
    fn test_compute_buy_preserves_invariant_approximately() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);

        compute_buy(&mut reserves, k_squared, 0, 100_000).unwrap();

        // After buy, sum_of_squares should be close to k_squared.
        let actual = sum_of_squares(&reserves);
        let diff = if actual > k_squared {
            actual - k_squared
        } else {
            k_squared - actual
        };
        // isqrt rounding may cause a small diff.
        assert!(
            diff <= 2 * 1_100_000, // at most 2 * max_reserve
            "invariant diff={diff}"
        );
    }

    #[test]
    fn test_compute_buy_then_sell_roundtrip() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);

        let tokens = compute_buy(&mut reserves, k_squared, 0, 100_000).unwrap();
        let k2_after_buy = sum_of_squares(&reserves);

        let collateral = compute_sell(&mut reserves, k2_after_buy, 0, tokens).unwrap();

        // Should get back approximately the same collateral (within rounding).
        let diff = if collateral > 100_000 {
            collateral - 100_000
        } else {
            100_000 - collateral
        };
        // Allow up to 1% difference due to integer rounding.
        assert!(
            diff <= 1_000,
            "roundtrip diff={diff}, bought for 100000, got back {collateral}"
        );
    }

    #[test]
    fn test_compute_buy_increases_price() {
        let mut reserves = vec![1_000_000u64; 5];
        let k_squared = 5 * (1_000_000u128).pow(2);

        let probs_before = compute_probabilities(&reserves, k_squared);
        compute_buy(&mut reserves, k_squared, 2, 50_000).unwrap();
        let k2_new = sum_of_squares(&reserves);
        let probs_after = compute_probabilities(&reserves, k2_new);

        // Price of outcome 2 should decrease (lower reserve = lower probability in L2-norm).
        assert!(
            probs_after[2] < probs_before[2],
            "before={}, after={}",
            probs_before[2],
            probs_after[2]
        );
    }

    // ── Discrete Sell ───────────────────────────────────────────────

    #[test]
    fn test_compute_sell_basic() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);

        // First buy to get tokens, then sell them back.
        let tokens = compute_buy(&mut reserves, k_squared, 0, 100_000).unwrap();
        let k2 = sum_of_squares(&reserves);

        let collateral = compute_sell(&mut reserves, k2, 0, tokens).unwrap();
        assert!(collateral > 0);
    }

    // ── Solve Burn Amount ───────────────────────────────────────────

    #[test]
    fn test_solve_burn_basic() {
        // After adding tokens to one reserve, the burn should be positive.
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        reserves[0] += 100_000; // Simulate adding tokens back.

        let burn = solve_burn_amount(&reserves, k_squared).unwrap();
        assert!(burn > 0, "burn={burn}");
        assert!(burn < 100_000, "burn should be less than added amount");
    }

    // ── Scale Reserves ──────────────────────────────────────────────

    #[test]
    fn test_scale_reserves_add_liquidity() {
        let mut reserves = vec![1_000_000u64; 2];
        let total_minted: u128 = 1_000_000;
        let deposit: u128 = 500_000;

        let new_k2 =
            scale_reserves(&mut reserves, total_minted + deposit, total_minted).unwrap();

        // Reserves should be 1.5x.
        assert_eq!(reserves[0], 1_500_000);
        assert_eq!(reserves[1], 1_500_000);
        assert_eq!(new_k2, 2 * (1_500_000u128).pow(2));
    }

    #[test]
    fn test_scale_reserves_remove_liquidity() {
        let mut reserves = vec![1_000_000u64; 2];
        let total_minted: u128 = 1_000_000;
        let withdrawal: u128 = 250_000;

        let new_k2 =
            scale_reserves(&mut reserves, total_minted - withdrawal, total_minted).unwrap();

        // Reserves should be 0.75x.
        assert_eq!(reserves[0], 750_000);
        assert_eq!(reserves[1], 750_000);
        assert_eq!(new_k2, 2 * (750_000u128).pow(2));
    }

    #[test]
    fn test_scale_reserves_preserves_ratios() {
        let mut reserves = vec![800_000u64, 1_200_000];
        let k2_before = sum_of_squares(&reserves);

        let new_k2 = scale_reserves(&mut reserves, 3, 2).unwrap(); // 1.5x

        // Ratio should be preserved.
        // 800k * 3/2 = 1200k, 1200k * 3/2 = 1800k
        assert_eq!(reserves[0], 1_200_000);
        assert_eq!(reserves[1], 1_800_000);
    }

    // ── Probabilities ───────────────────────────────────────────────

    #[test]
    fn test_probabilities_uniform() {
        let reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        let probs = compute_probabilities(&reserves, k_squared);
        assert_eq!(probs[0], 500_000_000);
        assert_eq!(probs[1], 500_000_000);
    }

    #[test]
    fn test_probabilities_sum_to_scale() {
        let reserves = vec![800_000u64, 1_200_000];
        let k_squared = sum_of_squares(&reserves);
        let probs = compute_probabilities(&reserves, k_squared);
        let sum: u128 = probs.iter().sum();
        // Allow ±N rounding error.
        let diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
        assert!(diff <= 2, "sum={sum}");
    }

    #[test]
    fn test_probabilities_zero_k() {
        let reserves = vec![100u64; 3];
        let probs = compute_probabilities(&reserves, 0);
        assert!(probs.iter().all(|&p| p == 0));
    }

    // ── Distribution Buy ────────────────────────────────────────────

    #[test]
    fn test_distribution_buy_uniform_weights() {
        // Uniform weights on uniform reserves → tokens_out = effective_collateral per bin.
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        let weights = vec![(SCALE / 2) as u64; 2];

        let tokens = compute_distribution_buy(&mut reserves, k_squared, &weights, 100_000).unwrap();

        // Each bin should get approximately the same tokens.
        let diff = if tokens[0] > tokens[1] {
            tokens[0] - tokens[1]
        } else {
            tokens[1] - tokens[0]
        };
        assert!(diff <= 1, "tokens={:?}", tokens);
        // Total tokens should be approximately effective_collateral.
        let total: u64 = tokens.iter().sum();
        let t_diff = if total > 100_000 {
            total - 100_000
        } else {
            100_000 - total
        };
        assert!(t_diff <= 10, "total={total}");
    }

    #[test]
    fn test_distribution_buy_single_bin_weight() {
        // All weight on bin 0 → equivalent to discrete buy.
        let mut reserves_dist = vec![1_000_000u64; 2];
        let mut reserves_disc = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        let weights = vec![SCALE as u64, 0];

        let tokens_dist =
            compute_distribution_buy(&mut reserves_dist, k_squared, &weights, 100_000).unwrap();
        let tokens_disc = compute_buy(&mut reserves_disc, k_squared, 0, 100_000).unwrap();

        // Should be very close (differ only by integer rounding path).
        let diff = if tokens_dist[0] > tokens_disc {
            tokens_dist[0] - tokens_disc
        } else {
            tokens_disc - tokens_dist[0]
        };
        assert!(diff <= 100, "dist={}, disc={}", tokens_dist[0], tokens_disc);
        assert_eq!(tokens_dist[1], 0);
    }

    // ── Distribution Sell ───────────────────────────────────────────

    #[test]
    fn test_distribution_sell_basic() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        let weights = vec![(SCALE / 2) as u64; 2];

        // Buy first.
        let tokens =
            compute_distribution_buy(&mut reserves, k_squared, &weights, 100_000).unwrap();
        let k2 = sum_of_squares(&reserves);
        let total_tokens: u64 = tokens.iter().sum();

        // Sell back.
        let collateral =
            compute_distribution_sell(&mut reserves, k2, &weights, total_tokens).unwrap();

        // Should get back approximately the same collateral.
        let diff = if collateral > 100_000 {
            collateral - 100_000
        } else {
            100_000 - collateral
        };
        assert!(
            diff <= 1_000,
            "roundtrip diff={diff}, collateral={collateral}"
        );
    }
}
