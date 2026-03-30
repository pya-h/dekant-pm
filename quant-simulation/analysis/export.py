"""Export simulation results as CSV and JSON for MiroFish ingestion."""
import json
import pandas as pd
from pathlib import Path


def export_csv(df: pd.DataFrame, path: str) -> None:
    """Export results DataFrame to CSV.

    Drops non-serializable columns (kl_series, capital_efficiency dict) before
    writing so the CSV contains only scalar-valued columns.
    """
    serializable_cols = [c for c in df.columns if c not in ("kl_series", "capital_efficiency")]
    df[serializable_cols].to_csv(path, index=False)


def export_mirofish_json(
    df: pd.DataFrame,
    top_n: int = 3,
    path: str = "mirofish_export.json",
) -> None:
    """Export top N combos as structured JSON for MiroFish knowledge graph.

    Aggregates per-design median metrics, sorts ascending by
    resolution_fairness_median (lower = better), then writes the top N entries
    alongside the total run count to the given path.
    """
    summary = []
    for design_name in df["design_name"].unique():
        subset = df[df["design_name"] == design_name]
        entry = {
            "design": design_name,
            "fee_model": subset["fee_name"].iloc[0] if "fee_name" in subset.columns else "Flat",
            "metrics": {
                "price_accuracy_median": float(subset["price_accuracy"].median()),
                "convergence_speed_median": float(subset["convergence_speed"].median()),
                "lp_profitability_median": float(subset["lp_profitability"].median()),
                "manipulation_resistance_median": float(subset["manipulation_resistance"].median()),
                "resolution_fairness_median": float(subset["resolution_fairness"].median()),
                "boundary_sensitivity_max_median": float(subset["boundary_sensitivity_max"].median()),
                "exitability_unwind_median": float(subset["exitability_unwind"].median()),
            },
            "num_runs": len(subset),
        }
        summary.append(entry)

    # Sort ascending by resolution_fairness (lower = fairer)
    summary.sort(key=lambda x: x["metrics"]["resolution_fairness_median"])
    top = summary[:top_n]

    Path(path).write_text(
        json.dumps({"top_designs": top, "total_runs": len(df)}, indent=2)
    )
