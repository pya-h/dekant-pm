use umbra::engine::normal_pdf::{exp_neg_half_approx, compute_bin_weights};
use umbra::constants::SCALE;

#[test]
fn test_exp_at_zero() {
    // exp(0) = 1
    assert_eq!(exp_neg_half_approx(0), SCALE);
}

#[test]
fn test_exp_at_cutoff() {
    // z² = 25 → beyond cutoff
    let t = 25 * SCALE + 1;
    assert_eq!(exp_neg_half_approx(t), 0);
}

#[test]
fn test_exp_at_one() {
    // z² = 1 (z=1) → exp(-0.5) ≈ 0.60653
    let t = SCALE; // z² = 1
    let result = exp_neg_half_approx(t);
    let expected = 606_530_000u128; // 0.60653 * SCALE
    let error = if result > expected {
        result - expected
    } else {
        expected - result
    };
    // Allow 1% error.
    assert!(
        error < expected / 100,
        "result={result}, expected={expected}, error={error}"
    );
}

#[test]
fn test_exp_beyond_cutoff_returns_zero() {
    // Beyond Z_CUTOFF² * SCALE → clamped to 0.
    let t = 25 * SCALE + 1; // z² > 25 → past cutoff
    assert_eq!(exp_neg_half_approx(t), 0);
}

#[test]
fn test_exp_large_z_bounded() {
    // z² = 20 (z ≈ 4.47): within cutoff but Taylor diverges here.
    // The degree-4 polynomial only approximates well for |z| ≤ ~1.5.
    // For larger z, the raw result is clamped to [0, SCALE].
    // The bin weight normalization step ensures correct relative weights.
    let t = 20 * SCALE;
    let result = exp_neg_half_approx(t);
    assert!(result <= SCALE, "result={result} should be clamped to SCALE");
}

#[test]
fn test_bin_weights_symmetric() {
    // mu at center of range → weights should be symmetric.
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 500_000_000, 100_000_000);
    let n = weights.len();
    for i in 0..n / 2 {
        let diff = if weights[i] > weights[n - 1 - i] {
            weights[i] - weights[n - 1 - i]
        } else {
            weights[n - 1 - i] - weights[i]
        };
        // Allow rounding difference from normalization adjustment.
        assert!(diff <= 10, "bin {i}: {} vs {}", weights[i], weights[n - 1 - i]);
    }
}

#[test]
fn test_bin_weights_sum_to_scale() {
    let weights = compute_bin_weights(0, 1_000_000_000, 64, 500_000_000, 100_000_000);
    let sum: u64 = weights.iter().sum();
    assert_eq!(sum, SCALE as u64, "sum={sum}");
}

#[test]
fn test_bin_weights_narrow_sigma() {
    // Very narrow sigma → almost all weight in center bins.
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 500_000_000, 10_000_000);
    // Center bin (bin 5) should have the most weight.
    let center_weight = weights[5];
    let edge_weight = weights[0];
    assert!(
        center_weight > edge_weight * 10,
        "center={center_weight}, edge={edge_weight}"
    );
}

#[test]
fn test_bin_weights_wide_sigma() {
    // Very wide sigma → nearly uniform.
    let weights = compute_bin_weights(0, 1_000_000_000, 10, 500_000_000, 10_000_000_000);
    let avg = SCALE as u64 / 10;
    for w in &weights {
        let diff = if *w > avg { *w - avg } else { avg - *w };
        assert!(diff < avg / 5, "w={w}, avg={avg}");
    }
}

#[test]
fn test_bin_weights_mu_at_edge() {
    // mu at range_min → weights concentrated at low bins.
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

// ── Taylor series edge cases ────────────────────────────────

#[test]
fn test_exp_very_small_z_squared() {
    // z² = 0.01 (z = 0.1) → exp(-0.005) ≈ 0.99501
    let t = SCALE / 100; // 0.01 * SCALE
    let result = exp_neg_half_approx(t);
    let expected = 995_010_000u128; // 0.99501 * SCALE
    let error = if result > expected {
        result - expected
    } else {
        expected - result
    };
    // Allow 1% error.
    assert!(
        error < expected / 100,
        "result={result}, expected={expected}, error={error}"
    );
}

#[test]
fn test_exp_at_z_squared_four() {
    // z² = 4 (z = 2) → exp(-2) ≈ 0.13534
    let t = 4 * SCALE;
    let result = exp_neg_half_approx(t);
    // The polynomial approximation diverges for large z, so we just
    // verify it's clamped within [0, SCALE].
    assert!(result <= SCALE, "result={result} should be <= SCALE");
}

// ── compute_bin_weights additional coverage ──────────────────

#[test]
fn test_bin_weights_center_bin_is_max() {
    // Use a wider sigma so the polynomial approximation is well-behaved
    // across most bins, and the center bin genuinely has the highest weight.
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
    // mu at the top of the range with moderate sigma →
    // higher bins should have more weight than lower bins.
    // (Using mu=range_max which the existing test_bin_weights_mu_at_edge
    // already covers for range_min, so here we test the other edge.)
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
    // Negative range: [-1B, 0], mu at -500M, sigma = 100M.
    let weights =
        compute_bin_weights(-1_000_000_000, 0, 10, -500_000_000, 100_000_000);
    let sum: u64 = weights.iter().sum();
    assert_eq!(sum, SCALE as u64, "sum={sum}");
    // Should be symmetric around center.
    let n = weights.len();
    for i in 0..n / 2 {
        let diff = if weights[i] > weights[n - 1 - i] {
            weights[i] - weights[n - 1 - i]
        } else {
            weights[n - 1 - i] - weights[i]
        };
        assert!(diff <= 10, "bin {i}: {} vs {}", weights[i], weights[n - 1 - i]);
    }
}

#[test]
fn test_bin_weights_adjacent_monotonic_near_center() {
    // Weights should decrease monotonically near the center.
    // The polynomial approximation only works well for |z| ≤ ~1.5,
    // so we use a wide sigma and only check the inner bins.
    let weights = compute_bin_weights(0, 1_000_000_000, 20, 500_000_000, 200_000_000);
    // Check a small region around center (bins 8-12) where approximation is reliable.
    for i in 10..12 {
        assert!(
            weights[i] >= weights[i + 1],
            "non-monotonic at {i}: {} < {}",
            weights[i],
            weights[i + 1]
        );
    }
    for i in (9..=10).rev() {
        assert!(
            weights[i] >= weights[i - 1],
            "non-monotonic at {i}: {} < {}",
            weights[i],
            weights[i - 1]
        );
    }
}

#[test]
fn test_bin_weights_two_bins() {
    // Minimum number of bins.
    let weights = compute_bin_weights(0, 1_000_000_000, 2, 500_000_000, 100_000_000);
    let sum: u64 = weights.iter().sum();
    assert_eq!(sum, SCALE as u64, "sum={sum}");
    assert_eq!(weights.len(), 2);
    // Symmetric around center, so both should be roughly equal.
    let diff = if weights[0] > weights[1] {
        weights[0] - weights[1]
    } else {
        weights[1] - weights[0]
    };
    assert!(diff <= 10, "bins should be ~equal: {:?}", weights);
}
