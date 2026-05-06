use dekant_pm::engine::normal_pdf::{exp_neg_half_approx, compute_bin_weights};
use dekant_pm::constants::SCALE;

// ── exp_neg_half_approx accuracy tests ────────────────────────

#[test]
fn test_exp_at_zero() {
    assert_eq!(exp_neg_half_approx(0), SCALE);
}

#[test]
fn test_exp_at_cutoff() {
    // z² = 25 → at cutoff boundary, returns EXP_TABLE[25] ≈ 0.
    let t = 25 * SCALE;
    let result = exp_neg_half_approx(t);
    assert!(result < SCALE / 100_000, "result={result} should be near-zero");
}

#[test]
fn test_exp_beyond_cutoff_returns_zero() {
    let t = 25 * SCALE + 1;
    assert_eq!(exp_neg_half_approx(t), 0);
}

/// Verify accuracy at table points (exact lookups, should be near-exact).
#[test]
fn test_exp_at_table_points() {
    // (t = z², expected = round(exp(-t/2) * SCALE))
    // Includes both integer and half-integer t values (all are table entries now).
    let cases: [(u128, u128); 12] = [
        (0,                1_000_000_000), // exp(0)
        (SCALE / 2,          778_800_783), // exp(-0.25)  [t=0.5]
        (1 * SCALE,          606_530_660), // exp(-0.5)
        (2 * SCALE,          367_879_441), // exp(-1.0)
        (SCALE * 5 / 2,      286_504_797), // exp(-1.25)  [t=2.5]
        (4 * SCALE,          135_335_283), // exp(-2.0)
        (6 * SCALE,           49_787_068), // exp(-3.0)
        (SCALE * 15 / 2,      23_517_746), // exp(-3.75)  [t=7.5]
        (10 * SCALE,           6_737_947), // exp(-5.0)
        (16 * SCALE,             335_463), // exp(-8.0)
        (SCALE * 47 / 2,          7_889), // exp(-11.75) [t=23.5]
        (24 * SCALE,               6_144), // exp(-12.0)
    ];
    for (t, expected) in cases {
        let result = exp_neg_half_approx(t);
        let error = result.abs_diff(expected);
        assert!(
            error <= 1,
            "t={t}: result={result}, expected={expected}, error={error}"
        );
    }
}

/// Verify accuracy at midpoints (interpolation between half-step entries, max ~1% error).
#[test]
fn test_exp_at_midpoints() {
    // Midpoints are now at quarter-integer t values (between the half-step table entries).
    // (t_scaled, expected = round(exp(-t/2) * SCALE), max_pct_error)
    let cases: [(u128, u128, u128); 6] = [
        (SCALE / 4,        882_496_903, 1), // z²=0.25, exp(-0.125)
        (SCALE * 3 / 4,    687_289_279, 1), // z²=0.75, exp(-0.375)
        (SCALE * 5 / 4,    535_261_429, 1), // z²=1.25, exp(-0.625)
        (SCALE * 7 / 4,    416_862_020, 1), // z²=1.75, exp(-0.875)
        (SCALE * 9 / 4,    324_652_467, 1), // z²=2.25, exp(-1.125)
        (SCALE * 15 / 4,   153_354_967, 1), // z²=3.75, exp(-1.875)
    ];
    for (t, expected, max_pct) in cases {
        let result = exp_neg_half_approx(t);
        let error = result.abs_diff(expected);
        let tolerance = expected * max_pct / 100;
        assert!(
            error <= tolerance,
            "t={t}: result={result}, expected={expected}, error={error}, tolerance={tolerance}"
        );
    }
}

#[test]
fn test_exp_very_small_z_squared() {
    // z² = 0.01 (z = 0.1) → exp(-0.005) ≈ 0.99501
    let t = SCALE / 100;
    let result = exp_neg_half_approx(t);
    let expected = 995_012_479u128; // exp(-0.005) * SCALE
    let error = result.abs_diff(expected);
    assert!(
        error < expected / 100,
        "result={result}, expected={expected}, error={error}"
    );
}

