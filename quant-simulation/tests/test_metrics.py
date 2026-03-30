"""Tests for the 8 simulation metrics."""
import numpy as np
import pytest
from config.params import SCALE
from engine.metrics import (
    kl_divergence, convergence_speed, compute_slippage,
    lp_profitability, manipulation_cost, resolution_fairness,
    boundary_sensitivity, exitability, composite_score,
)
from models.math_engine import init_reserves, compute_probabilities, compute_buy
from models.settlement_baseline import compute_payout_wta
from models.settlement_kernel import compute_payout_kernel


class TestKLDivergence:
    def test_identical_distributions(self):
        p = np.array([0.25, 0.25, 0.25, 0.25])
        assert kl_divergence(p, p) == pytest.approx(0.0, abs=1e-10)

    def test_different_distributions(self):
        p = np.array([0.5, 0.3, 0.1, 0.1])
        q = np.array([0.25, 0.25, 0.25, 0.25])
        assert kl_divergence(p, q) > 0

    def test_handles_zeros(self):
        p = np.array([0.0, 1.0, 0.0, 0.0])
        q = np.array([0.25, 0.25, 0.25, 0.25])
        result = kl_divergence(p, q)
        assert result >= 0


class TestConvergenceSpeed:
    def test_detects_convergence(self):
        kl_series = [0.5, 0.2, 0.05, 0.008, 0.005]
        assert convergence_speed(kl_series, threshold=0.01) == 3

    def test_never_converged(self):
        kl_series = [0.5, 0.3, 0.2, 0.1, 0.05]
        assert convergence_speed(kl_series, threshold=0.01) == 5


class TestBoundarySensitivity:
    def test_wta_has_max_jump(self):
        payouts = compute_payout_wta(num_bins=64, resolved_bin=32)
        max_jump, mean_jump = boundary_sensitivity(payouts)
        assert max_jump == SCALE

    def test_kernel_has_low_jump(self):
        payouts = compute_payout_kernel(num_bins=64, resolved_bin=32, bandwidth=5)
        max_jump, mean_jump = boundary_sensitivity(payouts)
        assert max_jump < SCALE // 2


class TestCompositeScore:
    def test_weighted_sum(self):
        metrics = {
            "price_accuracy": 0.5,
            "convergence_speed": 0.3,
            "capital_efficiency": 0.7,
            "lp_profitability": 0.4,
            "manipulation_resistance": 0.6,
            "resolution_fairness": 0.8,
            "boundary_sensitivity": 0.9,
            "exitability": 0.5,
        }
        score = composite_score(metrics)
        assert 0 <= score <= 1
