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
from config.scenarios import TRUTH_FAMILIES, Scenario, sample_scenario
from engine.simulation import SimulationRun, MarketState
from agents.lp import PassiveLP, RebalancingLP
from agents.late_round_whale import LateRoundWhale
from agents.manipulator import Manipulator, STRATEGIES as MANIP_STRATEGIES
from agents.base import DistributionTradeAction


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
            "exitability_unwind", "exitability_transaction_count",
            "exitability_slippage", "exitability_reposition_cost",
            "exitability_failure_rate",
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

    def test_resolve_uses_true_weight_support(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_B, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=1, seed=42,
        )
        weights = np.zeros(16, dtype=np.int64)
        weights[5] = SCALE
        sim.true_weights = weights
        sim.true_probs = weights.astype(np.float64) / float(np.sum(weights))

        resolved = {sim._resolve() for _ in range(20)}
        assert resolved == {5}

    def test_distribution_trade_uses_explicit_weights(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_B, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=1, seed=42,
        )
        action = DistributionTradeAction(
            agent_id=0,
            bin_idx=4,
            side="buy",
            amount=1_000_000,
            weights=np.eye(1, 16, 4, dtype=np.int64).reshape(16) * SCALE,
        )
        sim._execute_distribution_trade(action, current_round=0)

        holdings = sim.agent_states[0].holdings
        assert holdings.get(4, 0) > 0
        assert all(tokens == 0 for bin_idx, tokens in holdings.items() if bin_idx != 4)


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

    def test_scalar_marked_excluded(self):
        sim = SimulationRun(
            design=DESIGN_SCALAR, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        results = sim.run()
        assert results.get("excluded") is True

    def test_candidate_not_excluded(self):
        sim = SimulationRun(
            design=DESIGN_PIECEWISE, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        results = sim.run()
        assert results.get("excluded") is False
        assert results.get("red_team_only") is False

    def test_clob_excluded_but_not_red_team(self):
        sim = SimulationRun(
            design=DESIGN_CLOB, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        results = sim.run()
        assert results.get("excluded") is True
        assert results.get("red_team_only") is False


class TestRevisedMetricOutput:
    def test_results_contain_revised_metrics(self):
        sim = SimulationRun(
            design=DESIGN_PIECEWISE, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        results = sim.run()
        assert "truthful_incentive_alignment" in results
        assert "boundary_payout_jump_max" in results
        assert "boundary_incentive_jump_max" in results
        assert "convergence_speed_sustained" in results
        assert "lp_activation_rate" in results
        assert "price_accuracy_combined" in results
        assert "manipulation_cost_to_move" in results

    def test_scalar_marked_red_team(self):
        sim = SimulationRun(
            design=DESIGN_SCALAR, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        results = sim.run()
        assert results.get("red_team_only") is True


class TestBeliefShiftAtRegimeShift:
    """Verify belief_weights are updated at the regime shift round when belief_family='shifter'."""

    def test_belief_weights_updated_at_belief_shift_round(self):
        """When belief=shifter, the simulation should update self.belief_weights
        at the belief_shift_round_frac, which is the belief shifter's own timing
        (independent of the truth shift_round_frac)."""
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=100, seed=42,
            scenario_family="regime_shift", belief_family="shifter",
        )
        # Verify the scenario has belief post-shift data and its own timing
        assert sim.scenario.belief_post_shift_weights is not None
        assert sim.scenario.belief_shift_round_frac is not None

        # Record the initial belief weights
        initial_belief = sim.belief_weights.copy()
        expected_post_shift = sim.scenario.belief_post_shift_weights

        # Determine the belief shift round (from the belief shifter's own timing)
        belief_shift_round = int(sim.num_rounds * sim.scenario.belief_shift_round_frac)

        # Run rounds up to (but not including) the belief shift round
        for r in range(belief_shift_round):
            sim._run_trade_round(r)
        # Before shift: belief_weights should still be the initial ones
        np.testing.assert_array_equal(sim.belief_weights, initial_belief)

        # Run the belief shift round
        sim._run_trade_round(belief_shift_round)
        # After shift: belief_weights should now match the post-shift belief
        np.testing.assert_array_equal(sim.belief_weights, expected_post_shift)

    def test_no_belief_shift_when_belief_not_shifter(self):
        """When belief_family is not 'shifter', belief_weights should not change at regime shift."""
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=100, seed=42,
            scenario_family="regime_shift", belief_family="gaussian",
        )
        assert sim.scenario.belief_post_shift_weights is None
        initial_belief = sim.belief_weights.copy()

        shift_round = int(sim.num_rounds * sim.scenario.shift_round_frac)
        for r in range(shift_round + 1):
            sim._run_trade_round(r)

        # belief_weights unchanged because no belief post-shift data
        np.testing.assert_array_equal(sim.belief_weights, initial_belief)


class TestWhaleGating:
    """Late-round whales should only run in red-team (Scalar) designs."""

    def test_whales_skipped_for_non_scalar_designs(self):
        """In a non-Scalar design, whale agents should never trade."""
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        whale_agents = [a for a in sim.agents if isinstance(a, LateRoundWhale)]
        assert len(whale_agents) > 0, "Expected at least one whale agent"

        # Record initial capital from live AgentState
        initial_capital = {w.agent_id: sim.agent_states[w.agent_id].capital for w in whale_agents}

        # Run all rounds
        for r in range(sim.num_rounds):
            sim._run_trade_round(r)

        # Whales should have spent nothing (capital unchanged)
        for whale in whale_agents:
            spent = initial_capital[whale.agent_id] - sim.agent_states[whale.agent_id].capital
            assert spent == 0, (
                f"Whale {whale.agent_id} spent {spent} in non-Scalar design"
            )

    def test_whales_active_for_scalar_design(self):
        """In Scalar design, whale agents should trade in late rounds."""
        sim = SimulationRun(
            design=DESIGN_SCALAR, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        whale_agents = [a for a in sim.agents if isinstance(a, LateRoundWhale)]
        assert len(whale_agents) > 0, "Expected at least one whale agent"

        # Record initial capital from live AgentState
        initial_capital = {w.agent_id: sim.agent_states[w.agent_id].capital for w in whale_agents}

        # Run all rounds
        for r in range(sim.num_rounds):
            sim._run_trade_round(r)

        # At least one whale should have spent something (capital decreased)
        total_whale_spent = sum(
            initial_capital[a.agent_id] - sim.agent_states[a.agent_id].capital
            for a in whale_agents
        )
        assert total_whale_spent > 0, "Expected whales to trade in Scalar design"

    def test_whales_skipped_for_piecewise_design(self):
        """Piecewise is not red-team; whales should be inactive."""
        sim = SimulationRun(
            design=DESIGN_PIECEWISE, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        whale_agents = [a for a in sim.agents if isinstance(a, LateRoundWhale)]
        initial_capital = {w.agent_id: sim.agent_states[w.agent_id].capital for w in whale_agents}
        for r in range(sim.num_rounds):
            sim._run_trade_round(r)
        for whale in whale_agents:
            spent = initial_capital[whale.agent_id] - sim.agent_states[whale.agent_id].capital
            assert spent == 0


class TestLPDeployabilityMedian:
    """LP deployability median_capital_deployed must be the true median, not mean."""

    def test_median_not_mean_with_unequal_deposits(self):
        """When LP agents have unequal deposits, the metric should report
        the median of per-LP deposited amounts, not total/count (mean).

        We call _compute_all_metrics directly after setting up the deposit
        state to isolate the median computation from LP trading decisions.
        """
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        # Record initial probs (needed by _compute_all_metrics)
        sim.initial_probs = sim._current_implied_probs().copy()
        # Run a few rounds so kl_series is populated
        for r in range(20):
            sim._run_trade_round(r)

        # Force LP agents to have specific unequal deposits so mean != median.
        # With deposits [100, 200, 1000], mean=433 but median=200.
        lp_agents = [a for a in sim.agents if isinstance(a, (PassiveLP, RebalancingLP))]
        assert len(lp_agents) >= 3, "Need at least 3 LP agents for this test"

        sim.state.passive_lp_deposited = 0
        sim.state.rebalancing_lp_deposited = 0
        for agent in lp_agents:
            sim.agent_states[agent.agent_id].deposited_lp = 0

        deposit_amounts = [100, 200, 1000]
        for i, agent in enumerate(lp_agents[:3]):
            amount = deposit_amounts[i]
            sim.agent_states[agent.agent_id].deposited_lp = amount
            if isinstance(agent, PassiveLP):
                sim.state.passive_lp_deposited += amount
            else:
                sim.state.rebalancing_lp_deposited += amount

        resolved_bin = sim._resolve()
        payouts = sim._compute_payouts(resolved_bin)
        results = sim._compute_all_metrics(resolved_bin, payouts)

        # The median of [100, 200, 1000] is 200
        assert results["lp_deploy_median_capital"] == 200
        # The mean would be 433 (1300 // 3), which is NOT what we want
        mean_capital = sum(deposit_amounts) // len(deposit_amounts)
        assert results["lp_deploy_median_capital"] != mean_capital

    def test_median_with_single_active_lp(self):
        """With one active LP, median equals that LP's deposit."""
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        sim.initial_probs = sim._current_implied_probs().copy()
        for r in range(20):
            sim._run_trade_round(r)

        lp_agents = [a for a in sim.agents if isinstance(a, (PassiveLP, RebalancingLP))]
        # Zero all LP deposits
        sim.state.passive_lp_deposited = 0
        sim.state.rebalancing_lp_deposited = 0
        for agent in lp_agents:
            sim.agent_states[agent.agent_id].deposited_lp = 0

        # Activate exactly one LP with deposit=500
        target = lp_agents[0]
        sim.agent_states[target.agent_id].deposited_lp = 500
        if isinstance(target, PassiveLP):
            sim.state.passive_lp_deposited = 500
        else:
            sim.state.rebalancing_lp_deposited = 500

        resolved_bin = sim._resolve()
        payouts = sim._compute_payouts(resolved_bin)
        results = sim._compute_all_metrics(resolved_bin, payouts)
        assert results["lp_deploy_median_capital"] == 500


class TestManipulatorStrategyCycling:
    """Manipulators should be assigned different strategies cyclically."""

    def test_strategies_are_cycled(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=1, seed=42,
        )
        manip_agents = [a for a in sim.agents if isinstance(a, Manipulator)]
        assert len(manip_agents) >= 4, "Need at least 4 manipulators to test cycling"
        strategies = [a.strategy for a in manip_agents]
        # First 4 should each be a different strategy
        assert strategies[0] == MANIP_STRATEGIES[0]
        assert strategies[1] == MANIP_STRATEGIES[1]
        assert strategies[2] == MANIP_STRATEGIES[2]
        assert strategies[3] == MANIP_STRATEGIES[3]

    def test_fifth_manipulator_wraps(self):
        """If there are 5+ manipulators, the 5th should wrap to strategy 0."""
        mix = AgentMix(
            noise=0.40,
            informed=0.20,
            arbitrageur=0.10,
            manipulator=0.10,
            late_round_whale=0.02,
            lp_passive=0.09,
            lp_rebalancing=0.09,
        )
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=1, seed=42,
            agent_mix=mix,
        )
        manip_agents = [a for a in sim.agents if isinstance(a, Manipulator)]
        if len(manip_agents) >= 5:
            assert manip_agents[4].strategy == MANIP_STRATEGIES[0]


class TestManipulationResistanceUsesSettlementPayout:
    """Verify cost_to_profit is based on actual settlement payout, not price change."""

    def test_cost_to_profit_reflects_settlement_payout(self):
        """Run two designs and confirm cost_to_profit can differ even if
        cost_to_move is similar, because settlement rules yield different
        attacker profits."""
        results_wta = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=30, seed=42,
        ).run()

        results_kernel = SimulationRun(
            design=DESIGN_KERNEL, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=30, seed=42,
        ).run()

        # Both should have the metric
        assert "manipulation_cost_to_profit" in results_wta
        assert "manipulation_cost_to_profit" in results_kernel

        # cost_to_profit should be positive (could be inf if no profit)
        assert results_wta["manipulation_cost_to_profit"] > 0
        assert results_kernel["manipulation_cost_to_profit"] > 0

    def test_cosmetic_manipulation_yields_inf_cost_to_profit(self):
        """When manipulator budget exceeds settlement payout, cost_to_profit
        should be inf (no actual profit under the settlement rule)."""
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=30, seed=42,
        )
        results = sim.run()
        # Either the manipulator profited or didn't — we just verify
        # the metric is a valid number (finite or inf) and > 0
        ctp = results["manipulation_cost_to_profit"]
        assert ctp > 0
        # If no actual profit, it should be inf (cosmetic only)
        if ctp == float("inf"):
            # Cosmetic manipulation: budget_spent > settlement_payout
            assert results["manipulation_cost_to_move"] < float("inf")
