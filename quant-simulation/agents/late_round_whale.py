"""Late-round whale: only acts in final rounds, stress-tests scalar design."""
from agents.base import DecisionContext, TradeAction


class LateRoundWhale:
    def __init__(self, agent_id: int, budget: int, target_bin: int, activation_round_pct: float = 0.9):
        self.agent_id = agent_id
        self.budget = budget
        self.spent = 0
        self.target_bin = target_bin
        self.activation_round_pct = activation_round_pct
        self.red_team_only = True

    def decide(self, ctx: DecisionContext) -> list[TradeAction]:
        if ctx.current_round < ctx.total_rounds * self.activation_round_pct:
            return []
        remaining = self.budget - self.spent
        if remaining <= 0:
            return []
        rounds_left = max(1, ctx.total_rounds - ctx.current_round)
        amount = min(remaining // rounds_left, remaining)
        if amount <= 0:
            return []
        self.spent += amount
        return [TradeAction(agent_id=self.agent_id, bin_idx=self.target_bin, side="buy", amount=amount)]
