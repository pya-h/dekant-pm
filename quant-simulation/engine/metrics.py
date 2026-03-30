"""All 8 simulation metrics."""
import numpy as np
from config.params import SCALE, MetricWeights
from models.math_engine import compute_buy, compute_probabilities, isqrt


def kl_divergence(p_true: np.ndarray, p_amm: np.ndarray, epsilon: float = 1e-12) -> float:
    """KL divergence: sum(p_true * log(p_true / p_amm)). Skips zeros in p_true."""
    p = np.clip(p_true, epsilon, None)
    q = np.clip(p_amm, epsilon, None)
    mask = p_true > epsilon
    return float(np.sum(p[mask] * np.log(p[mask] / q[mask])))


def convergence_speed(kl_series: list[float], threshold: float = 0.01) -> int:
    """Number of rounds (index) to reach KL < threshold. Returns len if never reached."""
    for i, kl in enumerate(kl_series):
        if kl < threshold:
            return i
    return len(kl_series)


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


def lp_profitability(fees_earned: int, deposited: int, current_value: int) -> float:
    """Net LP return: (fees_earned + current_value - deposited) / deposited."""
    if deposited <= 0:
        return 0.0
    return (fees_earned + current_value - deposited) / deposited


def manipulation_cost(budget_spent: int, price_change_pct: float) -> float:
    """Cost per percent of price distortion. Higher = more resistant."""
    if price_change_pct <= 0:
        return float("inf")
    return budget_spent / price_change_pct


def resolution_fairness(trader_payouts: np.ndarray, trader_distances: np.ndarray, ideal_payouts: np.ndarray) -> float:
    """Mean |actual_payout / ideal_payout - 1| for traders near resolved bin. Lower = more fair."""
    mask = ideal_payouts > 0
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


def exitability(reserves: np.ndarray, total_minted: int, holdings: np.ndarray, target_unwind_fraction: float = 0.5) -> dict:
    """Measure how much of a position can be unwound and at what slippage cost.
    Returns dict with max_unwind_fraction and slippage_cost."""
    total_held = int(np.sum(holdings))
    if total_held == 0:
        return {"max_unwind_fraction": 1.0, "slippage_cost": 0.0}

    target_sell = int(total_held * target_unwind_fraction)
    actually_sold = 0
    total_collateral = 0
    reserves_copy = reserves.copy()
    tm = total_minted

    for i in range(len(holdings)):
        if holdings[i] <= 0:
            continue
        sell_amount = int(holdings[i] * target_unwind_fraction)
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
    fair_value = total_held * target_unwind_fraction
    slippage = 1.0 - (total_collateral / fair_value) if fair_value > 0 else 0.0

    return {"max_unwind_fraction": max_unwind, "slippage_cost": max(0.0, slippage)}


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
