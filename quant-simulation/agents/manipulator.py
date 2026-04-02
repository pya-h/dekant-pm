"""Manipulator: multi-strategy agent that attempts to exploit the market."""
import numpy as np
from agents.base import DecisionContext, TradeAction

STRATEGIES = ("price_distortion", "payout_capture", "boundary_crossing", "late_gaming")


class Manipulator:
    def __init__(self, agent_id: int, budget: int, target_bin: int, strategy: str = "price_distortion"):
        self.agent_id = agent_id
        self.budget = budget
        self.target_bin = target_bin
        if strategy not in STRATEGIES:
            strategy = "price_distortion"
        self.strategy = strategy
        # Track which adjacent bin to target next for boundary_crossing
        self._boundary_toggle = False

    def decide(self, ctx: DecisionContext) -> list[TradeAction]:
        remaining = ctx.agent_state.capital
        if remaining <= 0:
            return []

        if self.strategy == "price_distortion":
            return self._strategy_price_distortion(ctx, remaining)
        elif self.strategy == "payout_capture":
            return self._strategy_payout_capture(ctx, remaining)
        elif self.strategy == "boundary_crossing":
            return self._strategy_boundary_crossing(ctx, remaining)
        elif self.strategy == "late_gaming":
            return self._strategy_late_gaming(ctx, remaining)
        else:
            return self._strategy_price_distortion(ctx, remaining)

    def _base_spend_frac(self, ctx: DecisionContext) -> float:
        """Design-aware base spend fraction."""
        rule = ctx.settlement_rule
        if rule == "scalar":
            spend_frac = 0.2
        elif rule == "crps":
            spend_frac = 0.05
        else:
            spend_frac = 0.1
        return spend_frac

    def _compute_amount(self, spend_frac: float, remaining: int) -> int:
        amount = min(int(remaining * spend_frac), remaining)
        if amount <= 0:
            amount = min(1, remaining)
        return amount

    def _strategy_price_distortion(self, ctx: DecisionContext, remaining: int) -> list[TradeAction]:
        """Original behavior: buy target bin to inflate its price."""
        spend_frac = self._base_spend_frac(ctx)

        # Late-stage: double spend fraction
        if ctx.total_rounds > 0 and ctx.current_round / ctx.total_rounds > 0.8:
            spend_frac *= 2.0

        amount = self._compute_amount(spend_frac, remaining)
        if amount <= 0:
            return []

        # Capital bookkeeping is handled by the simulation engine via AgentState
        return [TradeAction(agent_id=self.agent_id, bin_idx=self.target_bin, side="buy", amount=amount)]

    def _strategy_payout_capture(self, ctx: DecisionContext, remaining: int) -> list[TradeAction]:
        """After 50% of rounds, buy the bin with highest implied probability.
        Before 50%, do small random buys on the target bin."""
        progress = ctx.current_round / max(1, ctx.total_rounds)
        spend_frac = self._base_spend_frac(ctx)

        if progress <= 0.5:
            # Small random buys before midpoint
            spend_frac *= 0.3
            amount = self._compute_amount(spend_frac, remaining)
            if amount <= 0:
                return []
            # Capital bookkeeping is handled by the simulation engine via AgentState
            return [TradeAction(agent_id=self.agent_id, bin_idx=self.target_bin, side="buy", amount=amount)]

        # After midpoint: find bin with highest implied probability and buy it
        probs = ctx.implied_probs.astype(np.float64)
        peak_bin = int(np.argmax(probs))

        # Late-stage boost
        if progress > 0.8:
            spend_frac *= 2.0

        amount = self._compute_amount(spend_frac, remaining)
        if amount <= 0:
            return []

        # Capital bookkeeping is handled by the simulation engine via AgentState
        return [TradeAction(agent_id=self.agent_id, bin_idx=peak_bin, side="buy", amount=amount)]

    def _strategy_boundary_crossing(self, ctx: DecisionContext, remaining: int) -> list[TradeAction]:
        """Buy adjacent bins alternately to push mass across a boundary."""
        spend_frac = self._base_spend_frac(ctx)

        # Late-stage: double spend fraction
        if ctx.total_rounds > 0 and ctx.current_round / ctx.total_rounds > 0.8:
            spend_frac *= 2.0

        n_bins = len(ctx.implied_probs)
        if self._boundary_toggle:
            adj_bin = min(self.target_bin + 1, n_bins - 1)
        else:
            adj_bin = max(self.target_bin - 1, 0)
        self._boundary_toggle = not self._boundary_toggle

        amount = self._compute_amount(spend_frac, remaining)
        if amount <= 0:
            return []

        # Capital bookkeeping is handled by the simulation engine via AgentState
        return [TradeAction(agent_id=self.agent_id, bin_idx=adj_bin, side="buy", amount=amount)]

    def _strategy_late_gaming(self, ctx: DecisionContext, remaining: int) -> list[TradeAction]:
        """Stay dormant until last 15% of rounds, then aggressively buy the cheapest bin."""
        progress = ctx.current_round / max(1, ctx.total_rounds)
        if progress < 0.85:
            return []

        # Find the cheapest bin (lowest implied probability)
        probs = ctx.implied_probs.astype(np.float64)
        cheapest_bin = int(np.argmin(probs))

        # Aggressive: use 3x base spend fraction
        spend_frac = self._base_spend_frac(ctx) * 3.0

        amount = self._compute_amount(spend_frac, remaining)
        if amount <= 0:
            return []

        # Capital bookkeeping is handled by the simulation engine via AgentState
        return [TradeAction(agent_id=self.agent_id, bin_idx=cheapest_bin, side="buy", amount=amount)]
