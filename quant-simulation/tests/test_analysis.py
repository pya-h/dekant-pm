"""Tests for report/export behavior."""
import json
from pathlib import Path

import pandas as pd

from analysis.export import export_all_results, export_mirofish_json
from analysis.report import generate_report
from config.params import DESIGN_SCALAR, DESIGN_CLOB


def _sample_rows():
    return [
        {
            "design": 0,
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
            "exitability_transaction_count": 3,
            "exitability_slippage": 0.4,
            "exitability_reposition_cost": 0.2,
            "exitability_failure_rate": 0.1,
            "lp_passive_profitability": 0.05,
            "lp_rebalancing_profitability": 0.06,
            "truthful_incentive_alignment": 0.75,
            "lp_activation_rate": 0.8,
            "lp_deploy_status": "active",
            "boundary_payout_jump_max": 0.1,
            "boundary_payout_jump_mean": 0.05,
            "boundary_incentive_jump_max": 0.2,
            "boundary_incentive_jump_mean": 0.1,
            "payout_by_distance": {0: 1.0},
            "kl_series": [0.4, 0.2],
        },
        {
            "design": 1,
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
            "exitability_transaction_count": 2,
            "exitability_slippage": 0.2,
            "exitability_reposition_cost": 0.1,
            "exitability_failure_rate": 0.0,
            "lp_passive_profitability": 0.08,
            "lp_rebalancing_profitability": 0.12,
            "truthful_incentive_alignment": 0.85,
            "lp_activation_rate": 0.9,
            "lp_deploy_status": "active",
            "boundary_payout_jump_max": 0.05,
            "boundary_payout_jump_mean": 0.02,
            "boundary_incentive_jump_max": 0.15,
            "boundary_incentive_jump_mean": 0.08,
            "payout_by_distance": {0: 1.0},
            "kl_series": [0.2, 0.1],
        },
    ]


def _sample_scalar_row():
    """A Scalar design row for red-team testing."""
    return {
        "design": DESIGN_SCALAR,
        "design_name": "Scalar",
        "fee_name": "Flat",
        "price_accuracy": 0.5,
        "convergence_speed": 60,
        "mean_slippage": 0.3,
        "lp_profitability": 0.05,
        "manipulation_resistance": 5.0,
        "resolution_fairness": 0.8,
        "boundary_sensitivity_max": 2_000_000_000,
        "exitability_unwind": 0.3,
        "exitability_transaction_count": 5,
        "exitability_slippage": 0.5,
        "exitability_reposition_cost": 0.4,
        "exitability_failure_rate": 0.3,
        "lp_passive_profitability": 0.02,
        "lp_rebalancing_profitability": 0.03,
        "truthful_incentive_alignment": 0.55,
        "lp_activation_rate": 0.6,
        "lp_deploy_status": "partial",
        "boundary_payout_jump_max": 0.2,
        "boundary_payout_jump_mean": 0.1,
        "boundary_incentive_jump_max": 0.3,
        "boundary_incentive_jump_mean": 0.15,
        "payout_by_distance": {0: 0.9},
        "kl_series": [0.5, 0.3],
    }


def _make_stage0():
    """Create a minimal stage0 dict with ValidationResults."""
    from engine.validation import ValidationResult
    return {
        "validity_results": [
            ValidationResult(gate="design_differentiation", passed=True, detail="Designs differ"),
            ValidationResult(gate="lp_activation", passed=True, detail="LPs activate"),
            ValidationResult(gate="scenario_coverage", passed=False, detail="Missing bimodal"),
        ],
        "kl_by_design": {0: [0.1], 1: [0.2]},
        "lp_activation_rates": {0: 0.8, 1: 0.9},
        "exit_values": {0: 0.5, 1: 0.7},
        "scenario_families_used": {"gaussian_center", "gaussian_edge"},
    }


def test_generate_report_is_self_contained(tmp_path):
    stage1_df = pd.DataFrame(_sample_rows())
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert '<script src="https://cdn.plot.ly' not in html
    assert "Composite Score" in html


def test_generate_report_with_stage0(tmp_path):
    stage1_df = pd.DataFrame(_sample_rows())
    stage0 = _make_stage0()
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path), stage0=stage0))
    html = report_path.read_text()
    assert "Validity Gates" in html
    assert "design_differentiation" in html
    assert "PASS" in html
    assert "FAIL" in html


def test_report_contains_validity_gates(tmp_path):
    """Check that the report HTML includes Stage 0 section when stage0 data provided."""
    stage1_df = pd.DataFrame(_sample_rows())
    stage0 = _make_stage0()
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path), stage0=stage0))
    html = report_path.read_text()
    assert "Stage 0" in html
    assert "Validity Gates" in html
    assert "scenario_coverage" in html


