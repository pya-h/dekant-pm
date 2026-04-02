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

        # Attack 4: design-specific pricing inconsistencies
        actions.extend(self._attack_design_specific(ctx))

        return actions

    def _attack_design_specific(self, ctx: DecisionContext) -> list[TradeAction]:
        """Exploit pricing inconsistencies specific to the settlement rule design.

        Returns 0-2 TradeActions depending on settlement_rule.
        """
        result: list[TradeAction] = []
        capital = ctx.agent_state.capital
        implied_probs = ctx.implied_probs
        n = len(implied_probs)
        rule = ctx.settlement_rule

        if rule == "wta":
            # Winner-take-all: only the winning bin pays out.  Bins far from
            # the peak should be cheap.  If any bin far from peak (distance > 5)
            # still carries high implied probability, sell it.
            peak = int(np.argmax(implied_probs))
            peak_prob = float(implied_probs[peak]) / SCALE
            for i in range(n):
                if abs(i - peak) > 5:
                    bin_prob = float(implied_probs[i]) / SCALE
                    # If a far-from-peak bin has > 20% of peak probability, it's
                    # overpriced under WTA.
                    if bin_prob > peak_prob * 0.20 and bin_prob > self.min_edge:
                        amount = min(int(capital * 0.02), capital)
                        if amount > 0:
                            result.append(TradeAction(
                                agent_id=self.agent_id, bin_idx=i,
                                side="sell", amount=amount,
                            ))
                        if len(result) >= 2:
                            break

        elif rule == "scalar":
            # Scalar: all bins pay proportionally to final probability.
            # Look for inversions where a bin's implied probability is below
            # its neighbors on both sides (local minimum that shouldn't exist
            # in a smooth distribution).  Buy the underpriced bin.
            for i in range(1, n - 1):
                left = float(implied_probs[i - 1]) / SCALE
                center = float(implied_probs[i]) / SCALE
                right = float(implied_probs[i + 1]) / SCALE
                avg_neighbors = (left + right) / 2.0
                if center < avg_neighbors - self.min_edge and center > 0:
                    amount = min(int(capital * 0.02), capital)
                    if amount > 0:
                        result.append(TradeAction(
                            agent_id=self.agent_id, bin_idx=i,
                            side="buy", amount=amount,
                        ))
                    if len(result) >= 2:
                        break

        elif rule in ("piecewise", "kernel"):
            # Piecewise/kernel: smooth payouts around resolution bin.  Target
            # bins at the edge of the smoothing window where the transition
            # from high to zero payout creates opportunity.
            peak = int(np.argmax(implied_probs))
            # The smoothing window is roughly 3-5 bins around the peak.
            window_edge_offsets = [4, 5]
            for offset in window_edge_offsets:
                idx = peak + offset
                if 0 <= idx < n:
                    bin_prob = float(implied_probs[idx]) / SCALE
                    # If the transition-edge bin is suspiciously cheap, buy it
                    if bin_prob < self.min_edge and bin_prob > 0:
                        amount = min(int(capital * 0.01), capital)
                        if amount > 0:
                            result.append(TradeAction(
                                agent_id=self.agent_id, bin_idx=idx,
                                side="buy", amount=amount,
                            ))
                idx = peak - offset
                if 0 <= idx < n:
                    bin_prob = float(implied_probs[idx]) / SCALE
                    if bin_prob < self.min_edge and bin_prob > 0:
                        amount = min(int(capital * 0.01), capital)
                        if amount > 0:
                            result.append(TradeAction(
                                agent_id=self.agent_id, bin_idx=idx,
                                side="buy", amount=amount,
                            ))
                if len(result) >= 2:
                    break

        elif rule == "crps":
            # CRPS is a proper scoring rule — fewer exploitable inconsistencies.
            # Reduce activity: return no design-specific actions.
            pass

        return result[:2]
