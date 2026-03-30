"""LP agents: passive and rebalancing strategies."""
import numpy as np


class PassiveLP:
    def __init__(self, agent_id: int, capital: int, yield_threshold: float, loss_tolerance: float):
        self.agent_id = agent_id
        self.capital = capital
        self.deposited = 0
        self.yield_threshold = yield_threshold
        self.loss_tolerance = loss_tolerance

    def decide_lp(self, fee_yield: float, unrealized_loss: float, current_round: int) -> dict | None:
        if unrealized_loss > self.loss_tolerance and self.deposited > 0:
            return {"type": "withdraw", "amount": self.deposited, "agent_id": self.agent_id}
        if fee_yield >= self.yield_threshold and self.deposited == 0:
            deposit = self.capital // 2
            if deposit > 0:
                self.deposited = deposit
                return {"type": "deposit", "amount": deposit, "agent_id": self.agent_id}
        return None


class RebalancingLP:
    def __init__(self, agent_id, capital, yield_threshold, loss_tolerance, rebalance_interval, concentration_factor):
        self.agent_id = agent_id
        self.capital = capital
        self.deposited = 0
        self.yield_threshold = yield_threshold
        self.loss_tolerance = loss_tolerance
        self.rebalance_interval = rebalance_interval
        self.concentration_factor = concentration_factor

    def decide_lp(self, fee_yield, unrealized_loss, current_round) -> dict | None:
        if unrealized_loss > self.loss_tolerance and self.deposited > 0:
            return {"type": "withdraw", "amount": self.deposited, "agent_id": self.agent_id}
        if fee_yield >= self.yield_threshold and self.deposited == 0:
            deposit = self.capital // 2
            if deposit > 0:
                self.deposited = deposit
                return {"type": "deposit", "amount": deposit, "agent_id": self.agent_id}
        return None

    def compute_rebalance_weights(self, activity_counts, num_bins, current_round) -> np.ndarray:
        if current_round % self.rebalance_interval != 0:
            return np.ones(num_bins, dtype=np.float64) / num_bins
        total_activity = float(np.sum(activity_counts))
        if total_activity == 0:
            return np.ones(num_bins, dtype=np.float64) / num_bins
        activity_share = activity_counts.astype(np.float64) / total_activity
        uniform = np.ones(num_bins, dtype=np.float64) / num_bins
        weights = uniform + self.concentration_factor * activity_share
        weights /= weights.sum()
        return weights
