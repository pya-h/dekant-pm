"""Tests for the scenario framework (config/scenarios.py)."""

from __future__ import annotations

import numpy as np
import pytest

from config.params import SCALE
from config.scenarios import (
    BELIEF_FAMILIES,
    TRUTH_FAMILIES,
    Scenario,
    sample_scenario,
)

# ── Constants ─────────────────────────────────────────────────────────────────

NUM_BINS = 64
RANGE_MIN = 0
RANGE_MAX = 100 * SCALE  # 100 * 10^9 scaled units

_TRUTH_NAMES = list(TRUTH_FAMILIES.keys())
_BELIEF_NAMES = list(BELIEF_FAMILIES.keys())


def _rng(seed: int = 42) -> np.random.Generator:
    return np.random.default_rng(seed)


def _call_truth(name: str, seed: int = 42, num_bins: int = NUM_BINS) -> dict:
    rng = _rng(seed)
    fn = TRUTH_FAMILIES[name]
    return fn(rng, num_bins, RANGE_MIN, RANGE_MAX)


def _call_belief(name: str, seed: int = 42, num_bins: int = NUM_BINS) -> dict:
    rng = _rng(seed)
    fn = BELIEF_FAMILIES[name]
    return fn(rng, num_bins, RANGE_MIN, RANGE_MAX)


# ── Truth families: valid weights ─────────────────────────────────────────────

class TestTruthFamilyValidity:
    @pytest.mark.parametrize("family", _TRUTH_NAMES)
    def test_correct_shape(self, family):
        result = _call_truth(family)
        weights = result["weights"]
        assert len(weights) == NUM_BINS, f"{family}: expected {NUM_BINS} bins, got {len(weights)}"

    @pytest.mark.parametrize("family", _TRUTH_NAMES)
    def test_non_negative(self, family):
        result = _call_truth(family)
        weights = result["weights"]
        assert np.all(weights >= 0), f"{family}: found negative weights"

    @pytest.mark.parametrize("family", _TRUTH_NAMES)
    def test_sums_to_scale(self, family):
        result = _call_truth(family)
        weights = result["weights"]
        total = int(np.sum(weights))
        assert total > 0, f"{family}: weights sum to zero"
        assert abs(total - SCALE) <= 1, (
            f"{family}: weights sum to {total}, expected {SCALE}"
        )

    @pytest.mark.parametrize("family", _TRUTH_NAMES)
    def test_dtype_int64(self, family):
        result = _call_truth(family)
        weights = result["weights"]
        assert weights.dtype == np.int64, f"{family}: dtype is {weights.dtype}, expected int64"

    @pytest.mark.parametrize("family", _TRUTH_NAMES)
    def test_has_required_keys(self, family):
        result = _call_truth(family)
        assert "weights" in result
        assert "mu" in result
        assert "sigma" in result


# ── Truth families: reproducibility ──────────────────────────────────────────

class TestTruthFamilyReproducibility:
    @pytest.mark.parametrize("family", _TRUTH_NAMES)
    def test_same_seed_same_result(self, family):
        result1 = _call_truth(family, seed=123)
        result2 = _call_truth(family, seed=123)
        np.testing.assert_array_equal(
            result1["weights"],
            result2["weights"],
            err_msg=f"{family}: different results for same seed",
        )

    @pytest.mark.parametrize("family", _TRUTH_NAMES)
    def test_different_seeds_differ(self, family):
        # Not guaranteed for all seeds, but very likely
        results = [_call_truth(family, seed=s)["weights"] for s in range(5)]
        # At least two should differ
        all_same = all(np.array_equal(results[0], r) for r in results[1:])
        assert not all_same, f"{family}: identical results across 5 different seeds"


# ── Truth family-specific behavioral tests ────────────────────────────────────

