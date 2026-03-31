"""LP agents: passive and rebalancing strategies."""
import numpy as np
from agents.base import AgentState


class PassiveLP:
    def __init__(self, agent_id: int, yield_threshold: float, loss_tolerance: float):
        self.agent_id = agent_id
        self.yield_threshold = yield_threshold
        self.loss_tolerance = loss_tolerance

    def decide_lp(
        self,
        fee_yield: float,
        unrealized_loss: float,
        current_round: int,
        agent_state: AgentState,
    ) -> dict | None:
        deposited = agent_state.deposited_lp
        capital = agent_state.capital

        if unrealized_loss > self.loss_tolerance and deposited > 0:
            return {"type": "withdraw", "amount": deposited, "agent_id": self.agent_id}

        if fee_yield >= self.yield_threshold and deposited == 0:
            deposit = capital // 2
            if deposit > 0:
                return {"type": "deposit", "amount": deposit, "agent_id": self.agent_id}

        return None


class RebalancingLP:
    def __init__(
        self,
        agent_id: int,
        yield_threshold: float,
        loss_tolerance: float,
        rebalance_interval: int,
        concentration_factor: float,
    ):
        self.agent_id = agent_id
        self.yield_threshold = yield_threshold
        self.loss_tolerance = loss_tolerance
        self.rebalance_interval = rebalance_interval
        self.concentration_factor = concentration_factor
        self.last_weights = None

    def decide_lp(
        self,
        fee_yield: float,
        unrealized_loss: float,
        current_round: int,
        agent_state: AgentState,
    ) -> dict | None:
        deposited = agent_state.deposited_lp
        capital = agent_state.capital

        if unrealized_loss > self.loss_tolerance and deposited > 0:
            return {"type": "withdraw", "amount": deposited, "agent_id": self.agent_id}

        if fee_yield >= self.yield_threshold and deposited == 0:
            deposit = capital // 2
            if deposit > 0:
                return {"type": "deposit", "amount": deposit, "agent_id": self.agent_id}

        return None

    def compute_rebalance_weights(self, activity_counts, num_bins, current_round) -> np.ndarray:
        uniform = np.ones(num_bins, dtype=np.float64) / num_bins
        if current_round % self.rebalance_interval != 0:
            return self.last_weights.copy() if self.last_weights is not None else uniform
        total_activity = float(np.sum(activity_counts))
        if total_activity == 0:
            return self.last_weights.copy() if self.last_weights is not None else uniform
        activity_share = activity_counts.astype(np.float64) / total_activity
        weights = uniform + self.concentration_factor * activity_share
        weights /= weights.sum()
        self.last_weights = weights.copy()
        return weights
