"""Tests for all settlement/payout functions."""
import numpy as np
import pytest
from config.params import SCALE, DEFAULT_NUM_BINS, DEFAULT_TARGET_PAYOUT_WIDTH
from models.settlement_baseline import compute_payout_wta
from models.settlement_piecewise import compute_payout_piecewise, compute_dynamic_bandwidth
from models.settlement_kernel import compute_payout_kernel
from models.settlement_scalar import compute_payout_scalar
from models.settlement_crps import compute_payout_crps

class TestWinnerTakeAll:
    def test_winning_bin_gets_all(self):
        payouts = compute_payout_wta(num_bins=10, resolved_bin=5)
        assert payouts[5] == SCALE
        assert np.sum(payouts) == SCALE

    def test_other_bins_get_zero(self):
        payouts = compute_payout_wta(num_bins=10, resolved_bin=5)
        for i in range(10):
            if i != 5:
                assert payouts[i] == 0

class TestDynamicBandwidth:
    def test_w5_at_256_bins(self):
        w = compute_dynamic_bandwidth(num_bins=256, range_span=100 * SCALE, target_payout_width=DEFAULT_TARGET_PAYOUT_WIDTH)
        assert w == 5

    def test_scales_with_bins(self):
        w_256 = compute_dynamic_bandwidth(256, 100 * SCALE, DEFAULT_TARGET_PAYOUT_WIDTH)
        w_64 = compute_dynamic_bandwidth(64, 100 * SCALE, DEFAULT_TARGET_PAYOUT_WIDTH)
        assert w_64 < w_256 or w_64 == 1

    def test_minimum_one(self):
        w = compute_dynamic_bandwidth(2, 100 * SCALE, DEFAULT_TARGET_PAYOUT_WIDTH)
        assert w >= 1

class TestPiecewiseLinear:
    def test_winning_bin_gets_max(self):
        payouts = compute_payout_piecewise(num_bins=256, resolved_bin=128, bandwidth=5)
        assert payouts[128] == max(payouts)

    def test_linear_decay(self):
        payouts = compute_payout_piecewise(num_bins=256, resolved_bin=128, bandwidth=5)
        assert payouts[128] > payouts[129] > payouts[130] > payouts[131]

    def test_zero_beyond_bandwidth(self):
        payouts = compute_payout_piecewise(num_bins=256, resolved_bin=128, bandwidth=5)
        assert payouts[134] == 0

    def test_payouts_sum_correctly(self):
        payouts = compute_payout_piecewise(num_bins=256, resolved_bin=128, bandwidth=5)
        assert int(np.sum(payouts)) == SCALE

class TestKernelSmoothed:
    def test_winning_bin_gets_max(self):
        payouts = compute_payout_kernel(num_bins=256, resolved_bin=128, bandwidth=5)
        assert payouts[128] == max(payouts)

    def test_smooth_decay(self):
        payouts = compute_payout_kernel(num_bins=256, resolved_bin=128, bandwidth=5)
        assert payouts[128] > payouts[129] > payouts[130]

    def test_no_hard_cutoff(self):
        payouts = compute_payout_kernel(num_bins=256, resolved_bin=128, bandwidth=5)
        assert payouts[138] > 0

    def test_payouts_normalized(self):
        payouts = compute_payout_kernel(num_bins=256, resolved_bin=128, bandwidth=5)
        assert int(np.sum(payouts)) == SCALE

class TestScalar:
    def test_uses_implied_probabilities(self):
        probs = np.array([500_000_000, 300_000_000, 200_000_000], dtype=np.int64)
        payouts = compute_payout_scalar(probs)
        assert payouts[0] > payouts[1] > payouts[2]

    def test_payouts_sum_to_scale(self):
        probs = np.array([500_000_000, 300_000_000, 200_000_000], dtype=np.int64)
        payouts = compute_payout_scalar(probs)
        assert abs(int(np.sum(payouts)) - SCALE) < 10

class TestCRPS:
    def test_rewards_accurate_forecast(self):
        num_bins = 64
        resolved_bin = 32
        holdings_a = np.zeros(num_bins, dtype=np.int64)
        holdings_a[30:35] = 1_000_000
        holdings_b = np.zeros(num_bins, dtype=np.int64)
        holdings_b[0:5] = 1_000_000
        payout_a = compute_payout_crps(holdings_a, resolved_bin, num_bins)
        payout_b = compute_payout_crps(holdings_b, resolved_bin, num_bins)
        assert payout_a > payout_b

    def test_perfect_prediction_gets_max(self):
        num_bins = 64
        resolved_bin = 32
        holdings = np.zeros(num_bins, dtype=np.int64)
        holdings[resolved_bin] = 1_000_000
        payout = compute_payout_crps(holdings, resolved_bin, num_bins)
        assert payout > 0
