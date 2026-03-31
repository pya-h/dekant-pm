"""4-stage sweep orchestration for quantitative simulation.

Stage 0: Validity suite — quick sanity checks across all AMM designs.
Stage 1: Full design sweep across scenario families (AMM 0-5 + CLOB).
Stage 2: Fee sweep for finalist AMM designs.
Stage 3: Sensitivity sweep — bins, liquidity, agent mix, scenario family.
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
from config.scenarios import TRUTH_FAMILIES
from engine.metrics import composite_score
from engine.simulation import SimulationRun
from engine.validation import run_stage0_checks


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_AMM_DESIGNS = [
    DESIGN_BASELINE_A,
    DESIGN_BASELINE_B,
    DESIGN_PIECEWISE,
    DESIGN_KERNEL,
    DESIGN_SCALAR,
    DESIGN_CRPS,
]

_ALL_DESIGNS = _AMM_DESIGNS + [DESIGN_CLOB]

_FEE_MODELS = [FEE_FLAT, FEE_DYNAMIC, FEE_TIERED, FEE_SPREAD, FEE_TIME_WEIGHTED]

# Representative subset of scenario families used for Stage 0 and Stage 1
_STAGE0_FAMILIES = ["gaussian_center", "gaussian_edge", "skewed", "bimodal"]

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

_SENSITIVITY_FAMILIES = ["gaussian_center", "gaussian_edge", "skewed", "bimodal"]


# ---------------------------------------------------------------------------
# Stage 0: Validity suite
# ---------------------------------------------------------------------------

def run_stage0(
    num_bins: int = DEFAULT_NUM_BINS,
    initial_liquidity: int = DEFAULT_INITIAL_LIQUIDITY,
    num_rounds: int = DEFAULT_NUM_ROUNDS,
    mc_runs: int = 5,
) -> dict:
    """Run validity suite across all AMM designs with mixed scenario families.

    Returns dict with:
        validity_results: list[ValidationResult]
        kl_by_design: dict[int, list[float]]
        lp_activation_rates: dict[int, float]
        exit_values: dict[int, float]
        scenario_families_used: set[str]
    """
    kl_by_design: dict[int, list[float]] = {}
    lp_activation_rates: dict[int, float] = {}
    exit_values: dict[int, float] = {}
    metric_values: dict[str, dict[int, float]] = {
        "price_accuracy": {},
        "convergence_speed": {},
        "lp_profitability": {},
        "manipulation_resistance": {},
        "resolution_fairness": {},
    }
    scenario_families_used: set[str] = set()

    for design in _AMM_DESIGNS:
        design_kl_all: list[float] = []
        design_lp_rates: list[float] = []
        design_exit_vals: list[float] = []
        design_metrics: dict[str, list[float]] = {k: [] for k in metric_values}

        for seed in range(mc_runs):
            # Cycle through scenario families
            family = _STAGE0_FAMILIES[seed % len(_STAGE0_FAMILIES)]
            scenario_families_used.add(family)

            sim = SimulationRun(
                design=design,
                fee_model=FEE_FLAT,
                num_bins=num_bins,
                initial_liquidity=initial_liquidity,
                num_rounds=num_rounds,
                seed=seed,
                scenario_family=family,
            )
            result = sim.run()

            # Collect KL series (use the final KL for this run)
            kl_series = result.get("kl_series", [])
            if kl_series:
                design_kl_all.extend(kl_series)

            design_lp_rates.append(result.get("lp_activation_rate", 0.0))
            design_exit_vals.append(result.get("exitability_unwind", 0.0))

            for metric_name in design_metrics:
                val = result.get(metric_name, 0.0)
                if isinstance(val, (int, float)) and np.isfinite(val):
                    design_metrics[metric_name].append(val)

        kl_by_design[design] = design_kl_all if design_kl_all else [0.0]
        lp_activation_rates[design] = float(np.mean(design_lp_rates)) if design_lp_rates else 0.0
        exit_values[design] = float(np.mean(design_exit_vals)) if design_exit_vals else 0.0

        for metric_name, vals in design_metrics.items():
            if metric_name not in metric_values:
                metric_values[metric_name] = {}
            metric_values[metric_name][design] = float(np.mean(vals)) if vals else 0.0

    # Run validation checks
    validity_results = run_stage0_checks(
        kl_by_design=kl_by_design,
        lp_activation_rates=lp_activation_rates,
        scenario_families_used=scenario_families_used,
        exit_values=exit_values,
        metric_values=metric_values,
    )

    return {
        "validity_results": validity_results,
        "kl_by_design": kl_by_design,
        "lp_activation_rates": lp_activation_rates,
        "exit_values": exit_values,
        "scenario_families_used": scenario_families_used,
    }


# ---------------------------------------------------------------------------
# Stage 1: Full design sweep across scenario families
# ---------------------------------------------------------------------------

def run_stage1(
    num_bins: int = DEFAULT_NUM_BINS,
    initial_liquidity: int = DEFAULT_INITIAL_LIQUIDITY,
    num_rounds: int = DEFAULT_NUM_ROUNDS,
    mc_runs: int = DEFAULT_MC_RUNS,
) -> pd.DataFrame:
    """Run all AMM designs (0-5) + CLOB across scenario families.

    Iterates over TRUTH_FAMILIES, running each design x scenario_family x seed.
    Returns combined DataFrame with scenario_family column.
    """
    families = list(TRUTH_FAMILIES.keys())
    rows: list[dict] = []

    for design in _ALL_DESIGNS:
        for family in families:
            for seed in range(mc_runs):
                sim = SimulationRun(
                    design=design,
                    fee_model=FEE_FLAT,
                    num_bins=num_bins,
                    initial_liquidity=initial_liquidity,
                    num_rounds=num_rounds,
                    seed=seed,
                    scenario_family=family,
                )
                result = sim.run()
                result["design_name"] = DESIGN_NAMES[design]
                result["fee_name"] = FEE_NAMES[FEE_FLAT]
                result["seed"] = seed
                # scenario_family is already in result from SimulationRun,
                # but ensure it is present
                result.setdefault("scenario_family", family)
                rows.append(result)

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Design selection
# ---------------------------------------------------------------------------

def select_finalists(stage1_df: pd.DataFrame, n: int = 3) -> list[int]:
    """Rank designs by composite score and return top n design IDs.

    MUST exclude DESIGN_SCALAR (4) and DESIGN_CLOB (6) from selection.
    Uses per-metric Pareto normalization and composite_score logic.
    """
    # Filter out Scalar and CLOB
    filtered_df = stage1_df[
        ~stage1_df["design"].isin([DESIGN_SCALAR, DESIGN_CLOB])
    ].copy()

    if filtered_df.empty:
        return []

    # Aggregate per-design medians
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
    if "mean_slippage" in filtered_df.columns:
        agg_cols["mean_slippage"] = "median"
    design_medians = filtered_df.groupby("design").agg(agg_cols).reset_index()

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
# Stage 2: Fee sweep for finalist AMM designs
# ---------------------------------------------------------------------------

def run_stage2(
    finalists: list[int],
    num_bins: int = DEFAULT_NUM_BINS,
    initial_liquidity: int = DEFAULT_INITIAL_LIQUIDITY,
    num_rounds: int = DEFAULT_NUM_ROUNDS,
    mc_runs: int = DEFAULT_MC_RUNS,
) -> pd.DataFrame:
    """Run finalist AMM designs crossed with all fee mechanisms across mc_runs seeds.

    Returns a DataFrame with one row per (design, fee_model, seed).
    """
    rows: list[dict] = []

    for design in finalists:
        for fee_model in _FEE_MODELS:
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
# Stage 3: Sensitivity sweep
# ---------------------------------------------------------------------------

def run_stage3(
    finalists: list[int],
    num_rounds: int = DEFAULT_NUM_ROUNDS,
    mc_runs: int = 100,
) -> pd.DataFrame:
    """Run sensitivity sweeps varying bins, liquidity, agent mix, and scenario family.

    Uses reduced mc_runs (default 100) to keep runtime manageable.
    Returns a DataFrame with one row per (design, parameter, value, seed).
    """
    rows: list[dict] = []

    for design in finalists:
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

        # --- Scenario family sweep (default bins, default liquidity, default agents) ---
        for family in _SENSITIVITY_FAMILIES:
            for seed in range(mc_runs):
                sim = SimulationRun(
                    design=design, fee_model=FEE_FLAT,
                    num_bins=DEFAULT_NUM_BINS, initial_liquidity=DEFAULT_INITIAL_LIQUIDITY,
                    num_rounds=num_rounds, seed=seed, scenario_family=family,
                )
                result = sim.run()
                result["design_name"] = DESIGN_NAMES[design]
                result["sweep_param"] = "scenario_family"
                result["sweep_value"] = family
                result["seed"] = seed
                rows.append(result)

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Backward-compatible aliases
# ---------------------------------------------------------------------------

def select_top_designs(phase1_df: pd.DataFrame, n: int = 3) -> list[int]:
    """Backward-compatible alias for select_finalists.

    Note: unlike select_finalists, this does NOT filter out Scalar/CLOB by default,
    preserving original behavior for existing callers.
    """
    # Use the same normalization and composite logic, but without filtering
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
    normalized["price_accuracy"] = _normalize(design_medians["price_accuracy"], invert=True)
    normalized["convergence_speed"] = _normalize(design_medians["convergence_speed"], invert=True)
    normalized["resolution_fairness"] = _normalize(design_medians["resolution_fairness"], invert=True)
    normalized["boundary_sensitivity"] = _normalize(design_medians["boundary_sensitivity_max"], invert=True)
    normalized["lp_profitability"] = _normalize(design_medians["lp_profitability"])
    normalized["manipulation_resistance"] = _normalize(design_medians["manipulation_resistance"])
    normalized["exitability"] = _normalize(design_medians["exitability_unwind"])
    if "mean_slippage" in design_medians.columns:
        normalized["capital_efficiency"] = _normalize(design_medians["mean_slippage"], invert=True)
    else:
        normalized["capital_efficiency"] = _normalize(design_medians["exitability_slippage"], invert=True)

    scores = []
    for i in range(len(design_medians)):
        norm_metrics = {k: float(v.iloc[i]) for k, v in normalized.items()}
        score = composite_score(norm_metrics)
        scores.append(score)

    design_medians["composite_score"] = scores
    design_medians = design_medians.sort_values("composite_score", ascending=False)

    top_designs = design_medians["design"].head(n).tolist()
    return [int(d) for d in top_designs]


# Functional aliases for backward compatibility with run.py and other callers
run_phase1 = run_stage1
run_phase2 = run_stage2
run_sensitivity = run_stage3


def run_clob_phase1(
    num_bins: int = DEFAULT_NUM_BINS,
    initial_liquidity: int = DEFAULT_INITIAL_LIQUIDITY,
    num_rounds: int = DEFAULT_NUM_ROUNDS,
    mc_runs: int = DEFAULT_MC_RUNS,
) -> pd.DataFrame:
    """Run CLOB design separately (backward-compatible alias).

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
