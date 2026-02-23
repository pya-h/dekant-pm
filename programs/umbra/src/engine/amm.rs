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
        // Total tokens = tokens per bin × n. For a uniform buy across all
        // outcomes, the total exceeds collateral because each outcome is
        // partially drained (not a full discrete buy on one outcome).
        let total: u64 = tokens.iter().sum();
        assert!(total > 100_000, "total={total} should exceed collateral");
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

    // ── compute_buy edge cases ─────────────────────────────────────

    #[test]
    fn test_compute_buy_invalid_outcome() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        // outcome index 2 is out of bounds for a 2-element reserves vec.
        assert!(compute_buy(&mut reserves, k_squared, 2, 100_000).is_err());
    }

    #[test]
    fn test_compute_buy_outcome_eq_n() {
        let mut reserves = vec![1_000_000u64; 5];
        let k_squared = 5 * (1_000_000u128).pow(2);
        // outcome == n (length), should be rejected.
        assert!(compute_buy(&mut reserves, k_squared, 5, 50_000).is_err());
    }

    #[test]
    fn test_compute_buy_zero_collateral() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        // effective_collateral == 0 should fail with TradeTooSmall.
        assert!(compute_buy(&mut reserves, k_squared, 0, 0).is_err());
    }

    #[test]
    fn test_compute_buy_overflow_on_reserve_add() {
        // Reserve at u64::MAX cannot accept any collateral addition.
        let mut reserves = vec![u64::MAX, 1_000_000];
        // Use a safe k_squared value (not from sum_of_squares which would overflow).
        let k_squared = (1_000_000u128).pow(2);
        assert!(compute_buy(&mut reserves, k_squared, 0, 1).is_err());
    }

    #[test]
    fn test_compute_buy_insufficient_liquidity() {
        // k_squared much smaller than sum_others_sq after mint.
        // Tiny k_squared with a big collateral addition pushes sum_others_sq > k_squared.
        let mut reserves = vec![100u64; 2];
        let k_squared = 2 * (100u128).pow(2); // 20_000
        // After adding 10_000_000, reserves = [10_000_100, 10_000_100].
        // sum_others_sq = 10_000_100^2 = ~10^14, far exceeding k_squared = 20_000.
        assert!(compute_buy(&mut reserves, k_squared, 0, 10_000_000).is_err());
    }

    // ── compute_sell edge cases ────────────────────────────────────

    #[test]
    fn test_compute_sell_invalid_outcome() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        assert!(compute_sell(&mut reserves, k_squared, 3, 100_000).is_err());
    }

    #[test]
    fn test_compute_sell_zero_tokens() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        // tokens_in == 0 should fail with TradeTooSmall.
        assert!(compute_sell(&mut reserves, k_squared, 0, 0).is_err());
    }

    #[test]
    fn test_compute_sell_overflow_on_token_addition() {
        // Reserve near u64::MAX + tokens_in overflows.
        let mut reserves = vec![u64::MAX, 1_000_000];
        let k_squared = sum_of_squares(&reserves);
        assert!(compute_sell(&mut reserves, k_squared, 0, 1).is_err());
    }

    // ── solve_burn_amount edge cases ───────────────────────────────

    #[test]
    fn test_solve_burn_r2_equals_k_squared() {
        // When reserves are already at the invariant, burn should be 0.
        let reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        let burn = solve_burn_amount(&reserves, k_squared).unwrap();
        assert_eq!(burn, 0);
    }

    #[test]
    fn test_solve_burn_rejects_r2_below_k_squared() {
        // If r2 < k_squared, the invariant is violated in the wrong direction.
        let reserves = vec![100u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2); // way larger
        assert!(solve_burn_amount(&reserves, k_squared).is_err());
    }

    #[test]
    fn test_solve_burn_empty_reserves() {
        let reserves: Vec<u64> = vec![];
        let k_squared = 0u128;
        // n == 0 should be rejected.
        assert!(solve_burn_amount(&reserves, k_squared).is_err());
    }

    #[test]
    fn test_solve_burn_single_reserve() {
        // Single reserve: r2 = r^2, burn = (r - sqrt(r^2 - (r^2 - k^2))) / 1 = r - sqrt(k^2)
        let reserves = vec![1_100_000u64];
        let k_squared = (1_000_000u128).pow(2);
        let burn = solve_burn_amount(&reserves, k_squared).unwrap();
        // burn = (1_100_000 - sqrt(1_100_000^2 - 1*(1_100_000^2 - 1_000_000^2))) / 1
        // = 1_100_000 - sqrt(1_000_000^2) = 1_100_000 - 1_000_000 = 100_000
        assert_eq!(burn, 100_000);
    }

    // ── scale_reserves edge cases ──────────────────────────────────

    #[test]
    fn test_scale_reserves_denominator_zero() {
        let mut reserves = vec![1_000_000u64; 2];
        assert!(scale_reserves(&mut reserves, 1, 0).is_err());
    }

    #[test]
    fn test_scale_reserves_numerator_zero() {
        // Scaling by 0/anything should zero out all reserves.
        let mut reserves = vec![1_000_000u64; 2];
        let new_k2 = scale_reserves(&mut reserves, 0, 1).unwrap();
        assert_eq!(reserves[0], 0);
        assert_eq!(reserves[1], 0);
        assert_eq!(new_k2, 0);
    }

    #[test]
    fn test_scale_reserves_truncation() {
        // Non-exact division should truncate (floor).
        // 1_000_000 * 2 / 3 = 666_666.666... → 666_666
        let mut reserves = vec![1_000_000u64; 2];
        let _new_k2 = scale_reserves(&mut reserves, 2, 3).unwrap();
        assert_eq!(reserves[0], 666_666);
        assert_eq!(reserves[1], 666_666);
    }

    #[test]
    fn test_scale_reserves_overflow() {
        // Reserve near u64::MAX with a large numerator should overflow.
        let mut reserves = vec![u64::MAX; 2];
        assert!(scale_reserves(&mut reserves, u128::MAX, 1).is_err());
    }

    // ── compute_distribution_buy edge cases ────────────────────────

    #[test]
    fn test_distribution_buy_mismatched_lengths() {
        let mut reserves = vec![1_000_000u64; 3];
        let k_squared = 3 * (1_000_000u128).pow(2);
        let weights = vec![500_000_000u64; 2]; // 2 weights for 3 reserves
        assert!(compute_distribution_buy(&mut reserves, k_squared, &weights, 100_000).is_err());
    }

    #[test]
    fn test_distribution_buy_all_zero_weights() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        let weights = vec![0u64; 2];
        // w2 == 0 should be rejected with DivisionByZero.
        assert!(compute_distribution_buy(&mut reserves, k_squared, &weights, 100_000).is_err());
    }

    #[test]
    fn test_distribution_buy_zero_collateral() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        let weights = vec![500_000_000u64; 2];
        assert!(compute_distribution_buy(&mut reserves, k_squared, &weights, 0).is_err());
    }

    // ── compute_distribution_sell edge cases ───────────────────────

    #[test]
    fn test_distribution_sell_mismatched_lengths() {
        let mut reserves = vec![1_000_000u64; 3];
        let k_squared = 3 * (1_000_000u128).pow(2);
        let weights = vec![500_000_000u64; 2]; // 2 weights for 3 reserves
        assert!(compute_distribution_sell(&mut reserves, k_squared, &weights, 100_000).is_err());
    }

    #[test]
    fn test_distribution_sell_zero_total_tokens() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);
        let weights = vec![500_000_000u64; 2];
        // total_tokens == 0 should fail.
        assert!(compute_distribution_sell(&mut reserves, k_squared, &weights, 0).is_err());
    }

    // ── compute_probabilities edge cases ───────────────────────────

    #[test]
    fn test_probabilities_overflow_inducing_reserves() {
        // Reserves so large that r^2 * SCALE overflows u128.
        // u128::MAX ~ 3.4e38. We need r^2 * SCALE > u128::MAX.
        // r = 2^50 ~ 1.1e15, r^2 = 2^100 ~ 1.27e30, r^2 * SCALE = 1.27e39 > u128::MAX? No.
        // r = 2^55, r^2 = 2^110, r^2 * SCALE(10^9) ~ 2^110 * 2^30 = 2^140 > 2^128.
        let large_r = 1u64 << 55;
        let reserves = vec![large_r; 2];
        let k_squared = sum_of_squares(&reserves);
        let probs = compute_probabilities(&reserves, k_squared);
        // Should gracefully return 0 for overflowing entries.
        for p in &probs {
            assert_eq!(*p, 0, "overflow should yield 0");
        }
    }

    #[test]
    fn test_probabilities_single_outcome() {
        let reserves = vec![1_000_000u64];
        let k_squared = (1_000_000u128).pow(2);
        let probs = compute_probabilities(&reserves, k_squared);
        assert_eq!(probs.len(), 1);
        assert_eq!(probs[0], SCALE);
    }

    #[test]
    fn test_probabilities_five_outcomes_sum() {
        let reserves = vec![500_000u64, 700_000, 1_200_000, 900_000, 300_000];
        let k_squared = sum_of_squares(&reserves);
        let probs = compute_probabilities(&reserves, k_squared);
        let sum: u128 = probs.iter().sum();
        let diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
        assert!(diff <= 5, "sum={sum}, expected ~{SCALE}");
    }

    // ── Multi-trade sequences ──────────────────────────────────────

    #[test]
    fn test_buy_buy_sell_sequence() {
        let mut reserves = vec![1_000_000u64; 2];
        let k_squared = 2 * (1_000_000u128).pow(2);

        // Buy #1 on outcome 0.
        let tokens_1 = compute_buy(&mut reserves, k_squared, 0, 50_000).unwrap();
        let k2_1 = sum_of_squares(&reserves);

        // Buy #2 on outcome 1.
        let tokens_2 = compute_buy(&mut reserves, k2_1, 1, 30_000).unwrap();
        let k2_2 = sum_of_squares(&reserves);

        assert!(tokens_1 > 0);
        assert!(tokens_2 > 0);

        // Sell #1 (sell back some of outcome 0).
        let collateral = compute_sell(&mut reserves, k2_2, 0, tokens_1 / 2).unwrap();
        assert!(collateral > 0);

        // Invariant should still hold approximately.
        let k2_final = sum_of_squares(&reserves);
        let diff = if k2_final > k2_2 {
            k2_final - k2_2
        } else {
            k2_2 - k2_final
        };
        let max_reserve = *reserves.iter().max().unwrap() as u128;
        assert!(
            diff <= 2 * max_reserve,
            "invariant drift too large: diff={diff}"
        );
    }

    #[test]
    fn test_many_small_trades_invariant_drift() {
        let mut reserves = vec![1_000_000u64; 2];
        let original_k2 = 2 * (1_000_000u128).pow(2);

        // Perform 20 buy-sell roundtrips and check invariant drift stays bounded.
        let mut k2 = original_k2;
        for _ in 0..20 {
            let tokens = compute_buy(&mut reserves, k2, 0, 10_000).unwrap();
            k2 = sum_of_squares(&reserves);
            let _coll = compute_sell(&mut reserves, k2, 0, tokens).unwrap();
            k2 = sum_of_squares(&reserves);
        }

        // After many roundtrips, invariant may drift but should stay within reason.
        let drift = if k2 > original_k2 {
            k2 - original_k2
        } else {
            original_k2 - k2
        };
        let max_reserve = *reserves.iter().max().unwrap() as u128;
        // Allow drift up to 20 * 2 * max_reserve (accumulated isqrt rounding).
        assert!(
            drift <= 40 * max_reserve,
            "excessive invariant drift after 20 roundtrips: drift={drift}"
        );
    }

    // ── Large value boundary tests ─────────────────────────────────

    #[test]
    fn test_compute_buy_large_reserves() {
        // Use reserves near the practical limit (~10^12 per bin).
        let r = 1_000_000_000_000u64; // 10^12
        let mut reserves = vec![r; 2];
        let k_squared = 2 * (r as u128).pow(2);

        let tokens = compute_buy(&mut reserves, k_squared, 0, 1_000_000_000).unwrap();
        assert!(tokens > 0);
        // Invariant should approximately hold.
        let actual_k2 = sum_of_squares(&reserves);
        let diff = if actual_k2 > k_squared {
            actual_k2 - k_squared
        } else {
            k_squared - actual_k2
        };
        let max_r = *reserves.iter().max().unwrap() as u128;
        assert!(diff <= 2 * max_r, "invariant diff={diff}");
    }

    #[test]
    fn test_compute_sell_large_reserves() {
        // Buy first with large reserves, then sell.
        let r = 1_000_000_000_000u64;
        let mut reserves = vec![r; 2];
        let k_squared = 2 * (r as u128).pow(2);

        let tokens = compute_buy(&mut reserves, k_squared, 0, 1_000_000_000).unwrap();
        let k2 = sum_of_squares(&reserves);
        let collateral = compute_sell(&mut reserves, k2, 0, tokens).unwrap();
        assert!(collateral > 0);
        // Roundtrip should return approximately the same collateral.
        let diff = if collateral > 1_000_000_000 {
            collateral - 1_000_000_000
        } else {
            1_000_000_000 - collateral
        };
        // Allow 0.1% error.
        assert!(diff <= 1_000_000, "roundtrip diff={diff}");
    }

    #[test]
    fn test_solve_burn_large_values() {
        let r = 1_000_000_000_000u64;
        let mut reserves = vec![r; 2];
        let k_squared = 2 * (r as u128).pow(2);
        reserves[0] += 1_000_000_000; // Add tokens to one reserve.
        let burn = solve_burn_amount(&reserves, k_squared).unwrap();
        assert!(burn > 0);
        assert!(burn < 1_000_000_000);
    }

    #[test]
    fn test_scale_reserves_large_values() {
        let r = 1_000_000_000_000u64;
        let mut reserves = vec![r; 2];
        // Scale by 3/2.
        let new_k2 = scale_reserves(&mut reserves, 3, 2).unwrap();
        assert_eq!(reserves[0], 1_500_000_000_000);
        assert_eq!(reserves[1], 1_500_000_000_000);
        assert_eq!(new_k2, 2 * (1_500_000_000_000u128).pow(2));
    }

    // ── Verify invariant edge cases ────────────────────────────────

    #[test]
    fn test_verify_invariant_within_tolerance() {
        let reserves = vec![1_000_000u64; 2];
        // Off by exactly INVARIANT_TOLERANCE (256).
        let k_squared = 2 * (1_000_000u128).pow(2) + crate::constants::INVARIANT_TOLERANCE;
        verify_invariant(&reserves, k_squared).unwrap();
    }

    #[test]
    fn test_verify_invariant_just_beyond_tolerance() {
        let reserves = vec![1_000_000u64; 2];
        let k_squared =
            2 * (1_000_000u128).pow(2) + crate::constants::INVARIANT_TOLERANCE + 1;
        assert!(verify_invariant(&reserves, k_squared).is_err());
    }

    // ── Sum of squares ─────────────────────────────────────────────

    #[test]
    fn test_sum_of_squares_empty() {
        assert_eq!(sum_of_squares(&[]), 0);
    }

    #[test]
    fn test_sum_of_squares_single() {
        assert_eq!(sum_of_squares(&[5]), 25);
    }

    #[test]
    fn test_sum_of_squares_max_u64() {
        // Should not panic; u64::MAX^2 fits in u128.
        let result = sum_of_squares(&[u64::MAX]);
        assert_eq!(result, (u64::MAX as u128) * (u64::MAX as u128));
    }
}