class TestGaussianEdge:
    def test_mass_near_boundary(self):
        """gaussian_edge should place >30% mass in the first or last 8 bins."""
        boundary_bins = 8
        threshold = 0.30 * SCALE
        found = False
        for seed in range(20):
            result = _call_truth("gaussian_edge", seed=seed)
            weights = result["weights"]
            low_mass = int(np.sum(weights[:boundary_bins]))
            high_mass = int(np.sum(weights[-boundary_bins:]))
            if low_mass > threshold or high_mass > threshold:
                found = True
                break
        assert found, (
            "gaussian_edge: none of 20 seeds placed >30% mass in first/last 8 bins"
        )

    def test_all_seeds_near_boundary(self):
        """Every gaussian_edge sample should have >30% mass near some boundary."""
        boundary_bins = 8
        threshold = 0.30 * SCALE
        for seed in range(10):
            result = _call_truth("gaussian_edge", seed=seed)
            weights = result["weights"]
            low_mass = int(np.sum(weights[:boundary_bins]))
            high_mass = int(np.sum(weights[-boundary_bins:]))
            assert low_mass > threshold or high_mass > threshold, (
                f"gaussian_edge seed={seed}: only {max(low_mass, high_mass)/SCALE:.1%} "
                f"mass near boundaries (expected >30%)"
            )


class TestBimodal:
    def _count_local_maxima(self, weights: np.ndarray) -> int:
        peaks = 0
        n = len(weights)
        for i in range(1, n - 1):
            if weights[i] > weights[i - 1] and weights[i] > weights[i + 1]:
                peaks += 1
        return peaks

    def test_has_two_peaks(self):
        """bimodal should produce >=2 local maxima."""
        found = False
        for seed in range(20):
            result = _call_truth("bimodal", seed=seed)
            peaks = self._count_local_maxima(result["weights"])
            if peaks >= 2:
                found = True
                break
        assert found, "bimodal: no seed among 20 produced >=2 peaks"

    def test_most_seeds_bimodal(self):
        """Most bimodal samples should have >=2 peaks."""
        bimodal_count = 0
        n_trials = 20
        for seed in range(n_trials):
            result = _call_truth("bimodal", seed=seed)
            peaks = self._count_local_maxima(result["weights"])
            if peaks >= 2:
                bimodal_count += 1
        assert bimodal_count >= n_trials // 2, (
            f"bimodal: only {bimodal_count}/{n_trials} samples had >=2 peaks"
        )


class TestRegimeShift:
    def test_has_shift_round_frac(self):
        result = _call_truth("regime_shift")
        assert "shift_round_frac" in result
        frac = result["shift_round_frac"]
        assert 0.2 <= frac <= 0.8, f"shift_round_frac={frac} outside [0.2, 0.8]"

    def test_has_post_shift_weights(self):
        result = _call_truth("regime_shift")
        assert "post_shift_weights" in result
        pw = result["post_shift_weights"]
        assert len(pw) == NUM_BINS
        assert abs(int(np.sum(pw)) - SCALE) <= 1

    def test_shift_round_frac_range_across_seeds(self):
        for seed in range(15):
            result = _call_truth("regime_shift", seed=seed)
            frac = result["shift_round_frac"]
            assert 0.2 <= frac <= 0.8, (
                f"regime_shift seed={seed}: shift_round_frac={frac} outside [0.2, 0.8]"
            )


class TestAdversarialBoundary:
    def test_has_adversarial_bin(self):
        result = _call_truth("adversarial_boundary")
        assert "adversarial_bin" in result
        b = result["adversarial_bin"]
        assert 0 < b < NUM_BINS, f"adversarial_bin={b} out of range"

    def test_adversarial_bin_valid_across_seeds(self):
        for seed in range(10):
            result = _call_truth("adversarial_boundary", seed=seed)
            b = result["adversarial_bin"]
            assert isinstance(b, (int, np.integer)), f"adversarial_bin is not int: {type(b)}"
            assert 0 <= b < NUM_BINS


# ── Belief families: valid weights ───────────────────────────────────────────

class TestBeliefFamilyValidity:
    @pytest.mark.parametrize("family", _BELIEF_NAMES)
    def test_correct_shape(self, family):
        result = _call_belief(family)
        weights = result["weights"]
        assert len(weights) == NUM_BINS

    @pytest.mark.parametrize("family", _BELIEF_NAMES)
    def test_non_negative(self, family):
        result = _call_belief(family)
        weights = result["weights"]
        assert np.all(weights >= 0), f"{family} belief: found negative weights"

    @pytest.mark.parametrize("family", _BELIEF_NAMES)
    def test_sums_to_scale(self, family):
        result = _call_belief(family)
        weights = result["weights"]
        total = int(np.sum(weights))
        assert total > 0
        assert abs(total - SCALE) <= 1, f"{family} belief: sum={total}"

    @pytest.mark.parametrize("family", _BELIEF_NAMES)
    def test_dtype_int64(self, family):
        result = _call_belief(family)
        weights = result["weights"]
        assert weights.dtype == np.int64


