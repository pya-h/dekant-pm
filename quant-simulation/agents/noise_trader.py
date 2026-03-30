"""Noise trader: random trades modeling uninformed retail flow."""
import numpy as np
from agents.base import TradeAction


class NoiseTrader:
    def __init__(self, agent_id: int, capital: int, trade_min: int, trade_max: int, frequency: float, rng: np.random.Generator):
        self.agent_id = agent_id
        self.capital = capital
        self.trade_min = trade_min
        self.trade_max = trade_max
        self.frequency = frequency
        self.rng = rng

    def decide(self, implied_probs, total_minted, current_round, total_rounds) -> list[TradeAction]:
        if self.capital <= 0 or self.rng.random() > self.frequency:
            return []
        n_bins = len(implied_probs)
        bin_idx = int(self.rng.integers(0, n_bins))
        side = "buy" if self.rng.random() > 0.5 else "sell"
        amount = int(self.rng.integers(self.trade_min, min(self.trade_max, self.capital) + 1))
        amount = min(amount, self.capital)
        if amount <= 0:
            return []
        return [TradeAction(agent_id=self.agent_id, bin_idx=bin_idx, side=side, amount=amount)]
