"""L2-norm CFAMM math engine — faithful port of on-chain Rust code.

All functions are pure — no side effects (except where reserves are mutated
in-place, matching the Rust API), no external framework dependency.

Invariant: Σ (total_minted - reserves[i])² = total_minted²  (within tolerance)

Arithmetic uses Python int (arbitrary precision) for invariant math to avoid
overflow.  numpy arrays are used only for storage.
"""

from __future__ import annotations

import numpy as np
from config.params import SCALE


# ── Integer Square Root ──────────────────────────────────────────────────────

def isqrt(n: int) -> int:
    """Return ⌊√n⌋ via Newton's method.

    Faithful port of programs/dekant-pm/src/engine/sqrt.rs::isqrt.
    Converges in ≤ 128 iterations for any non-negative Python int.
    """
    n = int(n)
    if n < 0:
        raise ValueError("isqrt is undefined for negative integers")
    if n == 0:
        return 0
    if n == 1:
        return 1

    x = n // 2 + 1
    while True:
        y = (x + n // x) // 2
        if y >= x:
            return x
        x = y


# ── Invariant ────────────────────────────────────────────────────────────────

def _sum_of_position_squares(reserves: np.ndarray, total_minted: int) -> int:
    """Compute Σ (total_minted - reserves[i])²."""
    k = int(total_minted)
    return sum((k - int(r)) ** 2 for r in reserves)


def verify_invariant(
    reserves: np.ndarray,
    total_minted: int,
    tolerance: int = 256,
) -> bool:
    """Return True if |Σ (total_minted - reserves[i])² - total_minted²| ≤ tolerance."""
    k = int(total_minted)
    actual = _sum_of_position_squares(reserves, k)
    expected = k * k
    return abs(actual - expected) <= tolerance


# ── Init Reserves ────────────────────────────────────────────────────────────

def init_reserves(num_bins: int, liquidity: int) -> tuple[np.ndarray, int]:
    """Initialise reserves for a uniform distribution.

    Algorithm (from market.rs::initialize):
      x_per = isqrt(L² / N)
      reserve_per = L - x_per

    Returns:
        reserves:      numpy array of shape (num_bins,) dtype int64
        total_minted:  equals liquidity
    """
    liq = int(liquidity)
    n = int(num_bins)
    x_per = isqrt(liq * liq // n)
    reserve_per = liq - x_per
    reserves = np.full(num_bins, reserve_per, dtype=np.int64)
    return reserves, liq


# ── Probabilities ────────────────────────────────────────────────────────────

def compute_probabilities(reserves: np.ndarray, total_minted: int) -> np.ndarray:
    """Return implied probabilities scaled to SCALE.

    probability[i] = (total_minted - reserves[i])² * SCALE / total_minted²

    Faithful port of amm.rs::compute_probabilities.
    Returns array of Python ints stored as object dtype to avoid int64 overflow.
    """
    k = int(total_minted)
    if k == 0:
        return np.zeros(len(reserves), dtype=np.int64)

    k_sq = k * k
    probs = np.empty(len(reserves), dtype=object)
    for i, r in enumerate(reserves):
        x = k - int(r)
        x_sq = x * x
        probs[i] = x_sq * SCALE // k_sq
    # Downcast to int64 if values fit (they always will for SCALE=10^9)
    return probs.astype(np.int64)


# ── Discrete Buy ─────────────────────────────────────────────────────────────

def compute_buy(
    reserves: np.ndarray,
    total_minted: int,
    outcome: int,
    collateral: int,
) -> tuple[int, int]:
    """Buy outcome tokens for a single outcome index.

    Mutates *reserves* in place.  Returns (tokens_out, new_total_minted).

    Algorithm (amm.rs::compute_buy):
      1. x_i = total_minted - reserves[outcome]          (position BEFORE mint)
      2. sum_others_x_sq = Σ_{j≠i} (total_minted - reserves[j])²
      3. Add collateral to ALL reserves (mint complete sets).
      4. k_new = total_minted + collateral
      5. x_new_i = isqrt(k_new² - sum_others_x_sq)
      6. tokens_out = x_new_i - x_i
      7. reserves[outcome] = k_new - x_new_i
    """
    k = int(total_minted)
    col = int(collateral)
    n = len(reserves)
    assert 0 <= outcome < n, f"outcome {outcome} out of range [0, {n})"
    assert col > 0, "collateral must be positive"

    # Positions before mint
    x_i = k - int(reserves[outcome])
    sum_others_x_sq: int = 0
    for j in range(n):
        if j != outcome:
            x_j = k - int(reserves[j])
            sum_others_x_sq += x_j * x_j

    # Mint complete sets: add collateral to every reserve
    for j in range(n):
        reserves[j] = int(reserves[j]) + col

    k_new = k + col
    k_new_sq = k_new * k_new

    assert k_new_sq >= sum_others_x_sq, "insufficient liquidity"
    x_new_i = isqrt(k_new_sq - sum_others_x_sq)

    assert x_new_i >= x_i, "insufficient liquidity"
    tokens_out = x_new_i - x_i

    reserves[outcome] = k_new - x_new_i

    return int(tokens_out), int(k_new)


# ── Discrete Sell ─────────────────────────────────────────────────────────────

def compute_sell(
    reserves: np.ndarray,
    total_minted: int,
    outcome: int,
    tokens_in: int,
) -> tuple[int, int]:
    """Sell outcome tokens for a single outcome index.

    Mutates *reserves* in place.  Returns (collateral_out, new_total_minted).

    Algorithm (amm.rs::compute_sell):
      1. x_i = total_minted - reserves[outcome]; require x_i ≥ tokens_in.
      2. reserves[outcome] += tokens_in.
      3. k_new_sq = Σ (total_minted - reserves_new[j])²
      4. k_new = isqrt(k_new_sq)
      5. collateral_out = total_minted - k_new
      6. Subtract collateral_out from ALL reserves.
    """
    k = int(total_minted)
    t_in = int(tokens_in)
    n = len(reserves)
    assert 0 <= outcome < n, f"outcome {outcome} out of range [0, {n})"
    assert t_in > 0, "tokens_in must be positive"

    x_i = k - int(reserves[outcome])
    assert x_i >= t_in, "insufficient position to sell"

    reserves[outcome] = int(reserves[outcome]) + t_in

    k_new_sq: int = 0
    for j in range(n):
        x_j = k - int(reserves[j])
        k_new_sq += x_j * x_j

    k_new = isqrt(k_new_sq)
    assert k >= k_new, "insufficient liquidity"
    collateral_out = k - k_new

    for j in range(n):
        reserves[j] = int(reserves[j]) - collateral_out

    return int(collateral_out), int(k_new)


# ── Distribution Buy ──────────────────────────────────────────────────────────

def compute_distribution_buy(
    reserves: np.ndarray,
    total_minted: int,
    weights: np.ndarray,
    collateral: int,
) -> tuple[np.ndarray, int]:
    """Buy across multiple bins proportional to *weights*.

    Mutates *reserves* in place.  Returns (tokens_out_per_bin, new_total_minted).

    Algorithm (amm.rs::compute_distribution_buy):
      1. xw = Σ x[b] * W[b]   (positions BEFORE mint)
      2. w2 = Σ W[b]²
      3. Mint complete sets: reserves[b] += collateral
      4. k_new = total_minted + collateral
      5. disc = xw² + w2 * (k_new² - k_old²)
      6. numerator = isqrt(disc) - xw
      7. tokens_out[b] = numerator * W[b] / w2
      8. reserves[b] -= tokens_out[b]
    """
    k = int(total_minted)
    col = int(collateral)
    n = len(reserves)
    assert len(weights) == n, "weights length must match number of bins"
    assert col > 0, "collateral must be positive"

    # Compute XW and W2 BEFORE mint
    xw: int = 0
    w2: int = 0
    for b in range(n):
        x_b = k - int(reserves[b])
        w_b = int(weights[b])
        xw += x_b * w_b
        w2 += w_b * w_b

    assert w2 > 0, "w2 must be positive"

    # Mint complete sets
    for b in range(n):
        reserves[b] = int(reserves[b]) + col

    k_new = k + col
    k_new_sq = k_new * k_new
    k_old_sq = k * k

    excess = k_new_sq - k_old_sq  # always positive
    xw_sq = xw * xw
    disc = xw_sq + w2 * excess

    sqrt_disc = isqrt(disc)
    assert sqrt_disc >= xw, "discriminant underflow"
    numerator = sqrt_disc - xw

    tokens_out = np.empty(n, dtype=np.int64)
    for b in range(n):
        w_b = int(weights[b])
        out = numerator * w_b // w2
        tokens_out[b] = int(out)
        reserves[b] = int(reserves[b]) - int(out)

    return tokens_out, int(k_new)


# ── Distribution Sell ─────────────────────────────────────────────────────────

def compute_distribution_sell(
    reserves: np.ndarray,
    total_minted: int,
    weights: np.ndarray,
    total_tokens: int,
) -> tuple[int, int]:
    """Sell across multiple bins proportional to *weights*.

    Mutates *reserves* in place.  Returns (collateral_out, new_total_minted).

    Algorithm (amm.rs::compute_distribution_sell):
      1. tokens_for_bin[b] = total_tokens * W[b] / SCALE
      2. reserves[b] += tokens_for_bin[b]
      3. k_new_sq = Σ (total_minted - reserves_new[b])²
      4. k_new = isqrt(k_new_sq)
      5. collateral_out = total_minted - k_new
      6. reserves[b] -= collateral_out for all b
    """
    k = int(total_minted)
    t_total = int(total_tokens)
    n = len(reserves)
    assert len(weights) == n, "weights length must match number of bins"
    assert t_total > 0, "total_tokens must be positive"

    k_new_sq: int = 0
    for b in range(n):
        w_b = int(weights[b])
        tokens_for_bin = t_total * w_b // SCALE
        reserves[b] = int(reserves[b]) + tokens_for_bin

        x_new = k - int(reserves[b])
        # x_new could be zero if reserves >= total_minted (unlikely but safe)
        if x_new < 0:
            x_new = 0
        k_new_sq += x_new * x_new

    k_new = isqrt(k_new_sq)
    assert k >= k_new, "insufficient liquidity"
    collateral_out = k - k_new

    for b in range(n):
        reserves[b] = int(reserves[b]) - collateral_out

    return int(collateral_out), int(k_new)


# ── Fees ──────────────────────────────────────────────────────────────────────

def compute_fees(
    gross_amount: int,
    trade_fee_bps: int,
    lp_fee_share_bps: int,
) -> dict:
    """Decompose *gross_amount* into protocol fee, LP fee, and net amount.

    Returns dict with keys: net_amount, lp_fee, protocol_fee, total_fee.
    All values are Python ints.
    """
    gross = int(gross_amount)
    total_fee = gross * int(trade_fee_bps) // 10_000
    lp_fee = total_fee * int(lp_fee_share_bps) // 10_000
    protocol_fee = total_fee - lp_fee
    net_amount = gross - total_fee
    return {
        "net_amount": net_amount,
        "lp_fee": lp_fee,
        "protocol_fee": protocol_fee,
        "total_fee": total_fee,
    }


# ── Bin Mapping ───────────────────────────────────────────────────────────────

def value_to_bin(
    value: int,
    range_min: int,
    range_max: int,
    num_bins: int,
) -> int:
    """Map a value within [range_min, range_max) to a bin index [0, num_bins).

    Clamps to valid range.  Uses floor division (same as on-chain).
    """
    v = int(value)
    lo = int(range_min)
    hi = int(range_max)
    n = int(num_bins)
    assert hi > lo, "range_max must be greater than range_min"
    assert n > 0, "num_bins must be positive"
    if v <= lo:
        return 0
    if v >= hi:
        return n - 1
    return (v - lo) * n // (hi - lo)
