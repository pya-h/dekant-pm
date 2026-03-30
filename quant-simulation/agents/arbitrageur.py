"""Arbitrageur: exploits mispricings between bins."""
import numpy as np
from agents.base import TradeAction
from config.params import SCALE


class Arbitrageur:
    def __init__(self, agent_id: int, capital: int, min_edge: float):
        self.agent_id = agent_id
        self.capital = capital
        self.min_edge = min_edge

    def decide(self, implied_probs, total_minted, current_round, total_rounds) -> list[TradeAction]:
        actions = []
        if self.capital <= 0:
            return actions
        n = len(implied_probs)
        total_prob = float(np.sum(implied_probs)) / SCALE
        if abs(total_prob - 1.0) > self.min_edge:
            if total_prob < 1.0:
                cheapest = int(np.argmin(implied_probs))
                amount = min(int(self.capital * 0.05), self.capital)
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=cheapest, side="buy", amount=amount))
            else:
                expensive = int(np.argmax(implied_probs))
                amount = min(int(self.capital * 0.05), self.capital)
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=expensive, side="sell", amount=amount))
        for i in range(n - 1):
            diff = abs(float(implied_probs[i] - implied_probs[i + 1])) / SCALE
            if diff > self.min_edge * 2:
                cheap = i if implied_probs[i] < implied_probs[i + 1] else i + 1
                amount = min(int(self.capital * 0.02), self.capital)
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=cheap, side="buy", amount=amount))
                break
        return actions
