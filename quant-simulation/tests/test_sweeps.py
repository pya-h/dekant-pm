"""Tests for 4-stage sweep orchestration and selection logic."""

import pandas as pd

from engine.sweeps import (
    run_stage0,
    run_stage1,
    select_finalists,
    select_top_designs,
    run_stage2,
    run_stage3,
    _STAGE0_FAMILIES,
    _SENSITIVITY_FAMILIES,
    _SENSITIVITY_ADVERSARIAL_SEQUENCING,
)
from config.params import DESIGN_SCALAR, DESIGN_CLOB
from config.scenarios import TRUTH_FAMILIES


# ---------------------------------------------------------------------------
# Unit tests (no simulation needed)
# ---------------------------------------------------------------------------

def test_select_top_designs_treats_infinite_manipulation_resistance_as_best():
    df = pd.DataFrame(
        [
            {
                "design": 0,
                "price_accuracy": 1.0,
                "convergence_speed": 10,
                "lp_profitability": 0.0,
                "manipulation_resistance": float("inf"),
                "resolution_fairness": 0.1,
                "boundary_sensitivity_max": 1.0,
                "boundary_sensitivity_mean": 0.5,
                "exitability_unwind": 0.5,
                "exitability_transaction_count": 3,
                "exitability_slippage": 0.2,
                "exitability_reposition_cost": 0.15,
                "exitability_failure_rate": 0.1,
                "mean_slippage": 0.1,
            },
            {
                "design": 1,
                "price_accuracy": 1.0,
                "convergence_speed": 10,
                "lp_profitability": 0.0,
                "manipulation_resistance": 10.0,
                "resolution_fairness": 0.1,
                "boundary_sensitivity_max": 1.0,
                "boundary_sensitivity_mean": 0.5,
                "exitability_unwind": 0.5,
                "exitability_transaction_count": 3,
                "exitability_slippage": 0.2,
                "exitability_reposition_cost": 0.15,
                "exitability_failure_rate": 0.1,
                "mean_slippage": 0.1,
            },
        ]
    )

    assert select_top_designs(df, n=2) == [0, 1]


def test_select_finalists_excludes_scalar_and_clob_unit():
    """Unit test: select_finalists filters out Scalar and CLOB from a synthetic DataFrame."""
    rows = []
    for design in [0, 1, 2, 3, DESIGN_SCALAR, DESIGN_CLOB]:
        rows.append(
            {
                "design": design,
                "price_accuracy": 1.0,
                "convergence_speed": 10,
                "lp_profitability": 0.0,
                "manipulation_resistance": 10.0,
                "resolution_fairness": 0.1,
                "boundary_sensitivity_max": 1.0,
                "boundary_sensitivity_mean": 0.5,
                "exitability_unwind": 0.5,
                "exitability_transaction_count": 3,
                "exitability_slippage": 0.2,
                "exitability_reposition_cost": 0.15,
                "exitability_failure_rate": 0.1,
                "mean_slippage": 0.1,
            }
        )
    df = pd.DataFrame(rows)

    finalists = select_finalists(df, n=3)
    assert DESIGN_SCALAR not in finalists
    assert DESIGN_CLOB not in finalists
    assert len(finalists) <= 3


def test_select_finalists_returns_empty_when_validity_failed():
    """When validity_passed=False, select_finalists must return an empty list."""
    rows = []
    for design in [0, 1, 2]:
        rows.append(
            {
                "design": design,
                "price_accuracy": 1.0,
                "convergence_speed": 10,
                "lp_profitability": 0.0,
                "manipulation_resistance": 10.0,
                "resolution_fairness": 0.1,
                "boundary_sensitivity_max": 1.0,
                "boundary_sensitivity_mean": 0.5,
                "exitability_unwind": 0.5,
                "exitability_transaction_count": 3,
                "exitability_slippage": 0.2,
                "exitability_reposition_cost": 0.15,
                "exitability_failure_rate": 0.1,
                "mean_slippage": 0.1,
            }
        )
    df = pd.DataFrame(rows)
    assert select_finalists(df, n=3, validity_passed=False) == []


# ---------------------------------------------------------------------------
# Integration tests (run actual simulations — use small params)
# ---------------------------------------------------------------------------

