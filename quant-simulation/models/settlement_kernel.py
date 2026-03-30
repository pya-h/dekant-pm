"""Kernel-smoothed Gaussian settlement."""
import numpy as np
from config.params import SCALE

def compute_payout_kernel(num_bins: int, resolved_bin: int, bandwidth: int) -> np.ndarray:
    """Gaussian-kernel payout: exp(-distance^2 / (2 * bandwidth^2)), normalized to SCALE."""
    bins = np.arange(num_bins, dtype=np.float64)
    distances = bins - resolved_bin
    raw = np.exp(-distances**2 / (2.0 * bandwidth**2))
    total = raw.sum()
    if total == 0:
        payouts = np.zeros(num_bins, dtype=np.int64)
        payouts[resolved_bin] = SCALE
        return payouts
    normalized = (raw / total * SCALE).astype(np.int64)
    diff = SCALE - int(np.sum(normalized))
    if diff != 0:
        normalized[resolved_bin] += diff
    return normalized
