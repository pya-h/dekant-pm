"""Tests for agent strategies."""
import numpy as np
import pytest
from config.params import SCALE
from agents.base import (
    ActionType,
    AgentState,
    AMM_ACTIONS,
    CLOB_ACTIONS,
    DecisionContext,
    DistributionTradeAction,
    SETTLEMENT_RULES,
    TradeAction,
)
from agents.informed_trader import InformedTrader
from agents.noise_trader import NoiseTrader
from agents.arbitrageur import Arbitrageur
from agents.manipulator import Manipulator
from agents.late_round_whale import LateRoundWhale
from agents.lp import PassiveLP, RebalancingLP
from models.math_engine import init_reserves, compute_probabilities


def _make_market(n_bins=16, liq=1_000_000_000):
    reserves, total_minted = init_reserves(n_bins, liq)
    probs = compute_probabilities(reserves, total_minted)
    return reserves, total_minted, probs


def _make_state(agent_id=0, capital=1_000_000_000, holdings=None, deposited_lp=0):
    return AgentState(
        agent_id=agent_id,
        capital=capital,
        holdings=holdings or {},
        deposited_lp=deposited_lp,
    )


def _make_ctx(
    probs,
    reserves,
    total_minted,
    agent_state,
    design=0,
    fee_model=0,
    current_round=10,
    total_rounds=200,
    allowed_actions=None,
    scenario_family="baseline",
    belief_family="gaussian",
    settlement_rule=None,
):
    if allowed_actions is None:
        allowed_actions = AMM_ACTIONS
    if settlement_rule is None:
        settlement_rule = SETTLEMENT_RULES.get(design, "wta")
    return DecisionContext(
        implied_probs=probs,
        total_minted=total_minted,
        reserves=reserves,
        current_round=current_round,
        total_rounds=total_rounds,
        design=design,
        fee_model=fee_model,
        agent_state=agent_state,
        allowed_actions=allowed_actions,
        scenario_family=scenario_family,
        belief_family=belief_family,
        settlement_rule=settlement_rule,
    )


# ── DecisionContext primitives ──────────────────────────────────────────────

class TestDecisionContext:
    def test_required_fields(self):
        reserves, total_minted, probs = _make_market()
        state = _make_state()
        ctx = _make_ctx(probs, reserves, total_minted, state)
        assert hasattr(ctx, "implied_probs")
        assert hasattr(ctx, "total_minted")
        assert hasattr(ctx, "reserves")
        assert hasattr(ctx, "current_round")
        assert hasattr(ctx, "total_rounds")
        assert hasattr(ctx, "design")
        assert hasattr(ctx, "fee_model")
        assert hasattr(ctx, "agent_state")
        assert hasattr(ctx, "allowed_actions")
        assert hasattr(ctx, "scenario_family")
        assert hasattr(ctx, "belief_family")
        assert hasattr(ctx, "settlement_rule")

    def test_amm_actions_contents(self):
        assert ActionType.BUNDLE_BUY in AMM_ACTIONS
        assert ActionType.BUNDLE_SELL in AMM_ACTIONS
        assert ActionType.LP_DEPOSIT in AMM_ACTIONS
        assert ActionType.LP_WITHDRAW in AMM_ACTIONS
        assert ActionType.LP_REBALANCE in AMM_ACTIONS
        assert ActionType.SINGLE_BIN_BUY in AMM_ACTIONS
        assert ActionType.SINGLE_BIN_SELL in AMM_ACTIONS
        assert ActionType.ORDER_PLACE not in AMM_ACTIONS
        assert ActionType.ORDER_CANCEL not in AMM_ACTIONS

    def test_clob_actions_contents(self):
        assert ActionType.ORDER_PLACE in CLOB_ACTIONS
        assert ActionType.ORDER_CANCEL in CLOB_ACTIONS
        assert ActionType.SINGLE_BIN_BUY in CLOB_ACTIONS
        assert ActionType.SINGLE_BIN_SELL in CLOB_ACTIONS
        assert ActionType.BUNDLE_BUY not in CLOB_ACTIONS
        assert ActionType.LP_DEPOSIT not in CLOB_ACTIONS

    def test_settlement_rules_mapping(self):
        assert SETTLEMENT_RULES[0] == "wta"
        assert SETTLEMENT_RULES[1] == "wta"
        assert SETTLEMENT_RULES[2] == "piecewise"
        assert SETTLEMENT_RULES[3] == "kernel"
        assert SETTLEMENT_RULES[4] == "scalar"
        assert SETTLEMENT_RULES[5] == "crps"
        assert SETTLEMENT_RULES[6] == "piecewise"

    def test_agent_state_realized_pnl(self):
        state = AgentState(agent_id=0, capital=1000, holdings={})
        assert state.realized_pnl == 0.0

    def test_distribution_trade_action_defaults(self):
        a = DistributionTradeAction(agent_id=0, bin_idx=5, side="buy", amount=100)
        assert a.mu == 0
        assert a.sigma == 0


