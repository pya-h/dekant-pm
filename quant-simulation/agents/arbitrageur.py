"""Arbitrageur: exploits mispricings between bins."""
import numpy as np
from agents.base import DecisionContext, TradeAction
from config.params import SCALE


class Arbitrageur:
    def __init__(self, agent_id: int, min_edge: float = 0.005):
        self.agent_id = agent_id
        self.min_edge = min_edge

    def decide(self, ctx: DecisionContext) -> list[TradeAction]:
        actions = []
        capital = ctx.agent_state.capital
        if capital <= 0:
            return actions

        implied_probs = ctx.implied_probs
        n = len(implied_probs)

        # Attack 1: probability-sum deviation
        total_prob = float(np.sum(implied_probs)) / SCALE
        if abs(total_prob - 1.0) > self.min_edge:
            if total_prob < 1.0:
                cheapest = int(np.argmin(implied_probs))
                amount = min(int(capital * 0.05), capital)
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=cheapest, side="buy", amount=amount))
            else:
                expensive = int(np.argmax(implied_probs))
                amount = min(int(capital * 0.05), capital)
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=expensive, side="sell", amount=amount))

        # Attack 2: adjacent bin discontinuities
        for i in range(n - 1):
            diff = abs(float(implied_probs[i] - implied_probs[i + 1])) / SCALE
            if diff > self.min_edge * 2:
                cheap = i if implied_probs[i] < implied_probs[i + 1] else i + 1
                amount = min(int(capital * 0.02), capital)
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=cheap, side="buy", amount=amount))
                break

        # Attack 3: cross-bin shape violations (non-monotonic regions away from peak)
        if n > 2:
            peak = int(np.argmax(implied_probs))
            for i in range(1, peak - 1):
                # Left of peak: expect monotonically increasing — flag decreases
                if implied_probs[i] < implied_probs[i - 1] - self.min_edge * SCALE:
                    amount = min(int(capital * 0.01), capital)
                    if amount > 0:
                        actions.append(TradeAction(agent_id=self.agent_id, bin_idx=i, side="buy", amount=amount))
                    break
            for i in range(peak + 1, n - 1):
                # Right of peak: expect monotonically decreasing — flag increases
                if implied_probs[i] > implied_probs[i - 1] + self.min_edge * SCALE:
                    amount = min(int(capital * 0.01), capital)
                    if amount > 0:
                        actions.append(TradeAction(agent_id=self.agent_id, bin_idx=i, side="sell", amount=amount))
                    break

        return actions
