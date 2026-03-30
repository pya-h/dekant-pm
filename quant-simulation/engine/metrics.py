"""All 8 simulation metrics."""
import numpy as np
from config.params import SCALE, MetricWeights
from models.math_engine import compute_buy, compute_distribution_buy, compute_probabilities, isqrt


def kl_divergence(p_true: np.ndarray, p_amm: np.ndarray, epsilon: float = 1e-12) -> float:
    """KL divergence: sum(p_true * log(p_true / p_amm)). Skips zeros in p_true."""
    p = np.clip(p_true, epsilon, None)
    q = np.clip(p_amm, epsilon, None)
    mask = p_true > epsilon
    return float(np.sum(p[mask] * np.log(p[mask] / q[mask])))


def convergence_speed(kl_series: list[float], threshold: float = 0.01, snapshot_interval: int = 10) -> int:
    """Number of rounds to reach KL < threshold. Returns total rounds if never reached."""
    for i, kl in enumerate(kl_series):
        if kl < threshold:
            return i * snapshot_interval
    return len(kl_series) * snapshot_interval


def compute_slippage(reserves: np.ndarray, total_minted: int, outcome: int, trade_fraction: float) -> float:
    """Slippage for a trade of trade_fraction of pool depth. Returns (avg_price - mid_price) / mid_price."""
    probs = compute_probabilities(reserves, total_minted)
    mid_price = float(probs[outcome]) / SCALE
    if mid_price <= 0 or mid_price >= 1:
        return 0.0
    trade_size = int(total_minted * trade_fraction)
    if trade_size <= 0:
        return 0.0
    reserves_copy = reserves.copy()
    tokens_out, _ = compute_buy(reserves_copy, total_minted, outcome, trade_size)
    if tokens_out <= 0:
        return 0.0
    avg_price = trade_size / tokens_out
    return (avg_price - mid_price) / mid_price if mid_price > 0 else 0.0


def lp_profitability(fees_earned: int, capital_deposited: int, impermanent_loss: float) -> float:
    """Net LP return per spec: (fees_earned - impermanent_loss) / capital_deposited."""
    if capital_deposited <= 0:
        return 0.0
    return (fees_earned - impermanent_loss) / capital_deposited


def manipulation_cost(budget_spent: int, price_change_pct: float) -> float:
    """Cost per percent of price distortion. Higher = more resistant."""
    if price_change_pct <= 0:
        return float("inf")
    return budget_spent / price_change_pct


def resolution_fairness(
    trader_payouts: np.ndarray,
    trader_distances: np.ndarray,
    ideal_payouts: np.ndarray,
    max_distance: int | None = None,
) -> float:
    """Mean absolute payout-ratio error for traders near the resolved bin."""
    mask = ideal_payouts > 0
    if max_distance is not None:
        mask &= trader_distances <= max_distance
    if not np.any(mask):
        return 0.0
    ratios = trader_payouts[mask].astype(np.float64) / ideal_payouts[mask].astype(np.float64)
    return float(np.mean(np.abs(ratios - 1.0)))


def boundary_sensitivity(payouts: np.ndarray) -> tuple[int, float]:
    """Payout jump at bin boundaries. Returns (max_jump, mean_jump) in SCALE-denominated units."""
    if len(payouts) < 2:
        return 0, 0.0
    diffs = np.abs(np.diff(payouts.astype(np.int64)))
    return int(np.max(diffs)), float(np.mean(diffs))


def exitability(
    reserves: np.ndarray,
    total_minted: int,
    reference_holdings: np.ndarray,
    weight_fn,
    range_min: int,
    range_max: int,
    num_bins: int,
    original_mu: int,
    original_sigma: int,
    delta_mu_frac: float = 0.1,
    delta_sigma_frac: float = 0.2,
) -> dict:
    """Measure unwind feasibility plus reposition cost after a belief shift."""
    total_held = int(np.sum(reference_holdings))
    if total_held == 0:
        return {"max_unwind_fraction": 1.0, "unwind_slippage": 0.0, "reposition_cost": 0.0}

    actually_sold = 0
    total_collateral = 0
    reserves_copy = reserves.copy()
    tm = total_minted

    for i in range(len(reference_holdings)):
        if reference_holdings[i] <= 0:
            continue
        sell_amount = int(reference_holdings[i])
        if sell_amount <= 0:
            continue
        x_i = tm - int(reserves_copy[i])
        if x_i < sell_amount:
            sell_amount = max(0, x_i)
        if sell_amount <= 0:
            continue
        reserves_copy[i] += sell_amount
        k_new_sq = sum((tm - int(reserves_copy[j])) ** 2 for j in range(len(reserves_copy)))
        k_new = isqrt(k_new_sq)
        collateral = tm - k_new
        if collateral <= 0:
            reserves_copy[i] -= sell_amount
            continue
        reserves_copy -= collateral
        tm = k_new
        actually_sold += sell_amount
        total_collateral += collateral

    max_unwind = actually_sold / total_held if total_held > 0 else 1.0
    fair_value = total_held
    unwind_slippage = 1.0 - (total_collateral / fair_value) if fair_value > 0 else 0.0

    span = range_max - range_min
    new_mu = original_mu + int(delta_mu_frac * span)
    new_sigma = max(1, int(original_sigma * (1.0 + delta_sigma_frac)))
    new_weights = weight_fn(range_min, range_max, num_bins, new_mu, new_sigma)

    reposition_cost = 0.0
    if total_collateral > 0 and int(np.sum(new_weights)) > 0:
        try:
            reserves_copy2 = reserves_copy.copy()
            tokens_out, _ = compute_distribution_buy(
                reserves_copy2,
                tm,
                new_weights,
                total_collateral,
            )
            received = int(np.sum(tokens_out))
            fair_reposition = total_collateral
            if fair_reposition > 0:
                reposition_cost = max(0.0, 1.0 - (received / fair_reposition))
        except (ValueError, OverflowError, AssertionError, ZeroDivisionError):
            reposition_cost = 1.0

    return {
        "max_unwind_fraction": max_unwind,
        "unwind_slippage": max(0.0, unwind_slippage),
        "reposition_cost": reposition_cost,
    }


def composite_score(normalized_metrics: dict[str, float], weights: MetricWeights | None = None) -> float:
    """Weighted composite score from normalized (0-1) metric values."""
    if weights is None:
        weights = MetricWeights()
    w = {
        "price_accuracy": weights.price_accuracy,
        "convergence_speed": weights.convergence_speed,
        "capital_efficiency": weights.capital_efficiency,
        "lp_profitability": weights.lp_profitability,
        "manipulation_resistance": weights.manipulation_resistance,
        "resolution_fairness": weights.resolution_fairness,
        "boundary_sensitivity": weights.boundary_sensitivity,
        "exitability": weights.exitability,
    }
    return sum(normalized_metrics.get(k, 0) * v for k, v in w.items())