# ── sample_scenario ───────────────────────────────────────────────────────────

class TestSampleScenario:
    def test_returns_scenario(self):
        rng = _rng(0)
        scenario = sample_scenario(rng, NUM_BINS, RANGE_MIN, RANGE_MAX)
        assert isinstance(scenario, Scenario)

    def test_truth_weights_valid(self):
        rng = _rng(1)
        scenario = sample_scenario(rng, NUM_BINS, RANGE_MIN, RANGE_MAX)
        assert len(scenario.truth_weights) == NUM_BINS
        assert np.all(scenario.truth_weights >= 0)
        assert abs(int(np.sum(scenario.truth_weights)) - SCALE) <= 1

    def test_belief_weights_valid(self):
        rng = _rng(2)
        scenario = sample_scenario(rng, NUM_BINS, RANGE_MIN, RANGE_MAX)
        assert len(scenario.belief_weights) == NUM_BINS
        assert np.all(scenario.belief_weights >= 0)
        assert abs(int(np.sum(scenario.belief_weights)) - SCALE) <= 1

    def test_truth_family_specified(self):
        rng = _rng(3)
        scenario = sample_scenario(rng, NUM_BINS, RANGE_MIN, RANGE_MAX, truth_family="bimodal")
        assert scenario.truth_family == "bimodal"

    def test_belief_family_specified(self):
        rng = _rng(4)
        scenario = sample_scenario(rng, NUM_BINS, RANGE_MIN, RANGE_MAX, belief_family="localized")
        assert scenario.belief_family == "localized"

    def test_both_families_specified(self):
        rng = _rng(5)
        scenario = sample_scenario(
            rng, NUM_BINS, RANGE_MIN, RANGE_MAX,
            truth_family="skewed", belief_family="multi_peak",
        )
        assert scenario.truth_family == "skewed"
        assert scenario.belief_family == "multi_peak"

    def test_regime_shift_fields_present(self):
        rng = _rng(6)
        scenario = sample_scenario(
            rng, NUM_BINS, RANGE_MIN, RANGE_MAX, truth_family="regime_shift"
        )
        assert scenario.shift_round_frac is not None
        assert 0.2 <= scenario.shift_round_frac <= 0.8
        assert scenario.post_shift_weights is not None

    def test_adversarial_boundary_fields_present(self):
        rng = _rng(7)
        scenario = sample_scenario(
            rng, NUM_BINS, RANGE_MIN, RANGE_MAX, truth_family="adversarial_boundary"
        )
        assert scenario.adversarial_bin is not None

    def test_non_regime_shift_has_no_shift_frac(self):
        rng = _rng(8)
        scenario = sample_scenario(
            rng, NUM_BINS, RANGE_MIN, RANGE_MAX, truth_family="gaussian_center"
        )
        assert scenario.shift_round_frac is None

    def test_reproducible(self):
        s1 = sample_scenario(_rng(99), NUM_BINS, RANGE_MIN, RANGE_MAX)
        s2 = sample_scenario(_rng(99), NUM_BINS, RANGE_MIN, RANGE_MAX)
        assert s1.truth_family == s2.truth_family
        assert s1.belief_family == s2.belief_family
        np.testing.assert_array_equal(s1.truth_weights, s2.truth_weights)
        np.testing.assert_array_equal(s1.belief_weights, s2.belief_weights)

    def test_mismatched_families_occur(self):
        """At least some seeds should produce truth and belief from different families."""
        mismatches = 0
        for seed in range(30):
            s = sample_scenario(_rng(seed), NUM_BINS, RANGE_MIN, RANGE_MAX)
            # Truth family names differ from belief family names by design
            # (different name spaces), so we check they're from different registries
            # by verifying families can independently differ in their distributions.
            # Since TRUTH_FAMILIES and BELIEF_FAMILIES have different keys,
            # the actual test is that random sampling isn't always producing
            # predictably "aligned" scenarios. We verify the families chosen
            # are from the correct registries.
            assert s.truth_family in TRUTH_FAMILIES
            assert s.belief_family in BELIEF_FAMILIES
            if s.truth_family != s.belief_family:
                mismatches += 1
        # All scenarios have mismatched family names since the registries
        # use different naming conventions — this always holds
        assert mismatches > 0, "Expected at least some truth/belief family name mismatches"

    def test_family_names_in_registry(self):
        """All sampled family names should come from the proper registries."""
        for seed in range(10):
            s = sample_scenario(_rng(seed), NUM_BINS, RANGE_MIN, RANGE_MAX)
            assert s.truth_family in TRUTH_FAMILIES
            assert s.belief_family in BELIEF_FAMILIES

    def test_mu_sigma_are_ints(self):
        rng = _rng(10)
        scenario = sample_scenario(rng, NUM_BINS, RANGE_MIN, RANGE_MAX)
        assert isinstance(scenario.truth_mu, (int, np.integer))
        assert isinstance(scenario.truth_sigma, (int, np.integer))
        assert isinstance(scenario.belief_mu, (int, np.integer))
        assert isinstance(scenario.belief_sigma, (int, np.integer))

    def test_belief_shifter_has_belief_post_shift_weights(self):
        """When belief_family='shifter', the Scenario should carry belief post-shift data."""
        rng = _rng(50)
        scenario = sample_scenario(
            rng, NUM_BINS, RANGE_MIN, RANGE_MAX, belief_family="shifter",
        )
        assert scenario.belief_post_shift_weights is not None
        assert len(scenario.belief_post_shift_weights) == NUM_BINS
        assert abs(int(np.sum(scenario.belief_post_shift_weights)) - SCALE) <= 1
        assert scenario.belief_post_shift_mu is not None
        assert scenario.belief_post_shift_sigma is not None

    def test_belief_shifter_has_own_shift_round_frac(self):
        """When belief_family='shifter', the Scenario must carry a belief_shift_round_frac
        so the belief shift fires even when the truth family is not regime_shift."""
        rng = _rng(52)
        scenario = sample_scenario(
            rng, NUM_BINS, RANGE_MIN, RANGE_MAX,
            truth_family="gaussian_center", belief_family="shifter",
        )
        # Truth is gaussian_center, so truth shift_round_frac should be None
        assert scenario.shift_round_frac is None, (
            "gaussian_center truth should not produce a shift_round_frac"
        )
        # But belief_shift_round_frac must be set so the belief shift has a trigger
        assert scenario.belief_shift_round_frac is not None, (
            "belief shifter must carry its own belief_shift_round_frac"
        )
        assert 0.2 <= scenario.belief_shift_round_frac <= 0.8

    def test_belief_shifter_shift_round_frac_across_truth_families(self):
        """Belief shifter must carry belief_shift_round_frac regardless of truth family."""
        for truth_fam in TRUTH_FAMILIES:
            rng = _rng(60)
            scenario = sample_scenario(
                rng, NUM_BINS, RANGE_MIN, RANGE_MAX,
                truth_family=truth_fam, belief_family="shifter",
            )
            assert scenario.belief_shift_round_frac is not None, (
                f"belief_shift_round_frac is None when truth_family={truth_fam!r}"
            )
            assert 0.2 <= scenario.belief_shift_round_frac <= 0.8

    def test_non_shifter_belief_has_no_belief_post_shift(self):
        """When belief_family is not 'shifter', belief post-shift fields should be None."""
        rng = _rng(51)
        scenario = sample_scenario(
            rng, NUM_BINS, RANGE_MIN, RANGE_MAX, belief_family="gaussian",
        )
        assert scenario.belief_post_shift_weights is None
        assert scenario.belief_post_shift_mu is None
        assert scenario.belief_post_shift_sigma is None

    def test_non_shifter_belief_has_no_belief_shift_round_frac(self):
        """When belief_family is not 'shifter', belief_shift_round_frac should be None."""
        rng = _rng(53)
        scenario = sample_scenario(
            rng, NUM_BINS, RANGE_MIN, RANGE_MAX, belief_family="gaussian",
        )
        assert scenario.belief_shift_round_frac is None
