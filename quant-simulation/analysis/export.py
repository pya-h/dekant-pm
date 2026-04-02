"""Export simulation results as CSV and JSON for MiroFish ingestion."""
import json
import pandas as pd
import numpy as np
from pathlib import Path
from engine.metrics import composite_score
from config.params import DESIGN_SCALAR, DESIGN_CLOB, DESIGN_NAMES


def export_csv(df: pd.DataFrame, path: str) -> None:
    """Export results DataFrame to CSV.

    Drops non-serializable columns (kl_series, capital_efficiency dict) before
    writing so the CSV contains only scalar-valued columns.
    """
    serializable_cols = [c for c in df.columns if c not in ("kl_series", "capital_efficiency")]
    df[serializable_cols].to_csv(path, index=False)


def export_all_results(
    phase1_df: pd.DataFrame,
    clob_df: pd.DataFrame,
    phase2_df: pd.DataFrame | None = None,
    sensitivity_df: pd.DataFrame | None = None,
    output_dir: str = "output",
) -> dict[str, str]:
    """Write per-dataset CSVs plus a consolidated results.csv."""
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    paths = {
        "phase1": str(output / "phase1_results.csv"),
        "clob": str(output / "clob_results.csv"),
        "results": str(output / "results.csv"),
    }
    export_csv(phase1_df, paths["phase1"])
    export_csv(clob_df, paths["clob"])

    frames = [
        phase1_df.assign(dataset="phase1"),
        clob_df.assign(dataset="clob"),
    ]

    if phase2_df is not None and len(phase2_df) > 0:
        paths["phase2"] = str(output / "phase2_results.csv")
        export_csv(phase2_df, paths["phase2"])
        frames.append(phase2_df.assign(dataset="phase2"))

    if sensitivity_df is not None and len(sensitivity_df) > 0:
        paths["sensitivity"] = str(output / "sensitivity_results.csv")
        export_csv(sensitivity_df, paths["sensitivity"])
        frames.append(sensitivity_df.assign(dataset="sensitivity"))

    export_csv(pd.concat(frames, ignore_index=True), paths["results"])
    return paths


def _normalize_metric_vector(arr: np.ndarray, invert: bool = False) -> np.ndarray:
    """Normalize a metric vector to [0, 1] while treating positive infinity as best."""
    values = np.asarray(arr, dtype=np.float64).copy()
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        normed = np.full(values.shape, 0.5, dtype=np.float64)
    else:
        span = float(finite.max() - finite.min())
        if span == 0:
            span = max(1.0, abs(float(finite.max())), abs(float(finite.min())))
        values[np.isposinf(values)] = float(finite.max()) + span
        values[np.isneginf(values)] = float(finite.min()) - span
        mn = float(values.min())
        mx = float(values.max())
        normed = np.full(values.shape, 0.5, dtype=np.float64) if mx == mn else (values - mn) / (mx - mn)
    return 1 - normed if invert else normed