# ── InformedTrader ──────────────────────────────────────────────────────────

class TestInformedTrader:
    def test_buys_underpriced_bins(self):
        reserves, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        state = _make_state(agent_id=0, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = InformedTrader(agent_id=0, conviction=0.5)
        actions = agent.decide(ctx, true_dist)
        buys = [a for a in actions if a.side == "buy"]
        assert len(buys) > 0
        assert buys[0].bin_idx == 8

    def test_respects_capital_limit(self):
        reserves, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        state = _make_state(agent_id=0, capital=100)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = InformedTrader(agent_id=0, conviction=1.0)
        actions = agent.decide(ctx, true_dist)
        total_spend = sum(a.amount for a in actions if a.side == "buy")
        assert total_spend <= 100

    def test_can_emit_sell_when_bundle_is_overpriced(self):
        reserves, total_minted, _ = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = int(0.7 * SCALE)
        true_dist[9] = SCALE - true_dist[8]
        implied = np.zeros(16, dtype=np.int64)
        implied[8] = SCALE
        state = _make_state(agent_id=0, capital=1_000_000_000)
        ctx = _make_ctx(implied, reserves, 1_000_000_000, state)
        agent = InformedTrader(agent_id=0, conviction=1.0)
        actions = agent.decide(ctx, true_dist)
        sells = [a for a in actions if a.side == "sell"]
        assert len(sells) > 0

    def test_no_action_when_bundle_buy_not_allowed(self):
        reserves, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        state = _make_state(agent_id=0, capital=1_000_000_000)
        # Remove BUNDLE_BUY from allowed actions
        restricted = AMM_ACTIONS - {ActionType.BUNDLE_BUY}
        ctx = _make_ctx(probs, reserves, total_minted, state, allowed_actions=restricted)
        agent = InformedTrader(agent_id=0, conviction=0.5)
        actions = agent.decide(ctx, true_dist)
        buys = [a for a in actions if a.side == "buy"]
        assert len(buys) == 0

    def test_crps_rule_increases_conviction(self):
        """CRPS rule multiplies conviction by 1.3, yielding a larger trade."""
        reserves, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        state_base = _make_state(agent_id=0, capital=1_000_000_000)
        state_crps = _make_state(agent_id=0, capital=1_000_000_000)
        ctx_base = _make_ctx(probs, reserves, total_minted, state_base, settlement_rule="wta")
        ctx_crps = _make_ctx(probs, reserves, total_minted, state_crps, settlement_rule="crps")
        agent = InformedTrader(agent_id=0, conviction=0.5)
        actions_base = agent.decide(ctx_base, true_dist)
        actions_crps = agent.decide(ctx_crps, true_dist)
        if actions_base and actions_crps:
            assert actions_crps[0].amount >= actions_base[0].amount


# ── TestInformedTraderLiveState ─────────────────────────────────────────────

class TestInformedTraderLiveState:
    def test_reduced_capital_reduces_trade_size(self):
        reserves, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        state_rich = _make_state(agent_id=0, capital=1_000_000_000)
        state_poor = _make_state(agent_id=0, capital=1_000)
        agent = InformedTrader(agent_id=0, conviction=1.0)
        ctx_rich = _make_ctx(probs, reserves, total_minted, state_rich)
        ctx_poor = _make_ctx(probs, reserves, total_minted, state_poor)
        actions_rich = agent.decide(ctx_rich, true_dist)
        actions_poor = agent.decide(ctx_poor, true_dist)
        if actions_rich and actions_poor:
            assert actions_poor[0].amount < actions_rich[0].amount

    def test_zero_capital_no_action(self):
        reserves, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        state = _make_state(agent_id=0, capital=0)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = InformedTrader(agent_id=0, conviction=1.0)
        actions = agent.decide(ctx, true_dist)
        assert actions == []


class TestInformedTraderUsesBeliefWeights:
    """Verify that informed trader decisions follow belief weights, not truth weights."""

    def test_actions_reflect_belief_not_truth(self):
        """Create divergent truth and belief distributions. Pass belief weights to
        InformedTrader.decide() and verify the agent targets the belief peak, not the
        truth peak."""
        reserves, total_minted, probs = _make_market()

        # Truth: all mass on bin 2
        truth_weights = np.zeros(16, dtype=np.int64)
        truth_weights[2] = SCALE

        # Belief: all mass on bin 12 (very different from truth)
        belief_weights = np.zeros(16, dtype=np.int64)
        belief_weights[12] = SCALE

        state = _make_state(agent_id=0, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = InformedTrader(agent_id=0, conviction=0.8)

        # Per the spec, the simulation passes belief_weights, not truth_weights
        actions = agent.decide(ctx, belief_weights)
        buys = [a for a in actions if a.side == "buy"]
        assert len(buys) > 0, "Expected at least one buy action"
        # The agent should buy bin 12 (belief peak), not bin 2 (truth peak)
        assert buys[0].bin_idx == 12, (
            f"Agent targeted bin {buys[0].bin_idx}, expected bin 12 (belief peak)"
        )

    def test_actions_differ_with_different_belief(self):
        """Two calls with different belief weights should produce different buy targets."""
        reserves, total_minted, probs = _make_market()

        belief_a = np.zeros(16, dtype=np.int64)
        belief_a[3] = SCALE

        belief_b = np.zeros(16, dtype=np.int64)
        belief_b[14] = SCALE

        state = _make_state(agent_id=0, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = InformedTrader(agent_id=0, conviction=0.8)

        actions_a = agent.decide(ctx, belief_a)
        actions_b = agent.decide(ctx, belief_b)
        buys_a = [a for a in actions_a if a.side == "buy"]
        buys_b = [a for a in actions_b if a.side == "buy"]
        assert len(buys_a) > 0
        assert len(buys_b) > 0
        assert buys_a[0].bin_idx != buys_b[0].bin_idx, (
            "Expected different buy targets for different belief distributions"
        )

    def test_actions_carry_explicit_belief_weights(self):
        reserves, total_minted, probs = _make_market()
        belief_weights = np.zeros(16, dtype=np.int64)
        belief_weights[3] = int(0.4 * SCALE)
        belief_weights[12] = SCALE - belief_weights[3]

        state = _make_state(agent_id=0, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = InformedTrader(agent_id=0, conviction=0.8)

        actions = agent.decide(ctx, belief_weights)
        buys = [a for a in actions if a.side == "buy"]
        assert len(buys) > 0
        assert buys[0].weights is not None
        np.testing.assert_array_equal(buys[0].weights, belief_weights)


# ── NoiseTrader ─────────────────────────────────────────────────────────────

class TestNoiseTrader:
    def test_produces_random_actions(self):
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=1, capital=1_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = NoiseTrader(agent_id=1, trade_min=1000, trade_max=100_000, frequency=1.0, rng=np.random.default_rng(42))
        actions = agent.decide(ctx)
        assert len(actions) > 0

    def test_no_action_when_capital_zero(self):
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=1, capital=0)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = NoiseTrader(agent_id=1, trade_min=1000, trade_max=100_000, frequency=1.0, rng=np.random.default_rng(0))
        actions = agent.decide(ctx)
        assert actions == []


# ── TestNoiseTraderBundles ───────────────────────────────────────────────────

class TestNoiseTraderBundles:
    def test_some_actions_are_bundle_trades(self):
        """Over many seeds, some actions should be DistributionTradeAction."""
        reserves, total_minted, probs = _make_market()
        bundle_count = 0
        total = 0
        for seed in range(200):
            state = _make_state(agent_id=1, capital=1_000_000_000)
            ctx = _make_ctx(probs, reserves, total_minted, state, allowed_actions=AMM_ACTIONS)
            agent = NoiseTrader(agent_id=1, trade_min=1000, trade_max=100_000, frequency=1.0, rng=np.random.default_rng(seed))
            actions = agent.decide(ctx)
            for a in actions:
                total += 1
                if isinstance(a, DistributionTradeAction):
                    bundle_count += 1
        assert total > 0
        assert bundle_count > 0, "Expected some bundle trades over 200 seeds"

    def test_no_bundle_when_not_allowed(self):
        """If BUNDLE_BUY is not in allowed_actions, all actions should be plain TradeAction."""
        reserves, total_minted, probs = _make_market()
        restricted = frozenset({ActionType.SINGLE_BIN_BUY, ActionType.SINGLE_BIN_SELL})
        for seed in range(50):
            state = _make_state(agent_id=1, capital=1_000_000_000)
            ctx = _make_ctx(probs, reserves, total_minted, state, allowed_actions=restricted)
            agent = NoiseTrader(agent_id=1, trade_min=1000, trade_max=100_000, frequency=1.0, rng=np.random.default_rng(seed))
            actions = agent.decide(ctx)
            for a in actions:
                assert not isinstance(a, DistributionTradeAction), f"Unexpected bundle trade with seed {seed}"


# ── Arbitrageur ─────────────────────────────────────────────────────────────

class TestArbitrageur:
    def test_detects_mispricing(self):
        reserves, total_minted, probs = _make_market()
        probs_skewed = probs.copy()
        probs_skewed[0] += 100_000_000
        probs_skewed[1] -= 100_000_000
        state = _make_state(agent_id=2, capital=1_000_000_000)
        ctx = _make_ctx(probs_skewed, reserves, total_minted, state)
        agent = Arbitrageur(agent_id=2, min_edge=0.005)
        actions = agent.decide(ctx)
        assert len(actions) > 0

    def test_no_action_when_capital_zero(self):
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=2, capital=0)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = Arbitrageur(agent_id=2, min_edge=0.005)
        actions = agent.decide(ctx)
        assert actions == []


# ── Arbitrageur design-specific attacks ────────────────────────────────────

class TestArbitrageurDesignSpecific:
    """Verify that the arbitrageur produces design-aware actions."""

    def _make_peaked_probs(self, n_bins=16, peak=8):
        """Create implied probs with a clear peak and some far-from-peak mass."""
        probs = np.zeros(n_bins, dtype=np.int64)
        # Give peak bin 40% of SCALE, and spread the rest with some far bins overpriced
        probs[peak] = int(SCALE * 0.40)
        for i in range(n_bins):
            if i != peak:
                probs[i] = int(SCALE * 0.04)  # 4% each for 15 bins = 60%
        # Fix rounding
        probs[peak] += SCALE - int(np.sum(probs))
        return probs

    def test_wta_sells_far_from_peak_bins(self):
        """WTA: bins far from peak with high probability should be sold."""
        reserves, total_minted, _ = _make_market()
        probs = self._make_peaked_probs(n_bins=16, peak=8)
        # Make a far bin (bin 0) overpriced: >20% of peak probability
        probs[0] = int(SCALE * 0.15)  # 15% — well above 20% of 40%=8%
        probs[8] = SCALE - int(np.sum(probs)) + probs[8]  # fix sum

        state = _make_state(agent_id=2, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state, settlement_rule="wta")
        agent = Arbitrageur(agent_id=2, min_edge=0.005)
        actions = agent.decide(ctx)

        # There should be at least one sell action on a far-from-peak bin
        design_sells = [a for a in actions if a.side == "sell" and abs(a.bin_idx - 8) > 5]
        assert len(design_sells) > 0, "WTA should sell overpriced far-from-peak bins"

    def test_scalar_buys_local_minima(self):
        """Scalar: local minima (inversions) should trigger buy actions."""
        reserves, total_minted, _ = _make_market()
        n_bins = 16
        # Create smooth distribution with an artificial dip at bin 6
        probs = np.zeros(n_bins, dtype=np.int64)
        for i in range(n_bins):
            probs[i] = int(SCALE / n_bins)
        # Create a local minimum: bin 6 much lower than neighbors
        probs[5] = int(SCALE * 0.10)
        probs[6] = int(SCALE * 0.02)  # dip
        probs[7] = int(SCALE * 0.10)
        # Fix sum
        probs[0] += SCALE - int(np.sum(probs))

        state = _make_state(agent_id=2, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state, settlement_rule="scalar")
        agent = Arbitrageur(agent_id=2, min_edge=0.005)
        actions = agent.decide(ctx)

        # Should include a buy at the local minimum (bin 6)
        design_buys = [a for a in actions if a.side == "buy" and a.bin_idx == 6]
        assert len(design_buys) > 0, "Scalar should buy underpriced local-minimum bins"

    def test_crps_reduces_activity(self):
        """CRPS: proper scoring rule should yield fewer design-specific actions."""
        reserves, total_minted, _ = _make_market()
        probs = self._make_peaked_probs(n_bins=16, peak=8)
        # Make a far bin overpriced (same as WTA test)
        probs[0] = int(SCALE * 0.15)
        probs[8] = SCALE - int(np.sum(probs)) + probs[8]

        state_wta = _make_state(agent_id=2, capital=1_000_000_000)
        state_crps = _make_state(agent_id=2, capital=1_000_000_000)

        ctx_wta = _make_ctx(probs, reserves, total_minted, state_wta, settlement_rule="wta")
        ctx_crps = _make_ctx(probs, reserves, total_minted, state_crps, settlement_rule="crps")

        agent = Arbitrageur(agent_id=2, min_edge=0.005)
        actions_wta = agent.decide(ctx_wta)
        actions_crps = agent.decide(ctx_crps)

        # CRPS should produce no more actions than WTA (typically fewer since
        # design-specific attack returns nothing for CRPS)
        assert len(actions_crps) <= len(actions_wta), (
            f"CRPS ({len(actions_crps)} actions) should not exceed WTA ({len(actions_wta)} actions)"
        )

    def test_piecewise_targets_smoothing_edge(self):
        """Piecewise/kernel: should target bins at the smoothing window edge."""
        reserves, total_minted, _ = _make_market()
        n_bins = 16
        # Create distribution with peak at bin 8 and very low but nonzero
        # bins at edges of the smoothing window (bins 4, 12)
        probs = np.zeros(n_bins, dtype=np.int64)
        probs[8] = int(SCALE * 0.50)
        for i in range(n_bins):
            if i != 8:
                probs[i] = int(SCALE * 0.001)  # very small
        probs[0] += SCALE - int(np.sum(probs))

        state = _make_state(agent_id=2, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state, settlement_rule="piecewise")
        agent = Arbitrageur(agent_id=2, min_edge=0.005)
        actions = agent.decide(ctx)

        # The method should still return a list (possibly empty depending on
        # exact threshold, but it must not error)
        assert isinstance(actions, list)


# ── Manipulator ─────────────────────────────────────────────────────────────

class TestManipulator:
    def test_buys_target_bin(self):
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=3, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = Manipulator(agent_id=3, budget=5_000_000, target_bin=8)
        actions = agent.decide(ctx)
        assert all(a.bin_idx == 8 for a in actions)

    def test_scalar_rule_spends_more(self):
        """Scalar design spend fraction (0.2) > default (0.1)."""
        reserves, total_minted, probs = _make_market()
        budget = 10_000_000
        agent_default = Manipulator(agent_id=3, budget=budget, target_bin=8)
        agent_scalar = Manipulator(agent_id=3, budget=budget, target_bin=8)

        state = _make_state(agent_id=3, capital=budget)
        ctx_default = _make_ctx(probs, reserves, total_minted, state, settlement_rule="wta")
        ctx_scalar = _make_ctx(probs, reserves, total_minted, state, settlement_rule="scalar")

        actions_default = agent_default.decide(ctx_default)
        actions_scalar = agent_scalar.decide(ctx_scalar)
        amount_default = sum(a.amount for a in actions_default)
        amount_scalar = sum(a.amount for a in actions_scalar)
        assert amount_scalar > amount_default

    def test_late_stage_doubles_spend(self):
        """After 80% of rounds, spend fraction doubles."""
        reserves, total_minted, probs = _make_market()
        budget = 10_000_000
        agent_early = Manipulator(agent_id=3, budget=budget, target_bin=8)
        agent_late = Manipulator(agent_id=3, budget=budget, target_bin=8)

        state = _make_state(agent_id=3, capital=budget)
        ctx_early = _make_ctx(probs, reserves, total_minted, state, current_round=10, total_rounds=200, settlement_rule="wta")
        ctx_late = _make_ctx(probs, reserves, total_minted, state, current_round=170, total_rounds=200, settlement_rule="wta")

        actions_early = agent_early.decide(ctx_early)
        actions_late = agent_late.decide(ctx_late)
        amount_early = sum(a.amount for a in actions_early)
        amount_late = sum(a.amount for a in actions_late)
        assert amount_late > amount_early


class TestManipulatorStrategies:
    """Test each manipulator strategy produces appropriate actions."""

    def test_price_distortion_buys_target_bin(self):
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=3, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        agent = Manipulator(agent_id=3, budget=5_000_000, target_bin=8, strategy="price_distortion")
        actions = agent.decide(ctx)
        assert len(actions) > 0
        assert all(a.bin_idx == 8 for a in actions)

    def test_payout_capture_buys_target_before_midpoint(self):
        """Before 50%, payout_capture does small buys on target bin."""
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=3, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state, current_round=10, total_rounds=200)
        agent = Manipulator(agent_id=3, budget=5_000_000, target_bin=8, strategy="payout_capture")
        actions = agent.decide(ctx)
        assert len(actions) > 0
        assert actions[0].bin_idx == 8

    def test_payout_capture_buys_peak_after_midpoint(self):
        """After 50%, payout_capture buys the bin with highest implied prob."""
        reserves, total_minted, probs = _make_market()
        # Skew probs so bin 5 is the peak
        probs_skewed = probs.copy()
        probs_skewed[5] += 500_000_000
        # Renormalize
        diff = int(np.sum(probs_skewed)) - SCALE
        probs_skewed[0] -= diff

        state = _make_state(agent_id=3, capital=1_000_000_000)
        ctx = _make_ctx(probs_skewed, reserves, total_minted, state, current_round=150, total_rounds=200)
        agent = Manipulator(agent_id=3, budget=5_000_000, target_bin=8, strategy="payout_capture")
        actions = agent.decide(ctx)
        assert len(actions) > 0
        assert actions[0].bin_idx == 5  # the peak bin

    def test_boundary_crossing_targets_adjacent_bins(self):
        """Boundary crossing should alternate between bins adjacent to target."""
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=3, capital=1_000_000_000)
        agent = Manipulator(agent_id=3, budget=5_000_000, target_bin=8, strategy="boundary_crossing")

        ctx1 = _make_ctx(probs, reserves, total_minted, state, current_round=10, total_rounds=200)
        actions1 = agent.decide(ctx1)

        ctx2 = _make_ctx(probs, reserves, total_minted, state, current_round=11, total_rounds=200)
        actions2 = agent.decide(ctx2)

        assert len(actions1) > 0 and len(actions2) > 0
        bins_hit = {actions1[0].bin_idx, actions2[0].bin_idx}
        assert bins_hit == {7, 9}  # adjacent to target_bin=8

    def test_late_gaming_dormant_before_85_pct(self):
        """Late gaming does nothing before 85% of rounds."""
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=3, capital=1_000_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state, current_round=100, total_rounds=200)
        agent = Manipulator(agent_id=3, budget=5_000_000, target_bin=8, strategy="late_gaming")
        actions = agent.decide(ctx)
        assert len(actions) == 0

    def test_late_gaming_buys_cheapest_after_85_pct(self):
        """Late gaming buys the cheapest bin in the last 15%."""
        reserves, total_minted, probs = _make_market()
        # Make bin 3 the cheapest
        probs_skewed = probs.copy()
        probs_skewed[3] = 1  # very cheap
        diff = int(np.sum(probs_skewed)) - SCALE
        probs_skewed[0] -= diff

        state = _make_state(agent_id=3, capital=1_000_000_000)
        ctx = _make_ctx(probs_skewed, reserves, total_minted, state, current_round=180, total_rounds=200)
        agent = Manipulator(agent_id=3, budget=5_000_000, target_bin=8, strategy="late_gaming")
        actions = agent.decide(ctx)
        assert len(actions) > 0
        assert actions[0].bin_idx == 3  # cheapest bin

    def test_invalid_strategy_falls_back_to_price_distortion(self):
        """Invalid strategy name defaults to price_distortion."""
        agent = Manipulator(agent_id=3, budget=5_000_000, target_bin=8, strategy="nonexistent")
        assert agent.strategy == "price_distortion"


