"""Tests for 4-stage sweep orchestration and selection logic."""

import pandas as pd

from engine.sweeps import (
    run_stage0,
    run_stage1,
    select_finalists,
    select_top_designs,
    run_stage2,
    run_stage3,
)
from config.params import DESIGN_SCALAR, DESIGN_CLOB


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
                "exitability_slippage": 0.2,
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
                "exitability_slippage": 0.2,
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
                "exitability_slippage": 0.2,
                "mean_slippage": 0.1,
            }
        )
    df = pd.DataFrame(rows)

    finalists = select_finalists(df, n=3)
    assert DESIGN_SCALAR not in finalists
    assert DESIGN_CLOB not in finalists
    assert len(finalists) <= 3


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
    assert "kl_by_design" in results
    assert "lp_activation_rates" in results
    assert "exit_values" in results
    assert "scenario_families_used" in results
    assert len(results["scenario_families_used"]) >= 2


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
