"""Fee mechanisms for the distribution market simulation.

All public functions return a dict:
    {"total_fee": int, "lp_fee": int, "protocol_fee": int, "net_amount": int}
"""

from __future__ import annotations

import numpy as np

from config.params import SCALE


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _split_fee(gross: int, fee_bps: int, lp_share_bps: int) -> dict:
    """Compute fee components from a gross amount."""
    total_fee = (gross * fee_bps) // 10_000
    lp_fee = (total_fee * lp_share_bps) // 10_000
    protocol_fee = total_fee - lp_fee
    net_amount = gross - total_fee
    return {
        "total_fee": total_fee,
        "lp_fee": lp_fee,
        "protocol_fee": protocol_fee,
        "net_amount": net_amount,
    }


# ---------------------------------------------------------------------------
# 1. Flat fee  — constant rate regardless of conditions
# ---------------------------------------------------------------------------

def flat_fee(gross: int, trade_fee_bps: int = 30, lp_share_bps: int = 5000) -> dict:
    """Constant basis-point fee applied to the gross trade amount."""
    return _split_fee(gross, trade_fee_bps, lp_share_bps)


# ---------------------------------------------------------------------------
# 2. Dynamic fee  — scales with pool imbalance
# ---------------------------------------------------------------------------

def dynamic_fee(
    gross: int,
    implied_probs: "np.ndarray",
    base_bps: int = 30,
    max_bps: int = 100,
    lp_share_bps: int = 5000,
) -> dict:
    """Fee that rises when outcome probabilities deviate from uniform.

    Parameters
    ----------
    gross : int
        Trade size.
    implied_probs : np.ndarray
        Array of implied probabilities in fixed-point SCALE units (sum ≈ SCALE).
    base_bps : int
        Minimum fee in basis points.
    max_bps : int
        Maximum fee in basis points.
    lp_share_bps : int
        LP share of total fee in basis points.
    """
    n = len(implied_probs)
    uniform = SCALE // n  # integer uniform probability per outcome
    max_deviation = max(abs(int(p) - uniform) / SCALE for p in implied_probs)
    # Scale deviation so that a single outcome holding all weight gives factor=1
    fee_bps = base_bps + (max_bps - base_bps) * min(max_deviation * n, 1.0)
    fee_bps = int(fee_bps)
    return _split_fee(gross, fee_bps, lp_share_bps)


# ---------------------------------------------------------------------------
# 3. Tiered fee  — discount based on cumulative volume
# ---------------------------------------------------------------------------

def tiered_fee(
    gross: int,
    cumulative_volume: int,
    base_bps: int = 30,
    discount_per_tier: int = 5,
    tier_size: int = 1_000_000,
    lp_share_bps: int = 5000,
) -> dict:
    """Volume-tiered fee with a floor of 1 bps.

    Parameters
    ----------
    gross : int
        Trade size.
    cumulative_volume : int
        Lifetime trading volume for the trader (same units as gross).
    base_bps : int
        Starting fee rate in basis points.
    discount_per_tier : int
        Basis-point reduction per completed tier.
    tier_size : int
        Volume threshold for each tier.
    lp_share_bps : int
        LP share of total fee in basis points.
    """
    tiers = cumulative_volume // tier_size
    fee_bps = max(1, base_bps - tiers * discount_per_tier)
    return _split_fee(gross, fee_bps, lp_share_bps)


# ---------------------------------------------------------------------------
# 4. Spread fee  — higher fee for trading against consensus
# ---------------------------------------------------------------------------

def spread_fee(
    gross: int,
    outcome: int,
    probs: "np.ndarray",
    base_bps: int = 30,
    max_bps: int = 100,
    lp_share_bps: int = 5000,
) -> dict:
    """Fee that penalises trading on low-probability (contrarian) outcomes.

    The distance measures how far below uniform the chosen outcome sits.
    Outcomes above uniform pay the base rate; outcomes below pay up to max.

    Parameters
    ----------
    gross : int
        Trade size.
    outcome : int
        Index of the outcome being traded.
    probs : np.ndarray
        Array of implied probabilities in fixed-point SCALE units.
    base_bps : int
        Minimum fee in basis points.
    max_bps : int
        Maximum fee in basis points.
    lp_share_bps : int
        LP share of total fee in basis points.
    """
    n = len(probs)
    uniform_prob = SCALE / n  # float for division
    prob_of_outcome = float(probs[outcome])
    distance = max(0.0, uniform_prob - prob_of_outcome) / uniform_prob
    fee_bps = base_bps + (max_bps - base_bps) * min(distance, 1.0)
    fee_bps = int(fee_bps)
    return _split_fee(gross, fee_bps, lp_share_bps)


# ---------------------------------------------------------------------------
# 5. Time-weighted fee  — quadratic ramp toward resolution
# ---------------------------------------------------------------------------

def time_weighted_fee(
    gross: int,
    current_round: int,
    total_rounds: int,
    base_bps: int = 10,
    max_bps: int = 100,
    lp_share_bps: int = 5000,
) -> dict:
    """Fee that increases quadratically as the market approaches resolution.

    Parameters
    ----------
    gross : int
        Trade size.
    current_round : int
        Current simulation round (0-indexed).
    total_rounds : int
        Total number of rounds in the simulation.
    base_bps : int
        Fee at round 0 in basis points.
    max_bps : int
        Fee at final round in basis points.
    lp_share_bps : int
        LP share of total fee in basis points.
    """
    t = current_round / total_rounds  # normalised in [0, 1)
    fee_bps = base_bps + (max_bps - base_bps) * (t ** 2)
    fee_bps = int(fee_bps)
    return _split_fee(gross, fee_bps, lp_share_bps)
