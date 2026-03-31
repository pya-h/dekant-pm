"""Manipulator: aggressively buys a target bin to inflate its price."""
from agents.base import DecisionContext, TradeAction


class Manipulator:
    def __init__(self, agent_id: int, budget: int, target_bin: int):
        self.agent_id = agent_id
        self.budget = budget
        self.spent = 0
        self.target_bin = target_bin

    def decide(self, ctx: DecisionContext) -> list[TradeAction]:
        remaining = self.budget - self.spent
        if remaining <= 0:
            return []

        # Design-aware spend fraction
        rule = ctx.settlement_rule
        if rule == "scalar":
            spend_frac = 0.2
        elif rule == "crps":
            spend_frac = 0.05
        else:
            spend_frac = 0.1

        # Late-stage: double spend fraction
        if ctx.total_rounds > 0 and ctx.current_round / ctx.total_rounds > 0.8:
            spend_frac *= 2.0

        amount = min(int(remaining * spend_frac), remaining)
        if amount <= 0:
            amount = min(1, remaining)
        if amount <= 0:
            return []

        self.spent += amount
        return [TradeAction(agent_id=self.agent_id, bin_idx=self.target_bin, side="buy", amount=amount)]
