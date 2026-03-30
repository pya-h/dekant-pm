"""Informed trader: trades toward the true distribution."""
import numpy as np
from agents.base import DistributionTradeAction
from config.params import SCALE


class InformedTrader:
    def __init__(
        self,
        agent_id: int,
        capital: int,
        conviction: float,
        true_distribution: np.ndarray,
        true_mu: int,
        true_sigma: int,
    ):
        self.agent_id = agent_id
        self.capital = capital
        self.conviction = conviction
        self.true_distribution = true_distribution
        self.true_mu = true_mu
        self.true_sigma = true_sigma

    def decide(self, implied_probs, total_minted, current_round, total_rounds) -> list[DistributionTradeAction]:
        actions = []
        if self.capital <= 0:
            return actions

        true_total = float(np.sum(self.true_distribution))
        implied_total = float(np.sum(implied_probs))
        if true_total <= 0 or implied_total <= 0:
            return actions

        true_probs = self.true_distribution.astype(np.float64) / true_total
        market_probs = implied_probs.astype(np.float64) / implied_total
        mispricings = true_probs - market_probs
        bundle_edge = float(np.dot(mispricings, true_probs))
        if abs(bundle_edge) <= 1e-6:
            return actions

        side = "buy" if bundle_edge > 0 else "sell"
        target_bin = int(np.argmax(mispricings)) if side == "buy" else int(np.argmin(mispricings))
        amount = int(min(self.capital * 0.1, self.capital * abs(bundle_edge) * self.conviction))
        if amount > 0:
            actions.append(
                DistributionTradeAction(
                    agent_id=self.agent_id,
                    bin_idx=target_bin,
                    side=side,
                    amount=amount,
                    mu=self.true_mu,
                    sigma=self.true_sigma,
                )
            )
        return actions
