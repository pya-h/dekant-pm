"""Simulation engine — runs a complete market lifecycle.

Integrates: math_engine, weights, settlement_*, fee_models, agents, metrics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from config.params import (
    DESIGN_BASELINE_A,
    DESIGN_BASELINE_B,
    DESIGN_CRPS,
    DESIGN_KERNEL,
    DESIGN_PIECEWISE,
    DESIGN_SCALAR,
    DESIGN_CLOB,
    FEE_FLAT,
    FEE_DYNAMIC,
    FEE_TIERED,
    FEE_SPREAD,
    FEE_TIME_WEIGHTED,
    SCALE,
    AgentMix,
    NoiseParams,
    InformedParams,
    ArbitrageurParams,
    ManipulatorParams,
    WhaleParams,
    LpPassiveParams,
    LpRebalancingParams,
    DEFAULT_RANGE_MIN,
    DEFAULT_RANGE_MAX,
    DEFAULT_TARGET_PAYOUT_WIDTH,
    DEFAULT_NUM_BINS,
    DEFAULT_INITIAL_LIQUIDITY,
    DEFAULT_RESOLUTION_FAIRNESS_BINS,
)
from models.math_engine import (
    init_reserves,
    compute_buy,
    compute_sell,
    compute_distribution_buy,
    compute_distribution_sell,
    compute_probabilities,
    isqrt,
    value_to_bin,
)
from models.weights import compute_bin_weights_taylor4, compute_bin_weights_exact
from models.settlement_baseline import compute_payout_wta
from models.settlement_piecewise import compute_payout_piecewise, compute_dynamic_bandwidth
from models.settlement_kernel import compute_payout_kernel
from models.settlement_scalar import compute_payout_scalar
from models.settlement_crps import compute_payout_crps
from models.fee_models import flat_fee, dynamic_fee, tiered_fee, spread_fee, time_weighted_fee
from models.orderbook import Orderbook, Order, Side, Fill
from agents.base import TradeAction, DistributionTradeAction, AgentState
from agents.noise_trader import NoiseTrader
from agents.informed_trader import InformedTrader
from agents.arbitrageur import Arbitrageur
from agents.manipulator import Manipulator
from agents.late_round_whale import LateRoundWhale
from agents.lp import PassiveLP, RebalancingLP
from engine.metrics import (
    kl_divergence,
    convergence_speed,
    compute_slippage,
    lp_profitability,
    manipulation_cost,
    resolution_fairness,
    boundary_sensitivity,
    exitability,
)


# ---------------------------------------------------------------------------
# Market state dataclass
# ---------------------------------------------------------------------------

@dataclass
class MarketState:
    reserves: np.ndarray
    total_minted: int
    range_min: int
    range_max: int
    num_bins: int
    lp_fee_accumulated: int = 0
    protocol_fee_accumulated: int = 0
    passive_lp_deposited: int = 0
    passive_lp_fees: int = 0
    rebalancing_lp_deposited: int = 0
    rebalancing_lp_fees: int = 0
    clob_implied_probs: np.ndarray | None = None


# ---------------------------------------------------------------------------
# SimulationRun
# ---------------------------------------------------------------------------

class SimulationRun:
    """Execute a complete market lifecycle: init, trade rounds, resolve, measure."""

    def __init__(
        self,
        design: int,
        fee_model: int,
        num_bins: int = DEFAULT_NUM_BINS,
        initial_liquidity: int = DEFAULT_INITIAL_LIQUIDITY,
        num_rounds: int = 200,
        seed: int = 42,
        range_min: int = DEFAULT_RANGE_MIN,
        range_max: int = DEFAULT_RANGE_MAX,
        agent_mix: AgentMix | None = None,
    ):
        self.design = design
        self.fee_model = fee_model
        self.num_bins = num_bins
        self.initial_liquidity = initial_liquidity
        self.num_rounds = num_rounds
        self.seed = seed
        self.range_min = range_min
        self.range_max = range_max
        self.agent_mix = agent_mix or AgentMix()
        self.rng = np.random.default_rng(seed)

        # Select weight function
        if design == DESIGN_BASELINE_A:
            self.weight_fn = compute_bin_weights_taylor4
        else:
            self.weight_fn = compute_bin_weights_exact

        # Init market reserves
        reserves, total_minted = init_reserves(num_bins, initial_liquidity)
        self.state = MarketState(
            reserves=reserves,
            total_minted=total_minted,
            range_min=range_min,
            range_max=range_max,
            num_bins=num_bins,
        )

        # Generate true distribution params
        span = range_max - range_min
        center = (range_min + range_max) // 2
        self.true_mu = center + int(self.rng.uniform(-0.2, 0.2) * span)
        self.true_sigma = int(self.rng.uniform(span / 10, span / 3))
        if self.true_sigma <= 0:
            self.true_sigma = span // 10

        # Compute true distribution weights — always exact Gaussian regardless of
        # design, so that the ground truth is the same for all designs (including
        # Baseline A whose AMM uses Taylor-4).
        self.true_weights = compute_bin_weights_exact(
            range_min, range_max, num_bins, self.true_mu, self.true_sigma
        )

        # True distribution as float probabilities for KL divergence
        tw_sum = float(np.sum(self.true_weights))
        if tw_sum > 0:
            self.true_probs = self.true_weights / tw_sum
        else:
            self.true_probs = np.ones(num_bins) / num_bins

        # Create agents
        self.agents: list = []
        self.agent_states: dict[int, AgentState] = {}
        self._create_agents()

        # CLOB orderbook (only for CLOB design)
        self.orderbook: Orderbook | None = None
        if design == DESIGN_CLOB:
            self.orderbook = Orderbook(num_bins)
            self.state.clob_implied_probs = self._uniform_probabilities(num_bins)
            self.clob_last_prices = self.state.clob_implied_probs.copy()
        else:
            self.clob_last_prices = None

        # Tracking
        self.kl_series: list[float] = []
        self.manipulator_budget_spent = 0
        self.initial_probs: np.ndarray | None = None
        self.mid_run_slippages: dict[str, float] | None = None
        self.trade_activity = np.zeros(self.num_bins, dtype=np.int64)
        # CLOB-specific tracking
        self.clob_total_orders = 0
        self.clob_total_fills = 0
        self.clob_total_fill_volume = 0
        if self.design == DESIGN_CLOB:
            self._seed_clob_inventory()

    def _uniform_probabilities(self, num_bins: int) -> np.ndarray:
        probs = np.full(num_bins, SCALE // num_bins, dtype=np.int64)
        probs[0] += SCALE - int(np.sum(probs))
        return probs

    def _normalize_probabilities(self, raw: np.ndarray) -> np.ndarray:
        raw = np.asarray(raw, dtype=np.float64)
        raw = np.clip(raw, 0.0, None)
        total = float(np.sum(raw))
        if total <= 0:
            return self._uniform_probabilities(len(raw))
        scaled = (raw / total * SCALE).astype(np.int64)
        diff = SCALE - int(np.sum(scaled))
        scaled[int(np.argmax(raw))] += diff
        return scaled

    def _current_implied_probs(self) -> np.ndarray:
        if self.design == DESIGN_CLOB and self.state.clob_implied_probs is not None:
            return self.state.clob_implied_probs
        return compute_probabilities(self.state.reserves, self.state.total_minted)

    def _refresh_clob_implied_probs(self) -> None:
        if self.orderbook is None or self.clob_last_prices is None:
            return
        raw = self.clob_last_prices.astype(np.float64).copy()
        for bin_idx in range(self.num_bins):
            bid = self.orderbook.best_bid(bin_idx)
            ask = self.orderbook.best_ask(bin_idx)
            if bid is not None and ask is not None:
                raw[bin_idx] = (bid + ask) / 2
            elif ask is not None:
                raw[bin_idx] = ask
            elif bid is not None:
                raw[bin_idx] = bid
        self.state.clob_implied_probs = self._normalize_probabilities(raw)

    def _seed_clob_inventory(self) -> None:
        if self.orderbook is None:
            return
        for agent in self.agents:
            if isinstance(agent, (PassiveLP, RebalancingLP)):
                continue
            state = self.agent_states[agent.agent_id]
            inventory_per_bin = max(1, state.capital // (100 * self.num_bins))
            total_cost = inventory_per_bin * self.num_bins
            if total_cost >= state.capital:
                continue
            state.capital -= total_cost
            for bin_idx in range(self.num_bins):
                state.holdings[bin_idx] = state.holdings.get(bin_idx, 0) + inventory_per_bin

    def _rescale_amm_pool(self, delta: int) -> None:
        if delta == 0 or self.design == DESIGN_CLOB:
            return
        current_total = int(self.state.total_minted)
        new_total = max(1, current_total + int(delta))
        if new_total == current_total:
            return
        positions = [current_total - int(r) for r in self.state.reserves]
        anchor = int(np.argmax(positions))
        scaled_positions = [0] * self.num_bins
        sum_other_sq = 0
        for idx, position in enumerate(positions):
            if idx == anchor:
                continue
            scaled = position * new_total // current_total
            scaled_positions[idx] = int(min(max(scaled, 0), new_total))
            sum_other_sq += scaled_positions[idx] * scaled_positions[idx]
        scaled_positions[anchor] = isqrt(max(0, new_total * new_total - sum_other_sq))
        self.state.reserves = np.array(
            [new_total - scaled_positions[idx] for idx in range(self.num_bins)],
            dtype=np.int64,
        )
        self.state.total_minted = new_total

    def _scale_config_bin(self, configured_bin: int) -> int:
        """Map a config bin index from the 256-bin default grid to the active grid."""
        if self.num_bins <= 1:
            return 0
        scaled = configured_bin * self.num_bins // max(1, DEFAULT_NUM_BINS)
        return int(min(max(scaled, 0), self.num_bins - 1))

    def _agent_mix_counts(self) -> dict[str, int]:
        allocations = [
            ("noise", self.agent_mix.noise),
            ("informed", self.agent_mix.informed),
            ("arbitrageur", self.agent_mix.arbitrageur),
            ("manipulator", self.agent_mix.manipulator),
            ("late_round_whale", self.agent_mix.late_round_whale),
            ("lp_passive", self.agent_mix.lp_passive),
            ("lp_rebalancing", self.agent_mix.lp_rebalancing),
        ]
        positive = [(name, fraction) for name, fraction in allocations if fraction > 0]
        counts = {name: 0 for name, _ in allocations}
        if not positive:
            return counts

        total_fraction = sum(fraction for _, fraction in positive)
        normalized = [(name, fraction / total_fraction) for name, fraction in positive]
        scaled_percentages = [fraction * 100.0 for _, fraction in normalized]
        if all(abs(value - round(value)) < 1e-9 for value in scaled_percentages):
            target_population = 100
        else:
            min_positive = min(fraction for _, fraction in normalized)
            target_population = int(min(100, max(len(normalized), round(1.0 / min_positive))))

        raw_counts = [(name, fraction * target_population) for name, fraction in normalized]
        for name, raw in raw_counts:
            counts[name] = int(np.floor(raw))

        assigned = sum(counts.values())
        remaining = target_population - assigned
        if remaining > 0:
            remainders = sorted(
                (
                    raw - counts[name],
                    idx,
                    name,
                )
                for idx, (name, raw) in enumerate(raw_counts)
            )
            for _, _, name in reversed(remainders[-remaining:]):
                counts[name] += 1

        return counts

    def _capital_pool_for_fraction(self, fraction: float) -> int:
        return int(round(self.initial_liquidity * max(0.0, fraction)))

    def _lp_effective_liquidity(self, agent, deposited: int, activity_counts: np.ndarray) -> float:
        if deposited <= 0:
            return 0.0
        if not isinstance(agent, RebalancingLP) or agent.last_weights is None:
            return float(deposited)
        total_activity = float(np.sum(activity_counts))
        if total_activity <= 0:
            return float(deposited)

        activity_share = activity_counts.astype(np.float64) / total_activity
        uniform_alignment = 1.0 / max(1, self.num_bins)
        alignment = float(np.dot(agent.last_weights.astype(np.float64), activity_share))
        max_excess = max(1e-12, 1.0 - uniform_alignment)
        concentration_bonus = max(0.0, (alignment - uniform_alignment) / max_excess)
        multiplier = 1.0 + concentration_bonus * max(0.0, agent.concentration_factor - 1.0)
        return float(deposited) * multiplier

    def _create_agents(self) -> None:
        """Create agents using deterministic apportionment from configured fractions."""
        mix = self.agent_mix
        agent_id = 0
        counts = self._agent_mix_counts()

        # Noise traders
        n_noise = counts["noise"]
        noise_params = NoiseParams()
        noise_capital = self._capital_pool_for_fraction(mix.noise) // max(1, n_noise) if n_noise > 0 else 0
        for _ in range(n_noise):
            agent = NoiseTrader(
                agent_id=agent_id,
                capital=noise_capital,
                trade_min=noise_params.trade_min,
                trade_max=noise_params.trade_max,
                frequency=noise_params.frequency,
                rng=np.random.default_rng(self.rng.integers(0, 2**31)),
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=noise_capital, holdings={}
            )
            agent_id += 1

        # Informed traders
        n_informed = counts["informed"]
        informed_params = InformedParams()
        informed_capital = self._capital_pool_for_fraction(mix.informed) // max(1, n_informed) if n_informed > 0 else 0
        for _ in range(n_informed):
            capital = min(informed_params.capital_limit, informed_capital)
            agent = InformedTrader(
                agent_id=agent_id,
                capital=capital,
                conviction=informed_params.conviction,
                true_distribution=self.true_weights,
                true_mu=self.true_mu,
                true_sigma=self.true_sigma,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=capital, holdings={}
            )
            agent_id += 1

        # Arbitrageurs
        n_arb = counts["arbitrageur"]
        arb_params = ArbitrageurParams()
        arb_capital = self._capital_pool_for_fraction(mix.arbitrageur) // max(1, n_arb) if n_arb > 0 else 0
        for _ in range(n_arb):
            agent = Arbitrageur(
                agent_id=agent_id,
                capital=arb_capital,
                min_edge=arb_params.min_edge,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=arb_capital, holdings={}
            )
            agent_id += 1

        # Manipulators
        n_manip = counts["manipulator"]
        manip_params = ManipulatorParams()
        target_bin = self._scale_config_bin(manip_params.target_bin)
        manip_budget = manip_params.budget // max(1, n_manip) if n_manip > 0 else 0
        for _ in range(n_manip):
            agent = Manipulator(
                agent_id=agent_id,
                budget=manip_budget,
                target_bin=int(target_bin),
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=manip_budget, holdings={}
            )
            agent_id += 1

        # Late-round whales
        n_whale = counts["late_round_whale"]
        whale_params = WhaleParams()
        whale_target = self._scale_config_bin(whale_params.target_bin)
        whale_budget = whale_params.budget // max(1, n_whale) if n_whale > 0 else 0
        for _ in range(n_whale):
            agent = LateRoundWhale(
                agent_id=agent_id,
                budget=whale_budget,
                target_bin=int(whale_target),
                activation_round_pct=whale_params.activation_round_pct,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=whale_budget, holdings={}
            )
            agent_id += 1

        # Passive LPs
        n_lp_passive = counts["lp_passive"]
        lp_params = LpPassiveParams()
        passive_lp_capital = self._capital_pool_for_fraction(mix.lp_passive) // max(1, n_lp_passive) if n_lp_passive > 0 else 0
        for _ in range(n_lp_passive):
            agent = PassiveLP(
                agent_id=agent_id,
                capital=passive_lp_capital,
                yield_threshold=lp_params.yield_threshold,
                loss_tolerance=lp_params.loss_tolerance,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=passive_lp_capital, holdings={}
            )
            agent_id += 1

        # Rebalancing LPs
        n_lp_rebal = counts["lp_rebalancing"]
        lp_rebal_params = LpRebalancingParams()
        rebalancing_lp_capital = self._capital_pool_for_fraction(mix.lp_rebalancing) // max(1, n_lp_rebal) if n_lp_rebal > 0 else 0
        for _ in range(n_lp_rebal):
            agent = RebalancingLP(
                agent_id=agent_id,
                capital=rebalancing_lp_capital,
                yield_threshold=lp_rebal_params.yield_threshold,
                loss_tolerance=lp_rebal_params.loss_tolerance,
                rebalance_interval=lp_rebal_params.rebalance_interval,
                concentration_factor=lp_rebal_params.concentration_factor,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=rebalancing_lp_capital, holdings={}
            )
            agent_id += 1

    def _apply_fee(
        self, gross: int, outcome: int, current_round: int, agent_id: int = -1
    ) -> dict:
        """Apply the selected fee model and return fee breakdown."""
        if self.fee_model == FEE_FLAT:
            return flat_fee(gross)
        elif self.fee_model == FEE_DYNAMIC:
            probs = self._current_implied_probs()
            return dynamic_fee(gross, probs)
        elif self.fee_model == FEE_TIERED:
            agent_state = self.agent_states.get(agent_id)
            vol = agent_state.cumulative_volume if agent_state else 0
            return tiered_fee(gross, cumulative_volume=vol)
        elif self.fee_model == FEE_SPREAD:
            probs = self._current_implied_probs()
            return spread_fee(gross, outcome, probs)
        elif self.fee_model == FEE_TIME_WEIGHTED:
            return time_weighted_fee(gross, current_round, self.num_rounds)
        else:
            return flat_fee(gross)

    def _execute_distribution_trade(self, action: DistributionTradeAction, current_round: int) -> None:
        """Execute a Gaussian-weighted trade using the design's weight function."""
        agent_state = self.agent_states.get(action.agent_id)
        if agent_state is None or action.amount <= 0:
            return

        weights = self.weight_fn(
            self.range_min,
            self.range_max,
            self.num_bins,
            action.mu,
            action.sigma,
        )
        if int(np.sum(weights)) <= 0:
            return

        try:
            if action.side == "buy":
                if agent_state.capital < action.amount:
                    return
                fee_info = self._apply_fee(action.amount, action.bin_idx, current_round, action.agent_id)
                net_amount = fee_info["net_amount"]
                if net_amount <= 0:
                    return
                tokens_out, new_total = compute_distribution_buy(
                    self.state.reserves,
                    self.state.total_minted,
                    weights,
                    net_amount,
                )
                self.state.total_minted = new_total
                agent_state.capital -= action.amount
                for idx, tokens in enumerate(tokens_out):
                    if tokens > 0:
                        agent_state.holdings[idx] = agent_state.holdings.get(idx, 0) + int(tokens)
                agent_state.cumulative_volume += action.amount
                self.state.lp_fee_accumulated += fee_info["lp_fee"]
                self.state.protocol_fee_accumulated += fee_info["protocol_fee"]
            elif action.side == "sell":
                total_held = int(sum(agent_state.holdings.values()))
                tokens_in = min(total_held, action.amount)
                if tokens_in <= 0:
                    return
                required = (weights.astype(np.int64) * tokens_in // SCALE).astype(np.int64)
                for idx, need in enumerate(required):
                    if agent_state.holdings.get(idx, 0) < int(need):
                        return
                collateral_out, new_total = compute_distribution_sell(
                    self.state.reserves,
                    self.state.total_minted,
                    weights,
                    tokens_in,
                )
                fee_info = self._apply_fee(collateral_out, action.bin_idx, current_round, action.agent_id)
                self.state.total_minted = new_total
                for idx, need in enumerate(required):
                    if need > 0:
                        agent_state.holdings[idx] = agent_state.holdings.get(idx, 0) - int(need)
                agent_state.capital += fee_info["net_amount"]
                agent_state.cumulative_volume += collateral_out
                self.state.lp_fee_accumulated += fee_info["lp_fee"]
                self.state.protocol_fee_accumulated += fee_info["protocol_fee"]
        except (AssertionError, ValueError, OverflowError, ZeroDivisionError):
            pass

    def _execute_trade(self, action: TradeAction, current_round: int) -> None:
        """Execute a single trade action with fee application."""
        agent_state = self.agent_states.get(action.agent_id)
        if agent_state is None:
            return

        try:
            if action.side == "buy":
                # For buys: deduct fee from collateral first, then pass net to compute_buy
                fee_info = self._apply_fee(action.amount, action.bin_idx, current_round, action.agent_id)
                net_amount = fee_info["net_amount"]
                if net_amount <= 0:
                    return

                # Check agent has enough capital
                if agent_state.capital < action.amount:
                    return

                tokens_out, new_total = compute_buy(
                    self.state.reserves, self.state.total_minted,
                    action.bin_idx, net_amount,
                )

                self.state.total_minted = new_total
                agent_state.capital -= action.amount
                agent_state.holdings[action.bin_idx] = (
                    agent_state.holdings.get(action.bin_idx, 0) + tokens_out
                )
                agent_state.cumulative_volume += action.amount

                # Accumulate fees
                self.state.lp_fee_accumulated += fee_info["lp_fee"]
                self.state.protocol_fee_accumulated += fee_info["protocol_fee"]

            elif action.side == "sell":
                # For sells: check agent has tokens for that bin
                held = agent_state.holdings.get(action.bin_idx, 0)
                if held <= 0:
                    return

                # Also check the position is large enough in the AMM
                position = self.state.total_minted - int(self.state.reserves[action.bin_idx])
                if position <= 0:
                    return

                # tokens_in is the amount the agent holds (capped by position)
                tokens_in = min(held, position)
                if tokens_in <= 0:
                    return

                collateral_out, new_total = compute_sell(
                    self.state.reserves, self.state.total_minted,
                    action.bin_idx, tokens_in,
                )

                self.state.total_minted = new_total

                # For sells: fee is deducted from collateral returned
                fee_info = self._apply_fee(collateral_out, action.bin_idx, current_round, action.agent_id)
                net_collateral = fee_info["net_amount"]

                agent_state.holdings[action.bin_idx] = held - tokens_in
                agent_state.capital += net_collateral
                agent_state.cumulative_volume += collateral_out

                self.state.lp_fee_accumulated += fee_info["lp_fee"]
                self.state.protocol_fee_accumulated += fee_info["protocol_fee"]

        except (AssertionError, ValueError, OverflowError, ZeroDivisionError):
            # Silently skip failed trades (invariant violations, insufficient liquidity, etc.)
            pass

    def _process_lp_agents(self, round_num: int, activity_counts: np.ndarray) -> None:
        """Process LP deposit/withdraw decisions and attribute fees per LP type."""
        if self.num_rounds <= 0:
            return
        total_lp_deposited = self.state.passive_lp_deposited + self.state.rebalancing_lp_deposited

        # Compute fee yield: LP fees this round / total deposited (approximate)
        # Use accumulated fees divided by rounds elapsed as a per-round estimate
        rounds_elapsed = max(1, round_num)
        baseline_capital = max(self.initial_liquidity, total_lp_deposited)
        fee_yield = self.state.lp_fee_accumulated / rounds_elapsed / max(1, baseline_capital)

        # Estimate unrealized loss: compare current pool value to total deposited
        unrealized_loss = 0.0
        if total_lp_deposited > 0:
            unrealized_loss = max(0.0, 1.0 - self.state.total_minted / total_lp_deposited)

        for agent in self.agents:
            if not isinstance(agent, (PassiveLP, RebalancingLP)):
                continue
            if isinstance(agent, RebalancingLP):
                agent.last_weights = agent.compute_rebalance_weights(
                    activity_counts=activity_counts,
                    num_bins=self.num_bins,
                    current_round=round_num,
                )
            decision = agent.decide_lp(fee_yield, unrealized_loss, round_num)
            if decision is None:
                continue
            agent_state = self.agent_states[agent.agent_id]
            if decision["type"] == "deposit":
                amount = decision["amount"]
                if amount <= 0 or agent_state.capital < amount:
                    continue
                agent_state.capital -= amount
                agent_state.deposited_lp += amount
                self._rescale_amm_pool(amount)
                if isinstance(agent, PassiveLP):
                    self.state.passive_lp_deposited += amount
                else:
                    self.state.rebalancing_lp_deposited += amount
            elif decision["type"] == "withdraw":
                amount = decision["amount"]
                if amount <= 0:
                    continue
                self._rescale_amm_pool(-amount)
                agent_state.capital += amount
                agent_state.deposited_lp = max(0, agent_state.deposited_lp - amount)
                if isinstance(agent, PassiveLP):
                    self.state.passive_lp_deposited = max(0, self.state.passive_lp_deposited - amount)
                    agent.deposited = 0
                else:
                    self.state.rebalancing_lp_deposited = max(0, self.state.rebalancing_lp_deposited - amount)
                    agent.deposited = 0

        # Attribute LP fees using concentration-aware effective liquidity.
        current_total_lp_deposited = self.state.passive_lp_deposited + self.state.rebalancing_lp_deposited
        if current_total_lp_deposited > 0 and self.state.lp_fee_accumulated > 0:
            passive_effective = 0.0
            rebalancing_effective = 0.0
            for agent in self.agents:
                if not isinstance(agent, (PassiveLP, RebalancingLP)):
                    continue
                agent_state = self.agent_states[agent.agent_id]
                effective = self._lp_effective_liquidity(agent, agent_state.deposited_lp, activity_counts)
                if isinstance(agent, PassiveLP):
                    passive_effective += effective
                else:
                    rebalancing_effective += effective

            total_effective = passive_effective + rebalancing_effective
            if total_effective > 0:
                passive_share = passive_effective / total_effective
                self.state.passive_lp_fees = int(self.state.lp_fee_accumulated * passive_share)
                self.state.rebalancing_lp_fees = self.state.lp_fee_accumulated - self.state.passive_lp_fees
            else:
                self.state.passive_lp_fees = 0
                self.state.rebalancing_lp_fees = 0

    def _execute_clob_trade(self, action: TradeAction, current_round: int) -> None:
        """Execute a trade via the CLOB orderbook."""
        agent_state = self.agent_states.get(action.agent_id)
        if agent_state is None or self.orderbook is None:
            return

        self.clob_total_orders += 1

        try:
            current_probs = self._current_implied_probs()
            ref_price = max(1, int(current_probs[action.bin_idx]))
            tick = max(1, ref_price // 20)
            if action.side == "buy":
                if agent_state.capital < action.amount:
                    return
                price = min(SCALE, ref_price + tick)
                token_size = max(1, int(action.amount * SCALE // price))
                order = Order(
                    agent_id=action.agent_id,
                    bin_idx=action.bin_idx,
                    price=price,
                    size=token_size,
                    side=Side.BUY,
                )
                fills = self.orderbook.place_order(order)
                self.clob_total_fills += len(fills)
                filled_notional = 0
                for fill in fills:
                    notional = fill.size * fill.price // SCALE
                    self.clob_total_fill_volume += fill.size
                    filled_notional += notional
                    fee_info = self._apply_fee(notional, fill.bin_idx, current_round, action.agent_id)
                    buyer = self.agent_states.get(fill.taker_id)
                    seller = self.agent_states.get(fill.maker_id)
                    self.clob_last_prices[fill.bin_idx] = fill.price
                    if buyer and buyer.capital >= notional:
                        buyer.capital -= notional
                        buyer.holdings[fill.bin_idx] = buyer.holdings.get(fill.bin_idx, 0) + fill.size
                        buyer.cumulative_volume += notional
                    if seller:
                        seller.capital += fee_info["net_amount"]
                        seller.cumulative_volume += notional
                    self.state.lp_fee_accumulated += fee_info["lp_fee"]
                    self.state.protocol_fee_accumulated += fee_info["protocol_fee"]
                # Lock remaining unfilled amount as resting collateral.
                if order.size > 0:
                    remaining_notional = order.size * order.price // SCALE
                    agent_state.capital -= min(remaining_notional, agent_state.capital)

            elif action.side == "sell":
                held = agent_state.holdings.get(action.bin_idx, 0)
                if held <= 0:
                    return
                price = max(1, ref_price - tick)
                sell_size = min(action.amount, held)
                order = Order(
                    agent_id=action.agent_id,
                    bin_idx=action.bin_idx,
                    price=price,
                    size=sell_size,
                    side=Side.SELL,
                )
                fills = self.orderbook.place_order(order)
                self.clob_total_fills += len(fills)
                sold_tokens = 0
                for fill in fills:
                    notional = fill.size * fill.price // SCALE
                    self.clob_total_fill_volume += fill.size
                    sold_tokens += fill.size
                    fee_info = self._apply_fee(notional, fill.bin_idx, current_round, action.agent_id)
                    seller = self.agent_states.get(fill.taker_id)
                    buyer = self.agent_states.get(fill.maker_id)
                    self.clob_last_prices[fill.bin_idx] = fill.price
                    if seller:
                        seller.holdings[fill.bin_idx] = max(0, seller.holdings.get(fill.bin_idx, 0) - fill.size)
                        seller.capital += fee_info["net_amount"]
                        seller.cumulative_volume += notional
                    if buyer:
                        buyer.holdings[fill.bin_idx] = buyer.holdings.get(fill.bin_idx, 0) + fill.size
                        buyer.cumulative_volume += notional
                    self.state.lp_fee_accumulated += fee_info["lp_fee"]
                    self.state.protocol_fee_accumulated += fee_info["protocol_fee"]
                if order.size > 0:
                    agent_state.holdings[action.bin_idx] = max(
                        0,
                        agent_state.holdings.get(action.bin_idx, 0) - order.size,
                    )
                if sold_tokens > 0 or order.size > 0:
                    self.trade_activity[action.bin_idx] += sold_tokens + order.size

        except (AssertionError, ValueError, OverflowError, ZeroDivisionError):
            pass
        finally:
            self._refresh_clob_implied_probs()

    def _run_trade_round(self, round_num: int) -> None:
        """Run a single trading round: agents decide, shuffle, execute."""
        implied_probs = self._current_implied_probs()

        # Collect all actions from trading agents
        all_actions: list[TradeAction] = []
        for agent in self.agents:
            if isinstance(agent, (PassiveLP, RebalancingLP)):
                continue
            actions = agent.decide(
                implied_probs, self.state.total_minted, round_num, self.num_rounds
            )
            all_actions.extend(actions)

        # Shuffle actions to avoid ordering bias
        self.rng.shuffle(all_actions)

        # Execute all trades — route through orderbook for CLOB, AMM otherwise
        if self.design == DESIGN_CLOB:
            for action in all_actions:
                self._execute_clob_trade(action, round_num)
        else:
            for action in all_actions:
                if isinstance(action, DistributionTradeAction):
                    self._execute_distribution_trade(action, round_num)
                else:
                    self._execute_trade(action, round_num)
                self.trade_activity[action.bin_idx] += action.amount

        # Process LP deposit/withdraw decisions after trading
        self._process_lp_agents(round_num, self.trade_activity.copy())

        # Snapshot KL divergence every 10 rounds
        if round_num % 10 == 0:
            amm_probs = self._current_implied_probs()
            amm_probs_float = amm_probs.astype(np.float64) / SCALE
            amm_probs_float = np.clip(amm_probs_float, 1e-12, None)
            amm_probs_float /= amm_probs_float.sum()  # renormalize
            kl = kl_divergence(self.true_probs, amm_probs_float)
            self.kl_series.append(kl)

        # Snapshot slippage at mid-run
        if round_num == self.num_rounds // 2 and self.mid_run_slippages is None:
            mid_bin = self.num_bins // 2  # representative bin
            mid_slippages = {}
            for frac in [0.01, 0.05, 0.10, 0.25]:
                if self.design == DESIGN_CLOB:
                    depth = max(1, self.orderbook.total_depth(mid_bin, Side.SELL) if self.orderbook else 1)
                    trade_size = max(1, int(depth * frac))
                    mid_price = max(1.0 / SCALE, float(self._current_implied_probs()[mid_bin]) / SCALE)
                    ask = self.orderbook.best_ask(mid_bin) if self.orderbook else None
                    exec_price = float(ask if ask is not None else self._current_implied_probs()[mid_bin]) / SCALE
                    fill_ratio = min(1.0, depth / max(1, trade_size))
                    sl = max(0.0, (exec_price - mid_price) / mid_price + (1.0 - fill_ratio))
                else:
                    sl = compute_slippage(
                        self.state.reserves.copy(), self.state.total_minted,
                        mid_bin, frac,
                    )
                mid_slippages[f"mid_slippage_{frac}"] = sl
            self.mid_run_slippages = mid_slippages

    def _resolve(self) -> int:
        """Sample resolved value and map to bin."""
        resolved_value = self.rng.normal(self.true_mu, self.true_sigma)
        # Clamp to range
        resolved_value = max(self.range_min, min(self.range_max - 1, resolved_value))
        resolved_bin = value_to_bin(
            int(resolved_value), self.range_min, self.range_max, self.num_bins
        )
        return resolved_bin

    def _compute_payouts(self, resolved_bin: int) -> np.ndarray:
        """Dispatch to the appropriate settlement function based on design."""
        if self.design in (DESIGN_BASELINE_A, DESIGN_BASELINE_B):
            return compute_payout_wta(self.num_bins, resolved_bin)
        elif self.design == DESIGN_PIECEWISE:
            span = self.range_max - self.range_min
            bw = compute_dynamic_bandwidth(self.num_bins, span, DEFAULT_TARGET_PAYOUT_WIDTH)
            return compute_payout_piecewise(self.num_bins, resolved_bin, bw)
        elif self.design == DESIGN_KERNEL:
            span = self.range_max - self.range_min
            bw = compute_dynamic_bandwidth(self.num_bins, span, DEFAULT_TARGET_PAYOUT_WIDTH)
            return compute_payout_kernel(self.num_bins, resolved_bin, bw)
        elif self.design == DESIGN_SCALAR:
            probs = compute_probabilities(self.state.reserves, self.state.total_minted)
            return compute_payout_scalar(probs)
        elif self.design == DESIGN_CRPS:
            # CRPS payouts are per-trader; for aggregate metrics (boundary sensitivity)
            # use kernel-smoothed shape as the payout surface proxy
            span = self.range_max - self.range_min
            bw = compute_dynamic_bandwidth(self.num_bins, span, DEFAULT_TARGET_PAYOUT_WIDTH)
            return compute_payout_kernel(self.num_bins, resolved_bin, bw)
        elif self.design == DESIGN_CLOB:
            # CLOB uses piecewise-linear settlement (same dynamic bandwidth)
            span = self.range_max - self.range_min
            bw = compute_dynamic_bandwidth(self.num_bins, span, DEFAULT_TARGET_PAYOUT_WIDTH)
            return compute_payout_piecewise(self.num_bins, resolved_bin, bw)
        else:
            return compute_payout_wta(self.num_bins, resolved_bin)

    def _compute_clob_avg_spread(self) -> float:
        """Average bid-ask spread across all bins with two-sided quotes."""
        if self.orderbook is None:
            return 0.0
        spreads = []
        for b in range(self.num_bins):
            bid = self.orderbook.best_bid(b)
            ask = self.orderbook.best_ask(b)
            if bid is not None and ask is not None and ask > bid:
                spreads.append((ask - bid) / SCALE)
        return float(np.mean(spreads)) if spreads else 0.0

    def _compute_clob_total_depth(self) -> int:
        """Total resting order depth across all bins and sides."""
        if self.orderbook is None:
            return 0
        total = 0
        for b in range(self.num_bins):
            total += self.orderbook.total_depth(b, Side.BUY)
            total += self.orderbook.total_depth(b, Side.SELL)
        return total

    def _compute_all_metrics(self, resolved_bin: int, payouts: np.ndarray) -> dict:
        """Compute all 8 metrics and return as dict."""
        # Price accuracy: final KL divergence (lower = better)
        amm_probs = self._current_implied_probs()
        amm_probs_float = amm_probs.astype(np.float64) / SCALE
        amm_probs_float = np.clip(amm_probs_float, 1e-12, None)
        amm_probs_float /= amm_probs_float.sum()
        price_accuracy = kl_divergence(self.true_probs, amm_probs_float)

        # Convergence speed
        conv_speed = convergence_speed(self.kl_series, snapshot_interval=10)

        # Capital efficiency: slippage at various trade fractions (end-of-run)
        slippages = {}
        for frac in [0.01, 0.05, 0.10, 0.25]:
            if self.design == DESIGN_CLOB:
                depth = max(1, self.orderbook.total_depth(resolved_bin, Side.SELL) if self.orderbook else 1)
                trade_size = max(1, int(depth * frac))
                mid_price = max(1.0 / SCALE, float(amm_probs[resolved_bin]) / SCALE)
                ask = self.orderbook.best_ask(resolved_bin) if self.orderbook else None
                exec_price = float(ask if ask is not None else amm_probs[resolved_bin]) / SCALE
                fill_ratio = min(1.0, depth / max(1, trade_size))
                sl = max(0.0, (exec_price - mid_price) / mid_price + (1.0 - fill_ratio))
            else:
                sl = compute_slippage(
                    self.state.reserves.copy(), self.state.total_minted,
                    resolved_bin, frac,
                )
            slippages[f"slippage_{frac}"] = sl

        # Include mid-run slippages
        if self.mid_run_slippages:
            slippages.update(self.mid_run_slippages)

        # LP profitability (aggregate + per-type)
        total_lp_deposited = self.state.passive_lp_deposited + self.state.rebalancing_lp_deposited
        pool_capital = self.initial_liquidity + total_lp_deposited

        if self.state.passive_lp_deposited > 0 and pool_capital > 0:
            passive_current_value = int(
                self.state.total_minted * self.state.passive_lp_deposited / pool_capital
            )
            passive_impermanent_loss = self.state.passive_lp_deposited - passive_current_value
            lp_passive_profit = lp_profitability(
                self.state.passive_lp_fees,
                self.state.passive_lp_deposited,
                passive_impermanent_loss,
            )
        else:
            lp_passive_profit = 0.0

        if self.state.rebalancing_lp_deposited > 0 and pool_capital > 0:
            rebal_current_value = int(
                self.state.total_minted * self.state.rebalancing_lp_deposited / pool_capital
            )
            rebal_impermanent_loss = self.state.rebalancing_lp_deposited - rebal_current_value
            lp_rebalancing_profit = lp_profitability(
                self.state.rebalancing_lp_fees,
                self.state.rebalancing_lp_deposited,
                rebal_impermanent_loss,
            )
        else:
            lp_rebalancing_profit = 0.0

        if total_lp_deposited > 0 and pool_capital > 0:
            total_lp_current_value = int(self.state.total_minted * total_lp_deposited / pool_capital)
            total_impermanent_loss = total_lp_deposited - total_lp_current_value
            lp_profit = lp_profitability(
                self.state.lp_fee_accumulated,
                total_lp_deposited,
                total_impermanent_loss,
            )
        else:
            lp_profit = 0.0

        # Manipulation resistance
        if self.initial_probs is not None:
            manip_agents = [a for a in self.agents if isinstance(a, Manipulator)]
            target_bin = manip_agents[0].target_bin if manip_agents else resolved_bin
            final_prob = float(amm_probs[target_bin]) / SCALE
            init_prob = float(self.initial_probs[target_bin]) / SCALE
            price_change = abs(final_prob - init_prob) * 100.0
            manip_resist = manipulation_cost(self.manipulator_budget_spent, price_change)
        else:
            manip_resist = float("inf")

        # Late-round whale payout capture (scalar design stress test)
        whale_payout_share = 0.0
        whale_budget_spent = 0
        whale_capital_to_majority = float("inf")
        whale_agents = [a for a in self.agents if isinstance(a, LateRoundWhale)]
        if whale_agents and self.design == DESIGN_SCALAR:
            whale_ids = {a.agent_id for a in whale_agents}
            whale_budget_spent = sum(a.spent for a in whale_agents)
            total_payout = 0
            whale_payout = 0
            for aid, astate in self.agent_states.items():
                for bin_idx, tokens in astate.holdings.items():
                    if tokens > 0:
                        payout_per_token = int(payouts[bin_idx])
                        agent_payout = tokens * payout_per_token // SCALE
                        total_payout += agent_payout
                        if aid in whale_ids:
                            whale_payout += agent_payout
            if total_payout > 0:
                whale_payout_share = whale_payout / total_payout
                if whale_payout_share > 0.5:
                    whale_capital_to_majority = float(whale_budget_spent)

        # Resolution fairness
        fairness_window = min(DEFAULT_RESOLUTION_FAIRNESS_BINS, max(0, self.num_bins - 1))
        trader_payouts_list = []
        trader_distances_list = []
        ideal_payouts_list = []
        payout_by_distance_actual: dict[int, int] = {}
        payout_by_distance_ideal: dict[int, int] = {}
        for aid, astate in self.agent_states.items():
            total_agent_tokens = int(sum(astate.holdings.values()))
            trader_crps_payout = 0
            if self.design == DESIGN_CRPS and total_agent_tokens > 0:
                holdings_arr = np.zeros(self.num_bins, dtype=np.int64)
                for b, t in astate.holdings.items():
                    holdings_arr[b] = t
                trader_crps_payout = compute_payout_crps(holdings_arr, resolved_bin, self.num_bins)

            trader_payout = 0
            ideal_payout = 0
            closest_distance = self.num_bins
            for bin_idx, tokens in astate.holdings.items():
                if tokens > 0:
                    distance = abs(bin_idx - resolved_bin)
                    if distance > fairness_window:
                        continue
                    if self.design == DESIGN_CRPS:
                        if total_agent_tokens > 0:
                            actual_component = trader_crps_payout * tokens // total_agent_tokens
                        else:
                            actual_component = 0
                    else:
                        payout_per_token = int(payouts[bin_idx])
                        actual_component = tokens * payout_per_token // SCALE

                    closeness = 1.0 - (distance / max(1, fairness_window + 1))
                    ideal_component = int(tokens * closeness)
                    if ideal_component <= 0:
                        continue

                    trader_payout += actual_component
                    ideal_payout += ideal_component
                    closest_distance = min(closest_distance, distance)
                    payout_by_distance_actual[distance] = payout_by_distance_actual.get(distance, 0) + actual_component
                    payout_by_distance_ideal[distance] = payout_by_distance_ideal.get(distance, 0) + ideal_component

            if ideal_payout > 0:
                trader_payouts_list.append(trader_payout)
                trader_distances_list.append(closest_distance if closest_distance < self.num_bins else 0)
                ideal_payouts_list.append(ideal_payout)

        if trader_payouts_list:
            res_fair = resolution_fairness(
                np.array(trader_payouts_list, dtype=np.int64),
                np.array(trader_distances_list, dtype=np.int64),
                np.array(ideal_payouts_list, dtype=np.int64),
                max_distance=fairness_window,
            )
        else:
            res_fair = 0.0

        # Payout by distance bins (for heatmap): mean payout ratio at each distance
        payout_by_distance: dict[int, float] = {}
        for distance, actual_total in sorted(payout_by_distance_actual.items()):
            ideal_total = payout_by_distance_ideal.get(distance, 0)
            if ideal_total > 0:
                payout_by_distance[distance] = float(actual_total / ideal_total)

        # Boundary sensitivity
        bs_max, bs_mean = boundary_sensitivity(payouts)

        # Exitability
        # Aggregate all agent holdings into a single array
        reference_holdings = np.zeros(self.num_bins, dtype=np.int64)
        informed_ids = {a.agent_id for a in self.agents if isinstance(a, InformedTrader)}
        for agent_id in informed_ids:
            astate = self.agent_states[agent_id]
            for bin_idx, tokens in astate.holdings.items():
                reference_holdings[bin_idx] += tokens
        if int(np.sum(reference_holdings)) == 0:
            synthetic_total = max(1, self.state.total_minted // 100)
            base_weights = self.weight_fn(
                self.range_min, self.range_max, self.num_bins, self.true_mu, self.true_sigma
            )
            for idx, weight in enumerate(base_weights.astype(np.int64)):
                tokens = synthetic_total * int(weight) // SCALE
                if tokens > 0:
                    reference_holdings[idx] = tokens

        exit_result = exitability(
            self.state.reserves.copy(),
            self.state.total_minted,
            reference_holdings,
            self.weight_fn,
            self.range_min,
            self.range_max,
            self.num_bins,
            self.true_mu,
            self.true_sigma,
        )

        # Flatten slippages into individual columns + compute mean
        mean_slippage = sum(slippages.values()) / len(slippages) if slippages else 0.0

        return {
            "price_accuracy": price_accuracy,
            "convergence_speed": conv_speed,
            "capital_efficiency": slippages,
            **slippages,
            "mean_slippage": mean_slippage,
            "lp_profitability": lp_profit,
            "lp_passive_profitability": lp_passive_profit,
            "lp_rebalancing_profitability": lp_rebalancing_profit,
            "manipulation_resistance": manip_resist,
            "whale_payout_share": whale_payout_share,
            "whale_budget_spent": whale_budget_spent,
            "whale_capital_to_majority": whale_capital_to_majority,
            "resolution_fairness": res_fair,
            "payout_by_distance": payout_by_distance,
            "boundary_sensitivity_max": bs_max,
            "boundary_sensitivity_mean": bs_mean,
            "exitability_unwind": exit_result["max_unwind_fraction"],
            "exitability_slippage": exit_result["unwind_slippage"],
            "exitability_reposition_cost": exit_result["reposition_cost"],
            "num_rounds": self.num_rounds,
            "design": self.design,
            "fee_model": self.fee_model,
            "resolved_bin": -1,  # placeholder, set by caller
            "kl_series": self.kl_series,
            # CLOB-specific metrics
            "clob_total_orders": self.clob_total_orders,
            "clob_total_fills": self.clob_total_fills,
            "clob_fill_rate": self.clob_total_fills / max(1, self.clob_total_orders),
            "clob_fill_volume": self.clob_total_fill_volume,
            "clob_avg_spread": self._compute_clob_avg_spread() if self.orderbook else 0,
            "clob_total_depth": self._compute_clob_total_depth() if self.orderbook else 0,
        }

    def run(self) -> dict:
        """Execute the full simulation lifecycle and return results."""
        # Record initial state for manipulation resistance metric
        self.initial_probs = self._current_implied_probs().copy()

        # Track manipulator spending
        manip_agents = [a for a in self.agents if isinstance(a, Manipulator)]
        initial_spent = sum(a.spent for a in manip_agents)

        # Trade rounds
        for round_num in range(self.num_rounds):
            self._run_trade_round(round_num)

        # Track manipulator spending after all rounds
        final_spent = sum(a.spent for a in manip_agents)
        self.manipulator_budget_spent = final_spent - initial_spent

        # Resolve
        resolved_bin = self._resolve()

        # Compute payouts
        payouts = self._compute_payouts(resolved_bin)

        # Compute all metrics
        results = self._compute_all_metrics(resolved_bin, payouts)
        results["resolved_bin"] = resolved_bin

        return results
