"""Tests for sweep selection and normalization."""

import pandas as pd

from engine.sweeps import select_top_designs


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