// ── Monotonicity tests ────────────────────────────────────────

/// The approximation must be monotonically decreasing across the full range.
#[test]
fn test_exp_monotonically_decreasing() {
    let mut prev = exp_neg_half_approx(0);
    // Step through t from 0.1 to 25 in steps of 0.1
    for i in 1..250 {
        let t = SCALE * i / 10;
        let curr = exp_neg_half_approx(t);
        assert!(
            curr <= prev,
            "NOT monotonic at t={}.{}: prev={prev}, curr={curr}",
            i / 10,
            i % 10
        );
        prev = curr;
    }
}

/// No rebound: values for large z must be small, not clamped to SCALE.
#[test]
fn test_exp_no_rebound() {
    for z_10x in 20..=50 {
        // z from 2.0 to 5.0
        let z_sq_scaled = SCALE * (z_10x as u128) * (z_10x as u128) / 100;
        let result = exp_neg_half_approx(z_sq_scaled);
        assert!(
            result < SCALE / 2,
            "rebound at z={}.{}: result={result} (should be << SCALE)",
            z_10x / 10,
            z_10x % 10
        );
    }
}

// ── compute_bin_weights tests ─────────────────────────────────

#[test]
fn test_bin_weights_sum_to_scale() {
    let weights = compute_bin_weights(0, 1_000_000_000, 64, 500_000_000, 100_000_000);
    let sum: u64 = weights.iter().sum();
    assert_eq!(sum, SCALE as u64, "sum={sum}");
}

#[test]
fn test_bin_weights_symmetric() {
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 500_000_000, 100_000_000);
    let n = weights.len();
    for i in 0..n / 2 {
        let diff = weights[i].abs_diff(weights[n - 1 - i]);
        assert!(diff <= 10, "bin {i}: {} vs {}", weights[i], weights[n - 1 - i]);
    }
}

#[test]
fn test_bin_weights_narrow_sigma() {
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 500_000_000, 10_000_000);
    let center_weight = weights[5];
    let edge_weight = weights[0];
    assert!(
        center_weight > edge_weight * 10,
        "center={center_weight}, edge={edge_weight}"
    );
}

#[test]
fn test_bin_weights_wide_sigma() {
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 500_000_000, 10_000_000_000);
    let avg = SCALE as u64 / 10;
    for w in &weights {
        let diff = w.abs_diff(avg);
        assert!(diff < avg / 5, "w={w}, avg={avg}");
    }
}

#[test]
fn test_bin_weights_mu_at_edge() {
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 0, 100_000_000);
    assert!(
        weights[0] > weights[9],
        "first={}, last={}",
        weights[0],
        weights[9]
    );
}

#[test]
fn test_bin_weights_zero_sigma_returns_zeros() {
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 500_000_000, 0);
    assert!(weights.iter().all(|&w| w == 0));
}

#[test]
fn test_bin_weights_center_bin_is_max() {
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 500_000_000, 200_000_000);
    let max_weight = *weights.iter().max().unwrap();
    let center_idx = weights.iter().position(|&w| w == max_weight).unwrap();
    assert!(
        center_idx == 4 || center_idx == 5,
        "center bin idx={center_idx}, expected 4 or 5, weights={:?}",
        weights
    );
}

#[test]
fn test_bin_weights_mu_above_range() {
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 1_000_000_000, 100_000_000);
    assert!(
        weights[9] > weights[0],
        "last={}, first={}, weights={:?}",
        weights[9],
        weights[0],
        weights
    );
}

#[test]
fn test_bin_weights_negative_range() {
    let weights =
        compute_bin_weights(-1_000_000_000, 0, 10, -500_000_000, 100_000_000);
    let sum: u64 = weights.iter().sum();
    assert_eq!(sum, SCALE as u64, "sum={sum}");
    let n = weights.len();
    for i in 0..n / 2 {
        let diff = weights[i].abs_diff(weights[n - 1 - i]);
        assert!(diff <= 10, "bin {i}: {} vs {}", weights[i], weights[n - 1 - i]);
    }
}

