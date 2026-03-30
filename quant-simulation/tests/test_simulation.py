"""Tests for simulation engine and sweep orchestration."""
import numpy as np
import pytest
from config.params import DESIGN_BASELINE_A, DESIGN_BASELINE_B, DESIGN_PIECEWISE, FEE_FLAT, SCALE
from engine.simulation import SimulationRun, MarketState


class TestMarketState:
    def test_market_state_creation(self):
        reserves = np.full(16, 900_000_000, dtype=np.int64)
        state = MarketState(
            reserves=reserves,
            total_minted=1_000_000_000,
            range_min=0,
            range_max=100 * SCALE,
            num_bins=16,
            lp_fee_accumulated=0,
            protocol_fee_accumulated=0,
        )
        assert len(state.reserves) == 16
        assert state.total_minted == 1_000_000_000
        assert state.lp_fee_accumulated == 0


class TestSimulationRun:
    def test_init_creates_valid_state(self):
        sim = SimulationRun(design=DESIGN_BASELINE_A, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=50, seed=42)
        state = sim.state
        assert len(state.reserves) == 16
        assert state.total_minted == 1_000_000_000

    def test_run_completes(self):
        sim = SimulationRun(design=DESIGN_BASELINE_B, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42)
        results = sim.run()
        assert "price_accuracy" in results
        assert "convergence_speed" in results
        assert "boundary_sensitivity_max" in results
        assert "boundary_sensitivity_mean" in results
        assert results["num_rounds"] == 20

    def test_different_seeds_give_different_results(self):
        results_a = SimulationRun(design=DESIGN_BASELINE_A, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=1).run()
        results_b = SimulationRun(design=DESIGN_BASELINE_A, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=2).run()
        assert results_a["price_accuracy"] != results_b["price_accuracy"]

    def test_baseline_a_vs_b_uses_different_weights(self):
        sim_a = SimulationRun(design=DESIGN_BASELINE_A, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=10, seed=42)
        sim_b = SimulationRun(design=DESIGN_BASELINE_B, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=10, seed=42)
        assert sim_a.weight_fn != sim_b.weight_fn

    def test_results_contain_all_expected_keys(self):
        sim = SimulationRun(design=DESIGN_PIECEWISE, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42)
        results = sim.run()
        expected_keys = [
            "price_accuracy", "convergence_speed", "capital_efficiency",
            "lp_profitability", "manipulation_resistance", "resolution_fairness",
            "boundary_sensitivity_max", "boundary_sensitivity_mean",
            "exitability_unwind", "exitability_slippage",
            "num_rounds", "design", "fee_model", "resolved_bin", "kl_series",
        ]
        for key in expected_keys:
            assert key in results, f"Missing key: {key}"

    def test_kl_series_recorded(self):
        sim = SimulationRun(design=DESIGN_BASELINE_A, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=30, seed=42)
        results = sim.run()
        assert len(results["kl_series"]) > 0

    def test_resolved_bin_in_range(self):
        sim = SimulationRun(design=DESIGN_BASELINE_A, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42)
        results = sim.run()
        assert 0 <= results["resolved_bin"] < 16
