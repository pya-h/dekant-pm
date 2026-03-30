"""Winner-take-all settlement — current on-chain behavior."""
import numpy as np
from config.params import SCALE

def compute_payout_wta(num_bins: int, resolved_bin: int) -> np.ndarray:
    """Winner-take-all: resolved bin gets SCALE, all others get 0."""
    payouts = np.zeros(num_bins, dtype=np.int64)
    payouts[resolved_bin] = SCALE
    return payouts
