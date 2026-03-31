"""Tests for all simulation metrics — original 8 plus revised versions."""
import numpy as np
import pytest
from config.params import SCALE
from engine.metrics import (
    kl_divergence, convergence_speed, compute_slippage,
    lp_profitability, manipulation_cost, resolution_fairness,
    boundary_sensitivity, exitability, composite_score,
    lp_deployability, resolution_fairness_benchmark,
    price_accuracy_revised, convergence_speed_revised,
    capital_efficiency_revised, manipulation_resistance_revised,
    boundary_sensitivity_revised, truthful_incentive_alignment,
)
from agents.base import ActionType, AMM_ACTIONS
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
        assert convergence_speed(kl_series, threshold=0.01) == 30

    def test_never_converged(self):
        kl_series = [0.5, 0.3, 0.2, 0.1, 0.05]
        assert convergence_speed(kl_series, threshold=0.01) == 50


class TestBoundarySensitivity:
    def test_wta_has_max_jump(self):
        payouts = compute_payout_wta(num_bins=64, resolved_bin=32)
        max_jump, mean_jump = boundary_sensitivity(payouts)
        assert max_jump == SCALE

    def test_kernel_has_low_jump(self):
        payouts = compute_payout_kernel(num_bins=64, resolved_bin=32, bandwidth=5)
        max_jump, mean_jump = boundary_sensitivity(payouts)
        assert max_jump < SCALE // 2


class TestLpProfitability:
    def test_uses_fees_minus_impermanent_loss(self):
        assert lp_profitability(fees_earned=20, capital_deposited=100, impermanent_loss=10) == 0.1

    def test_negative_impermanent_loss_increases_return(self):
        assert lp_profitability(fees_earned=20, capital_deposited=100, impermanent_loss=-5) == 0.25


class TestResolutionFairness:
    def test_ignores_traders_outside_window(self):
        fairness = resolution_fairness(
            trader_payouts=np.array([100, 0], dtype=np.int64),
            trader_distances=np.array([1, 10], dtype=np.int64),
            ideal_payouts=np.array([100, 100], dtype=np.int64),
            max_distance=5,
        )
        assert fairness == 0.0


class TestRevisedExitability:
    def test_returns_all_components(self):
        reserves, total_minted = init_reserves(16, 1_000_000_000)
        holdings = np.zeros(16, dtype=np.int64)
        holdings[8] = 10_000
        result = exitability(reserves, total_minted, holdings, 16, AMM_ACTIONS)
        assert "unwindable_fraction" in result
        assert "transaction_count" in result
        assert "slippage" in result
        assert "reposition_cost" in result
        assert "failure_rate" in result

    def test_bundle_only_worse_for_non_gaussian(self):
        reserves, total_minted = init_reserves(16, 1_000_000_000)
        holdings = np.zeros(16, dtype=np.int64)
        holdings[0] = 50_000
        holdings[15] = 50_000  # bimodal position
        bundle_only = frozenset({ActionType.BUNDLE_BUY, ActionType.BUNDLE_SELL})
        r_bundle = exitability(reserves.copy(), total_minted, holdings, 16, bundle_only)
        r_full = exitability(reserves.copy(), total_minted, holdings, 16, AMM_ACTIONS)
        assert r_bundle["unwindable_fraction"] <= r_full["unwindable_fraction"]


class TestLPDeployability:
    def test_not_activated(self):
        r = lp_deployability(0.0, 0, 0, 0.0)
        assert r["status"] == "not_activated"

    def test_activated(self):
        r = lp_deployability(0.5, 1_000_000, 50, 0.02, 20_000, 0.01)
        assert r["status"] == "activated"
        assert r["activation_rate"] == 0.5


class TestRevisedFairness:
    def test_benchmark_peak_at_resolved(self):
        b = resolution_fairness_benchmark(16, 8, max_distance=5)
        assert b[8] == pytest.approx(1.0)
        assert b[9] < b[8]
        assert b[14] == 0.0


class TestRevisedPriceAccuracy:
    def test_includes_time_series(self):
        r = price_accuracy_revised(0.02, [0.5, 0.3, 0.1, 0.05, 0.02])
        assert "combined" in r and r["combined"] > 0


class TestRevisedConvergence:
    def test_requires_sustained_window(self):
        # One-off dip should NOT count
        kl = [0.5, 0.3, 0.008, 0.2, 0.1, 0.05]
        r = convergence_speed_revised(kl, threshold=0.01, sustained_window=3)
        assert r > 20  # one-off at index 2 doesn't count


class TestRevisedCapitalEfficiency:
    def test_measures_local_depth(self):
        reserves, total_minted = init_reserves(16, 1_000_000_000)
        r = capital_efficiency_revised(reserves, total_minted, [7, 8, 9])
        assert "mean_local_slippage" in r and r["mean_local_slippage"] >= 0


class TestRevisedManipulationResistance:
    def test_both_costs(self):
        r = manipulation_resistance_revised(5000, 2.0, 0.5)
        assert r["cost_to_move"] > 0 and r["cost_to_profit"] > 0


class TestRevisedBoundarySensitivity:
    def test_wta_worse_than_kernel(self):
        r_wta = boundary_sensitivity_revised(compute_payout_wta(64, 32))
        r_kernel = boundary_sensitivity_revised(compute_payout_kernel(64, 32, 5))
        assert r_wta["max_payout_jump"] > r_kernel["max_payout_jump"]


class TestTruthfulIncentiveAlignment:
    def test_proper_scoring_rule_higher(self):
        true_dist = np.zeros(16, dtype=np.float64)
        true_dist[7:10] = [0.2, 0.6, 0.2]
        payouts_wta = compute_payout_wta(16, 8)
        score_wta = truthful_incentive_alignment(true_dist, payouts_wta, 16, 8)
        score_crps = truthful_incentive_alignment(true_dist, None, 16, 8, use_crps=True)
        assert score_crps >= score_wta

    def test_bounded_0_to_1(self):
        true_dist = np.zeros(16, dtype=np.float64)
        true_dist[8] = 1.0
        score = truthful_incentive_alignment(true_dist, compute_payout_wta(16, 8), 16, 8)
        assert 0.0 <= score <= 1.0


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