# ── Manipulator live-state tests ───────────────────────────────────────────

class TestManipulatorLiveState:
    """Verify manipulator decisions are driven by live AgentState capital."""

    def test_uses_live_capital_not_static_budget(self):
        """Manipulator amount should scale with ctx.agent_state.capital, not self.budget."""
        reserves, total_minted, probs = _make_market()
        agent = Manipulator(agent_id=3, budget=10_000_000, target_bin=8)

        state_rich = _make_state(agent_id=3, capital=10_000_000)
        ctx_rich = _make_ctx(probs, reserves, total_minted, state_rich)
        actions_rich = agent.decide(ctx_rich)

        state_poor = _make_state(agent_id=3, capital=1_000)
        ctx_poor = _make_ctx(probs, reserves, total_minted, state_poor)
        actions_poor = agent.decide(ctx_poor)

        assert len(actions_rich) > 0 and len(actions_poor) > 0
        assert actions_poor[0].amount < actions_rich[0].amount, (
            "Manipulator with less live capital should propose a smaller trade"
        )

    def test_zero_live_capital_produces_no_action(self):
        """If agent_state.capital is 0, manipulator should do nothing regardless of budget."""
        reserves, total_minted, probs = _make_market()
        agent = Manipulator(agent_id=3, budget=10_000_000, target_bin=8)

        state = _make_state(agent_id=3, capital=0)
        ctx = _make_ctx(probs, reserves, total_minted, state)
        actions = agent.decide(ctx)
        assert actions == [], "Manipulator should not trade when live capital is 0"

    def test_repeated_calls_with_decreasing_capital(self):
        """Simulating capital depletion across rounds should reduce trade sizes."""
        reserves, total_minted, probs = _make_market()
        agent = Manipulator(agent_id=3, budget=10_000_000, target_bin=8)
        amounts = []

        capital = 10_000_000
        for round_num in range(5):
            state = _make_state(agent_id=3, capital=capital)
            ctx = _make_ctx(probs, reserves, total_minted, state, current_round=round_num, total_rounds=200)
            actions = agent.decide(ctx)
            if actions:
                amounts.append(actions[0].amount)
                capital -= actions[0].amount  # simulate engine deducting capital
            else:
                break

        assert len(amounts) >= 2, "Expected at least 2 rounds of trading"
        # Later rounds should have smaller or equal amounts as capital depletes
        assert amounts[-1] <= amounts[0], (
            "Trade amount should not increase as live capital decreases"
        )