/// With the lookup table fix, weights should decrease monotonically from
/// center outward across ALL bins, not just near the center.
#[test]
fn test_bin_weights_fully_monotonic_from_center() {
    let weights = compute_bin_weights(0, 1_000_000_000, 20, 500_000_000, 100_000_000);
    // Find peak bin.
    let (peak_idx, _) = weights.iter().enumerate().max_by_key(|&(_, &w)| w).unwrap();
    // Check monotonically decreasing to the right of peak.
    for i in peak_idx..weights.len() - 1 {
        assert!(
            weights[i] >= weights[i + 1],
            "non-monotonic right at bin {i}: {} < {}",
            weights[i],
            weights[i + 1]
        );
    }
    // Check monotonically decreasing to the left of peak.
    for i in (1..=peak_idx).rev() {
        assert!(
            weights[i] >= weights[i - 1],
            "non-monotonic left at bin {i}: {} < {}",
            weights[i],
            weights[i - 1]
        );
    }
}

/// Reproduce the scenario from BUG-002: 256 bins, mu=24.93, sigma=5.20.
/// Verify the result is bell-shaped, not a "Mexican hat".
#[test]
fn test_bin_weights_bug002_scenario() {
    let range_min = 0i64;
    let range_max = (100 * SCALE) as i64;
    let mu = (24_930_000_000u64) as i64; // 24.93 * SCALE
    let sigma = 5_200_000_000u64;        // 5.20 * SCALE
    let weights = compute_bin_weights(range_min, range_max, 256, mu, sigma);

    // Find the peak bin (should be near bin 63-64, i.e. value ~24.93).
    let (peak_idx, peak_w) = weights.iter().enumerate().max_by_key(|&(_, &w)| w).unwrap();
    assert!(
        (60..=68).contains(&peak_idx),
        "peak at bin {peak_idx}, expected ~63-64"
    );

    // Monotonically decreasing outward from peak.
    for i in peak_idx..weights.len() - 1 {
        if weights[i + 1] == 0 { break; }
        assert!(
            weights[i] >= weights[i + 1],
            "non-monotonic right at bin {i}: {} < {}",
            weights[i],
            weights[i + 1]
        );
    }
    for i in (1..=peak_idx).rev() {
        if weights[i - 1] == 0 { break; }
        assert!(
            weights[i] >= weights[i - 1],
            "non-monotonic left at bin {i}: {} < {}",
            weights[i],
            weights[i - 1]
        );
    }

    // Tail bins (far from mu) should have zero or very small weight.
    // Bin 130 corresponds to value ~50.8 — that's ~5 sigma away, should be 0.
    assert_eq!(weights[130], 0, "bin 130 should be 0, got {}", weights[130]);
    assert_eq!(weights[200], 0, "bin 200 should be 0, got {}", weights[200]);

    // Peak weight should be significantly larger than weight at ~2 sigma away.
    // 2 sigma = 10.4 range units = ~26.6 bins from peak.
    let two_sigma_bin = peak_idx + 27;
    if two_sigma_bin < 256 {
        assert!(
            *peak_w > weights[two_sigma_bin] * 5,
            "peak={peak_w}, 2sigma={}, expected peak >> 2sigma",
            weights[two_sigma_bin]
        );
    }
}

#[test]
fn test_bin_weights_two_bins() {
    let weights = compute_bin_weights(0, 1_000_000_000, 2, 500_000_000, 100_000_000);
    let sum: u64 = weights.iter().sum();
    assert_eq!(sum, SCALE as u64, "sum={sum}");
    assert_eq!(weights.len(), 2);
    let diff = weights[0].abs_diff(weights[1]);
    assert!(diff <= 10, "bins should be ~equal: {:?}", weights);
}
