"""All simulation metrics — original 8 plus revised versions."""
import numpy as np
from config.params import SCALE, MetricWeights
from models.math_engine import compute_buy, compute_sell, compute_distribution_buy, compute_probabilities, isqrt
from agents.base import ActionType, AMM_ACTIONS


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
    num_bins: int,
    allowed_actions: frozenset = AMM_ACTIONS,
) -> dict:
    """Measure practical exit quality under allowed action primitives.

    Returns dict with:
    - unwindable_fraction: fraction of holdings that can be unwound (0-1)
    - transaction_count: number of transactions needed
    - slippage: average slippage on unwind
    - reposition_cost: cost to reposition after unwind
    - failure_rate: fraction of attempted unwinds that fail
    """
    total_held = int(np.sum(reference_holdings))
    if total_held == 0:
        return {
            "unwindable_fraction": 1.0,
            "transaction_count": 0,
            "slippage": 0.0,
            "reposition_cost": 0.0,
            "failure_rate": 0.0,
        }

    can_single_sell = ActionType.SINGLE_BIN_SELL in allowed_actions
    can_bundle_sell = ActionType.BUNDLE_SELL in allowed_actions

    actually_sold = 0
    total_collateral = 0
    transaction_count = 0
    failures = 0
    attempts = 0
    reserves_copy = reserves.copy()
    tm = total_minted

    if can_single_sell:
        # Per-bin sell: attempt to sell each held bin individually
        for i in range(len(reference_holdings)):
            if reference_holdings[i] <= 0:
                continue
            sell_amount = int(reference_holdings[i])
            attempts += 1
            # Check feasibility: position must be >= sell_amount
            x_i = tm - int(reserves_copy[i])
            if x_i < sell_amount:
                sell_amount = max(0, x_i)
            if sell_amount <= 0:
                failures += 1
                continue
            try:
                collateral_out, tm = compute_sell(reserves_copy, tm, i, sell_amount)
                actually_sold += sell_amount
                total_collateral += collateral_out
                transaction_count += 1
            except (AssertionError, ValueError, OverflowError):
                failures += 1
    elif can_bundle_sell:
        # Bundle sell: try to sell all holdings as a single bundle
        # For non-Gaussian positions this is harder — the bundle sell uses
        # proportional weights which may not match the holdings distribution well
        attempts = 1
        weights = reference_holdings.copy().astype(np.int64)
        total_tokens = int(np.sum(weights))
        if total_tokens > 0:
            # Normalize weights to SCALE for distribution sell
            weight_sum = int(np.sum(weights))
            scaled_weights = np.zeros(num_bins, dtype=np.int64)
            for b in range(num_bins):
                scaled_weights[b] = int(weights[b]) * SCALE // weight_sum

            # Check each bin has enough position to sell
            feasible = True
            for b in range(num_bins):
                if scaled_weights[b] > 0:
                    tokens_for_bin = total_tokens * int(scaled_weights[b]) // SCALE
                    x_b = tm - int(reserves_copy[b])
                    if tokens_for_bin > x_b:
                        feasible = False
                        break

            if feasible and int(np.sum(scaled_weights)) > 0:
                try:
                    from models.math_engine import compute_distribution_sell
                    collateral_out, tm = compute_distribution_sell(
                        reserves_copy, tm, scaled_weights, total_tokens
                    )
                    actually_sold = total_tokens
                    total_collateral = collateral_out
                    transaction_count = 1
                except (AssertionError, ValueError, OverflowError, ZeroDivisionError):
                    failures = 1
            else:
                failures = 1
    else:
        # No sell actions available
        attempts = 1
        failures = 1

    unwindable_fraction = actually_sold / total_held if total_held > 0 else 1.0

    # Slippage: how much less collateral we got vs fair value
    fair_value = actually_sold
    slippage = max(0.0, 1.0 - (total_collateral / fair_value)) if fair_value > 0 else 0.0

    # Reposition cost: attempt to re-buy into a uniform position with recovered collateral
    reposition_cost = 0.0
    if total_collateral > 0:
        try:
            reserves_copy2 = reserves_copy.copy()
            uniform_weights = np.ones(num_bins, dtype=np.int64)
            tokens_out, _ = compute_distribution_buy(
                reserves_copy2, tm, uniform_weights, total_collateral
            )
            received = int(np.sum(tokens_out))
            if total_collateral > 0:
                reposition_cost = max(0.0, 1.0 - (received / total_collateral))
        except (ValueError, OverflowError, AssertionError, ZeroDivisionError):
            reposition_cost = 1.0

    failure_rate = failures / max(1, attempts)

    return {
        "unwindable_fraction": unwindable_fraction,
        "transaction_count": transaction_count,
        "slippage": slippage,
        "reposition_cost": reposition_cost,
        "failure_rate": failure_rate,
    }


