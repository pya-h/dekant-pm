"""Stage 0 validation harness for composite ranking gate checks."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class ValidationResult:
    gate: str
    passed: bool
    detail: str


def check_design_differentiation(
    kl_by_design: dict[int, list[float]],
    threshold: float = 0.01,
) -> ValidationResult:
    """Check that at least two designs produce different KL trajectories.

    Compares mean absolute difference of KL series between all pairs.
    Returns passed=True if any pair differs by more than threshold.
    """
    gate = "design_differentiation"
    designs = list(kl_by_design.keys())

    if len(designs) < 2:
        return ValidationResult(
            gate=gate,
            passed=False,
            detail=f"Only {len(designs)} design(s) present; need at least 2 to compare.",
        )

    for i in range(len(designs)):
        for j in range(i + 1, len(designs)):
            a = kl_by_design[designs[i]]
            b = kl_by_design[designs[j]]
            length = min(len(a), len(b))
            if length == 0:
                continue
            mean_abs_diff = sum(abs(a[k] - b[k]) for k in range(length)) / length
            if mean_abs_diff > threshold:
                return ValidationResult(
                    gate=gate,
                    passed=True,
                    detail=(
                        f"Designs {designs[i]} and {designs[j]} differ by "
                        f"{mean_abs_diff:.4f} mean absolute KL (threshold={threshold})."
                    ),
                )

    return ValidationResult(
        gate=gate,
        passed=False,
        detail=(
            f"No pair of designs differs by more than {threshold} mean absolute KL; "
            "designs may be producing identical trajectories."
        ),
    )


def check_lp_activation(lp_activation_rates: dict[int, float]) -> ValidationResult:
    """Check that LP activation rate > 0 in at least one design."""
    gate = "lp_activation"

    for design_id, rate in lp_activation_rates.items():
        if rate > 0.0:
            return ValidationResult(
                gate=gate,
                passed=True,
                detail=f"Design {design_id} has LP activation rate {rate:.4f}.",
            )

    return ValidationResult(
        gate=gate,
        passed=False,
        detail="No design has LP activation rate > 0; LPs never activated.",
    )


def check_scenario_coverage(
    scenario_families_used: set[str],
    required_count: int = 3,
) -> ValidationResult:
    """Check that enough scenario families are covered."""
    gate = "scenario_coverage"
    count = len(scenario_families_used)

    if count >= required_count:
        return ValidationResult(
            gate=gate,
            passed=True,
            detail=f"{count} scenario families used (required {required_count}): {sorted(scenario_families_used)}.",
        )

    return ValidationResult(
        gate=gate,
        passed=False,
        detail=(
            f"Only {count} scenario families used (required {required_count}): "
            f"{sorted(scenario_families_used)}."
        ),
    )


def check_exitability_nontrivial(exit_values: dict[int, float]) -> ValidationResult:
    """Check that exitability differs across designs (not all identical)."""
    gate = "exitability_nontrivial"
    values = list(exit_values.values())

    if len(values) < 2:
        return ValidationResult(
            gate=gate,
            passed=False,
            detail=f"Only {len(values)} design(s); need at least 2 to compare exitability.",
        )

    min_val = min(values)
    max_val = max(values)

    if max_val != min_val:
        return ValidationResult(
            gate=gate,
            passed=True,
            detail=f"Exitability varies across designs (min={min_val}, max={max_val}).",
        )

    return ValidationResult(
        gate=gate,
        passed=False,
        detail=f"All designs have identical exitability ({min_val}); result is trivial.",
    )


def check_metric_degeneracy(
    metric_values: dict[str, dict[int, float]],
    threshold: float = 1e-6,
) -> list[ValidationResult]:
    """For each metric, check if values are constant across designs.

    Returns a list of ValidationResult, one per metric.
    passed=False if spread (max - min) < threshold.
    """
    results = []

    for metric_name, design_map in metric_values.items():
        gate = f"metric_degeneracy:{metric_name}"
        values = list(design_map.values())

        if len(values) < 2:
            results.append(
                ValidationResult(
                    gate=gate,
                    passed=False,
                    detail=f"Only {len(values)} value(s) for '{metric_name}'; cannot assess spread.",
                )
            )
            continue

        spread = max(values) - min(values)

        if spread >= threshold:
            results.append(
                ValidationResult(
                    gate=gate,
                    passed=True,
                    detail=f"Metric '{metric_name}' has spread {spread:.2e} across designs (threshold={threshold:.0e}).",
                )
            )
        else:
            results.append(
                ValidationResult(
                    gate=gate,
                    passed=False,
                    detail=(
                        f"Metric '{metric_name}' is effectively constant across designs "
                        f"(spread={spread:.2e} < threshold={threshold:.0e}); degenerate."
                    ),
                )
            )

    return results


def check_agent_live_state() -> ValidationResult:
    """Check that agent decisions change when capital / holdings change.

    Creates two :class:`DecisionContext` objects with very different capital
    levels and holdings, then verifies that at least one agent type produces
    different actions.  This validates the spec requirement that "agents
    consume live AgentState and portfolio information."
    """
    from agents.base import (
        AgentState,
        DecisionContext,
        AMM_ACTIONS,
    )
    from agents.noise_trader import NoiseTrader
    from agents.informed_trader import InformedTrader
    from config.params import SCALE

    gate = "agent_live_state"
    num_bins = 16
    implied_probs = np.ones(num_bins, dtype=np.int64) * (SCALE // num_bins)
    reserves = np.full(num_bins, 10_000_000, dtype=np.int64)
    total_minted = int(np.sum(reserves))

    # Context A: wealthy agent, no holdings
    state_a = AgentState(agent_id=0, capital=1_000_000, holdings={})
    ctx_a = DecisionContext(
        implied_probs=implied_probs,
        total_minted=total_minted,
        reserves=reserves.copy(),
        current_round=1,
        total_rounds=10,
        design=0,
        fee_model=0,
        agent_state=state_a,
        allowed_actions=AMM_ACTIONS,
        scenario_family="gaussian_center",
        belief_family="gaussian_center",
        settlement_rule="wta",
    )

    # Context B: nearly broke agent with some holdings
    state_b = AgentState(agent_id=0, capital=100, holdings={0: 5000, 1: 5000})
    ctx_b = DecisionContext(
        implied_probs=implied_probs,
        total_minted=total_minted,
        reserves=reserves.copy(),
        current_round=1,
        total_rounds=10,
        design=0,
        fee_model=0,
        agent_state=state_b,
        allowed_actions=AMM_ACTIONS,
        scenario_family="gaussian_center",
        belief_family="gaussian_center",
        settlement_rule="wta",
    )

    # Use a fixed seed for deterministic comparison
    rng = np.random.default_rng(42)

    # --- Noise trader ---
    # Run multiple trials to increase the chance of seeing a difference
    # (noise trader is stochastic, but capital limits should matter)
    any_differ = False

    for _ in range(20):
        seed_val = int(rng.integers(0, 2**31))
        nt_a = NoiseTrader(agent_id=0, trade_min=1_000, trade_max=100_000, frequency=1.0,
                           rng=np.random.default_rng(seed_val))
        nt_b = NoiseTrader(agent_id=0, trade_min=1_000, trade_max=100_000, frequency=1.0,
                           rng=np.random.default_rng(seed_val))
        actions_a = nt_a.decide(ctx_a)
        actions_b = nt_b.decide(ctx_b)

        # Compare: lengths differ or amounts differ
        if len(actions_a) != len(actions_b):
            any_differ = True
            break
        for aa, ab in zip(actions_a, actions_b):
            if aa.amount != ab.amount:
                any_differ = True
                break
        if any_differ:
            break

    if any_differ:
        return ValidationResult(
            gate=gate,
            passed=True,
            detail="NoiseTrader produces different actions for different capital/holdings states.",
        )

    # --- Informed trader (deterministic) ---
    true_dist = np.zeros(num_bins, dtype=np.float64)
    true_dist[7:10] = [0.2, 0.6, 0.2]
    it = InformedTrader(agent_id=0, conviction=0.5)
    informed_a = it.decide(ctx_a, true_dist)
    informed_b = it.decide(ctx_b, true_dist)

    if len(informed_a) != len(informed_b):
        return ValidationResult(
            gate=gate,
            passed=True,
            detail="InformedTrader produces different actions for different capital/holdings states.",
        )
    for ia, ib in zip(informed_a, informed_b):
        if ia.amount != ib.amount or ia.side != ib.side:
            return ValidationResult(
                gate=gate,
                passed=True,
                detail="InformedTrader produces different actions for different capital/holdings states.",
            )

    return ValidationResult(
        gate=gate,
        passed=False,
        detail="No tested agent type changed its actions when capital/holdings changed; "
               "agents may not be consuming live AgentState.",
    )


def run_stage0_checks(
    kl_by_design: dict[int, list[float]],
    lp_activation_rates: dict[int, float],
    scenario_families_used: set[str],
    exit_values: dict[int, float],
    metric_values: dict[str, dict[int, float]],
    check_live_state: bool = True,
) -> list[ValidationResult]:
    """Run all Stage 0 checks and return combined results.

    Parameters
    ----------
    check_live_state:
        When True (default), include the agent-live-state property test.
    """
    results: list[ValidationResult] = []

    results.append(check_design_differentiation(kl_by_design))
    results.append(check_lp_activation(lp_activation_rates))
    results.append(check_scenario_coverage(scenario_families_used))
    results.append(check_exitability_nontrivial(exit_values))
    results.extend(check_metric_degeneracy(metric_values))
    if check_live_state:
        results.append(check_agent_live_state())

    return results
