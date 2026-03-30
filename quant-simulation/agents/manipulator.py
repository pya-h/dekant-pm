"""Manipulator: aggressively buys a target bin to inflate its price."""
from agents.base import TradeAction


class Manipulator:
    def __init__(self, agent_id: int, budget: int, target_bin: int):
        self.agent_id = agent_id
        self.budget = budget
        self.spent = 0
        self.target_bin = target_bin

    def decide(self, implied_probs, total_minted, current_round, total_rounds) -> list[TradeAction]:
        remaining = self.budget - self.spent
        if remaining <= 0:
            return []
        amount = min(remaining // 10, remaining)
        if amount <= 0:
            return []
        self.spent += amount
        return [TradeAction(agent_id=self.agent_id, bin_idx=self.target_bin, side="buy", amount=amount)]