def test_report_contains_scalar_redteam(tmp_path):
    """Check report mentions Scalar / Red-Team when scalar data is present."""
    rows = _sample_rows() + [_sample_scalar_row()]
    stage1_df = pd.DataFrame(rows)
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "Red-Team" in html
    assert "Scalar" in html


def test_report_skips_stage0_when_none(tmp_path):
    """When stage0 is None, the report should not contain Stage 0 section."""
    stage1_df = pd.DataFrame(_sample_rows())
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path), stage0=None))
    html = report_path.read_text()
    assert "Validity Gates" not in html


def test_report_contains_pareto_frontier(tmp_path):
    stage1_df = pd.DataFrame(_sample_rows())
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "Pareto" in html


def test_report_contains_tia_section(tmp_path):
    stage1_df = pd.DataFrame(_sample_rows())
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "Truthful Incentive Alignment" in html


def test_report_contains_lp_activation(tmp_path):
    stage1_df = pd.DataFrame(_sample_rows())
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "LP Activation" in html
    assert "Activation Rate" in html


def test_report_contains_boundary_revised(tmp_path):
    stage1_df = pd.DataFrame(_sample_rows())
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "Payout" in html and "Jump" in html


def test_report_backward_compat(tmp_path):
    """Ensure old-style call with phase2_df and clob_df still works."""
    stage1_df = pd.DataFrame(_sample_rows())
    report_path = Path(generate_report(
        stage1_df,
        phase2_df=None,
        clob_df=None,
        output_dir=str(tmp_path),
    ))
    html = report_path.read_text()
    assert "Composite Score" in html


def test_report_contains_degenerate_metrics(tmp_path):
    """When stage0 has metric_degeneracy failures, the report shows them."""
    from engine.validation import ValidationResult
    stage1_df = pd.DataFrame(_sample_rows())
    stage0 = _make_stage0()
    stage0["validity_results"].append(
        ValidationResult(gate="metric_degeneracy:price_accuracy", passed=False, detail="All values identical")
    )
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path), stage0=stage0))
    html = report_path.read_text()
    assert "Degenerate" in html
    assert "price_accuracy" in html
    assert "All values identical" in html


def test_report_contains_scenario_coverage(tmp_path):
    """When stage0 has scenario_families_used, the report shows a coverage summary."""
    stage1_df = pd.DataFrame(_sample_rows())
    stage0 = _make_stage0()
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path), stage0=stage0))
    html = report_path.read_text()
    assert "Scenario Coverage" in html
    assert "gaussian_center" in html
    assert "gaussian_edge" in html


def test_report_contains_fee_impact_decomposition(tmp_path):
    """When stage2_df is provided with multiple fee models, fee impact section appears."""
    stage1_df = pd.DataFrame(_sample_rows())
    stage2_rows = []
    for row in _sample_rows():
        stage2_rows.append(row)  # Flat fee
        dynamic_row = {**row, "fee_name": "Dynamic", "price_accuracy": row["price_accuracy"] - 0.05}
        stage2_rows.append(dynamic_row)
    stage2_df = pd.DataFrame(stage2_rows)
    report_path = Path(generate_report(stage1_df, stage2_df=stage2_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "Fee Impact Decomposition" in html
    assert "Dynamic" in html


def test_report_contains_boundary_gallery(tmp_path):
    """When stage1_df has adversarial_boundary scenario_family rows, gallery appears."""
    rows = _sample_rows()
    for r in rows:
        r["scenario_family"] = "adversarial_boundary"
    stage1_df = pd.DataFrame(rows)
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "Boundary Case Gallery" in html
    assert "adversarial_boundary" in html


def test_report_contains_exitability_failures(tmp_path):
    """Runs with exitability_unwind < 0.5 appear in the failure cases section."""
    rows = _sample_rows()
    rows[0]["exitability_unwind"] = 0.3  # force a failure
    stage1_df = pd.DataFrame(rows)
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "Exitability Failure Cases" in html
    assert "0.3000" in html


def test_report_contains_lp_concentration_chart(tmp_path):
    """When scenario_family exists, LP concentration chart appears."""
    rows = _sample_rows()
    rows[0]["scenario_family"] = "gaussian_center"
    rows[1]["scenario_family"] = "gaussian_edge"
    stage1_df = pd.DataFrame(rows)
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "LP Activation Concentration" in html


def test_report_no_degenerate_when_none_flagged(tmp_path):
    """When no metric_degeneracy failures exist, the degenerate section is absent."""
    stage1_df = pd.DataFrame(_sample_rows())
    stage0 = _make_stage0()
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path), stage0=stage0))
    html = report_path.read_text()
    # The section heading should not appear if there are no degenerate metrics
    assert "Degenerate" not in html


