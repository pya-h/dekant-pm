"""Sweep orchestration — Phase 1 (designs) and Phase 2 (designs x fees).

Phase 1: runs designs 0-5 under flat fee, plus CLOB separately.
Phase 2: runs top N designs from Phase 1 across all fee mechanisms.
"""

from __future__ import annotations

import pandas as pd

from config.params import (
    DESIGN_BASELINE_A,
    DESIGN_BASELINE_B,
    DESIGN_PIECEWISE,
    DESIGN_KERNEL,
    DESIGN_SCALAR,
    DESIGN_CRPS,
    DESIGN_CLOB,
    FEE_FLAT,
    FEE_DYNAMIC,
    FEE_TIERED,
    FEE_SPREAD,
    FEE_TIME_WEIGHTED,
    DESIGN_NAMES,
    FEE_NAMES,
    DEFAULT_NUM_BINS,
    DEFAULT_INITIAL_LIQUIDITY,
    DEFAULT_NUM_ROUNDS,
    DEFAULT_MC_RUNS,
)
from engine.metrics import composite_score
from engine.simulation import SimulationRun


# ---------------------------------------------------------------------------
# Phase 1: Design sweep under flat fee
# ---------------------------------------------------------------------------

def run_phase1(
    num_bins: int = DEFAULT_NUM_BINS,
    initial_liquidity: int = DEFAULT_INITIAL_LIQUIDITY,
    num_rounds: int = DEFAULT_NUM_ROUNDS,
    mc_runs: int = DEFAULT_MC_RUNS,
) -> pd.DataFrame:
    """Run designs 0-5 (AMM-based) under flat fee across mc_runs seeds.

    Returns a DataFrame with one row per (design, seed) containing all metrics.
    """
    designs = [
        DESIGN_BASELINE_A,
        DESIGN_BASELINE_B,
        DESIGN_PIECEWISE,
        DESIGN_KERNEL,
        DESIGN_SCALAR,
        DESIGN_CRPS,
    ]

    rows: list[dict] = []

    for design in designs:
        for seed in range(mc_runs):
            sim = SimulationRun(
                design=design,
                fee_model=FEE_FLAT,
                num_bins=num_bins,
                initial_liquidity=initial_liquidity,
                num_rounds=num_rounds,
                seed=seed,
            )
            result = sim.run()
            result["design_name"] = DESIGN_NAMES[design]
            result["fee_name"] = FEE_NAMES[FEE_FLAT]
            result["seed"] = seed
            rows.append(result)

    return pd.DataFrame(rows)


def run_clob_phase1(
    num_bins: int = DEFAULT_NUM_BINS,
    initial_liquidity: int = DEFAULT_INITIAL_LIQUIDITY,
    num_rounds: int = DEFAULT_NUM_ROUNDS,
    mc_runs: int = DEFAULT_MC_RUNS,
) -> pd.DataFrame:
    """Run CLOB design separately (uses same SimulationRun but design=CLOB).

    Returns a DataFrame with one row per seed.
    """
    rows: list[dict] = []

    for seed in range(mc_runs):
        sim = SimulationRun(
            design=DESIGN_CLOB,
            fee_model=FEE_FLAT,
            num_bins=num_bins,
            initial_liquidity=initial_liquidity,
            num_rounds=num_rounds,
            seed=seed,
        )
        result = sim.run()
        result["design_name"] = DESIGN_NAMES[DESIGN_CLOB]
        result["fee_name"] = FEE_NAMES[FEE_FLAT]
        result["seed"] = seed
        rows.append(result)

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Design selection
# ---------------------------------------------------------------------------