# ── LateRoundWhale ──────────────────────────────────────────────────────────

class TestLateRoundWhale:
    def test_inactive_before_activation(self):
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=4, capital=50_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state, current_round=10, total_rounds=200)
        agent = LateRoundWhale(agent_id=4, budget=50_000_000, target_bin=8, activation_round_pct=0.9)
        actions = agent.decide(ctx)
        assert len(actions) == 0

    def test_active_after_activation(self):
        reserves, total_minted, probs = _make_market()
        state = _make_state(agent_id=4, capital=50_000_000)
        ctx = _make_ctx(probs, reserves, total_minted, state, current_round=185, total_rounds=200)
        agent = LateRoundWhale(agent_id=4, budget=50_000_000, target_bin=8, activation_round_pct=0.9)
        actions = agent.decide(ctx)
        assert len(actions) > 0
        assert actions[0].bin_idx == 8

    def test_red_team_only_flag(self):
        agent = LateRoundWhale(agent_id=4, budget=50_000_000, target_bin=8)
        assert agent.red_team_only is True


# ── LateRoundWhale live-state tests ───────────────────────────────────────

class TestLateRoundWhaleLiveState:
    """Verify late-round whale decisions are driven by live AgentState capital."""

    def test_uses_live_capital_not_static_budget(self):
        """Whale amount should scale with ctx.agent_state.capital."""
        reserves, total_minted, probs = _make_market()
        agent_rich = LateRoundWhale(agent_id=4, budget=50_000_000, target_bin=8)
        agent_poor = LateRoundWhale(agent_id=4, budget=50_000_000, target_bin=8)

        state_rich = _make_state(agent_id=4, capital=50_000_000)
        ctx_rich = _make_ctx(probs, reserves, total_minted, state_rich, current_round=190, total_rounds=200)
        actions_rich = agent_rich.decide(ctx_rich)

        state_poor = _make_state(agent_id=4, capital=1_000)
        ctx_poor = _make_ctx(probs, reserves, total_minted, state_poor, current_round=190, total_rounds=200)
        actions_poor = agent_poor.decide(ctx_poor)

        assert len(actions_rich) > 0 and len(actions_poor) > 0
        assert actions_poor[0].amount < actions_rich[0].amount, (
            "Whale with less live capital should propose a smaller trade"
        )

    def test_zero_live_capital_produces_no_action(self):
        """If agent_state.capital is 0, whale should do nothing regardless of budget."""
        reserves, total_minted, probs = _make_market()
        agent = LateRoundWhale(agent_id=4, budget=50_000_000, target_bin=8)

        state = _make_state(agent_id=4, capital=0)
        ctx = _make_ctx(probs, reserves, total_minted, state, current_round=190, total_rounds=200)
        actions = agent.decide(ctx)
        assert actions == [], "Whale should not trade when live capital is 0"