def export_mirofish_json(
    phase1_df: pd.DataFrame,
    clob_df: pd.DataFrame | None = None,
    phase2_df: pd.DataFrame | None = None,
    top_n: int = 3,
    path: str = "mirofish_export.json",
) -> None:
    """Export top design-fee combos as structured JSON with p5/p50/p95 summaries."""
    df = phase2_df if phase2_df is not None and len(phase2_df) > 0 else phase1_df

    group_cols = ["design_name"]
    if "fee_name" in df.columns:
        group_cols.append("fee_name")

    summary = []
    for group_key, subset in df.groupby(group_cols):
        if isinstance(group_key, tuple):
            design_name, fee_name = group_key
        else:
            design_name = group_key
            fee_name = subset["fee_name"].iloc[0] if "fee_name" in subset.columns else "Flat"
        # Determine red_team_only and excluded flags from design metadata.
        # red_team_only: True if the design is Scalar (red-team stress-test only).
        # excluded: True if the design should not appear in finalist selection
        #           (red-team-only designs and CLOB which has separate analysis).
        is_red_team = False
        if "red_team_only" in subset.columns:
            is_red_team = bool(subset["red_team_only"].iloc[0])
        else:
            # Fallback: infer from design name
            is_red_team = design_name == DESIGN_NAMES[DESIGN_SCALAR]

        is_clob = design_name == DESIGN_NAMES[DESIGN_CLOB]
        is_excluded = is_red_team or is_clob

        entry = {
            "design": design_name,
            "fee_model": fee_name,
            "red_team_only": is_red_team,
            "excluded": is_excluded,
            "metrics": {
                "price_accuracy": {
                    "p5": float(subset["price_accuracy"].quantile(0.05)),
                    "p50": float(subset["price_accuracy"].median()),
                    "p95": float(subset["price_accuracy"].quantile(0.95)),
                },
                "convergence_speed": {
                    "p5": float(subset["convergence_speed"].quantile(0.05)),
                    "p50": float(subset["convergence_speed"].median()),
                    "p95": float(subset["convergence_speed"].quantile(0.95)),
                },
                "capital_efficiency": {
                    "p5": float(subset["mean_slippage"].quantile(0.05)) if "mean_slippage" in subset.columns else 0.0,
                    "p50": float(subset["mean_slippage"].median()) if "mean_slippage" in subset.columns else 0.0,
                    "p95": float(subset["mean_slippage"].quantile(0.95)) if "mean_slippage" in subset.columns else 0.0,
                },
                "lp_profitability": {
                    "p5": float(subset["lp_profitability"].quantile(0.05)),
                    "p50": float(subset["lp_profitability"].median()),
                    "p95": float(subset["lp_profitability"].quantile(0.95)),
                },
                "manipulation_resistance": {
                    "p5": float(subset["manipulation_resistance"].quantile(0.05)),
                    "p50": float(subset["manipulation_resistance"].median()),
                    "p95": float(subset["manipulation_resistance"].quantile(0.95)),
                },
                "resolution_fairness": {
                    "p5": float(subset["resolution_fairness"].quantile(0.05)),
                    "p50": float(subset["resolution_fairness"].median()),
                    "p95": float(subset["resolution_fairness"].quantile(0.95)),
                },
                "boundary_sensitivity_max": {
                    "p5": float(subset["boundary_sensitivity_max"].quantile(0.05)),
                    "p50": float(subset["boundary_sensitivity_max"].median()),
                    "p95": float(subset["boundary_sensitivity_max"].quantile(0.95)),
                },
                "exitability_unwind": {
                    "p5": float(subset["exitability_unwind"].quantile(0.05)),
                    "p50": float(subset["exitability_unwind"].median()),
                    "p95": float(subset["exitability_unwind"].quantile(0.95)),
                },
            },
            "num_runs": len(subset),
        }
        summary.append(entry)

    if summary:
        metric_vectors = {
            "price_accuracy": np.array([entry["metrics"]["price_accuracy"]["p50"] for entry in summary], dtype=float),
            "convergence_speed": np.array([entry["metrics"]["convergence_speed"]["p50"] for entry in summary], dtype=float),
            "capital_efficiency": np.array([entry["metrics"]["capital_efficiency"]["p50"] for entry in summary], dtype=float),
            "lp_profitability": np.array([entry["metrics"]["lp_profitability"]["p50"] for entry in summary], dtype=float),
            "manipulation_resistance": np.array([entry["metrics"]["manipulation_resistance"]["p50"] for entry in summary], dtype=float),
            "resolution_fairness": np.array([entry["metrics"]["resolution_fairness"]["p50"] for entry in summary], dtype=float),
            "boundary_sensitivity": np.array([entry["metrics"]["boundary_sensitivity_max"]["p50"] for entry in summary], dtype=float),
            "exitability": np.array([entry["metrics"]["exitability_unwind"]["p50"] for entry in summary], dtype=float),
        }

        normalized = {
            "price_accuracy": _normalize_metric_vector(metric_vectors["price_accuracy"], invert=True),
            "convergence_speed": _normalize_metric_vector(metric_vectors["convergence_speed"], invert=True),
            "capital_efficiency": _normalize_metric_vector(metric_vectors["capital_efficiency"], invert=True),
            "lp_profitability": _normalize_metric_vector(metric_vectors["lp_profitability"]),
            "manipulation_resistance": _normalize_metric_vector(metric_vectors["manipulation_resistance"]),
            "resolution_fairness": _normalize_metric_vector(metric_vectors["resolution_fairness"], invert=True),
            "boundary_sensitivity": _normalize_metric_vector(metric_vectors["boundary_sensitivity"], invert=True),
            "exitability": _normalize_metric_vector(metric_vectors["exitability"]),
        }

        for idx, entry in enumerate(summary):
            entry["composite_score"] = composite_score(
                {name: float(values[idx]) for name, values in normalized.items()}
            )

    summary.sort(key=lambda x: x.get("composite_score", 0.0), reverse=True)
    top = summary[:top_n]

    Path(path).write_text(
        json.dumps(
            {
                "top_designs": top,
                "phase1_runs": len(phase1_df),
                "clob_runs": 0 if clob_df is None else len(clob_df),
                "phase2_runs": 0 if phase2_df is None else len(phase2_df),
                "total_runs": len(phase1_df)
                + (0 if clob_df is None else len(clob_df))
                + (0 if phase2_df is None else len(phase2_df)),
            },
            indent=2,
        )
    )
