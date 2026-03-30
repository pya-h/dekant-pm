"""Sweep orchestration — Phase 1 (designs) and Phase 2 (designs x fees).

Phase 1: runs designs 0-5 under flat fee, plus CLOB separately.
Phase 2: runs top N designs from Phase 1 across all fee mechanisms.
"""

from __future__ import annotations

import numpy as np
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
    AgentMix,
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
    # Aggregate per-design medians (spec: "report median, p5, p95")
    agg_cols = {
        "price_accuracy": "median",
        "convergence_speed": "median",
        "lp_profitability": "median",
        "manipulation_resistance": "median",
        "resolution_fairness": "median",
        "boundary_sensitivity_max": "median",
        "boundary_sensitivity_mean": "median",
        "exitability_unwind": "median",
        "exitability_slippage": "median",
    }
    if "mean_slippage" in phase1_df.columns:
        agg_cols["mean_slippage"] = "median"
    design_medians = phase1_df.groupby("design").agg(agg_cols).reset_index()

    if design_medians.empty:
        return []

    # Normalize each metric to [0, 1].  For metrics where lower is better,
    # invert (1 - normalized).
    def _normalize(series: pd.Series, invert: bool = False) -> pd.Series:
        values = series.astype(np.float64).to_numpy(copy=True)
        finite = values[np.isfinite(values)]
        if finite.size == 0:
            return pd.Series(0.5, index=series.index)
        span = float(finite.max() - finite.min())
        if span == 0:
            span = max(1.0, abs(float(finite.max())), abs(float(finite.min())))
        values[np.isposinf(values)] = float(finite.max()) + span
        values[np.isneginf(values)] = float(finite.min()) - span
        mn = float(values.min())
        mx = float(values.max())
        if mx == mn:
            return pd.Series(0.5, index=series.index)
        normed = (values - mn) / (mx - mn)
        if invert:
            normed = 1 - normed
        return pd.Series(normed, index=series.index)

    normalized = {}
    # Lower is better: price_accuracy (KL), convergence_speed, resolution_fairness,
    # boundary_sensitivity_max, exitability_slippage
    normalized["price_accuracy"] = _normalize(design_medians["price_accuracy"], invert=True)
    normalized["convergence_speed"] = _normalize(design_medians["convergence_speed"], invert=True)
    normalized["resolution_fairness"] = _normalize(design_medians["resolution_fairness"], invert=True)
    normalized["boundary_sensitivity"] = _normalize(design_medians["boundary_sensitivity_max"], invert=True)

    # Higher is better: lp_profitability, manipulation_resistance, exitability_unwind
    normalized["lp_profitability"] = _normalize(design_medians["lp_profitability"])
    normalized["manipulation_resistance"] = _normalize(design_medians["manipulation_resistance"])
    normalized["exitability"] = _normalize(design_medians["exitability_unwind"])

    # Capital efficiency: use mean_slippage (lower = better)
    if "mean_slippage" in design_medians.columns:
        normalized["capital_efficiency"] = _normalize(design_medians["mean_slippage"], invert=True)
    else:
        normalized["capital_efficiency"] = _normalize(design_medians["exitability_slippage"], invert=True)

    # Compute composite score per design
    scores = []
    for i in range(len(design_medians)):
        norm_metrics = {k: float(v.iloc[i]) for k, v in normalized.items()}
        score = composite_score(norm_metrics)
        scores.append(score)

    design_medians["composite_score"] = scores
    design_medians = design_medians.sort_values("composite_score", ascending=False)

    top_designs = design_medians["design"].head(n).tolist()
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


# ---------------------------------------------------------------------------
# Sensitivity sweeps
# ---------------------------------------------------------------------------

_SENSITIVITY_BINS = [16, 32, 64, 128, 256]

_SENSITIVITY_LIQUIDITY = [
    1_000_000_000,       # 1k USDC
    10_000_000_000,      # 10k USDC
    100_000_000_000,     # 100k USDC
]

_SENSITIVITY_AGENT_MIXES = {
    "noise_heavy": AgentMix(noise=0.80, informed=0.10, arbitrageur=0.05, manipulator=0.03, late_round_whale=0.02, lp_passive=0.0, lp_rebalancing=0.0),
    "balanced": AgentMix(),  # default 45/25/13/5/2/5/5
    "adversarial": AgentMix(noise=0.20, informed=0.30, arbitrageur=0.15, manipulator=0.10, late_round_whale=0.05, lp_passive=0.10, lp_rebalancing=0.10),
}


def run_sensitivity(
    top_designs: list[int],
    num_rounds: int = DEFAULT_NUM_ROUNDS,
    mc_runs: int = 100,
) -> pd.DataFrame:
    """Run sensitivity sweeps varying bins, liquidity, and agent mix on top designs.

    Uses reduced mc_runs (default 100) to keep runtime manageable.
    Returns a DataFrame with one row per (design, parameter, value, seed).
    """
    rows: list[dict] = []

    for design in top_designs:
        # --- Bins sweep (default liquidity, default agents) ---
        for num_bins in _SENSITIVITY_BINS:
            for seed in range(mc_runs):
                sim = SimulationRun(
                    design=design, fee_model=FEE_FLAT,
                    num_bins=num_bins, initial_liquidity=DEFAULT_INITIAL_LIQUIDITY,
                    num_rounds=num_rounds, seed=seed,
                )
                result = sim.run()
                result["design_name"] = DESIGN_NAMES[design]
                result["sweep_param"] = "num_bins"
                result["sweep_value"] = num_bins
                result["seed"] = seed
                rows.append(result)

        # --- Liquidity sweep (default bins, default agents) ---
        for liquidity in _SENSITIVITY_LIQUIDITY:
            for seed in range(mc_runs):
                sim = SimulationRun(
                    design=design, fee_model=FEE_FLAT,
                    num_bins=DEFAULT_NUM_BINS, initial_liquidity=liquidity,
                    num_rounds=num_rounds, seed=seed,
                )
                result = sim.run()
                result["design_name"] = DESIGN_NAMES[design]
                result["sweep_param"] = "liquidity"
                result["sweep_value"] = liquidity
                result["seed"] = seed
                rows.append(result)

        # --- Agent mix sweep (default bins, default liquidity) ---
        for mix_name, mix in _SENSITIVITY_AGENT_MIXES.items():
            for seed in range(mc_runs):
                sim = SimulationRun(
                    design=design, fee_model=FEE_FLAT,
                    num_bins=DEFAULT_NUM_BINS, initial_liquidity=DEFAULT_INITIAL_LIQUIDITY,
                    num_rounds=num_rounds, seed=seed, agent_mix=mix,
                )
                result = sim.run()
                result["design_name"] = DESIGN_NAMES[design]
                result["sweep_param"] = "agent_mix"
                result["sweep_value"] = mix_name
                result["seed"] = seed
                rows.append(result)

    return pd.DataFrame(rows)