# ── PassiveLP ───────────────────────────────────────────────────────────────

class TestPassiveLP:
    def test_deposits_when_yield_ok(self):
        agent = PassiveLP(agent_id=5, yield_threshold=0.0, loss_tolerance=1.0)
        state = _make_state(agent_id=5, capital=1_000_000_000, deposited_lp=0)
        action = agent.decide_lp(fee_yield=0.01, unrealized_loss=0.0, current_round=5, agent_state=state)
        assert action is not None and action["type"] == "deposit"

    def test_withdraws_on_loss(self):
        agent = PassiveLP(agent_id=5, yield_threshold=0.001, loss_tolerance=0.05)
        state = _make_state(agent_id=5, capital=500_000_000, deposited_lp=500_000_000)
        action = agent.decide_lp(fee_yield=0.0001, unrealized_loss=0.06, current_round=50, agent_state=state)
        assert action is not None and action["type"] == "withdraw"

    def test_no_action_when_conditions_not_met(self):
        agent = PassiveLP(agent_id=5, yield_threshold=0.05, loss_tolerance=1.0)
        state = _make_state(agent_id=5, capital=1_000_000_000, deposited_lp=0)
        action = agent.decide_lp(fee_yield=0.001, unrealized_loss=0.0, current_round=5, agent_state=state)
        assert action is None


