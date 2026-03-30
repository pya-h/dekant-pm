"""Piecewise-linear (triangular) settlement with dynamic bandwidth."""
import numpy as np
import math
from config.params import SCALE

def compute_dynamic_bandwidth(num_bins: int, range_span: int, target_payout_width: int) -> int:
    """W = max(1, ceil(num_bins * target_payout_width / range_span))"""
    return max(1, math.ceil(num_bins * target_payout_width / range_span))

def compute_payout_piecewise(num_bins: int, resolved_bin: int, bandwidth: int) -> np.ndarray:
    """Piecewise-linear payout with peak normalization at the resolved bin."""
    bins = np.arange(num_bins, dtype=np.float64)
    distances = np.abs(bins - resolved_bin)
    raw = np.maximum(0.0, 1.0 - distances / bandwidth)
    peak = raw.max()
    if peak == 0:
        payouts = np.zeros(num_bins, dtype=np.int64)
        payouts[resolved_bin] = SCALE
        return payouts
    normalized = (raw / peak * SCALE).astype(np.int64)
    normalized[resolved_bin] = SCALE
    return normalized
