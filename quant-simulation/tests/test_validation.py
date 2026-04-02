"""Tests for the Stage 0 validation harness."""
import pytest
from engine.validation import (
    ValidationResult,
    check_agent_live_state,
    check_design_differentiation,
    check_exitability_nontrivial,
    check_lp_activation,
    check_metric_degeneracy,
    check_scenario_coverage,
    run_stage0_checks,
)


class TestValidationResult:
    def test_passed_result(self):
        r = ValidationResult(gate="test", passed=True, detail="ok")
        assert r.passed

    def test_failed_result(self):
        r = ValidationResult(gate="test", passed=False, detail="failed")
        assert not r.passed


class TestDesignDifferentiation:
    def test_detects_identical_trade_paths(self):
        results = {0: [1.0, 1.0, 1.0], 1: [1.0, 1.0, 1.0]}
        r = check_design_differentiation(results)
        assert not r.passed

    def test_passes_with_different_paths(self):
        results = {0: [1.0, 0.5, 0.3], 1: [0.8, 0.4, 0.2]}
        r = check_design_differentiation(results)
        assert r.passed

    def test_single_design_fails(self):
        r = check_design_differentiation({0: [1.0, 0.5]})
        assert not r.passed

    def test_threshold_respected_just_below(self):
        # difference of exactly threshold should NOT pass (must be strictly greater)
        results = {0: [0.0, 0.0, 0.0], 1: [0.01, 0.01, 0.01]}
        r = check_design_differentiation(results, threshold=0.01)
        assert not r.passed

    def test_threshold_respected_just_above(self):
        results = {0: [0.0, 0.0, 0.0], 1: [0.02, 0.02, 0.02]}
        r = check_design_differentiation(results, threshold=0.01)
        assert r.passed

    def test_gate_name(self):
        r = check_design_differentiation({0: [1.0], 1: [0.5]})
        assert r.gate == "design_differentiation"

    def test_detail_populated(self):
        r = check_design_differentiation({0: [1.0, 1.0], 1: [1.0, 1.0]})
        assert len(r.detail) > 0


class TestMetricDegeneracy:
    def test_detects_constant_metric(self):
        metric_values = {"metric_a": {0: 1.0, 1: 1.0, 2: 1.0}}
        result = check_metric_degeneracy(metric_values)
        assert len(result) == 1
        assert not result[0].passed

    def test_passes_varying_metric(self):
        metric_values = {"metric_a": {0: 1.0, 1: 0.5, 2: 0.3}}
        result = check_metric_degeneracy(metric_values)
        assert all(r.passed for r in result)

    def test_multiple_metrics(self):
        metric_values = {
            "metric_a": {0: 1.0, 1: 0.5},
            "metric_b": {0: 2.0, 1: 2.0},
        }
        result = check_metric_degeneracy(metric_values)
        assert len(result) == 2
        passed_map = {r.gate.split(":")[-1]: r.passed for r in result}
        assert passed_map["metric_a"] is True
        assert passed_map["metric_b"] is False

    def test_empty_metrics_returns_empty(self):
        result = check_metric_degeneracy({})
        assert result == []

    def test_gate_name_includes_metric(self):
        result = check_metric_degeneracy({"kl_div": {0: 1.0, 1: 0.5}})
        assert "kl_div" in result[0].gate

    def test_custom_threshold(self):
        # spread of 0.1 passes default threshold (1e-6) but should fail with threshold=0.5
        metric_values = {"m": {0: 0.0, 1: 0.1}}
        result = check_metric_degeneracy(metric_values, threshold=0.5)
        assert not result[0].passed


class TestLPActivation:
    def test_detects_zero_activation(self):
        r = check_lp_activation({0: 0.0, 1: 0.0})
        assert not r.passed

    def test_detects_positive_activation(self):
        r = check_lp_activation({0: 0.0, 1: 0.5})
        assert r.passed

    def test_empty_dict_fails(self):
        r = check_lp_activation({})
        assert not r.passed

    def test_gate_name(self):
        r = check_lp_activation({0: 0.5})
        assert r.gate == "lp_activation"

    def test_detail_mentions_design(self):
        r = check_lp_activation({0: 0.0, 1: 0.3})
        assert "1" in r.detail