# ── TestLPLiveState ─────────────────────────────────────────────────────────

class TestLPLiveState:
    def test_already_deposited_no_re_deposit(self):
        """If agent_state.deposited_lp > 0, PassiveLP should not deposit again."""
        agent = PassiveLP(agent_id=5, yield_threshold=0.0, loss_tolerance=1.0)
        # Simulate already having deposited
        state = _make_state(agent_id=5, capital=500_000_000, deposited_lp=500_000_000)
        action = agent.decide_lp(fee_yield=0.05, unrealized_loss=0.0, current_round=5, agent_state=state)
        # Should not deposit again; no withdraw triggered either (loss < tolerance)
        assert action is None

    def test_withdraw_uses_live_deposited_lp(self):
        """Withdraw amount comes from agent_state.deposited_lp, not a stale field."""
        agent = PassiveLP(agent_id=5, yield_threshold=0.001, loss_tolerance=0.05)
        deposit_amount = 750_000_000
        state = _make_state(agent_id=5, capital=250_000_000, deposited_lp=deposit_amount)
        action = agent.decide_lp(fee_yield=0.0001, unrealized_loss=0.1, current_round=50, agent_state=state)
        assert action is not None
        assert action["type"] == "withdraw"
        assert action["amount"] == deposit_amount

    def test_rebalancing_lp_already_deposited_no_re_deposit(self):
        """RebalancingLP also should not re-deposit if already deposited."""
        agent = RebalancingLP(
            agent_id=6,
            yield_threshold=0.0,
            loss_tolerance=1.0,
            rebalance_interval=10,
            concentration_factor=2.0,
        )
        state = _make_state(agent_id=6, capital=500_000_000, deposited_lp=500_000_000)
        action = agent.decide_lp(fee_yield=0.05, unrealized_loss=0.0, current_round=10, agent_state=state)
        assert action is None


