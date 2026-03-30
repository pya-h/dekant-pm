"""Gaussian weight generators for bin weight computation.

Two implementations:
1. taylor4_exp_neg_half / compute_bin_weights_taylor4 — faithful port of the
   on-chain normal_pdf.rs (Baseline A).  Deliberately reproduces the Taylor-4
   approximation error so simulation results match on-chain behaviour.
2. compute_bin_weights_exact — uses scipy.stats.norm for Baseline B and all
   redesign variants.
"""

import numpy as np
from scipy.stats import norm

from config.params import SCALE, Z_CUTOFF


# ---------------------------------------------------------------------------
# Taylor-4 approximation (faithful port of normal_pdf.rs::exp_neg_half_approx)
# ---------------------------------------------------------------------------

def taylor4_exp_neg_half(t_scaled: int) -> int:
    """Approximate exp(-t/2) in SCALE-denominated fixed-point.

    Faithful port of the on-chain Rust function ``exp_neg_half_approx``.
    Uses the degree-4 Taylor polynomial in Horner form:
        exp(-t/2) ≈ 1 - t/2 + t²/8 - t³/48 + t⁴/384
        Horner:    ((((1/384·t - 1/48)·t + 1/8)·t - 1/2)·t + 1)

    Args:
        t_scaled: z² expressed in SCALE-denominated fixed-point (i.e. z² * SCALE).

    Returns:
        exp(-t/2) in SCALE-denominated fixed-point, clamped to [0, SCALE].
        Returns 0 when t_scaled > Z_CUTOFF² * SCALE.
    """
    if t_scaled == 0:
        return SCALE

    cutoff = Z_CUTOFF * Z_CUTOFF * SCALE
    if t_scaled > cutoff:
        return 0

    # Integer arithmetic mirrors the on-chain i128 Horner evaluation.
    t = int(t_scaled)
    s = int(SCALE)

    c4: int = s // 384          #   2_604_166
    c3: int = -(s // 48)        # -20_833_333
    c2: int = s // 8            # 125_000_000
    c1: int = -(s // 2)         # -500_000_000
    c0: int = s                 # 1_000_000_000

    r = c4
    r = r * t // s + c3
    r = r * t // s + c2
    r = r * t // s + c1
    r = r * t // s + c0

    if r <= 0:
        return 0
    if r > s:
        # The polynomial overshoots at large z (approximation breakdown).
        # Return 0 rather than SCALE so that blown-up tail values don't
        # masquerade as high-weight bins during normalisation.
        return 0
    return r


def compute_bin_weights_taylor4(
    range_min: int,
    range_max: int,
    num_bins: int,
    mu: int,
    sigma: int,
) -> np.ndarray:
    """Compute normalised bin weights using the Taylor-4 approximation.

    Port of normal_pdf.rs::compute_bin_weights.  All inputs are SCALE-
    denominated integers (same convention as range_min/range_max on-chain).

    Returns:
        np.ndarray of shape (num_bins,) with dtype float64 whose sum equals
        SCALE (adjusted for rounding on the largest weight bin).
    """
    if num_bins == 0 or sigma == 0 or range_max <= range_min:
        return np.zeros(num_bins, dtype=np.float64)

    span = range_max - range_min
    sigma_sq = sigma * sigma
    cutoff_dist = Z_CUTOFF * sigma

    raw: list[int] = []
    total: int = 0

    for b in range(num_bins):
        # Bin centre: range_min + (2b + 1) * span // (2 * num_bins)
        center = range_min + (2 * b + 1) * span // (2 * num_bins)
        diff = center - mu

        if abs(diff) > cutoff_dist:
            raw.append(0)
            continue

        diff_sq = diff * diff
        z_sq_scaled = diff_sq * SCALE // sigma_sq
        w = taylor4_exp_neg_half(z_sq_scaled)
        raw.append(w)
        total += w

    if total == 0:
        return np.zeros(num_bins, dtype=np.float64)

    weights: list[int] = [
        w * SCALE // total if w != 0 else 0
        for w in raw
    ]

    # Adjust largest weight so the sum is exactly SCALE.
    current_sum = sum(weights)
    if current_sum != SCALE and current_sum > 0:
        max_idx = max(range(num_bins), key=lambda i: weights[i])
        target = SCALE
        if current_sum < target:
            weights[max_idx] += target - current_sum
        else:
            weights[max_idx] -= current_sum - target

    return np.array(weights, dtype=np.float64)


# ---------------------------------------------------------------------------
# Exact Gaussian via scipy.stats.norm
# ---------------------------------------------------------------------------

def compute_bin_weights_exact(
    range_min: int,
    range_max: int,
    num_bins: int,
    mu: int,
    sigma: int,
) -> np.ndarray:
    """Compute normalised bin weights using the exact Gaussian PDF.

    Uses ``scipy.stats.norm.pdf`` evaluated at each bin centre.  The result
    is normalised so that the sum equals SCALE, with the largest-weight bin
    adjusted to absorb any integer rounding residual.

    Args:
        range_min: Lower bound of the market range (SCALE-denominated int).
        range_max: Upper bound of the market range (SCALE-denominated int).
        num_bins:  Number of equal-width bins.
        mu:        Distribution mean (SCALE-denominated int).
        sigma:     Distribution standard deviation (SCALE-denominated int, > 0).

    Returns:
        np.ndarray of shape (num_bins,) with dtype float64 whose sum equals
        SCALE (adjusted for rounding on the largest weight bin).
    """
    if num_bins == 0 or sigma == 0 or range_max <= range_min:
        return np.zeros(num_bins, dtype=np.float64)

    span = range_max - range_min

    # Build array of bin centres using the same formula as the Taylor-4 port.
    bins = np.arange(num_bins, dtype=np.int64)
    centers = range_min + (2 * bins + 1) * span // (2 * num_bins)

    # Evaluate exact PDF (inputs converted to float; ratio preserves scale).
    mu_f = float(mu)
    sigma_f = float(sigma)
    pdf_vals = norm.pdf(centers.astype(np.float64), loc=mu_f, scale=sigma_f)

    total = pdf_vals.sum()
    if total == 0.0:
        return np.zeros(num_bins, dtype=np.float64)

    # Normalise to SCALE using integer rounding.
    raw_norm = (pdf_vals / total * SCALE).astype(np.int64)
    weights = raw_norm.tolist()

    # Adjust largest weight to absorb rounding residual.
    current_sum = sum(weights)
    if current_sum != SCALE and current_sum > 0:
        max_idx = int(np.argmax(weights))
        target = SCALE
        if current_sum < target:
            weights[max_idx] += target - current_sum
        else:
            weights[max_idx] -= current_sum - target

    return np.array(weights, dtype=np.float64)