def test_report_no_exitability_failures_when_all_pass(tmp_path):
    """When all exitability_unwind >= 0.5, the failure section is absent."""
    stage1_df = pd.DataFrame(_sample_rows())  # default values are >= 0.5
    report_path = Path(generate_report(stage1_df, output_dir=str(tmp_path)))
    html = report_path.read_text()
    assert "Exitability Failure Cases" not in html


def test_report_sensitivity_includes_scenario_family(tmp_path):
    """Stage 3 sensitivity charts must include scenario_family sweep results."""
    stage1_df = pd.DataFrame(_sample_rows())

    # Build a minimal stage3 DataFrame with all four sweep dimensions
    sens_rows = []
    base = _sample_rows()[0]
    for param, values in [
        ("num_bins", [16, 32]),
        ("liquidity", [1_000_000_000, 10_000_000_000]),
        ("agent_mix", ["balanced", "adversarial"]),
        ("scenario_family", ["gaussian_center", "adversarial_boundary"]),
    ]:
        for val in values:
            row = {**base, "sweep_param": param, "sweep_value": val, "seed": 0}
            sens_rows.append(row)
    stage3_df = pd.DataFrame(sens_rows)

    report_path = Path(generate_report(
        stage1_df, stage3_df=stage3_df, output_dir=str(tmp_path),
    ))
    html = report_path.read_text()

    # The sensitivity section must appear
    assert "Sensitivity Analysis" in html
    # All four sweep parameters must produce a chart
    assert "Sensitivity: num_bins" in html
    assert "Sensitivity: liquidity" in html
    assert "Sensitivity: agent_mix" in html
    assert "Sensitivity: scenario_family" in html


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


def test_export_mirofish_includes_red_team_and_excluded_metadata(tmp_path):
    """Spec requires red_team_only and excluded flags on each design in the export."""
    # Include a normal candidate, a Scalar (red-team), and a CLOB (separate analysis)
    candidate_row = {**_sample_rows()[0], "red_team_only": False}
    scalar_row = {**_sample_scalar_row(), "red_team_only": True}
    clob_row = {
        **_sample_rows()[1],
        "design": DESIGN_CLOB,
        "design_name": "CLOB Hybrid",
        "red_team_only": False,
    }
    phase1_df = pd.DataFrame([candidate_row, scalar_row, clob_row])
    output_path = tmp_path / "mirofish_meta.json"
    export_mirofish_json(phase1_df, top_n=10, path=str(output_path))
    payload = json.loads(output_path.read_text())

    designs = {d["design"]: d for d in payload["top_designs"]}

    # Baseline A: candidate, not red-team, not excluded
    assert "Baseline A" in designs
    assert designs["Baseline A"]["red_team_only"] is False
    assert designs["Baseline A"]["excluded"] is False

    # Scalar: red-team-only AND excluded
    assert "Scalar" in designs
    assert designs["Scalar"]["red_team_only"] is True
    assert designs["Scalar"]["excluded"] is True

    # CLOB Hybrid: not red-team but excluded (separate analysis lane)
    assert "CLOB Hybrid" in designs
    assert designs["CLOB Hybrid"]["red_team_only"] is False
    assert designs["CLOB Hybrid"]["excluded"] is True


def test_export_mirofish_red_team_flag_inferred_from_name(tmp_path):
    """When red_team_only column is absent, infer from design name."""
    scalar_row = _sample_scalar_row()  # no red_team_only column
    phase1_df = pd.DataFrame([scalar_row])
    output_path = tmp_path / "mirofish_infer.json"
    export_mirofish_json(phase1_df, top_n=10, path=str(output_path))
    payload = json.loads(output_path.read_text())
    assert payload["top_designs"][0]["red_team_only"] is True
    assert payload["top_designs"][0]["excluded"] is True


def test_export_all_results_writes_consolidated_csv(tmp_path):
    phase1_df = pd.DataFrame(_sample_rows())
    clob_df = pd.DataFrame(_sample_rows()[:1])
    paths = export_all_results(phase1_df, clob_df, output_dir=str(tmp_path))
    assert Path(paths["results"]).exists()
    results_df = pd.read_csv(paths["results"])
    assert set(results_df["dataset"]) == {"phase1", "clob"}