def lp_deployability(
    activation_rate: float,
    median_capital_deployed: int,
    holding_duration: int,
    realized_return: float,
    realized_fees: int = 0,
    realized_adverse_selection: float = 0.0,
) -> dict:
    """LP deployability metric.

    Returns status='not_activated' if activation_rate==0, otherwise 'activated'
    with all provided fields.
    """
    if activation_rate <= 0:
        return {
            "status": "not_activated",
            "activation_rate": 0.0,
            "median_capital_deployed": 0,
            "holding_duration": 0,
            "realized_return": 0.0,
            "realized_fees": 0,
            "realized_adverse_selection": 0.0,
        }
    return {
        "status": "activated",
        "activation_rate": activation_rate,
        "median_capital_deployed": median_capital_deployed,
        "holding_duration": holding_duration,
        "realized_return": realized_return,
        "realized_fees": realized_fees,
        "realized_adverse_selection": realized_adverse_selection,
    }


def resolution_fairness_benchmark(num_bins: int, resolved_bin: int, max_distance: int = 5) -> np.ndarray:
    """Design-independent benchmark: linear closeness decay from resolved bin.

    Bins within max_distance of the resolved bin get a linearly decaying
    weight from 1.0 (at resolved) to >0 (at max_distance away). Bins
    farther out get 0.
    """
    benchmark = np.zeros(num_bins, dtype=np.float64)
    for i in range(num_bins):
        dist = abs(i - resolved_bin)
        if dist <= max_distance:
            benchmark[i] = 1.0 - dist / (max_distance + 1)
    return benchmark


def price_accuracy_revised(final_kl: float, kl_series: list[float]) -> dict:
    """Revised price accuracy combining final KL with time-series calibration.

    Returns {final_kl, mean_calibration_error, combined}.
    """
    mean_cal = float(np.mean(kl_series)) if kl_series else final_kl
    combined = 0.5 * final_kl + 0.5 * mean_cal
    return {"final_kl": final_kl, "mean_calibration_error": mean_cal, "combined": combined}


def convergence_speed_revised(
    kl_series: list[float],
    threshold: float = 0.01,
    sustained_window: int = 3,
    snapshot_interval: int = 10,
) -> int:
    """Rounds to reach KL < threshold for sustained_window consecutive snapshots.

    A one-off dip below threshold does not count; the KL must stay below
    for sustained_window consecutive entries. Returns total rounds if
    never sustained.
    """
    n = len(kl_series)
    consecutive = 0
    for i in range(n):
        if kl_series[i] < threshold:
            consecutive += 1
            if consecutive >= sustained_window:
                # The sustained window started at index (i - sustained_window + 1)
                start_idx = i - sustained_window + 1
                return start_idx * snapshot_interval
        else:
            consecutive = 0
    return n * snapshot_interval


