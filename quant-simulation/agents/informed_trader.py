"""Informed trader: trades toward the true distribution."""
import numpy as np
from agents.base import ActionType, DecisionContext, DistributionTradeAction
from config.params import SCALE


class InformedTrader:
    def __init__(self, agent_id: int, conviction: float = 0.5):
        self.agent_id = agent_id
        self.conviction = conviction

    def decide(self, ctx: DecisionContext, true_distribution: np.ndarray) -> list[DistributionTradeAction]:
        actions = []
        capital = ctx.agent_state.capital
        if capital <= 0:
            return actions

        implied_probs = ctx.implied_probs
        true_total = float(np.sum(true_distribution))
        implied_total = float(np.sum(implied_probs))
        if true_total <= 0 or implied_total <= 0:
            return actions

        true_probs = true_distribution.astype(np.float64) / true_total
        market_probs = implied_probs.astype(np.float64) / implied_total
        mispricings = true_probs - market_probs
        bundle_edge = float(np.dot(mispricings, true_probs))
        if abs(bundle_edge) <= 1e-6:
            return actions

        # Scale conviction based on settlement rule
        conviction = self.conviction
        rule = ctx.settlement_rule
        if rule in ("piecewise", "kernel"):
            conviction *= 1.2
        elif rule == "crps":
            conviction *= 1.3
        elif rule == "scalar":
            conviction *= 0.5

        side = "buy" if bundle_edge > 0 else "sell"
        target_bin = int(np.argmax(mispricings)) if side == "buy" else int(np.argmin(mispricings))
        amount = int(min(capital * 0.1, capital * abs(bundle_edge) * conviction))

        if amount > 0:
            if side == "buy" and ActionType.BUNDLE_BUY not in ctx.allowed_actions:
                return actions
            if side == "sell" and ActionType.BUNDLE_SELL not in ctx.allowed_actions:
                return actions
            actions.append(
                DistributionTradeAction(
                    agent_id=self.agent_id,
                    bin_idx=target_bin,
                    side=side,
                    amount=amount,
                )
            )
        return actions
