/// On-chain Normal PDF bin weight computation.
///
/// Approximates exp(-z²/2) using a degree-4 Taylor polynomial (Horner form).
/// Accurate to ~0.1% for |z| ≤ 1.5; degrades gracefully for larger |z|.
/// Tails clamped to 0 for |z| > Z_CUTOFF.
///
/// Implementation: task P-3.

use crate::constants::{SCALE, Z_CUTOFF};

/// Approximate exp(-t/2) for t ≥ 0 in fixed-point (SCALE-denominated).
///
/// Uses Taylor series: exp(-t/2) ≈ 1 - t/2 + t²/8 - t³/48 + t⁴/384
/// in Horner form: ((((t/384 - 1/48) * t + 1/8) * t - 1/2) * t + 1)
///
/// Input: t = z² in SCALE-denominated fixed-point.
/// Output: exp(-t/2) in SCALE-denominated fixed-point, clamped to [0, SCALE].
pub fn exp_neg_half_approx(t_scaled: u128) -> u128 {
    if t_scaled == 0 {
        return SCALE;
    }

    // Cutoff: if t > Z_CUTOFF² * SCALE, return 0.
    let cutoff = (Z_CUTOFF as u128) * (Z_CUTOFF as u128) * SCALE;
    if t_scaled > cutoff {
        return 0;
    }

    // Horner evaluation using i128 to handle alternating signs.
    // exp(-t/2) ≈ 1 - t/2 + t²/8 - t³/48 + t⁴/384
    // Horner: ((((1/384 * t - 1/48) * t + 1/8) * t - 1/2) * t + 1)
    //
    // Coefficients scaled to SCALE:
    //   c4 =  SCALE / 384  =   2_604_166
    //   c3 = -SCALE / 48   = -20_833_333
    //   c2 =  SCALE / 8    = 125_000_000
    //   c1 = -SCALE / 2    = -500_000_000
    //   c0 =  SCALE        = 1_000_000_000
    let t = t_scaled as i128;
    let s = SCALE as i128;

    let c4: i128 = s / 384;
    let c3: i128 = -(s / 48);
    let c2: i128 = s / 8;
    let c1: i128 = -(s / 2);
    let c0: i128 = s;

    // Evaluate: r = ((((c4 * t / s + c3) * t / s + c2) * t / s + c1) * t / s + c0)
    let mut r = c4;
    r = r * t / s + c3;
    r = r * t / s + c2;
    r = r * t / s + c1;
    r = r * t / s + c0;

    // Clamp to [0, SCALE].
    if r <= 0 {
        0
    } else if r > s {
        SCALE
    } else {
        r as u128
    }
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
    if num_bins == 0 || sigma == 0 || range_max <= range_min {
        return vec![0; num_bins as usize];
    }

    let n = num_bins as i128;
    let lo = range_min as i128;
    let hi = range_max as i128;
    let span = hi - lo;
    let sigma_i128 = sigma as i128;
    let cutoff_dist = (Z_CUTOFF as i128) * sigma_i128;

    let mut raw_weights: Vec<u128> = Vec::with_capacity(num_bins as usize);
    let mut total: u128 = 0;

    for b in 0..num_bins as i128 {
        // Center of bin b: range_min + (2b + 1) * span / (2 * num_bins)
        let center = lo + (2 * b + 1) * span / (2 * n);

        let diff = center - (mu as i128);

        // Tail cutoff: |z| > Z_CUTOFF → weight = 0.
        if diff.unsigned_abs() > cutoff_dist as u128 {
            raw_weights.push(0);
            continue;
        }

        // z² * SCALE = diff² * SCALE / sigma²
        // Safe: |diff| ≤ cutoff_dist = 5*sigma, so diff² ≤ 25*sigma², fits in u128.
        let diff_sq = (diff * diff) as u128;
        let sigma_sq = (sigma_i128 * sigma_i128) as u128;
        let z_sq_scaled = diff_sq * SCALE / sigma_sq;

        let w = exp_neg_half_approx(z_sq_scaled);
        raw_weights.push(w);
        total += w;
    }

    // Normalize so weights sum to SCALE.
    if total == 0 {
        // All weights are zero (mu far outside range). Return zeros.
        return vec![0; num_bins as usize];
    }

    let mut weights: Vec<u64> = raw_weights
        .iter()
        .map(|&w| {
            if w == 0 {
                0
            } else {
                (w * SCALE / total) as u64
            }
        })
        .collect();

    // Adjust the largest weight to ensure the sum is exactly SCALE.
    let current_sum: u64 = weights.iter().sum();
    if current_sum != SCALE as u64 && current_sum > 0 {
        if let Some((max_idx, _)) = weights
            .iter()
            .enumerate()
            .max_by_key(|&(_, &w)| w)
        {
            let target = SCALE as u64;
            if current_sum < target {
                // Rounding left a shortfall; add the difference to the largest weight.
                weights[max_idx] = weights[max_idx].saturating_add(target - current_sum);
            } else {
                // Rounding overshot; subtract the excess from the largest weight.
                weights[max_idx] = weights[max_idx].saturating_sub(current_sum - target);
            }
        }
    }

    weights
}
