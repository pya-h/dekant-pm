"""Noise trader: random trades modeling uninformed retail flow."""
import numpy as np
from agents.base import ActionType, DecisionContext, DistributionTradeAction, TradeAction


class NoiseTrader:
    def __init__(
        self,
        agent_id: int,
        trade_min: int,
        trade_max: int,
        frequency: float,
        rng: np.random.Generator,
    ):
        self.agent_id = agent_id
        self.trade_min = trade_min
        self.trade_max = trade_max
        self.frequency = frequency
        self.rng = rng

    def decide(self, ctx: DecisionContext) -> list[TradeAction]:
        capital = ctx.agent_state.capital
        if capital <= 0 or self.rng.random() > self.frequency:
            return []

        implied_probs = ctx.implied_probs
        n_bins = len(implied_probs)
        bin_idx = int(self.rng.integers(0, n_bins))
        side = "buy" if self.rng.random() > 0.5 else "sell"
        amount = int(self.rng.integers(self.trade_min, min(self.trade_max, capital) + 1))
        amount = min(amount, capital)
        if amount <= 0:
            return []

        # 30% chance of bundle trade if BUNDLE_BUY is allowed
        if self.rng.random() < 0.3 and ActionType.BUNDLE_BUY in ctx.allowed_actions:
            return [
                DistributionTradeAction(
                    agent_id=self.agent_id,
                    bin_idx=bin_idx,
                    side=side,
                    amount=amount,
                )
            ]

        return [TradeAction(agent_id=self.agent_id, bin_idx=bin_idx, side=side, amount=amount)]