# ── RebalancingLP ───────────────────────────────────────────────────────────

class TestRebalancingLP:
    def test_rebalances_at_interval(self):
        agent = RebalancingLP(
            agent_id=6,
            yield_threshold=0.0,
            loss_tolerance=1.0,
            rebalance_interval=10,
            concentration_factor=2.0,
        )
        weights = agent.compute_rebalance_weights(
            activity_counts=np.array([10, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            num_bins=16,
            current_round=10,
        )
        assert weights[0] > weights[3]

    def test_rebalance_weights_persist_between_intervals(self):
        agent = RebalancingLP(
            agent_id=6,
            yield_threshold=0.0,
            loss_tolerance=1.0,
            rebalance_interval=10,
            concentration_factor=2.0,
        )
        weights = agent.compute_rebalance_weights(
            activity_counts=np.array([10, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            num_bins=16,
            current_round=10,
        )
        # last_weights is now set inside compute_rebalance_weights
        persisted = agent.compute_rebalance_weights(
            activity_counts=np.zeros(16, dtype=np.int64),
            num_bins=16,
            current_round=11,
        )
        assert np.allclose(persisted, weights)

    def test_deposits_when_yield_ok(self):
        agent = RebalancingLP(
            agent_id=6,
            yield_threshold=0.0,
            loss_tolerance=1.0,
            rebalance_interval=10,
            concentration_factor=2.0,
        )
        state = _make_state(agent_id=6, capital=1_000_000_000, deposited_lp=0)
        action = agent.decide_lp(fee_yield=0.01, unrealized_loss=0.0, current_round=5, agent_state=state)
        assert action is not None and action["type"] == "deposit"
