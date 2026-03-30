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
)
from models.math_engine import (
    init_reserves,
    compute_buy,
    compute_sell,
    compute_probabilities,
    value_to_bin,
)
from models.weights import compute_bin_weights_taylor4, compute_bin_weights_exact
from models.settlement_baseline import compute_payout_wta
from models.settlement_piecewise import compute_payout_piecewise, compute_dynamic_bandwidth
from models.settlement_kernel import compute_payout_kernel
from models.settlement_scalar import compute_payout_scalar
from models.settlement_crps import compute_payout_crps
from models.fee_models import flat_fee, dynamic_fee, tiered_fee, spread_fee, time_weighted_fee
from agents.base import TradeAction, AgentState
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


# ---------------------------------------------------------------------------
# SimulationRun
# ---------------------------------------------------------------------------

class SimulationRun:
    """Execute a complete market lifecycle: init, trade rounds, resolve, measure."""

    def __init__(
        self,
        design: int,
        fee_model: int,
        num_bins: int = 16,
        initial_liquidity: int = 1_000_000_000,
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

        # Compute true distribution weights (as bin probabilities)
        self.true_weights = self.weight_fn(
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

        # Tracking
        self.kl_series: list[float] = []
        self.manipulator_budget_spent = 0
        self.initial_probs: np.ndarray | None = None

    def _create_agents(self) -> None:
        """Create agents based on agent_mix fractions (~10 agents per type fraction)."""
        mix = self.agent_mix
        agent_id = 0
        base_count = 10  # scale factor

        agent_capital = self.initial_liquidity // 10  # each agent gets ~10% of pool

        # Noise traders
        n_noise = max(1, int(mix.noise * base_count))
        noise_params = NoiseParams()
        for _ in range(n_noise):
            agent = NoiseTrader(
                agent_id=agent_id,
                capital=agent_capital,
                trade_min=noise_params.trade_min,
                trade_max=noise_params.trade_max,
                frequency=noise_params.frequency,
                rng=np.random.default_rng(self.rng.integers(0, 2**31)),
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=agent_capital, holdings={}
            )
            agent_id += 1

        # Informed traders
        n_informed = max(1, int(mix.informed * base_count))
        informed_params = InformedParams()
        for _ in range(n_informed):
            agent = InformedTrader(
                agent_id=agent_id,
                capital=min(informed_params.capital_limit, agent_capital),
                conviction=informed_params.conviction,
                true_distribution=self.true_weights,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=min(informed_params.capital_limit, agent_capital), holdings={}
            )
            agent_id += 1

        # Arbitrageurs
        n_arb = max(1, int(mix.arbitrageur * base_count))
        arb_params = ArbitrageurParams()
        for _ in range(n_arb):
            agent = Arbitrageur(
                agent_id=agent_id,
                capital=agent_capital,
                min_edge=arb_params.min_edge,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=agent_capital, holdings={}
            )
            agent_id += 1

        # Manipulators
        n_manip = max(1, int(mix.manipulator * base_count))
        manip_params = ManipulatorParams()
        target_bin = self.rng.integers(0, self.num_bins)
        for _ in range(n_manip):
            agent = Manipulator(
                agent_id=agent_id,
                budget=manip_params.budget,
                target_bin=int(target_bin),
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=manip_params.budget, holdings={}
            )
            agent_id += 1

        # Late-round whales
        n_whale = max(1, int(mix.late_round_whale * base_count))
        whale_params = WhaleParams()
        whale_target = self.rng.integers(0, self.num_bins)
        for _ in range(n_whale):
            agent = LateRoundWhale(
                agent_id=agent_id,
                budget=whale_params.budget,
                target_bin=int(whale_target),
                activation_round_pct=whale_params.activation_round_pct,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=whale_params.budget, holdings={}
            )
            agent_id += 1

        # Passive LPs
        n_lp_passive = max(1, int(mix.lp_passive * base_count))
        lp_params = LpPassiveParams()
        for _ in range(n_lp_passive):
            agent = PassiveLP(
                agent_id=agent_id,
                capital=agent_capital,
                yield_threshold=lp_params.yield_threshold,
                loss_tolerance=lp_params.loss_tolerance,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=agent_capital, holdings={}
            )
            agent_id += 1

        # Rebalancing LPs
        n_lp_rebal = max(1, int(mix.lp_rebalancing * base_count))
        lp_rebal_params = LpRebalancingParams()
        for _ in range(n_lp_rebal):
            agent = RebalancingLP(
                agent_id=agent_id,
                capital=agent_capital,
                yield_threshold=lp_rebal_params.yield_threshold,
                loss_tolerance=lp_rebal_params.loss_tolerance,
                rebalance_interval=lp_rebal_params.rebalance_interval,
                concentration_factor=lp_rebal_params.concentration_factor,
            )
            self.agents.append(agent)
            self.agent_states[agent_id] = AgentState(
                agent_id=agent_id, capital=agent_capital, holdings={}
            )
            agent_id += 1

    def _apply_fee(
        self, gross: int, outcome: int, current_round: int
    ) -> dict:
        """Apply the selected fee model and return fee breakdown."""
        if self.fee_model == FEE_FLAT:
            return flat_fee(gross)
        elif self.fee_model == FEE_DYNAMIC:
            probs = compute_probabilities(self.state.reserves, self.state.total_minted)
            return dynamic_fee(gross, probs)
        elif self.fee_model == FEE_TIERED:
            # Use a cumulative volume of 0 (simplified — per-agent volume not tracked here)
            return tiered_fee(gross, cumulative_volume=0)
        elif self.fee_model == FEE_SPREAD:
            probs = compute_probabilities(self.state.reserves, self.state.total_minted)
            return spread_fee(gross, outcome, probs)
        elif self.fee_model == FEE_TIME_WEIGHTED:
            return time_weighted_fee(gross, current_round, self.num_rounds)
        else:
            return flat_fee(gross)

    def _execute_trade(self, action: TradeAction, current_round: int) -> None:
        """Execute a single trade action with fee application."""
        agent_state = self.agent_states.get(action.agent_id)
        if agent_state is None:
            return

        try:
            if action.side == "buy":
                # For buys: deduct fee from collateral first, then pass net to compute_buy
                fee_info = self._apply_fee(action.amount, action.bin_idx, current_round)
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
                fee_info = self._apply_fee(collateral_out, action.bin_idx, current_round)
                net_collateral = fee_info["net_amount"]

                agent_state.holdings[action.bin_idx] = held - tokens_in
                agent_state.capital += net_collateral
                agent_state.cumulative_volume += collateral_out

                self.state.lp_fee_accumulated += fee_info["lp_fee"]
                self.state.protocol_fee_accumulated += fee_info["protocol_fee"]

        except (AssertionError, ValueError, OverflowError, ZeroDivisionError):
            # Silently skip failed trades (invariant violations, insufficient liquidity, etc.)
            pass

    def _run_trade_round(self, round_num: int) -> None:
        """Run a single trading round: agents decide, shuffle, execute."""
        implied_probs = compute_probabilities(self.state.reserves, self.state.total_minted)

        # Collect all actions from all agents
        all_actions: list[TradeAction] = []
        for agent in self.agents:
            if isinstance(agent, (PassiveLP, RebalancingLP)):
                # LP agents use decide_lp, not trade actions on the AMM directly
                continue
            actions = agent.decide(
                implied_probs, self.state.total_minted, round_num, self.num_rounds
            )
            all_actions.extend(actions)

        # Shuffle actions to avoid ordering bias
        self.rng.shuffle(all_actions)

        # Execute all trades
        for action in all_actions:
            self._execute_trade(action, round_num)

        # Snapshot KL divergence every 10 rounds
        if round_num % 10 == 0:
            amm_probs = compute_probabilities(self.state.reserves, self.state.total_minted)
            amm_probs_float = amm_probs.astype(np.float64) / SCALE
            amm_probs_float = np.clip(amm_probs_float, 1e-12, None)
            amm_probs_float /= amm_probs_float.sum()  # renormalize
            kl = kl_divergence(self.true_probs, amm_probs_float)
            self.kl_series.append(kl)

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
            # CRPS payouts are per-trader; return WTA-like payouts for the aggregate metric
            return compute_payout_wta(self.num_bins, resolved_bin)
        elif self.design == DESIGN_CLOB:
            # CLOB uses WTA settlement
            return compute_payout_wta(self.num_bins, resolved_bin)
        else:
            return compute_payout_wta(self.num_bins, resolved_bin)

    def _compute_all_metrics(self, resolved_bin: int, payouts: np.ndarray) -> dict:
        """Compute all 8 metrics and return as dict."""
        # Price accuracy: final KL divergence (lower = better)
        amm_probs = compute_probabilities(self.state.reserves, self.state.total_minted)
        amm_probs_float = amm_probs.astype(np.float64) / SCALE
        amm_probs_float = np.clip(amm_probs_float, 1e-12, None)
        amm_probs_float /= amm_probs_float.sum()
        price_accuracy = kl_divergence(self.true_probs, amm_probs_float)

        # Convergence speed
        conv_speed = convergence_speed(self.kl_series)

        # Capital efficiency: slippage at various trade fractions
        slippages = {}
        for frac in [0.001, 0.01, 0.05]:
            # Pick a representative bin (the resolved bin)
            sl = compute_slippage(
                self.state.reserves.copy(), self.state.total_minted,
                resolved_bin, frac,
            )
            slippages[f"slippage_{frac}"] = sl

        # LP profitability
        lp_profit = lp_profitability(
            self.state.lp_fee_accumulated,
            self.initial_liquidity,
            self.state.total_minted,
        )

        # Manipulation resistance
        if self.initial_probs is not None:
            final_probs = amm_probs.astype(np.float64)
            init_probs = self.initial_probs.astype(np.float64)
            price_change = 0.0
            if np.sum(init_probs) > 0:
                price_change = float(np.max(np.abs(final_probs - init_probs))) / SCALE * 100
            manip_resist = manipulation_cost(self.manipulator_budget_spent, price_change)
        else:
            manip_resist = float("inf")

        # Resolution fairness
        # Build trader payouts and ideal payouts arrays
        trader_payouts_list = []
        trader_distances_list = []
        ideal_payouts_list = []
        for aid, astate in self.agent_states.items():
            for bin_idx, tokens in astate.holdings.items():
                if tokens > 0:
                    payout_per_token = int(payouts[bin_idx])
                    trader_payout = tokens * payout_per_token // SCALE
                    trader_payouts_list.append(trader_payout)
                    trader_distances_list.append(abs(bin_idx - resolved_bin))
                    # Ideal payout: tokens * true_weight_of_bin / SCALE
                    tw = float(self.true_weights[bin_idx])
                    ideal = int(tokens * tw / SCALE) if tw > 0 else 0
                    ideal_payouts_list.append(ideal)

        if trader_payouts_list:
            res_fair = resolution_fairness(
                np.array(trader_payouts_list, dtype=np.int64),
                np.array(trader_distances_list, dtype=np.int64),
                np.array(ideal_payouts_list, dtype=np.int64),
            )
        else:
            res_fair = 0.0

        # Boundary sensitivity
        bs_max, bs_mean = boundary_sensitivity(payouts)

        # Exitability
        # Aggregate all agent holdings into a single array
        total_holdings = np.zeros(self.num_bins, dtype=np.int64)
        for astate in self.agent_states.values():
            for bin_idx, tokens in astate.holdings.items():
                total_holdings[bin_idx] += tokens

        exit_result = exitability(
            self.state.reserves.copy(), self.state.total_minted, total_holdings
        )

        return {
            "price_accuracy": price_accuracy,
            "convergence_speed": conv_speed,
            "capital_efficiency": slippages,
            "lp_profitability": lp_profit,
            "manipulation_resistance": manip_resist,
            "resolution_fairness": res_fair,
            "boundary_sensitivity_max": bs_max,
            "boundary_sensitivity_mean": bs_mean,
            "exitability_unwind": exit_result["max_unwind_fraction"],
            "exitability_slippage": exit_result["slippage_cost"],
            "num_rounds": self.num_rounds,
            "design": self.design,
            "fee_model": self.fee_model,
            "resolved_bin": -1,  # placeholder, set by caller
            "kl_series": self.kl_series,
        }

    def run(self) -> dict:
        """Execute the full simulation lifecycle and return results."""
        # Record initial state for manipulation resistance metric
        self.initial_probs = compute_probabilities(
            self.state.reserves, self.state.total_minted
        )

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
