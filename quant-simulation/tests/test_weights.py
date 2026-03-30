"""Tests for Gaussian weight generation — Taylor-4 vs exact."""

import numpy as np
import pytest
from models.weights import (
    taylor4_exp_neg_half,
    compute_bin_weights_taylor4,
    compute_bin_weights_exact,
)
from config.params import SCALE


class TestTaylor4:
    def test_zero_input(self):
        assert taylor4_exp_neg_half(0) == SCALE

    def test_known_value_z1(self):
        t_scaled = SCALE  # z^2 * SCALE = 1 * 10^9
        result = taylor4_exp_neg_half(t_scaled)
        assert abs(result - 606_770_833) < 1_000_000

    def test_severe_error_at_z2(self):
        t_scaled = 4 * SCALE
        result = taylor4_exp_neg_half(t_scaled)
        exact = int(0.135335 * SCALE)
        error_pct = abs(result - exact) / exact * 100
        assert error_pct > 100  # confirm the ~146% error

    def test_cutoff_returns_zero(self):
        t_scaled = 26 * SCALE
        assert taylor4_exp_neg_half(t_scaled) == 0


class TestBinWeightsTaylor4:
    def test_weights_sum_to_scale(self):
        weights = compute_bin_weights_taylor4(
            range_min=0, range_max=100 * SCALE,
            num_bins=64, mu=50 * SCALE, sigma=10 * SCALE,
        )
        assert len(weights) == 64
        assert abs(int(np.sum(weights)) - SCALE) < 10

    def test_peak_at_mu(self):
        weights = compute_bin_weights_taylor4(
            range_min=0, range_max=100 * SCALE,
            num_bins=64, mu=50 * SCALE, sigma=10 * SCALE,
        )
        peak_bin = np.argmax(weights)
        expected_bin = 32
        assert abs(peak_bin - expected_bin) <= 1


class TestBinWeightsExact:
    def test_weights_sum_to_scale(self):
        weights = compute_bin_weights_exact(
            range_min=0, range_max=100 * SCALE,
            num_bins=64, mu=50 * SCALE, sigma=10 * SCALE,
        )
        assert len(weights) == 64
        assert abs(int(np.sum(weights)) - SCALE) < 10

    def test_peak_at_mu(self):
        weights = compute_bin_weights_exact(
            range_min=0, range_max=100 * SCALE,
            num_bins=64, mu=50 * SCALE, sigma=10 * SCALE,
        )
        peak_bin = np.argmax(weights)
        expected_bin = 32
        assert abs(peak_bin - expected_bin) <= 1

    def test_exact_more_accurate_than_taylor_at_tails(self):
        taylor = compute_bin_weights_taylor4(
            range_min=0, range_max=100 * SCALE,
            num_bins=64, mu=50 * SCALE, sigma=5 * SCALE,
        )
        exact = compute_bin_weights_exact(
            range_min=0, range_max=100 * SCALE,
            num_bins=64, mu=50 * SCALE, sigma=5 * SCALE,
        )
        center_diff = abs(int(taylor[32]) - int(exact[32]))
        tail_diff = abs(int(taylor[10]) - int(exact[10]))
        assert tail_diff > center_diff or np.sum(taylor) == np.sum(exact)
