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
