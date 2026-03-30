"""Tests for report/export behavior."""
import json
from pathlib import Path

import pandas as pd

from analysis.export import export_all_results, export_mirofish_json
from analysis.report import generate_report


def _sample_rows():
    return [
        {
            "design_name": "Baseline A",
            "fee_name": "Flat",
            "price_accuracy": 0.4,
            "convergence_speed": 50,
            "mean_slippage": 0.2,
            "lp_profitability": 0.1,
            "manipulation_resistance": 10.0,
            "resolution_fairness": 0.6,
            "boundary_sensitivity_max": 1_000_000_000,
            "exitability_unwind": 0.5,
            "exitability_slippage": 0.4,
            "lp_passive_profitability": 0.05,
            "lp_rebalancing_profitability": 0.06,
            "payout_by_distance": {0: 1.0},
            "kl_series": [0.4, 0.2],
        },
        {
            "design_name": "Baseline B",
            "fee_name": "Flat",
            "price_accuracy": 0.2,
            "convergence_speed": 30,
            "mean_slippage": 0.1,
            "lp_profitability": 0.2,
            "manipulation_resistance": 20.0,
            "resolution_fairness": 0.2,
            "boundary_sensitivity_max": 500_000_000,
            "exitability_unwind": 0.7,
            "exitability_slippage": 0.2,
            "lp_passive_profitability": 0.08,
            "lp_rebalancing_profitability": 0.12,
            "payout_by_distance": {0: 1.0},
            "kl_series": [0.2, 0.1],
        },
    ]


def test_generate_report_is_self_contained(tmp_path):
    phase1_df = pd.DataFrame(_sample_rows())
    report_path = Path(generate_report(phase1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert '<script src="https://cdn.plot.ly' not in html
    assert "Composite Score" in html


def test_export_mirofish_prefers_phase2_and_ranks_combos(tmp_path):
    phase1_df = pd.DataFrame(_sample_rows())
    phase2_df = pd.DataFrame(
        [
            {**_sample_rows()[0], "fee_name": "Dynamic", "price_accuracy": 0.35},
            {**_sample_rows()[1], "fee_name": "Time-weighted", "price_accuracy": 0.1},
        ]
    )
    output_path = tmp_path / "mirofish.json"
    export_mirofish_json(phase1_df, phase2_df=phase2_df, path=str(output_path))
    payload = json.loads(output_path.read_text())
    assert payload["top_designs"][0]["fee_model"] == "Time-weighted"
    assert "composite_score" in payload["top_designs"][0]
    assert payload["top_designs"][0]["metrics"]["price_accuracy"]["p50"] == 0.1
    assert payload["phase1_runs"] == len(phase1_df)
    assert payload["phase2_runs"] == len(phase2_df)


def test_export_all_results_writes_consolidated_csv(tmp_path):
    phase1_df = pd.DataFrame(_sample_rows())
    clob_df = pd.DataFrame(_sample_rows()[:1])
    paths = export_all_results(phase1_df, clob_df, output_dir=str(tmp_path))
    assert Path(paths["results"]).exists()
    results_df = pd.read_csv(paths["results"])
    assert set(results_df["dataset"]) == {"phase1", "clob"}