def select_top_designs(phase1_df: pd.DataFrame, n: int = 3) -> list[int]:
    """Rank designs by composite score and return top n design IDs.

    Normalizes per-metric means across designs to [0, 1], then computes
    composite score for each design.  Lower price_accuracy (KL) and
    convergence_speed are better, so they are inverted.
    """
    # Aggregate per-design means
    design_means = phase1_df.groupby("design").agg({
        "price_accuracy": "mean",
        "convergence_speed": "mean",
        "lp_profitability": "mean",
        "manipulation_resistance": "mean",
        "resolution_fairness": "mean",
        "boundary_sensitivity_max": "mean",
        "boundary_sensitivity_mean": "mean",
        "exitability_unwind": "mean",
        "exitability_slippage": "mean",
    }).reset_index()

    if design_means.empty:
        return []

    # Normalize each metric to [0, 1].  For metrics where lower is better,
    # invert (1 - normalized).
    def _normalize(series: pd.Series, invert: bool = False) -> pd.Series:
        mn, mx = series.min(), series.max()
        if mx == mn:
            return pd.Series(0.5, index=series.index)
        normed = (series - mn) / (mx - mn)
        return 1 - normed if invert else normed

    normalized = {}
    # Lower is better: price_accuracy (KL), convergence_speed, resolution_fairness,
    # boundary_sensitivity_max, boundary_sensitivity_mean, exitability_slippage
    normalized["price_accuracy"] = _normalize(design_means["price_accuracy"], invert=True)
    normalized["convergence_speed"] = _normalize(design_means["convergence_speed"], invert=True)
    normalized["resolution_fairness"] = _normalize(design_means["resolution_fairness"], invert=True)
    normalized["boundary_sensitivity"] = _normalize(design_means["boundary_sensitivity_max"], invert=True)

    # Higher is better: lp_profitability, manipulation_resistance, exitability_unwind
    normalized["lp_profitability"] = _normalize(design_means["lp_profitability"])
    normalized["manipulation_resistance"] = _normalize(
        design_means["manipulation_resistance"].replace(float("inf"), 0)
    )
    normalized["exitability"] = _normalize(design_means["exitability_unwind"])

    # Capital efficiency: use mean slippage inversion — not directly available
    # as a single column, so approximate with exitability_slippage
    normalized["capital_efficiency"] = _normalize(design_means["exitability_slippage"], invert=True)

    # Compute composite score per design
    scores = []
    for i in range(len(design_means)):
        norm_metrics = {k: float(v.iloc[i]) for k, v in normalized.items()}
        score = composite_score(norm_metrics)
        scores.append(score)

    design_means["composite_score"] = scores
    design_means = design_means.sort_values("composite_score", ascending=False)

    top_designs = design_means["design"].head(n).tolist()
    return [int(d) for d in top_designs]


# ---------------------------------------------------------------------------
# Phase 2: Top designs x all fee mechanisms
# ---------------------------------------------------------------------------

def run_phase2(
    top_designs: list[int],
    num_bins: int = DEFAULT_NUM_BINS,
    initial_liquidity: int = DEFAULT_INITIAL_LIQUIDITY,
    num_rounds: int = DEFAULT_NUM_ROUNDS,
    mc_runs: int = DEFAULT_MC_RUNS,
) -> pd.DataFrame:
    """Run top designs crossed with all fee mechanisms across mc_runs seeds.

    Returns a DataFrame with one row per (design, fee_model, seed).
    """
    fee_models = [FEE_FLAT, FEE_DYNAMIC, FEE_TIERED, FEE_SPREAD, FEE_TIME_WEIGHTED]
    rows: list[dict] = []

    for design in top_designs:
        for fee_model in fee_models:
            for seed in range(mc_runs):
                sim = SimulationRun(
                    design=design,
                    fee_model=fee_model,
                    num_bins=num_bins,
                    initial_liquidity=initial_liquidity,
                    num_rounds=num_rounds,
                    seed=seed,
                )
                result = sim.run()
                result["design_name"] = DESIGN_NAMES[design]
                result["fee_name"] = FEE_NAMES[fee_model]
                result["seed"] = seed
                rows.append(result)

    return pd.DataFrame(rows)
