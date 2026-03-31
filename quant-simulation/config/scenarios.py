"""Scenario framework: truth and belief family samplers for quantitative simulation.

Each sampler returns a dict with at minimum:
  weights: np.ndarray[int64] summing to SCALE
  mu: int (bin-space scaled)
  sigma: int (bin-space scaled)
Plus optional keys depending on family type.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np
from scipy.stats import norm, skewnorm

from config.params import SCALE


# ── Weight helpers ────────────────────────────────────────────────────────────

def _gaussian_weights(
    num_bins: int,
    mu: int,
    sigma: int,
    range_min: int,
    range_max: int,
) -> np.ndarray:
    """Compute Gaussian bin weights via scipy.stats.norm.pdf, normalized to SCALE."""
    bin_width = (range_max - range_min) / num_bins
    centers = np.array([range_min + (i + 0.5) * bin_width for i in range(num_bins)])
    pdf = norm.pdf(centers, loc=mu, scale=sigma)
    total = pdf.sum()
    if total == 0:
        # fallback: uniform
        weights = np.full(num_bins, SCALE // num_bins, dtype=np.int64)
        weights[0] += SCALE - weights.sum()
        return weights
    weights = (pdf / total * SCALE).astype(np.int64)
    # Fix rounding so weights sum exactly to SCALE
    weights[np.argmax(pdf)] += SCALE - weights.sum()
    return weights


def _skewed_weights(
    num_bins: int,
    mu: int,
    sigma: int,
    skewness: float,
    range_min: int,
    range_max: int,
) -> np.ndarray:
    """Compute skewed Gaussian bin weights via scipy.stats.skewnorm, normalized to SCALE."""
    bin_width = (range_max - range_min) / num_bins
    centers = np.array([range_min + (i + 0.5) * bin_width for i in range(num_bins)])
    pdf = skewnorm.pdf(centers, a=skewness, loc=mu, scale=sigma)
    total = pdf.sum()
    if total == 0:
        weights = np.full(num_bins, SCALE // num_bins, dtype=np.int64)
        weights[0] += SCALE - weights.sum()
        return weights
    weights = (pdf / total * SCALE).astype(np.int64)
    weights[np.argmax(pdf)] += SCALE - weights.sum()
    return weights


# ── Truth family samplers ─────────────────────────────────────────────────────

def _truth_gaussian_center(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Broad centered normal — mean near the middle, sigma 10–20% of range."""
    span = range_max - range_min
    mu = int(range_min + span * rng.uniform(0.35, 0.65))
    sigma = int(span * rng.uniform(0.10, 0.20))
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": mu, "sigma": sigma}


