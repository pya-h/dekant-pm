"""CRPS (Continuous Ranked Probability Score) settlement.
Discretized CRPS for a single trader:
  CRPS = sum_b |F(b) - 1{b >= resolved_bin}|^2
Lower CRPS = better forecast. Inverted so higher = more payout."""
import numpy as np
from config.params import SCALE

def compute_crps_score(holdings: np.ndarray, resolved_bin: int, num_bins: int) -> float:
    """Compute discretized CRPS. Lower = better forecast."""
    total_held = np.sum(holdings).astype(np.float64)
    if total_held == 0:
        return float(num_bins)
    cdf = np.cumsum(holdings.astype(np.float64)) / total_held
    indicator = np.zeros(num_bins, dtype=np.float64)
    indicator[resolved_bin:] = 1.0
    crps = float(np.sum((cdf - indicator) ** 2))
    return crps

def compute_payout_crps(holdings: np.ndarray, resolved_bin: int, num_bins: int) -> int:
    """CRPS-based payout for a single trader. Returns SCALE-denominated value."""
    crps = compute_crps_score(holdings, resolved_bin, num_bins)
    max_crps = float(num_bins)
    inverted = max_crps - crps
    if inverted <= 0:
        return 0
    payout = int(inverted / max_crps * SCALE)
    return min(payout, SCALE)
