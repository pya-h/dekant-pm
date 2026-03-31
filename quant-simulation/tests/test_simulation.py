"""Tests for simulation engine and sweep orchestration."""
from collections import Counter

import numpy as np
import pytest
from config.params import (
    DESIGN_BASELINE_A,
    DESIGN_BASELINE_B,
    DESIGN_PIECEWISE,
    DESIGN_CLOB,
    DESIGN_CRPS,
    DESIGN_KERNEL,
    DESIGN_SCALAR,
    FEE_FLAT,
    SCALE,
    AgentMix,
    DEFAULT_NUM_BINS,
    DEFAULT_INITIAL_LIQUIDITY,
)
from config.scenarios import TRUTH_FAMILIES
from engine.simulation import SimulationRun, MarketState
from agents.lp import PassiveLP, RebalancingLP


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
    def test_defaults_follow_config(self):
        sim = SimulationRun(design=DESIGN_BASELINE_A, fee_model=FEE_FLAT)
        assert sim.num_bins == DEFAULT_NUM_BINS
        assert sim.initial_liquidity == DEFAULT_INITIAL_LIQUIDITY

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

    def test_baseline_a_vs_b_produce_different_results(self):
        sim_a = SimulationRun(design=DESIGN_BASELINE_A, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42)
        sim_b = SimulationRun(design=DESIGN_BASELINE_B, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42)
        results_a = sim_a.run()
        results_b = sim_b.run()
        assert results_a["price_accuracy"] != results_b["price_accuracy"]

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

    def test_clob_generates_fills_and_quotes(self):
        sim = SimulationRun(design=DESIGN_CLOB, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42)
        results = sim.run()
        assert results["clob_total_orders"] > 0
        assert results["clob_total_fills"] > 0
        assert sim.state.clob_implied_probs is not None

    def test_resolved_bin_in_range(self):
        sim = SimulationRun(design=DESIGN_BASELINE_A, fee_model=FEE_FLAT, num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42)
        results = sim.run()
        assert 0 <= results["resolved_bin"] < 16

    def test_default_agent_mix_preserves_specified_counts(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_A,
            fee_model=FEE_FLAT,
            num_bins=16,
            initial_liquidity=1_000_000_000,
            num_rounds=1,
            seed=42,
        )
        counts = Counter(type(agent).__name__ for agent in sim.agents)
        assert counts == Counter(
            {
                "NoiseTrader": 45,
                "InformedTrader": 25,
                "Arbitrageur": 13,
                "Manipulator": 5,
                "LateRoundWhale": 2,
                "PassiveLP": 5,
                "RebalancingLP": 5,
            }
        )

    def test_manipulator_and_whale_default_targets_scale_with_bin_count(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_A,
            fee_model=FEE_FLAT,
            num_bins=16,
            initial_liquidity=1_000_000_000,
            num_rounds=1,
            seed=42,
        )
        manip_targets = {agent.target_bin for agent in sim.agents if agent.__class__.__name__ == "Manipulator"}
        whale_targets = {agent.target_bin for agent in sim.agents if agent.__class__.__name__ == "LateRoundWhale"}
        assert manip_targets == {8}
        assert whale_targets == {8}

    def test_rebalancing_lp_fee_share_uses_activity_alignment(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_A,
            fee_model=FEE_FLAT,
            num_bins=16,
            initial_liquidity=1_000_000_000,
            num_rounds=20,
            seed=42,
        )

        deposited_per_agent = 1_000_000
        for agent in sim.agents:
            if isinstance(agent, (PassiveLP, RebalancingLP)):
                agent.yield_threshold = 1.0
                agent.loss_tolerance = 1.0
                sim.agent_states[agent.agent_id].deposited_lp = deposited_per_agent
                if isinstance(agent, RebalancingLP):
                    weights = np.zeros(sim.num_bins, dtype=np.float64)
                    weights[0] = 1.0
                    agent.last_weights = weights

        n_passive = sum(isinstance(agent, PassiveLP) for agent in sim.agents)
        n_rebal = sum(isinstance(agent, RebalancingLP) for agent in sim.agents)
        sim.state.passive_lp_deposited = n_passive * deposited_per_agent
        sim.state.rebalancing_lp_deposited = n_rebal * deposited_per_agent
        sim.state.lp_fee_accumulated = 1_000_000

        activity = np.zeros(sim.num_bins, dtype=np.int64)
        activity[0] = 100
        sim._process_lp_agents(round_num=10, activity_counts=activity)

        assert sim.state.rebalancing_lp_fees > sim.state.passive_lp_fees

    def test_zero_weight_agent_mix_does_not_create_disabled_agent_types(self):
        mix = AgentMix(
            noise=0.80,
            informed=0.10,
            arbitrageur=0.05,
            manipulator=0.03,
            late_round_whale=0.02,
            lp_passive=0.0,
            lp_rebalancing=0.0,
        )
        sim = SimulationRun(
            design=DESIGN_BASELINE_A,
            fee_model=FEE_FLAT,
            num_bins=16,
            initial_liquidity=1_000_000_000,
            num_rounds=5,
            seed=42,
            agent_mix=mix,
        )
        counts = Counter(type(agent).__name__ for agent in sim.agents)
        assert counts["PassiveLP"] == 0
        assert counts["RebalancingLP"] == 0

    def test_results_contain_scenario_metadata(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        results = sim.run()
        assert "scenario_family" in results
        assert "belief_family" in results
        assert "red_team_only" in results
        assert results["scenario_family"] in TRUTH_FAMILIES


class TestScenarioIntegration:
    def test_simulation_accepts_scenario_family(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
            scenario_family="bimodal",
        )
        results = sim.run()
        assert results["scenario_family"] == "bimodal"

    def test_different_scenarios_produce_different_results(self):
        r1 = SimulationRun(
            design=DESIGN_BASELINE_B, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
            scenario_family="gaussian_center",
        ).run()
        r2 = SimulationRun(
            design=DESIGN_BASELINE_B, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
            scenario_family="skewed",
        ).run()
        assert r1["price_accuracy"] != r2["price_accuracy"]


class TestDesignAwareIncentives:
    def test_different_designs_produce_different_trade_paths(self):
        designs = [DESIGN_BASELINE_B, DESIGN_PIECEWISE, DESIGN_KERNEL, DESIGN_CRPS]
        kl_by_design = {}
        for d in designs:
            sim = SimulationRun(
                design=d, fee_model=FEE_FLAT,
                num_bins=16, initial_liquidity=1_000_000_000, num_rounds=30, seed=42,
            )
            results = sim.run()
            kl_by_design[d] = results["price_accuracy"]
        values = list(kl_by_design.values())
        assert len(set(round(v, 6) for v in values)) > 1


class TestScalarRedTeam:
    def test_scalar_marked_red_team(self):
        sim = SimulationRun(
            design=DESIGN_SCALAR, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        results = sim.run()
        assert results.get("red_team_only") is True