class TestScenarioCoverage:
    def test_insufficient_coverage(self):
        r = check_scenario_coverage({"gaussian_center", "bimodal"}, required_count=3)
        assert not r.passed

    def test_sufficient_coverage(self):
        r = check_scenario_coverage({"gaussian_center", "bimodal", "skewed"}, required_count=3)
        assert r.passed

    def test_exactly_required_count_passes(self):
        r = check_scenario_coverage({"a", "b", "c"}, required_count=3)
        assert r.passed

    def test_more_than_required_passes(self):
        r = check_scenario_coverage({"a", "b", "c", "d"}, required_count=3)
        assert r.passed

    def test_empty_set_fails(self):
        r = check_scenario_coverage(set(), required_count=3)
        assert not r.passed

    def test_gate_name(self):
        r = check_scenario_coverage({"a", "b", "c"})
        assert r.gate == "scenario_coverage"


class TestExitabilityNontrivial:
    def test_all_same(self):
        r = check_exitability_nontrivial({0: 1.0, 1: 1.0})
        assert not r.passed

    def test_different_values(self):
        r = check_exitability_nontrivial({0: 1.0, 1: 0.8})
        assert r.passed

    def test_single_design_fails(self):
        r = check_exitability_nontrivial({0: 1.0})
        assert not r.passed

    def test_empty_dict_fails(self):
        r = check_exitability_nontrivial({})
        assert not r.passed

    def test_gate_name(self):
        r = check_exitability_nontrivial({0: 1.0, 1: 0.5})
        assert r.gate == "exitability_nontrivial"

    def test_three_designs_all_same(self):
        r = check_exitability_nontrivial({0: 0.5, 1: 0.5, 2: 0.5})
        assert not r.passed

    def test_three_designs_one_differs(self):
        r = check_exitability_nontrivial({0: 0.5, 1: 0.5, 2: 0.9})
        assert r.passed


class TestAgentLiveState:
    def test_passes_when_agents_react_differently(self):
        """check_agent_live_state should pass because agents use capital to size trades."""
        result = check_agent_live_state()
        assert result.gate == "agent_live_state"
        assert result.passed, result.detail


class TestRunStage0Checks:
    def _make_passing_inputs(self):
        return dict(
            kl_by_design={0: [1.0, 0.5], 1: [0.1, 0.05]},
            lp_activation_rates={0: 0.0, 1: 0.4},
            scenario_families_used={"gaussian_center", "bimodal", "skewed"},
            exit_values={0: 1.0, 1: 0.7},
            metric_values={"kl_div": {0: 1.0, 1: 0.5}},
        )

    def test_returns_list(self):
        results = run_stage0_checks(**self._make_passing_inputs())
        assert isinstance(results, list)

    def test_all_pass_on_good_data(self):
        results = run_stage0_checks(**self._make_passing_inputs())
        assert all(r.passed for r in results), [r for r in results if not r.passed]

    def test_includes_metric_degeneracy_results(self):
        inputs = self._make_passing_inputs()
        inputs["metric_values"] = {"m1": {0: 1.0, 1: 1.0}, "m2": {0: 0.0, 1: 1.0}}
        results = run_stage0_checks(**inputs)
        gates = [r.gate for r in results]
        assert any("m1" in g for g in gates)
        assert any("m2" in g for g in gates)

    def test_result_count_scales_with_metrics(self):
        inputs = self._make_passing_inputs()
        # 4 fixed checks + 3 metric checks + 1 agent_live_state = 8 total
        inputs["metric_values"] = {
            "a": {0: 1.0, 1: 0.5},
            "b": {0: 2.0, 1: 1.0},
            "c": {0: 3.0, 1: 2.0},
        }
        results = run_stage0_checks(**inputs)
        assert len(results) == 8

    def test_result_count_without_live_state(self):
        inputs = self._make_passing_inputs()
        # 4 fixed checks + 3 metric checks = 7 total (no agent_live_state)
        inputs["metric_values"] = {
            "a": {0: 1.0, 1: 0.5},
            "b": {0: 2.0, 1: 1.0},
            "c": {0: 3.0, 1: 2.0},
        }
        results = run_stage0_checks(**inputs, check_live_state=False)
        assert len(results) == 7

    def test_all_results_have_detail(self):
        results = run_stage0_checks(**self._make_passing_inputs())
        for r in results:
            assert len(r.detail) > 0