def _truth_gaussian_edge(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Narrow distribution near one range boundary — >30% mass in first/last 8 bins."""
    span = range_max - range_min
    # Place mean in the first or last 12.5% of the range
    if rng.random() < 0.5:
        # near low boundary
        mu = int(range_min + span * rng.uniform(0.01, 0.08))
    else:
        # near high boundary
        mu = int(range_max - span * rng.uniform(0.01, 0.08))
    sigma = int(span * rng.uniform(0.02, 0.06))
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": mu, "sigma": sigma}


def _truth_skewed(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Asymmetric distribution using scipy.stats.skewnorm."""
    span = range_max - range_min
    mu = int(range_min + span * rng.uniform(0.25, 0.75))
    sigma = int(span * rng.uniform(0.08, 0.18))
    # skewness between 2 and 8 in either direction
    magnitude = float(rng.uniform(2.0, 8.0))
    skewness = magnitude if rng.random() < 0.5 else -magnitude
    weights = _skewed_weights(num_bins, mu, sigma, skewness, range_min, range_max)
    return {"weights": weights, "mu": mu, "sigma": sigma}


def _truth_bimodal(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Two local peaks — blend of two Gaussians."""
    span = range_max - range_min
    # Place the two modes at least 25% apart
    gap = rng.uniform(0.25, 0.45)
    center = rng.uniform(0.25 + gap / 2, 0.75 - gap / 2)
    mu1 = int(range_min + span * (center - gap / 2))
    mu2 = int(range_min + span * (center + gap / 2))
    sigma = int(span * rng.uniform(0.04, 0.10))
    # Use mu of the dominant peak as representative
    w1_frac = rng.uniform(0.35, 0.65)
    pdf_centers = np.array(
        [range_min + (i + 0.5) * (span / num_bins) for i in range(num_bins)]
    )
    pdf1 = norm.pdf(pdf_centers, loc=mu1, scale=sigma)
    pdf2 = norm.pdf(pdf_centers, loc=mu2, scale=sigma)
    combined = w1_frac * pdf1 + (1 - w1_frac) * pdf2
    total = combined.sum()
    if total == 0:
        weights = _gaussian_weights(num_bins, mu1, sigma, range_min, range_max)
    else:
        weights = (combined / total * SCALE).astype(np.int64)
        weights[np.argmax(combined)] += SCALE - weights.sum()
    # Representative mu is the heavier mode
    mu = mu1 if w1_frac >= 0.5 else mu2
    return {"weights": weights, "mu": mu, "sigma": sigma}


def _truth_truncated(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Mass pressed against one boundary — mean very near the edge."""
    span = range_max - range_min
    # mu between 0–10% from low boundary or 90–100% from low (i.e. near high boundary)
    if rng.random() < 0.5:
        mu = int(range_min + span * rng.uniform(0.0, 0.10))
    else:
        mu = int(range_max - span * rng.uniform(0.0, 0.10))
    sigma = int(span * rng.uniform(0.05, 0.15))
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": mu, "sigma": sigma}


def _truth_regime_shift(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Truth changes during trading — returns shift_round_frac and post_shift_weights."""
    span = range_max - range_min
    # Initial distribution
    mu = int(range_min + span * rng.uniform(0.3, 0.7))
    sigma = int(span * rng.uniform(0.08, 0.18))
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    # Post-shift distribution — move the mean substantially
    shift_direction = 1 if rng.random() < 0.5 else -1
    shift_amount = span * rng.uniform(0.15, 0.35)
    post_mu = int(np.clip(mu + shift_direction * shift_amount, range_min, range_max))
    post_sigma = int(span * rng.uniform(0.08, 0.18))
    post_weights = _gaussian_weights(num_bins, post_mu, post_sigma, range_min, range_max)
    shift_round_frac = float(rng.uniform(0.2, 0.8))
    return {
        "weights": weights,
        "mu": mu,
        "sigma": sigma,
        "shift_round_frac": shift_round_frac,
        "post_shift_weights": post_weights,
        "post_shift_mu": post_mu,
        "post_shift_sigma": post_sigma,
    }


def _truth_adversarial_boundary(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Resolution near a bin edge — mass concentrated around a bin boundary."""
    span = range_max - range_min
    bin_width = span / num_bins
    # Pick a random interior bin boundary (not the very first or last)
    boundary_idx = int(rng.integers(4, num_bins - 4))
    boundary_value = int(range_min + boundary_idx * bin_width)
    # Tight distribution centered on the boundary
    sigma = int(bin_width * rng.uniform(0.5, 1.5))
    weights = _gaussian_weights(num_bins, boundary_value, sigma, range_min, range_max)
    return {
        "weights": weights,
        "mu": boundary_value,
        "sigma": sigma,
        "adversarial_bin": boundary_idx,
    }


# ── Belief family samplers ────────────────────────────────────────────────────

def _belief_gaussian(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Standard Gaussian belief."""
    span = range_max - range_min
    mu = int(range_min + span * rng.uniform(0.2, 0.8))
    sigma = int(span * rng.uniform(0.08, 0.20))
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": mu, "sigma": sigma}


def _belief_skewed(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Skewed belief distribution."""
    span = range_max - range_min
    mu = int(range_min + span * rng.uniform(0.2, 0.8))
    sigma = int(span * rng.uniform(0.08, 0.18))
    magnitude = float(rng.uniform(1.5, 6.0))
    skewness = magnitude if rng.random() < 0.5 else -magnitude
    weights = _skewed_weights(num_bins, mu, sigma, skewness, range_min, range_max)
    return {"weights": weights, "mu": mu, "sigma": sigma}


def _belief_multi_peak(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """2–3 Gaussian peaks combined."""
    span = range_max - range_min
    num_peaks = int(rng.integers(2, 4))  # 2 or 3
    bin_width = span / num_bins
    pdf_centers = np.array(
        [range_min + (i + 0.5) * bin_width for i in range(num_bins)]
    )
    combined = np.zeros(num_bins, dtype=float)
    sigma = int(span * rng.uniform(0.05, 0.12))
    # Space peaks roughly evenly
    fracs = np.sort(rng.uniform(0.1, 0.9, size=num_peaks))
    weights_per_peak = rng.dirichlet(np.ones(num_peaks))
    mus = []
    for i, frac in enumerate(fracs):
        peak_mu = int(range_min + span * frac)
        mus.append(peak_mu)
        pdf_i = norm.pdf(pdf_centers, loc=peak_mu, scale=sigma)
        combined += weights_per_peak[i] * pdf_i
    total = combined.sum()
    if total == 0:
        weights = _gaussian_weights(num_bins, int(range_min + span * 0.5), sigma, range_min, range_max)
        mu = int(range_min + span * 0.5)
    else:
        weights = (combined / total * SCALE).astype(np.int64)
        weights[np.argmax(combined)] += SCALE - weights.sum()
        mu = mus[int(np.argmax(weights_per_peak))]
    return {"weights": weights, "mu": mu, "sigma": sigma}


def _belief_localized(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Narrow one-sided belief — tight sigma."""
    span = range_max - range_min
    mu = int(range_min + span * rng.uniform(0.1, 0.9))
    sigma = int(span * rng.uniform(0.02, 0.06))
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": mu, "sigma": sigma}


def _belief_shifter(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
) -> dict:
    """Initial belief that will change (post-shift handled by scenario metadata)."""
    span = range_max - range_min
    mu = int(range_min + span * rng.uniform(0.2, 0.8))
    sigma = int(span * rng.uniform(0.08, 0.18))
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    # Post-shift belief
    shift = span * rng.uniform(0.10, 0.30)
    direction = 1 if rng.random() < 0.5 else -1
    post_mu = int(np.clip(mu + direction * shift, range_min, range_max))
    post_sigma = int(span * rng.uniform(0.08, 0.18))
    post_weights = _gaussian_weights(num_bins, post_mu, post_sigma, range_min, range_max)
    return {
        "weights": weights,
        "mu": mu,
        "sigma": sigma,
        "post_shift_weights": post_weights,
        "post_shift_mu": post_mu,
        "post_shift_sigma": post_sigma,
    }


# ── Registry ──────────────────────────────────────────────────────────────────

TRUTH_FAMILIES: dict[str, Callable] = {
    "gaussian_center": _truth_gaussian_center,
    "gaussian_edge": _truth_gaussian_edge,
    "skewed": _truth_skewed,
    "bimodal": _truth_bimodal,
    "truncated": _truth_truncated,
    "regime_shift": _truth_regime_shift,
    "adversarial_boundary": _truth_adversarial_boundary,
}

BELIEF_FAMILIES: dict[str, Callable] = {
    "gaussian": _belief_gaussian,
    "skewed": _belief_skewed,
    "multi_peak": _belief_multi_peak,
    "localized": _belief_localized,
    "shifter": _belief_shifter,
}


# ── Scenario dataclass ────────────────────────────────────────────────────────

@dataclass
class Scenario:
    truth_family: str
    belief_family: str
    truth_weights: np.ndarray
    belief_weights: np.ndarray
    truth_mu: int
    truth_sigma: int
    belief_mu: int
    belief_sigma: int
    shift_round_frac: Optional[float] = None
    post_shift_weights: Optional[np.ndarray] = None
    post_shift_mu: Optional[int] = None
    post_shift_sigma: Optional[int] = None
    adversarial_bin: Optional[int] = None


# ── Public API ────────────────────────────────────────────────────────────────

def sample_scenario(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
    truth_family: Optional[str] = None,
    belief_family: Optional[str] = None,
) -> Scenario:
    """Sample a Scenario by drawing truth and belief distributions.

    Parameters
    ----------
    rng:
        NumPy random generator for reproducibility.
    num_bins:
        Number of market bins.
    range_min, range_max:
        Range of the market (in scaled integer units).
    truth_family:
        Name of a key in TRUTH_FAMILIES, or None for random choice.
    belief_family:
        Name of a key in BELIEF_FAMILIES, or None for random choice.

    Returns
    -------
    Scenario dataclass populated with weights and metadata.
    """
    truth_names = list(TRUTH_FAMILIES.keys())
    belief_names = list(BELIEF_FAMILIES.keys())

    if truth_family is None:
        truth_family = truth_names[int(rng.integers(len(truth_names)))]
    if belief_family is None:
        belief_family = belief_names[int(rng.integers(len(belief_names)))]

    truth_fn = TRUTH_FAMILIES[truth_family]
    belief_fn = BELIEF_FAMILIES[belief_family]

    truth_data = truth_fn(rng, num_bins, range_min, range_max)
    belief_data = belief_fn(rng, num_bins, range_min, range_max)

    return Scenario(
        truth_family=truth_family,
        belief_family=belief_family,
        truth_weights=truth_data["weights"],
        belief_weights=belief_data["weights"],
        truth_mu=truth_data["mu"],
        truth_sigma=truth_data["sigma"],
        belief_mu=belief_data["mu"],
        belief_sigma=belief_data["sigma"],
        shift_round_frac=truth_data.get("shift_round_frac"),
        post_shift_weights=truth_data.get("post_shift_weights"),
        post_shift_mu=truth_data.get("post_shift_mu"),
        post_shift_sigma=truth_data.get("post_shift_sigma"),
        adversarial_bin=truth_data.get("adversarial_bin"),
    )
