"""Informed trader: trades toward the true distribution."""
import numpy as np
from agents.base import TradeAction
from config.params import SCALE


class InformedTrader:
    def __init__(self, agent_id: int, capital: int, conviction: float, true_distribution: np.ndarray):
        self.agent_id = agent_id
        self.capital = capital
        self.conviction = conviction
        self.true_distribution = true_distribution

    def decide(self, implied_probs, total_minted, current_round, total_rounds) -> list[TradeAction]:
        actions = []
        if self.capital <= 0:
            return actions
        mispricings = self.true_distribution.astype(np.float64) - implied_probs.astype(np.float64)
        for i in range(len(mispricings)):
            if mispricings[i] > 0:
                frac = (mispricings[i] / SCALE) * self.conviction
                amount = int(min(frac * self.capital, self.capital * 0.1))
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=i, side="buy", amount=amount))
        return actions