def capital_efficiency_revised(
    reserves: np.ndarray,
    total_minted: int,
    target_bins: list[int],
) -> dict:
    """Local slippage and depth around target bins.

    Returns {mean_local_slippage, mean_local_depth}.
    """
    if not target_bins:
        return {"mean_local_slippage": 0.0, "mean_local_depth": 0.0}

    slippages = []
    depths = []
    probs = compute_probabilities(reserves, total_minted)

    for b in target_bins:
        if b < 0 or b >= len(reserves):
            continue
        # Local depth: the position size in that bin
        x_b = int(total_minted) - int(reserves[b])
        depths.append(float(x_b) / max(1, int(total_minted)))

        # Local slippage: cost of a small trade (0.1% of pool)
        slip = compute_slippage(reserves.copy(), total_minted, b, 0.001)
        slippages.append(slip)

    mean_slippage = float(np.mean(slippages)) if slippages else 0.0
    mean_depth = float(np.mean(depths)) if depths else 0.0

    return {"mean_local_slippage": mean_slippage, "mean_local_depth": mean_depth}


def manipulation_resistance_revised(
    budget_spent: float,
    price_change_pct: float,
    payout_improvement: float,
) -> dict:
    """Revised manipulation resistance with two cost metrics.

    Returns {cost_to_move, cost_to_profit}.
    - cost_to_move: budget per percent of price distortion
    - cost_to_profit: budget per unit of payout improvement
    """
    cost_to_move = budget_spent / price_change_pct if price_change_pct > 0 else float("inf")
    cost_to_profit = budget_spent / payout_improvement if payout_improvement > 0 else float("inf")
    return {"cost_to_move": cost_to_move, "cost_to_profit": cost_to_profit}


def boundary_sensitivity_revised(payouts: np.ndarray) -> dict:
    """Revised boundary sensitivity with payout and incentive jumps.

    Returns {max_payout_jump, mean_payout_jump, max_incentive_jump, mean_incentive_jump}.
    """
    if len(payouts) < 2:
        return {
            "max_payout_jump": 0,
            "mean_payout_jump": 0.0,
            "max_incentive_jump": 0.0,
            "mean_incentive_jump": 0.0,
        }
    payout_diffs = np.abs(np.diff(payouts.astype(np.int64)))
    max_pay = int(np.max(payout_diffs))
    mean_pay = float(np.mean(payout_diffs))

    payout_max = max(1, int(np.max(payouts)))
    payout_float = payouts.astype(np.float64) / payout_max
    incentive_diffs = np.abs(np.diff(payout_float))
    max_inc = float(np.max(incentive_diffs))
    mean_inc = float(np.mean(incentive_diffs))

    return {
        "max_payout_jump": max_pay,
        "mean_payout_jump": mean_pay,
        "max_incentive_jump": max_inc,
        "mean_incentive_jump": mean_inc,
    }


def truthful_incentive_alignment(
    true_dist: np.ndarray,
    payouts: np.ndarray | None,
    num_bins: int,
    resolved_bin: int,
    use_crps: bool = False,
) -> float:
    """Score = fraction of alternative bins where truthful buy beats manipulative buy.

    Measures whether buying the bin with highest true probability yields
    higher expected utility than buying any other bin.
    """
    true_probs = true_dist.astype(np.float64)
    total = true_probs.sum()
    if total <= 0:
        return 0.5
    true_probs = true_probs / total
    truthful_bin = int(np.argmax(true_probs))

    if use_crps:
        from models.settlement_crps import compute_payout_crps
        h = np.zeros(num_bins, dtype=np.int64)
        h[truthful_bin] = 1000
        truthful_eu = compute_payout_crps(h, resolved_bin, num_bins) / SCALE
    else:
        truthful_eu = float(payouts[truthful_bin]) / SCALE * true_probs[truthful_bin]

    wins = 0
    comparisons = 0
    for alt in range(num_bins):
        if alt == truthful_bin:
            continue
        if use_crps:
            h = np.zeros(num_bins, dtype=np.int64)
            h[alt] = 1000
            alt_eu = compute_payout_crps(h, resolved_bin, num_bins) / SCALE
        else:
            alt_eu = float(payouts[alt]) / SCALE * true_probs[alt]
        comparisons += 1
        if truthful_eu >= alt_eu:
            wins += 1
    return wins / max(1, comparisons)


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
