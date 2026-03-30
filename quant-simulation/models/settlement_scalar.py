"""Scalar settlement — payout proportional to final implied probability."""
import numpy as np
from config.params import SCALE

def compute_payout_scalar(implied_probabilities: np.ndarray) -> np.ndarray:
    """Payout each bin proportional to its final implied probability. Normalized to SCALE."""
    total = int(np.sum(implied_probabilities))
    if total == 0:
        n = len(implied_probabilities)
        payouts = np.full(n, SCALE // n, dtype=np.int64)
        payouts[0] += SCALE - int(np.sum(payouts))
        return payouts
    payouts = (implied_probabilities.astype(np.int64) * SCALE // total).astype(np.int64)
    diff = SCALE - int(np.sum(payouts))
    if diff != 0:
        max_idx = int(np.argmax(payouts))
        payouts[max_idx] += diff
    return payouts
