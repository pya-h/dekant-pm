/// On-chain Normal PDF bin weight computation.
///
/// Approximates exp(-z²/2) using a degree-4 Taylor polynomial (Horner form).
/// Accurate to ~0.1% for |z| ≤ 3; tails clamped to 0 for |z| > Z_CUTOFF.
///
/// Implementation in task P-3.

use crate::constants::{SCALE, Z_CUTOFF};

/// Approximate exp(-t/2) for t ≥ 0 in fixed-point (SCALE-denominated).
///
/// Uses Taylor series: exp(-t/2) ≈ 1 - t/2 + t²/8 - t³/48 + t⁴/384
/// in Horner form: ((((t/384 - 1/48) * t + 1/8) * t - 1/2) * t + 1)
///
/// Input: t = z² in SCALE-denominated fixed-point.
/// Output: exp(-t/2) in SCALE-denominated fixed-point, clamped to [0, SCALE].
pub fn exp_neg_half_approx(_t_scaled: u128) -> u128 {
    // Implementation deferred to task P-3.
    // Signature is stable.
    todo!()
}

/// Compute normalized bin weights for a Normal(mu, sigma) distribution
/// over `num_bins` equal-width bins spanning [range_min, range_max].
///
/// Returns a Vec of length `num_bins` where weights sum to SCALE.
/// Bins with |z| > Z_CUTOFF get weight 0.
///
/// All inputs use the same scale as the market's range_min/range_max (10^9).
/// `sigma` must be > 0.
pub fn compute_bin_weights(
    range_min: i64,
    range_max: i64,
    num_bins: u16,
    mu: i64,
    sigma: u64,
) -> Vec<u64> {
    // Implementation deferred to task P-3.
    // Signature is stable.
    todo!()
}
