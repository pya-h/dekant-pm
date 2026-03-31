"""Stage 0 validation harness for composite ranking gate checks."""
from dataclasses import dataclass


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


def run_stage0_checks(
    kl_by_design: dict[int, list[float]],
    lp_activation_rates: dict[int, float],
    scenario_families_used: set[str],
    exit_values: dict[int, float],
    metric_values: dict[str, dict[int, float]],
) -> list[ValidationResult]:
    """Run all Stage 0 checks and return combined results."""
    results: list[ValidationResult] = []

    results.append(check_design_differentiation(kl_by_design))
    results.append(check_lp_activation(lp_activation_rates))
    results.append(check_scenario_coverage(scenario_families_used))
    results.append(check_exitability_nontrivial(exit_values))
    results.extend(check_metric_degeneracy(metric_values))

    return results
