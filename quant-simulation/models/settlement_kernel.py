"""Kernel-smoothed Gaussian settlement."""
import numpy as np
from config.params import SCALE

def compute_payout_kernel(num_bins: int, resolved_bin: int, bandwidth: int) -> np.ndarray:
    """Gaussian-kernel payout with peak normalization at the resolved bin."""
    bins = np.arange(num_bins, dtype=np.float64)
    distances = bins - resolved_bin
    raw = np.exp(-distances**2 / (2.0 * bandwidth**2))
    peak = raw.max()
    if peak == 0:
        payouts = np.zeros(num_bins, dtype=np.int64)
        payouts[resolved_bin] = SCALE
        return payouts
    normalized = (raw / peak * SCALE).astype(np.int64)
    normalized[resolved_bin] = SCALE
    return normalized
