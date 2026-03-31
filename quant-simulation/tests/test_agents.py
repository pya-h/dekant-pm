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
