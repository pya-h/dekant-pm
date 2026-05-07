/// On-chain Normal PDF bin weight computation.
///
/// Approximates exp(-z²/2) using a precomputed lookup table with linear
/// interpolation. Step size 0.5 in t-space gives ~0.78% max relative error.
/// Guaranteed monotonically decreasing. Tails clamped to 0 for |z| > Z_CUTOFF.
///
use crate::constants::{SCALE, Z_CUTOFF};
use ethnum::U256;

/// Lookup table: EXP_TABLE[k] = round(exp(-k/4) * SCALE) for k = 0..2*Z_CUTOFF².
/// Each entry corresponds to t = k/2 (where t = z²), giving 0.5 step size in t.
/// Linear interpolation between entries gives ~0.78% max relative error.
///
/// Table size must be 2*Z_CUTOFF² + 1. The compile-time assert below enforces this.
const EXP_TABLE: [u128; 51] = [
    1_000_000_000, //  0: exp(  0.00)  [t= 0.0]
      778_800_783, //  1: exp( -0.25)  [t= 0.5]
      606_530_660, //  2: exp( -0.50)  [t= 1.0]
      472_366_553, //  3: exp( -0.75)  [t= 1.5]
      367_879_441, //  4: exp( -1.00)  [t= 2.0]
      286_504_797, //  5: exp( -1.25)  [t= 2.5]
      223_130_160, //  6: exp( -1.50)  [t= 3.0]
      173_773_943, //  7: exp( -1.75)  [t= 3.5]
      135_335_283, //  8: exp( -2.00)  [t= 4.0]
      105_399_225, //  9: exp( -2.25)  [t= 4.5]
       82_084_999, // 10: exp( -2.50)  [t= 5.0]
       63_927_861, // 11: exp( -2.75)  [t= 5.5]
       49_787_068, // 12: exp( -3.00)  [t= 6.0]
       38_774_208, // 13: exp( -3.25)  [t= 6.5]
       30_197_383, // 14: exp( -3.50)  [t= 7.0]
       23_517_746, // 15: exp( -3.75)  [t= 7.5]
       18_315_639, // 16: exp( -4.00)  [t= 8.0]
       14_264_234, // 17: exp( -4.25)  [t= 8.5]
       11_108_997, // 18: exp( -4.50)  [t= 9.0]
        8_651_695, // 19: exp( -4.75)  [t= 9.5]
        6_737_947, // 20: exp( -5.00)  [t=10.0]
        5_247_518, // 21: exp( -5.25)  [t=10.5]
        4_086_771, // 22: exp( -5.50)  [t=11.0]
        3_182_781, // 23: exp( -5.75)  [t=11.5]
        2_478_752, // 24: exp( -6.00)  [t=12.0]
        1_930_454, // 25: exp( -6.25)  [t=12.5]
        1_503_439, // 26: exp( -6.50)  [t=13.0]
        1_170_880, // 27: exp( -6.75)  [t=13.5]
          911_882, // 28: exp( -7.00)  [t=14.0]
          710_174, // 29: exp( -7.25)  [t=14.5]
          553_084, // 30: exp( -7.50)  [t=15.0]
          430_743, // 31: exp( -7.75)  [t=15.5]
          335_463, // 32: exp( -8.00)  [t=16.0]
          261_259, // 33: exp( -8.25)  [t=16.5]
          203_468, // 34: exp( -8.50)  [t=17.0]
          158_461, // 35: exp( -8.75)  [t=17.5]
          123_410, // 36: exp( -9.00)  [t=18.0]
           96_112, // 37: exp( -9.25)  [t=18.5]
           74_852, // 38: exp( -9.50)  [t=19.0]
           58_295, // 39: exp( -9.75)  [t=19.5]
           45_400, // 40: exp(-10.00)  [t=20.0]
           35_358, // 41: exp(-10.25)  [t=20.5]
           27_536, // 42: exp(-10.50)  [t=21.0]
           21_445, // 43: exp(-10.75)  [t=21.5]
           16_702, // 44: exp(-11.00)  [t=22.0]
           13_007, // 45: exp(-11.25)  [t=22.5]
           10_130, // 46: exp(-11.50)  [t=23.0]
            7_889, // 47: exp(-11.75)  [t=23.5]
            6_144, // 48: exp(-12.00)  [t=24.0]
            4_785, // 49: exp(-12.25)  [t=24.5]
            3_727, // 50: exp(-12.50)  [t=25.0]
];

/// Approximate exp(-t/2) for t ≥ 0 in fixed-point (SCALE-denominated).
///
/// Uses a 51-entry lookup table (half-integer values of t from 0 to 25) with
/// linear interpolation between entries. Guaranteed monotonically decreasing.
///
/// Input: t = z² in SCALE-denominated fixed-point.
/// Output: exp(-t/2) in SCALE-denominated fixed-point, in [0, SCALE].
pub fn exp_neg_half_approx(t_scaled: u128) -> u128 {
    // Compile-time check: table must cover [0, Z_CUTOFF²] at half-step spacing.
    const _: () = assert!(
        EXP_TABLE.len() == (Z_CUTOFF * Z_CUTOFF * 2 + 1) as usize,
        "EXP_TABLE size must equal 2 * Z_CUTOFF^2 + 1"
    );

    if t_scaled == 0 {
        return SCALE;
    }

    // Cutoff: if t > Z_CUTOFF² * SCALE, return 0.
    let cutoff = (Z_CUTOFF as u128) * (Z_CUTOFF as u128) * SCALE;
    if t_scaled > cutoff {
        return 0;
    }

    // Table step = SCALE/2. Map t_scaled to table index and fractional part.
    let half_scale = SCALE / 2;
    let k = (t_scaled / half_scale) as usize;
    let frac = t_scaled % half_scale;

    // k == 50 only when t_scaled == 25 * SCALE exactly (boundary).
    if k >= EXP_TABLE.len() - 1 {
        return EXP_TABLE[EXP_TABLE.len() - 1];
    }

    let val_lo = EXP_TABLE[k];
    let val_hi = EXP_TABLE[k + 1];

    // Linear interpolation: val_lo - (val_lo - val_hi) * frac / half_scale
    let diff = val_lo - val_hi;
    val_lo - diff * frac / half_scale
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

    // Hoist invariants outside the loop to reduce compute cost.
    let sigma_sq = U256::from(sigma as u128) * U256::from(sigma as u128);
    let scale_256 = U256::from(SCALE);

    for b in 0..num_bins as i128 {
        // Center of bin b: range_min + (2b + 1) * span / (2 * num_bins)
        let center = lo + (2 * b + 1) * span / (2 * n);

        let diff = center - (mu as i128);

        // Tail cutoff: |z| > Z_CUTOFF → weight = 0.
        if diff.unsigned_abs() > cutoff_dist as u128 {
            raw_weights.push(0);
            continue;
        }

        // |diff| ≤ 5*sigma after tail cutoff, so diff² ≤ 25*sigma².
        // Use U256 for the full computation to avoid u128 overflow at large sigma.
        let diff_abs = U256::from(diff.unsigned_abs());
        let diff_sq = diff_abs * diff_abs;
        let z_sq_scaled = (diff_sq * scale_256 / sigma_sq).as_u128();

        let w = exp_neg_half_approx(z_sq_scaled);
        raw_weights.push(w);
        total += w;
    }

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
                weights[max_idx] = weights[max_idx].saturating_add(target - current_sum);
            } else {
                weights[max_idx] = weights[max_idx].saturating_sub(current_sum - target);
            }
        }
    }

    weights
}