def test_stage0_returns_validity_results():
    results = run_stage0(
        num_bins=16, initial_liquidity=1_000_000_000,
        num_rounds=10, mc_runs=2,
    )
    assert "validity_results" in results
    assert isinstance(results["validity_results"], list)
    assert "validity_passed" in results
    assert isinstance(results["validity_passed"], bool)
    assert "kl_by_design" in results
    assert "lp_activation_rates" in results
    assert "exit_values" in results
    assert "scenario_families_used" in results
    assert len(results["scenario_families_used"]) >= 2


def test_stage0_validity_passed_reflects_gate_results():
    """validity_passed must be True only when every gate passes."""
    results = run_stage0(
        num_bins=16, initial_liquidity=1_000_000_000,
        num_rounds=10, mc_runs=2,
    )
    all_passed = all(r.passed for r in results["validity_results"])
    assert results["validity_passed"] == all_passed


def test_stage1_includes_scenario_family():
    df = run_stage1(
        num_bins=16, initial_liquidity=1_000_000_000,
        num_rounds=10, mc_runs=2,
    )
    assert "scenario_family" in df.columns
    assert len(df) > 0
    # All designs (0-6) should be present
    assert set(df["design"].unique()) == {0, 1, 2, 3, 4, 5, 6}


def test_select_finalists_excludes_scalar():
    df = run_stage1(
        num_bins=16, initial_liquidity=1_000_000_000,
        num_rounds=10, mc_runs=2,
    )
    finalists = select_finalists(df, n=3)
    assert DESIGN_SCALAR not in finalists
    assert DESIGN_CLOB not in finalists
    assert len(finalists) <= 3
    assert len(finalists) > 0


def test_stage2_runs_fee_sweep():
    finalists = [0, 1]
    df = run_stage2(
        finalists=finalists,
        num_bins=16, initial_liquidity=1_000_000_000,
        num_rounds=10, mc_runs=2,
    )
    assert len(df) > 0
    # Should have 2 designs x 5 fee models x 2 seeds = 20 rows
    assert len(df) == 2 * 5 * 2
    assert set(df["design"].unique()) == {0, 1}


def test_stage3_includes_scenario_family_sweep():
    finalists = [0]
    df = run_stage3(
        finalists=finalists,
        num_rounds=10, mc_runs=2,
    )
    assert len(df) > 0
    # Should include scenario_family sweep dimension
    assert "scenario_family" in df[df["sweep_param"] == "scenario_family"].columns or \
        "sweep_value" in df.columns
    family_rows = df[df["sweep_param"] == "scenario_family"]
    assert len(family_rows) > 0


# ---------------------------------------------------------------------------
# Scenario family coverage tests
# ---------------------------------------------------------------------------

def test_stage0_families_match_truth_families():
    """_STAGE0_FAMILIES must include every key in TRUTH_FAMILIES."""
    expected = set(TRUTH_FAMILIES.keys())
    actual = set(_STAGE0_FAMILIES)
    assert actual == expected, (
        f"_STAGE0_FAMILIES mismatch.\n"
        f"  Missing: {expected - actual}\n"
        f"  Extra:   {actual - expected}"
    )


def test_sensitivity_families_match_truth_families():
    """_SENSITIVITY_FAMILIES must include every key in TRUTH_FAMILIES."""
    expected = set(TRUTH_FAMILIES.keys())
    actual = set(_SENSITIVITY_FAMILIES)
    assert actual == expected, (
        f"_SENSITIVITY_FAMILIES mismatch.\n"
        f"  Missing: {expected - actual}\n"
        f"  Extra:   {actual - expected}"
    )


def test_stage3_includes_adversarial_sequencing_sweep():
    """Stage 3 must sweep adversarial_sequencing per the spec."""
    finalists = [0]
    df = run_stage3(
        finalists=finalists,
        num_rounds=10, mc_runs=2,
    )
    assert len(df) > 0
    adv_rows = df[df["sweep_param"] == "adversarial_sequencing"]
    assert len(adv_rows) > 0, "Stage 3 must include adversarial_sequencing sweep dimension"
    # Should have both True and False values
    sweep_values = set(adv_rows["sweep_value"].unique())
    assert True in sweep_values, "adversarial_sequencing sweep must include True"
    assert False in sweep_values, "adversarial_sequencing sweep must include False"


def test_adversarial_sequencing_config_has_both_orderings():
    """_SENSITIVITY_ADVERSARIAL_SEQUENCING must include both shuffle (False) and adversarial-first (True)."""
    assert False in _SENSITIVITY_ADVERSARIAL_SEQUENCING
    assert True in _SENSITIVITY_ADVERSARIAL_SEQUENCING
