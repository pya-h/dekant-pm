"""Tests for agent strategies."""
import numpy as np
import pytest
from config.params import SCALE
from agents.base import TradeAction, AgentState
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


class TestInformedTrader:
    def test_buys_underpriced_bins(self):
        reserves, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        agent = InformedTrader(
            agent_id=0,
            capital=1_000_000_000,
            conviction=0.5,
            true_distribution=true_dist,
            true_mu=50 * SCALE,
            true_sigma=10 * SCALE,
        )
        actions = agent.decide(probs, total_minted, current_round=10, total_rounds=200)
        buys = [a for a in actions if a.side == "buy"]
        assert len(buys) > 0
        assert buys[0].bin_idx == 8

    def test_respects_capital_limit(self):
        reserves, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        agent = InformedTrader(
            agent_id=0,
            capital=100,
            conviction=1.0,
            true_distribution=true_dist,
            true_mu=50 * SCALE,
            true_sigma=10 * SCALE,
        )
        actions = agent.decide(probs, total_minted, current_round=10, total_rounds=200)
        total_spend = sum(a.amount for a in actions if a.side == "buy")
        assert total_spend <= 100

    def test_can_emit_sell_when_bundle_is_overpriced(self):
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = int(0.7 * SCALE)
        true_dist[9] = SCALE - true_dist[8]
        implied = np.zeros(16, dtype=np.int64)
        implied[8] = SCALE
        agent = InformedTrader(
            agent_id=0,
            capital=1_000_000_000,
            conviction=1.0,
            true_distribution=true_dist,
            true_mu=50 * SCALE,
            true_sigma=10 * SCALE,
        )
        actions = agent.decide(implied, 1_000_000_000, current_round=10, total_rounds=200)
        sells = [a for a in actions if a.side == "sell"]
        assert len(sells) > 0


class TestNoiseTrader:
    def test_produces_random_actions(self):
        _, _, probs = _make_market()
        agent = NoiseTrader(agent_id=1, capital=1_000_000, trade_min=1000, trade_max=100_000, frequency=1.0, rng=np.random.default_rng(42))
        actions = agent.decide(probs, 1_000_000_000, current_round=5, total_rounds=200)
        assert len(actions) > 0


class TestArbitrageur:
    def test_detects_mispricing(self):
        _, total_minted, probs = _make_market()
        probs_skewed = probs.copy()
        probs_skewed[0] += 100_000_000
        probs_skewed[1] -= 100_000_000
        agent = Arbitrageur(agent_id=2, capital=1_000_000_000, min_edge=0.005)
        actions = agent.decide(probs_skewed, total_minted, current_round=5, total_rounds=200)
        assert len(actions) > 0


class TestManipulator:
    def test_buys_target_bin(self):
        _, total_minted, probs = _make_market()
        agent = Manipulator(agent_id=3, budget=5_000_000, target_bin=8)
        actions = agent.decide(probs, total_minted, current_round=5, total_rounds=200)
        assert all(a.bin_idx == 8 for a in actions)


class TestLateRoundWhale:
    def test_inactive_before_activation(self):
        _, total_minted, probs = _make_market()
        agent = LateRoundWhale(agent_id=4, budget=50_000_000, target_bin=8, activation_round_pct=0.9)
        actions = agent.decide(probs, total_minted, current_round=10, total_rounds=200)
        assert len(actions) == 0

    def test_active_after_activation(self):
        _, total_minted, probs = _make_market()
        agent = LateRoundWhale(agent_id=4, budget=50_000_000, target_bin=8, activation_round_pct=0.9)
        actions = agent.decide(probs, total_minted, current_round=185, total_rounds=200)
        assert len(actions) > 0
        assert actions[0].bin_idx == 8


class TestPassiveLP:
    def test_deposits_when_yield_ok(self):
        agent = PassiveLP(agent_id=5, capital=1_000_000_000, yield_threshold=0.0, loss_tolerance=1.0)
        action = agent.decide_lp(fee_yield=0.01, unrealized_loss=0.0, current_round=5)
        assert action is not None and action["type"] == "deposit"

    def test_withdraws_on_loss(self):
        agent = PassiveLP(agent_id=5, capital=1_000_000_000, yield_threshold=0.001, loss_tolerance=0.05)
        agent.deposited = 500_000_000  # simulate prior deposit
        action = agent.decide_lp(fee_yield=0.0001, unrealized_loss=0.06, current_round=50)
        assert action is not None and action["type"] == "withdraw"


class TestRebalancingLP:
    def test_rebalances_at_interval(self):
        agent = RebalancingLP(agent_id=6, capital=1_000_000_000, yield_threshold=0.0, loss_tolerance=1.0, rebalance_interval=10, concentration_factor=2.0)
        weights = agent.compute_rebalance_weights(
            activity_counts=np.array([10, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            num_bins=16, current_round=10,
        )
        assert weights[0] > weights[3]

    def test_rebalance_weights_persist_between_intervals(self):
        agent = RebalancingLP(agent_id=6, capital=1_000_000_000, yield_threshold=0.0, loss_tolerance=1.0, rebalance_interval=10, concentration_factor=2.0)
        weights = agent.compute_rebalance_weights(
            activity_counts=np.array([10, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            num_bins=16, current_round=10,
        )
        agent.last_weights = weights
        persisted = agent.compute_rebalance_weights(
            activity_counts=np.zeros(16, dtype=np.int64),
            num_bins=16, current_round=11,
        )
        assert np.allclose(persisted, weights)
