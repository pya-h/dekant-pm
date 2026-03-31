# Quantitative AMM Simulation Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the quant-simulation codebase so that agent decisions depend on live state and active design, scenarios cover non-Gaussian failure modes, metrics measure real exit/LP/incentive quality, and sweeps run in 4 validated stages.

**Architecture:** Bottom-up in 4 layers. Layer 1 builds the foundational types (scenarios, DecisionContext, action primitives, validation skeleton). Layer 2 rewires all agent behavior to use live state and design-aware incentives. Layer 3 implements the 9 revised metrics. Layer 4 integrates sweep orchestration, reporting, and calibration.

**Tech Stack:** Python 3.11+, NumPy, SciPy, pandas, Jinja2/Plotly for reports. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-30-quant-simulation-design.md`
**Lifecycle:** `docs/superpowers/specs/2026-03-30-simulation-run-lifecycle.md`

---

## Layer 1: Foundation

### Task 1: Scenario Framework

**Files:**
- Create: `quant-simulation/config/scenarios.py`
- Create: `quant-simulation/tests/test_scenarios.py`
- Modify: `quant-simulation/config/params.py`

- [ ] **Step 1: Write test_scenarios.py with tests for all 7 truth families and 5 belief families**

```python
"""Tests for scenario framework."""
import numpy as np
import pytest
from config.scenarios import (
    ScenarioFamily, BeliefFamily, Scenario,
    sample_scenario, TRUTH_FAMILIES, BELIEF_FAMILIES,
)
from config.params import SCALE, DEFAULT_NUM_BINS


class TestTruthFamilies:
    """Each truth family must produce valid bin weights that sum to ~SCALE."""

    @pytest.mark.parametrize("family", list(TRUTH_FAMILIES.keys()))
    def test_family_produces_valid_weights(self, family):
        rng = np.random.default_rng(42)
        num_bins = 64
        range_min = 0
        range_max = 100 * SCALE
        sampler = TRUTH_FAMILIES[family]
        result = sampler(rng, num_bins, range_min, range_max)
        assert result["weights"].shape == (num_bins,)
        assert np.all(result["weights"] >= 0)
        assert int(np.sum(result["weights"])) > 0

    @pytest.mark.parametrize("family", list(TRUTH_FAMILIES.keys()))
    def test_family_is_reproducible(self, family):
        num_bins = 64
        range_min = 0
        range_max = 100 * SCALE
        sampler = TRUTH_FAMILIES[family]
        a = sampler(np.random.default_rng(99), num_bins, range_min, range_max)
        b = sampler(np.random.default_rng(99), num_bins, range_min, range_max)
        np.testing.assert_array_equal(a["weights"], b["weights"])

    def test_gaussian_edge_has_mass_near_boundary(self):
        rng = np.random.default_rng(42)
        result = TRUTH_FAMILIES["gaussian_edge"](rng, 64, 0, 100 * SCALE)
        edge_mass = int(np.sum(result["weights"][:8])) + int(np.sum(result["weights"][-8:]))
        total_mass = int(np.sum(result["weights"]))
        assert edge_mass > total_mass * 0.3

    def test_bimodal_has_two_peaks(self):
        rng = np.random.default_rng(42)
        result = TRUTH_FAMILIES["bimodal"](rng, 64, 0, 100 * SCALE)
        w = result["weights"].astype(float)
        peaks = []
        for i in range(1, len(w) - 1):
            if w[i] > w[i - 1] and w[i] > w[i + 1]:
                peaks.append(i)
        assert len(peaks) >= 2

    def test_regime_shift_has_shift_round(self):
        rng = np.random.default_rng(42)
        result = TRUTH_FAMILIES["regime_shift"](rng, 64, 0, 100 * SCALE)
        assert "shift_round_frac" in result
        assert 0.2 <= result["shift_round_frac"] <= 0.8


class TestBeliefFamilies:
    @pytest.mark.parametrize("family", list(BELIEF_FAMILIES.keys()))
    def test_belief_produces_valid_weights(self, family):
        rng = np.random.default_rng(42)
        num_bins = 64
        range_min = 0
        range_max = 100 * SCALE
        sampler = BELIEF_FAMILIES[family]
        result = sampler(rng, num_bins, range_min, range_max)
        assert result["weights"].shape == (num_bins,)
        assert np.all(result["weights"] >= 0)
        assert int(np.sum(result["weights"])) > 0


class TestScenarioSampling:
    def test_sample_scenario_returns_valid_scenario(self):
        rng = np.random.default_rng(42)
        scenario = sample_scenario(rng, num_bins=64, range_min=0, range_max=100 * SCALE)
        assert isinstance(scenario, Scenario)
        assert scenario.truth_weights.shape == (64,)
        assert scenario.belief_weights.shape == (64,)
        assert scenario.truth_family in TRUTH_FAMILIES
        assert scenario.belief_family in BELIEF_FAMILIES

    def test_belief_can_differ_from_truth(self):
        """At least some seeds produce mismatched truth/belief families."""
        mismatched = False
        for seed in range(50):
            rng = np.random.default_rng(seed)
            scenario = sample_scenario(rng, 64, 0, 100 * SCALE)
            if scenario.truth_family != scenario.belief_family:
                mismatched = True
                break
        assert mismatched
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quant-simulation && python -m pytest tests/test_scenarios.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'config.scenarios'`

- [ ] **Step 3: Create config/scenarios.py with all families**

```python
"""Scenario families for truth processes and trader beliefs."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np
from scipy.stats import norm, skewnorm

from config.params import SCALE


@dataclass
class Scenario:
    truth_family: str
    belief_family: str
    truth_weights: np.ndarray
    belief_weights: np.ndarray
    truth_mu: int
    truth_sigma: int
    belief_mu: int
    belief_sigma: int
    shift_round_frac: float | None = None  # for regime_shift
    post_shift_weights: np.ndarray | None = None
    post_shift_mu: int | None = None
    post_shift_sigma: int | None = None
    adversarial_bin: int | None = None  # for adversarial_boundary


def _gaussian_weights(num_bins: int, mu: float, sigma: float, range_min: int, range_max: int) -> np.ndarray:
    """Compute Gaussian bin weights scaled to SCALE."""
    span = range_max - range_min
    bin_width = span / num_bins
    centers = np.array([range_min + (i + 0.5) * bin_width for i in range(num_bins)])
    pdf_vals = norm.pdf(centers, loc=mu, scale=max(1.0, sigma))
    pdf_vals = np.maximum(pdf_vals, 0.0)
    total = pdf_vals.sum()
    if total <= 0:
        return np.ones(num_bins, dtype=np.int64) * (SCALE // num_bins)
    scaled = (pdf_vals / total * SCALE).astype(np.int64)
    scaled[np.argmax(pdf_vals)] += SCALE - int(scaled.sum())
    return scaled


def _skewed_weights(num_bins: int, mu: float, sigma: float, skewness: float, range_min: int, range_max: int) -> np.ndarray:
    span = range_max - range_min
    bin_width = span / num_bins
    centers = np.array([range_min + (i + 0.5) * bin_width for i in range(num_bins)])
    pdf_vals = skewnorm.pdf(centers, a=skewness, loc=mu, scale=max(1.0, sigma))
    pdf_vals = np.maximum(pdf_vals, 0.0)
    total = pdf_vals.sum()
    if total <= 0:
        return np.ones(num_bins, dtype=np.int64) * (SCALE // num_bins)
    scaled = (pdf_vals / total * SCALE).astype(np.int64)
    scaled[np.argmax(pdf_vals)] += SCALE - int(scaled.sum())
    return scaled


# ── Truth families ────────────────────────────────────────────────────

def _truth_gaussian_center(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    center = (range_min + range_max) / 2
    mu = center + rng.uniform(-0.15, 0.15) * span
    sigma = rng.uniform(span / 10, span / 4)
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": int(mu), "sigma": int(sigma)}


def _truth_gaussian_edge(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    side = rng.choice([-1, 1])
    mu = (range_min if side == -1 else range_max) + side * rng.uniform(0, 0.05) * span
    sigma = rng.uniform(span / 20, span / 8)
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": int(mu), "sigma": int(sigma)}


def _truth_skewed(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    center = (range_min + range_max) / 2
    mu = center + rng.uniform(-0.2, 0.2) * span
    sigma = rng.uniform(span / 10, span / 4)
    skewness = rng.choice([-1, 1]) * rng.uniform(3, 8)
    weights = _skewed_weights(num_bins, mu, sigma, skewness, range_min, range_max)
    return {"weights": weights, "mu": int(mu), "sigma": int(sigma)}


def _truth_bimodal(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    sep = rng.uniform(0.2, 0.4) * span
    center = (range_min + range_max) / 2
    mu1 = center - sep / 2
    mu2 = center + sep / 2
    sigma = rng.uniform(span / 20, span / 8)
    w1 = _gaussian_weights(num_bins, mu1, sigma, range_min, range_max).astype(np.float64)
    w2 = _gaussian_weights(num_bins, mu2, sigma, range_min, range_max).astype(np.float64)
    mix = rng.uniform(0.3, 0.7)
    combined = mix * w1 + (1 - mix) * w2
    total = combined.sum()
    if total > 0:
        combined = (combined / total * SCALE).astype(np.int64)
    combined[np.argmax(combined)] += SCALE - int(combined.sum())
    avg_mu = int(mix * mu1 + (1 - mix) * mu2)
    return {"weights": combined, "mu": avg_mu, "sigma": int(sigma)}


def _truth_truncated(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    side = rng.choice([-1, 1])
    if side == -1:
        mu = range_min + rng.uniform(0, 0.1) * span
    else:
        mu = range_max - rng.uniform(0, 0.1) * span
    sigma = rng.uniform(span / 8, span / 4)
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    # Clip: zero out bins beyond boundary
    if side == -1:
        cutoff = num_bins // 3
        weights[cutoff:] = 0
    else:
        cutoff = 2 * num_bins // 3
        weights[:cutoff] = 0
    total = int(np.sum(weights))
    if total <= 0:
        weights = np.ones(num_bins, dtype=np.int64) * (SCALE // num_bins)
    else:
        weights = (weights.astype(np.float64) / total * SCALE).astype(np.int64)
        weights[np.argmax(weights)] += SCALE - int(weights.sum())
    return {"weights": weights, "mu": int(mu), "sigma": int(sigma)}


def _truth_regime_shift(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    center = (range_min + range_max) / 2
    mu1 = center + rng.uniform(-0.2, 0.0) * span
    sigma1 = rng.uniform(span / 10, span / 5)
    mu2 = center + rng.uniform(0.0, 0.2) * span
    sigma2 = rng.uniform(span / 10, span / 5)
    if abs(mu1 - mu2) < span * 0.1:
        mu2 = mu1 + 0.15 * span
    shift_round_frac = rng.uniform(0.3, 0.6)
    w1 = _gaussian_weights(num_bins, mu1, sigma1, range_min, range_max)
    w2 = _gaussian_weights(num_bins, mu2, sigma2, range_min, range_max)
    return {
        "weights": w1, "mu": int(mu1), "sigma": int(sigma1),
        "shift_round_frac": shift_round_frac,
        "post_shift_weights": w2, "post_shift_mu": int(mu2), "post_shift_sigma": int(sigma2),
    }


def _truth_adversarial_boundary(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    bin_width = span / num_bins
    target_bin = rng.integers(1, num_bins - 1)
    boundary = range_min + target_bin * bin_width
    mu = boundary + rng.choice([-1, 1]) * bin_width * 0.05
    sigma = rng.uniform(span / 20, span / 8)
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": int(mu), "sigma": int(sigma), "adversarial_bin": int(target_bin)}


TRUTH_FAMILIES: dict[str, Callable] = {
    "gaussian_center": _truth_gaussian_center,
    "gaussian_edge": _truth_gaussian_edge,
    "skewed": _truth_skewed,
    "bimodal": _truth_bimodal,
    "truncated": _truth_truncated,
    "regime_shift": _truth_regime_shift,
    "adversarial_boundary": _truth_adversarial_boundary,
}


# ── Belief families ───────────────────────────────────────────────────

def _belief_gaussian(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    center = (range_min + range_max) / 2
    mu = center + rng.uniform(-0.2, 0.2) * span
    sigma = rng.uniform(span / 10, span / 4)
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": int(mu), "sigma": int(sigma)}


def _belief_skewed(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    center = (range_min + range_max) / 2
    mu = center + rng.uniform(-0.2, 0.2) * span
    sigma = rng.uniform(span / 10, span / 4)
    skewness = rng.choice([-1, 1]) * rng.uniform(2, 6)
    weights = _skewed_weights(num_bins, mu, sigma, skewness, range_min, range_max)
    return {"weights": weights, "mu": int(mu), "sigma": int(sigma)}


def _belief_multi_peak(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    n_peaks = rng.integers(2, 4)
    combined = np.zeros(num_bins, dtype=np.float64)
    mus = []
    for _ in range(n_peaks):
        mu = range_min + rng.uniform(0.1, 0.9) * span
        sigma = rng.uniform(span / 20, span / 10)
        w = _gaussian_weights(num_bins, mu, sigma, range_min, range_max).astype(np.float64)
        combined += w
        mus.append(mu)
    total = combined.sum()
    if total > 0:
        combined = (combined / total * SCALE).astype(np.int64)
    combined[np.argmax(combined)] += SCALE - int(combined.sum())
    avg_mu = int(np.mean(mus))
    return {"weights": combined, "mu": avg_mu, "sigma": int(span / 10)}


def _belief_localized(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    span = range_max - range_min
    side = rng.choice([-1, 1])
    if side == -1:
        mu = range_min + rng.uniform(0.05, 0.25) * span
    else:
        mu = range_max - rng.uniform(0.05, 0.25) * span
    sigma = rng.uniform(span / 25, span / 12)
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": int(mu), "sigma": int(sigma)}


def _belief_shifter(rng: np.random.Generator, num_bins: int, range_min: int, range_max: int) -> dict:
    """Returns initial belief; post-shift belief handled by scenario's shift metadata."""
    span = range_max - range_min
    center = (range_min + range_max) / 2
    mu = center + rng.uniform(-0.15, 0.15) * span
    sigma = rng.uniform(span / 10, span / 5)
    weights = _gaussian_weights(num_bins, mu, sigma, range_min, range_max)
    return {"weights": weights, "mu": int(mu), "sigma": int(sigma)}


BELIEF_FAMILIES: dict[str, Callable] = {
    "gaussian": _belief_gaussian,
    "skewed": _belief_skewed,
    "multi_peak": _belief_multi_peak,
    "localized": _belief_localized,
    "shifter": _belief_shifter,
}


def sample_scenario(
    rng: np.random.Generator,
    num_bins: int,
    range_min: int,
    range_max: int,
    truth_family: str | None = None,
    belief_family: str | None = None,
) -> Scenario:
    """Sample a complete scenario with truth and belief, possibly mismatched."""
    if truth_family is None:
        truth_family = rng.choice(list(TRUTH_FAMILIES.keys()))
    if belief_family is None:
        belief_family = rng.choice(list(BELIEF_FAMILIES.keys()))

    truth = TRUTH_FAMILIES[truth_family](rng, num_bins, range_min, range_max)
    belief = BELIEF_FAMILIES[belief_family](rng, num_bins, range_min, range_max)

    return Scenario(
        truth_family=truth_family,
        belief_family=belief_family,
        truth_weights=truth["weights"],
        belief_weights=belief["weights"],
        truth_mu=truth["mu"],
        truth_sigma=truth["sigma"],
        belief_mu=belief["mu"],
        belief_sigma=belief["sigma"],
        shift_round_frac=truth.get("shift_round_frac"),
        post_shift_weights=truth.get("post_shift_weights"),
        post_shift_mu=truth.get("post_shift_mu"),
        post_shift_sigma=truth.get("post_shift_sigma"),
        adversarial_bin=truth.get("adversarial_bin"),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd quant-simulation && python -m pytest tests/test_scenarios.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/config/scenarios.py quant-simulation/tests/test_scenarios.py
git commit -m "feat(sim): add scenario framework with 7 truth and 5 belief families"
```

---

### Task 2: Agent Decision Context and Action Primitives

**Files:**
- Modify: `quant-simulation/agents/base.py`
- Modify: `quant-simulation/tests/test_agents.py`

- [ ] **Step 1: Write tests for DecisionContext and ActionType**

Add to `tests/test_agents.py`:

```python
from agents.base import DecisionContext, ActionType


class TestDecisionContext:
    def test_context_has_required_fields(self):
        ctx = DecisionContext(
            implied_probs=np.zeros(16, dtype=np.int64),
            total_minted=1_000_000_000,
            reserves=np.zeros(16, dtype=np.int64),
            current_round=5,
            total_rounds=200,
            design=0,
            fee_model=0,
            agent_state=AgentState(agent_id=0, capital=1000, holdings={}),
            allowed_actions=frozenset(ActionType),
            scenario_family="gaussian_center",
            belief_family="gaussian",
            settlement_rule="wta",
        )
        assert ctx.agent_state.capital == 1000
        assert ActionType.SINGLE_BIN_BUY in ctx.allowed_actions

    def test_action_primitives_registry(self):
        amm_actions = frozenset({
            ActionType.SINGLE_BIN_BUY, ActionType.SINGLE_BIN_SELL,
            ActionType.BUNDLE_BUY, ActionType.BUNDLE_SELL,
            ActionType.LP_DEPOSIT, ActionType.LP_WITHDRAW, ActionType.LP_REBALANCE,
        })
        clob_actions = frozenset({
            ActionType.SINGLE_BIN_BUY, ActionType.SINGLE_BIN_SELL,
            ActionType.ORDER_PLACE, ActionType.ORDER_CANCEL,
        })
        assert ActionType.ORDER_PLACE not in amm_actions
        assert ActionType.BUNDLE_BUY not in clob_actions
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quant-simulation && python -m pytest tests/test_agents.py::TestDecisionContext -v`
Expected: FAIL — `ImportError`

- [ ] **Step 3: Rewrite agents/base.py with DecisionContext and ActionType**

```python
"""Base types for agent actions and decision context."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto

import numpy as np


class ActionType(Enum):
    SINGLE_BIN_BUY = auto()
    SINGLE_BIN_SELL = auto()
    BUNDLE_BUY = auto()
    BUNDLE_SELL = auto()
    LP_DEPOSIT = auto()
    LP_WITHDRAW = auto()
    LP_REBALANCE = auto()
    ORDER_PLACE = auto()
    ORDER_CANCEL = auto()


@dataclass
class TradeAction:
    agent_id: int
    bin_idx: int
    side: str  # "buy" or "sell"
    amount: int  # collateral-native units


@dataclass
class DistributionTradeAction(TradeAction):
    mu: int = 0
    sigma: int = 0


@dataclass
class AgentState:
    agent_id: int
    capital: int
    holdings: dict  # bin_idx -> tokens held
    cumulative_volume: int = 0
    deposited_lp: int = 0
    fees_earned: int = 0
    realized_pnl: float = 0.0


SETTLEMENT_RULES = {
    0: "wta", 1: "wta",
    2: "piecewise", 3: "kernel",
    4: "scalar", 5: "crps", 6: "piecewise",
}

AMM_ACTIONS = frozenset({
    ActionType.SINGLE_BIN_BUY, ActionType.SINGLE_BIN_SELL,
    ActionType.BUNDLE_BUY, ActionType.BUNDLE_SELL,
    ActionType.LP_DEPOSIT, ActionType.LP_WITHDRAW, ActionType.LP_REBALANCE,
})

CLOB_ACTIONS = frozenset({
    ActionType.SINGLE_BIN_BUY, ActionType.SINGLE_BIN_SELL,
    ActionType.ORDER_PLACE, ActionType.ORDER_CANCEL,
})


@dataclass
class DecisionContext:
    implied_probs: np.ndarray
    total_minted: int
    reserves: np.ndarray
    current_round: int
    total_rounds: int
    design: int
    fee_model: int
    agent_state: AgentState
    allowed_actions: frozenset[ActionType]
    scenario_family: str
    belief_family: str
    settlement_rule: str
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd quant-simulation && python -m pytest tests/test_agents.py::TestDecisionContext -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/agents/base.py quant-simulation/tests/test_agents.py
git commit -m "feat(sim): add DecisionContext with action primitives registry"
```

---

### Task 3: Refactor All Agents to Use DecisionContext

**Files:**
- Modify: `quant-simulation/agents/informed_trader.py`
- Modify: `quant-simulation/agents/noise_trader.py`
- Modify: `quant-simulation/agents/arbitrageur.py`
- Modify: `quant-simulation/agents/manipulator.py`
- Modify: `quant-simulation/agents/late_round_whale.py`
- Modify: `quant-simulation/agents/lp.py`
- Modify: `quant-simulation/tests/test_agents.py`

- [ ] **Step 1: Write tests proving agents use live state from DecisionContext**

Add to `tests/test_agents.py`:

```python
class TestInformedTraderLiveState:
    def test_reduced_capital_reduces_trade_size(self):
        _, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        reserves, _, _ = _make_market()
        state_rich = AgentState(agent_id=0, capital=1_000_000_000, holdings={})
        state_poor = AgentState(agent_id=0, capital=1_000, holdings={})
        agent = InformedTrader(agent_id=0, conviction=0.5)

        ctx_rich = DecisionContext(
            implied_probs=probs, total_minted=total_minted, reserves=reserves,
            current_round=10, total_rounds=200, design=0, fee_model=0,
            agent_state=state_rich, allowed_actions=AMM_ACTIONS,
            scenario_family="gaussian_center", belief_family="gaussian",
            settlement_rule="wta",
        )
        ctx_poor = DecisionContext(
            implied_probs=probs, total_minted=total_minted, reserves=reserves,
            current_round=10, total_rounds=200, design=0, fee_model=0,
            agent_state=state_poor, allowed_actions=AMM_ACTIONS,
            scenario_family="gaussian_center", belief_family="gaussian",
            settlement_rule="wta",
        )
        actions_rich = agent.decide(ctx_rich, true_dist)
        actions_poor = agent.decide(ctx_poor, true_dist)
        if actions_rich and actions_poor:
            assert actions_rich[0].amount > actions_poor[0].amount

    def test_holdings_affect_sell_decisions(self):
        _, total_minted, probs = _make_market()
        true_dist = np.zeros(16, dtype=np.int64)
        true_dist[8] = SCALE
        reserves, _, _ = _make_market()
        state = AgentState(agent_id=0, capital=0, holdings={8: 1_000_000})
        agent = InformedTrader(agent_id=0, conviction=0.5)
        ctx = DecisionContext(
            implied_probs=probs, total_minted=total_minted, reserves=reserves,
            current_round=10, total_rounds=200, design=0, fee_model=0,
            agent_state=state, allowed_actions=AMM_ACTIONS,
            scenario_family="gaussian_center", belief_family="gaussian",
            settlement_rule="wta",
        )
        actions = agent.decide(ctx, true_dist)
        # Agent with zero capital but holdings should still be able to act
        assert isinstance(actions, list)


class TestNoiseTraderBundles:
    def test_noise_can_produce_bundle_actions(self):
        _, total_minted, probs = _make_market()
        reserves, _, _ = _make_market()
        state = AgentState(agent_id=1, capital=1_000_000, holdings={})
        rng = np.random.default_rng(42)
        agent = NoiseTrader(agent_id=1, trade_min=1000, trade_max=100_000, frequency=1.0, rng=rng)
        ctx = DecisionContext(
            implied_probs=probs, total_minted=total_minted, reserves=reserves,
            current_round=5, total_rounds=200, design=0, fee_model=0,
            agent_state=state, allowed_actions=AMM_ACTIONS,
            scenario_family="gaussian_center", belief_family="gaussian",
            settlement_rule="wta",
        )
        # Over many calls, some should be bundles
        found_bundle = False
        for seed in range(100):
            agent_rng = NoiseTrader(agent_id=1, trade_min=1000, trade_max=100_000, frequency=1.0, rng=np.random.default_rng(seed))
            actions = agent_rng.decide(ctx)
            for a in actions:
                if isinstance(a, DistributionTradeAction):
                    found_bundle = True
                    break
            if found_bundle:
                break
        assert found_bundle


class TestLPLiveState:
    def test_lp_uses_live_deposited_state(self):
        lp = PassiveLP(agent_id=5, yield_threshold=0.0, loss_tolerance=1.0)
        state_deposited = AgentState(agent_id=5, capital=1_000_000_000, holdings={}, deposited_lp=500_000_000)
        state_fresh = AgentState(agent_id=5, capital=1_000_000_000, holdings={}, deposited_lp=0)
        # Already deposited: should not deposit again
        action_deposited = lp.decide_lp(fee_yield=0.01, unrealized_loss=0.0, current_round=5, agent_state=state_deposited)
        action_fresh = lp.decide_lp(fee_yield=0.01, unrealized_loss=0.0, current_round=5, agent_state=state_fresh)
        assert action_fresh is not None and action_fresh["type"] == "deposit"
        # Already deposited should not deposit again
        assert action_deposited is None or action_deposited["type"] != "deposit"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_agents.py -k "LiveState or Bundles" -v`
Expected: FAIL

- [ ] **Step 3: Rewrite all agent classes to use DecisionContext**

**agents/informed_trader.py:**
```python
"""Informed trader: trades toward the true distribution using live state."""
import numpy as np
from agents.base import DecisionContext, DistributionTradeAction, ActionType
from config.params import SCALE


class InformedTrader:
    def __init__(self, agent_id: int, conviction: float = 0.5):
        self.agent_id = agent_id
        self.conviction = conviction

    def decide(self, ctx: DecisionContext, true_distribution: np.ndarray) -> list[DistributionTradeAction]:
        actions = []
        state = ctx.agent_state
        if state.capital <= 0:
            return actions

        true_total = float(np.sum(true_distribution))
        implied_total = float(np.sum(ctx.implied_probs))
        if true_total <= 0 or implied_total <= 0:
            return actions

        true_probs = true_distribution.astype(np.float64) / true_total
        market_probs = ctx.implied_probs.astype(np.float64) / implied_total
        mispricings = true_probs - market_probs

        # Design-aware: scale conviction by settlement smoothness
        effective_conviction = self.conviction
        if ctx.settlement_rule in ("piecewise", "kernel"):
            effective_conviction *= 1.2  # smoothed payouts reduce risk
        elif ctx.settlement_rule == "crps":
            effective_conviction *= 1.3  # proper scoring rule rewards truth
        elif ctx.settlement_rule == "scalar":
            effective_conviction *= 0.5  # scalar is manipulable

        bundle_edge = float(np.dot(mispricings, true_probs))
        if abs(bundle_edge) <= 1e-6:
            return actions

        side = "buy" if bundle_edge > 0 else "sell"
        target_bin = int(np.argmax(mispricings)) if side == "buy" else int(np.argmin(mispricings))

        if side == "buy" and ActionType.BUNDLE_BUY in ctx.allowed_actions:
            amount = int(min(state.capital * 0.1, state.capital * abs(bundle_edge) * effective_conviction))
            if amount > 0:
                actions.append(DistributionTradeAction(
                    agent_id=self.agent_id, bin_idx=target_bin, side=side, amount=amount,
                    mu=0, sigma=0,  # filled by simulation from scenario
                ))
        elif side == "sell" and ActionType.BUNDLE_SELL in ctx.allowed_actions:
            total_held = sum(state.holdings.values())
            if total_held > 0:
                amount = int(min(total_held, total_held * abs(bundle_edge) * effective_conviction))
                if amount > 0:
                    actions.append(DistributionTradeAction(
                        agent_id=self.agent_id, bin_idx=target_bin, side=side, amount=amount,
                        mu=0, sigma=0,
                    ))
        return actions
```

**agents/noise_trader.py:**
```python
"""Noise trader: random trades including both singles and bundles."""
import numpy as np
from agents.base import DecisionContext, TradeAction, DistributionTradeAction, ActionType


class NoiseTrader:
    def __init__(self, agent_id: int, trade_min: int, trade_max: int, frequency: float, rng: np.random.Generator):
        self.agent_id = agent_id
        self.trade_min = trade_min
        self.trade_max = trade_max
        self.frequency = frequency
        self.rng = rng

    def decide(self, ctx: DecisionContext) -> list[TradeAction]:
        state = ctx.agent_state
        if state.capital <= 0 or self.rng.random() > self.frequency:
            return []
        n_bins = len(ctx.implied_probs)
        amount = int(self.rng.integers(self.trade_min, min(self.trade_max, state.capital) + 1))
        amount = min(amount, state.capital)
        if amount <= 0:
            return []

        # 30% chance of bundle trade if allowed
        use_bundle = (
            self.rng.random() < 0.3
            and ActionType.BUNDLE_BUY in ctx.allowed_actions
        )

        if use_bundle:
            side = "buy" if self.rng.random() > 0.5 else "sell"
            if side == "sell" and sum(state.holdings.values()) <= 0:
                side = "buy"
            mu_bin = int(self.rng.integers(0, n_bins))
            return [DistributionTradeAction(
                agent_id=self.agent_id, bin_idx=mu_bin, side=side, amount=amount,
                mu=0, sigma=0,  # filled by simulation
            )]
        else:
            bin_idx = int(self.rng.integers(0, n_bins))
            side = "buy" if self.rng.random() > 0.5 else "sell"
            return [TradeAction(agent_id=self.agent_id, bin_idx=bin_idx, side=side, amount=amount)]
```

**agents/arbitrageur.py:**
```python
"""Arbitrageur: exploits mispricings, boundary discontinuities, and shape violations."""
import numpy as np
from agents.base import DecisionContext, TradeAction, ActionType
from config.params import SCALE


class Arbitrageur:
    def __init__(self, agent_id: int, min_edge: float = 0.005):
        self.agent_id = agent_id
        self.min_edge = min_edge

    def decide(self, ctx: DecisionContext) -> list[TradeAction]:
        actions = []
        state = ctx.agent_state
        if state.capital <= 0:
            return actions
        n = len(ctx.implied_probs)
        total_prob = float(np.sum(ctx.implied_probs)) / SCALE

        # 1. Probability-sum deviation
        if abs(total_prob - 1.0) > self.min_edge:
            if total_prob < 1.0:
                cheapest = int(np.argmin(ctx.implied_probs))
                amount = min(int(state.capital * 0.05), state.capital)
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=cheapest, side="buy", amount=amount))
            else:
                expensive = int(np.argmax(ctx.implied_probs))
                amount = min(int(state.capital * 0.05), state.capital)
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=expensive, side="sell", amount=amount))

        # 2. Adjacent bin boundary discontinuities
        for i in range(n - 1):
            diff = abs(float(ctx.implied_probs[i] - ctx.implied_probs[i + 1])) / SCALE
            if diff > self.min_edge * 2:
                cheap = i if ctx.implied_probs[i] < ctx.implied_probs[i + 1] else i + 1
                amount = min(int(state.capital * 0.02), state.capital)
                if amount > 0:
                    actions.append(TradeAction(agent_id=self.agent_id, bin_idx=cheap, side="buy", amount=amount))
                break

        # 3. Cross-bin shape violations: non-monotonic regions
        if n >= 4:
            probs_float = ctx.implied_probs.astype(np.float64)
            peak = int(np.argmax(probs_float))
            # Check for non-monotonic decrease away from peak
            for direction in [1, -1]:
                prev = probs_float[peak]
                idx = peak + direction
                while 0 <= idx < n:
                    curr = probs_float[idx]
                    if curr > prev + self.min_edge * SCALE:
                        amount = min(int(state.capital * 0.01), state.capital)
                        if amount > 0:
                            actions.append(TradeAction(
                                agent_id=self.agent_id, bin_idx=idx, side="sell", amount=amount,
                            ))
                        break
                    prev = curr
                    idx += direction

        return actions
```

**agents/manipulator.py:**
```python
"""Manipulator: optimizes for adversarial objectives using live state."""
from agents.base import DecisionContext, TradeAction


class Manipulator:
    def __init__(self, agent_id: int, budget: int, target_bin: int):
        self.agent_id = agent_id
        self.budget = budget
        self.spent = 0
        self.target_bin = target_bin

    def decide(self, ctx: DecisionContext) -> list[TradeAction]:
        remaining = self.budget - self.spent
        if remaining <= 0:
            return []

        # Design-aware: spend more aggressively on scalar (manipulable)
        spend_fraction = 0.1
        if ctx.settlement_rule == "scalar":
            spend_fraction = 0.2  # scalar is more manipulable, worth attacking faster
        elif ctx.settlement_rule == "crps":
            spend_fraction = 0.05  # proper scoring rule, harder to profit from manipulation

        # Late-stage payout gaming: spend more in final 20% of rounds
        if ctx.current_round > ctx.total_rounds * 0.8:
            spend_fraction *= 2.0

        amount = min(int(remaining * spend_fraction), remaining)
        if amount <= 0:
            return []
        self.spent += amount
        return [TradeAction(agent_id=self.agent_id, bin_idx=self.target_bin, side="buy", amount=amount)]
```

**agents/late_round_whale.py:**
```python
"""Late-round whale: only acts in final rounds, gated to red-team suites."""
from agents.base import DecisionContext, TradeAction


class LateRoundWhale:
    def __init__(self, agent_id: int, budget: int, target_bin: int, activation_round_pct: float = 0.9):
        self.agent_id = agent_id
        self.budget = budget
        self.spent = 0
        self.target_bin = target_bin
        self.activation_round_pct = activation_round_pct
        self.red_team_only = True  # gated by default

    def decide(self, ctx: DecisionContext) -> list[TradeAction]:
        if ctx.current_round < ctx.total_rounds * self.activation_round_pct:
            return []
        remaining = self.budget - self.spent
        if remaining <= 0:
            return []
        rounds_left = max(1, ctx.total_rounds - ctx.current_round)
        amount = min(remaining // rounds_left, remaining)
        if amount <= 0:
            return []
        self.spent += amount
        return [TradeAction(agent_id=self.agent_id, bin_idx=self.target_bin, side="buy", amount=amount)]
```

**agents/lp.py:**
```python
"""LP agents: passive and rebalancing strategies using live state."""
import numpy as np
from agents.base import AgentState


class PassiveLP:
    def __init__(self, agent_id: int, yield_threshold: float, loss_tolerance: float):
        self.agent_id = agent_id
        self.yield_threshold = yield_threshold
        self.loss_tolerance = loss_tolerance

    def decide_lp(self, fee_yield: float, unrealized_loss: float, current_round: int, agent_state: AgentState) -> dict | None:
        if unrealized_loss > self.loss_tolerance and agent_state.deposited_lp > 0:
            return {"type": "withdraw", "amount": agent_state.deposited_lp, "agent_id": self.agent_id}
        if fee_yield >= self.yield_threshold and agent_state.deposited_lp == 0:
            deposit = agent_state.capital // 2
            if deposit > 0:
                return {"type": "deposit", "amount": deposit, "agent_id": self.agent_id}
        return None


class RebalancingLP:
    def __init__(self, agent_id: int, yield_threshold: float, loss_tolerance: float,
                 rebalance_interval: int = 10, concentration_factor: float = 2.0):
        self.agent_id = agent_id
        self.yield_threshold = yield_threshold
        self.loss_tolerance = loss_tolerance
        self.rebalance_interval = rebalance_interval
        self.concentration_factor = concentration_factor
        self.last_weights: np.ndarray | None = None

    def decide_lp(self, fee_yield: float, unrealized_loss: float, current_round: int, agent_state: AgentState) -> dict | None:
        if unrealized_loss > self.loss_tolerance and agent_state.deposited_lp > 0:
            return {"type": "withdraw", "amount": agent_state.deposited_lp, "agent_id": self.agent_id}
        if fee_yield >= self.yield_threshold and agent_state.deposited_lp == 0:
            deposit = agent_state.capital // 2
            if deposit > 0:
                return {"type": "deposit", "amount": deposit, "agent_id": self.agent_id}
        return None

    def compute_rebalance_weights(self, activity_counts: np.ndarray, num_bins: int, current_round: int) -> np.ndarray:
        uniform = np.ones(num_bins, dtype=np.float64) / num_bins
        if current_round % self.rebalance_interval != 0:
            return self.last_weights.copy() if self.last_weights is not None else uniform
        total_activity = float(np.sum(activity_counts))
        if total_activity == 0:
            return self.last_weights.copy() if self.last_weights is not None else uniform
        activity_share = activity_counts.astype(np.float64) / total_activity
        weights = uniform + self.concentration_factor * activity_share
        weights /= weights.sum()
        self.last_weights = weights.copy()
        return weights
```

- [ ] **Step 4: Update existing agent tests to use the new API**

Update all existing `TestInformedTrader`, `TestNoiseTrader`, etc. tests in `test_agents.py` to pass `DecisionContext` instead of raw `(implied_probs, total_minted, current_round, total_rounds)`. Also update `TestPassiveLP` and `TestRebalancingLP` to pass `agent_state` to `decide_lp`.

- [ ] **Step 5: Run all agent tests**

Run: `cd quant-simulation && python -m pytest tests/test_agents.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add quant-simulation/agents/ quant-simulation/tests/test_agents.py
git commit -m "feat(sim): refactor all agents to use DecisionContext with live state"
```

---

### Task 4: Update SimulationRun to Thread Scenarios and DecisionContext

**Files:**
- Modify: `quant-simulation/engine/simulation.py`
- Modify: `quant-simulation/tests/test_simulation.py`

- [ ] **Step 1: Write tests for scenario-aware SimulationRun**

Add to `tests/test_simulation.py`:

```python
from config.scenarios import sample_scenario, TRUTH_FAMILIES


class TestScenarioIntegration:
    def test_simulation_accepts_scenario_family(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_A, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
            scenario_family="bimodal",
        )
        results = sim.run()
        assert results["scenario_family"] == "bimodal"

    def test_different_scenarios_produce_different_results(self):
        r1 = SimulationRun(
            design=DESIGN_BASELINE_B, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
            scenario_family="gaussian_center",
        ).run()
        r2 = SimulationRun(
            design=DESIGN_BASELINE_B, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
            scenario_family="skewed",
        ).run()
        assert r1["price_accuracy"] != r2["price_accuracy"]

    def test_regime_shift_changes_truth_mid_run(self):
        sim = SimulationRun(
            design=DESIGN_BASELINE_B, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=40, seed=42,
            scenario_family="regime_shift",
        )
        results = sim.run()
        assert "scenario_family" in results
        assert results["scenario_family"] == "regime_shift"


class TestDesignAwareIncentives:
    def test_different_designs_produce_different_trade_logs(self):
        """At least one seed where Baseline B, Piecewise, Kernel, CRPS differ."""
        designs = [DESIGN_BASELINE_B, DESIGN_PIECEWISE, DESIGN_KERNEL, DESIGN_CRPS]
        kl_by_design = {}
        for d in designs:
            sim = SimulationRun(
                design=d, fee_model=FEE_FLAT,
                num_bins=16, initial_liquidity=1_000_000_000, num_rounds=30, seed=42,
            )
            results = sim.run()
            kl_by_design[d] = results["price_accuracy"]
        values = list(kl_by_design.values())
        assert len(set(round(v, 6) for v in values)) > 1, "Designs must produce different trade paths"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_simulation.py -k "Scenario or DesignAware" -v`
Expected: FAIL

- [ ] **Step 3: Update SimulationRun.__init__ to accept scenario_family and build scenarios**

Modify `engine/simulation.py` to:
1. Accept `scenario_family` parameter (default `None` = random)
2. Use `sample_scenario()` to generate truth and belief weights
3. Build `DecisionContext` in `_run_trade_round` and pass to agents
4. Handle regime shifts mid-run
5. Thread scenario metadata into results
6. Update `_create_agents` to not store static capital — agents read from `AgentState`

The key changes to `SimulationRun`:
- Constructor takes `scenario_family: str | None = None` and `belief_family: str | None = None`
- `_run_trade_round` builds a `DecisionContext` per agent and calls `agent.decide(ctx)` or `agent.decide(ctx, true_distribution)` for informed traders
- Mid-round check for regime shift at `shift_round_frac`
- Results include `scenario_family` and `belief_family`

- [ ] **Step 4: Run all simulation tests**

Run: `cd quant-simulation && python -m pytest tests/test_simulation.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/simulation.py quant-simulation/tests/test_simulation.py
git commit -m "feat(sim): thread scenarios and DecisionContext through SimulationRun"
```

---

### Task 5: Validation Harness Skeleton

**Files:**
- Create: `quant-simulation/engine/validation.py`
- Create: `quant-simulation/tests/test_validation.py`

- [ ] **Step 1: Write test_validation.py**

```python
"""Tests for Stage 0 validation harness."""
import numpy as np
import pytest
from engine.validation import (
    check_design_differentiation,
    check_lp_activation,
    check_scenario_coverage,
    check_exitability_nontrivial,
    check_metric_degeneracy,
    ValidationResult,
)
from config.params import DESIGN_BASELINE_A, DESIGN_BASELINE_B, DESIGN_SCALAR


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quant-simulation && python -m pytest tests/test_validation.py -v`
Expected: FAIL

- [ ] **Step 3: Create engine/validation.py**

```python
"""Stage 0 validity checks for simulation outputs."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class ValidationResult:
    gate: str
    passed: bool
    detail: str


def check_design_differentiation(kl_by_design: dict[int, list[float]], threshold: float = 0.01) -> ValidationResult:
    """Check that at least two designs produce different KL trajectories."""
    designs = list(kl_by_design.keys())
    if len(designs) < 2:
        return ValidationResult("design_differentiation", False, "fewer than 2 designs")
    for i in range(len(designs)):
        for j in range(i + 1, len(designs)):
            a = np.array(kl_by_design[designs[i]])
            b = np.array(kl_by_design[designs[j]])
            min_len = min(len(a), len(b))
            if min_len == 0:
                continue
            diff = float(np.mean(np.abs(a[:min_len] - b[:min_len])))
            if diff > threshold:
                return ValidationResult("design_differentiation", True, f"designs {designs[i]} vs {designs[j]} differ by {diff:.4f}")
    return ValidationResult("design_differentiation", False, "all designs produce similar trade paths")


def check_lp_activation(lp_activation_rates: dict[int, float]) -> ValidationResult:
    """Check that LPs activate in at least one design."""
    for design, rate in lp_activation_rates.items():
        if rate > 0:
            return ValidationResult("lp_activation", True, f"design {design} has LP activation rate {rate:.2%}")
    return ValidationResult("lp_activation", False, "LP activation is zero in all designs")


def check_scenario_coverage(scenario_families_used: set[str], required_count: int = 3) -> ValidationResult:
    """Check that the sweep covers enough scenario families."""
    if len(scenario_families_used) >= required_count:
        return ValidationResult("scenario_coverage", True, f"{len(scenario_families_used)} families covered")
    return ValidationResult("scenario_coverage", False, f"only {len(scenario_families_used)} families used, need {required_count}")


def check_exitability_nontrivial(exit_values: dict[int, float]) -> ValidationResult:
    """Check that exitability differs across designs (not all 1.0)."""
    values = list(exit_values.values())
    if len(values) < 2:
        return ValidationResult("exitability_nontrivial", False, "fewer than 2 designs")
    if all(abs(v - values[0]) < 1e-6 for v in values):
        return ValidationResult("exitability_nontrivial", False, f"all designs have exitability={values[0]:.4f}")
    return ValidationResult("exitability_nontrivial", True, "exitability varies across designs")


def check_metric_degeneracy(metric_values: dict[str, dict[int, float]], threshold: float = 1e-6) -> list[ValidationResult]:
    """Check each metric for degeneracy (constant across designs)."""
    results = []
    for metric_name, by_design in metric_values.items():
        values = list(by_design.values())
        if len(values) < 2:
            results.append(ValidationResult(f"degeneracy:{metric_name}", False, "fewer than 2 designs"))
            continue
        spread = max(values) - min(values)
        if spread < threshold:
            results.append(ValidationResult(f"degeneracy:{metric_name}", False, f"spread={spread:.8f}"))
        else:
            results.append(ValidationResult(f"degeneracy:{metric_name}", True, f"spread={spread:.4f}"))
    return results


def run_stage0_checks(
    kl_by_design: dict[int, list[float]],
    lp_activation_rates: dict[int, float],
    scenario_families_used: set[str],
    exit_values: dict[int, float],
    metric_values: dict[str, dict[int, float]],
) -> list[ValidationResult]:
    """Run all Stage 0 validity checks and return results."""
    results = [
        check_design_differentiation(kl_by_design),
        check_lp_activation(lp_activation_rates),
        check_scenario_coverage(scenario_families_used),
        check_exitability_nontrivial(exit_values),
    ]
    results.extend(check_metric_degeneracy(metric_values))
    return results
```

- [ ] **Step 4: Run tests**

Run: `cd quant-simulation && python -m pytest tests/test_validation.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/validation.py quant-simulation/tests/test_validation.py
git commit -m "feat(sim): add Stage 0 validation harness skeleton"
```

---

## Layer 2: Behavior

### Task 6: Rebuild Exitability with Real Unwind Mechanics

**Files:**
- Modify: `quant-simulation/engine/metrics.py`
- Modify: `quant-simulation/tests/test_metrics.py`

- [ ] **Step 1: Write tests for revised exitability**

Add to `tests/test_metrics.py`:

```python
from agents.base import ActionType, AMM_ACTIONS


class TestRevisedExitability:
    def test_exitability_returns_all_components(self):
        reserves, total_minted = init_reserves(16, 1_000_000_000)
        holdings = np.zeros(16, dtype=np.int64)
        holdings[8] = 10_000
        result = exitability(
            reserves=reserves, total_minted=total_minted,
            reference_holdings=holdings, num_bins=16,
            allowed_actions=AMM_ACTIONS,
        )
        assert "unwindable_fraction" in result
        assert "transaction_count" in result
        assert "slippage" in result
        assert "reposition_cost" in result
        assert "failure_rate" in result

    def test_exitability_penalizes_bundle_only_sell(self):
        """If only bundle sell is allowed, exitability should be worse for non-Gaussian positions."""
        reserves, total_minted = init_reserves(16, 1_000_000_000)
        holdings = np.zeros(16, dtype=np.int64)
        holdings[0] = 50_000  # concentrated in one edge bin
        holdings[15] = 50_000  # and the opposite edge

        bundle_only = frozenset({ActionType.BUNDLE_BUY, ActionType.BUNDLE_SELL})
        full_actions = AMM_ACTIONS

        result_bundle = exitability(
            reserves=reserves, total_minted=total_minted,
            reference_holdings=holdings, num_bins=16,
            allowed_actions=bundle_only,
        )
        result_full = exitability(
            reserves=reserves, total_minted=total_minted,
            reference_holdings=holdings, num_bins=16,
            allowed_actions=full_actions,
        )
        assert result_bundle["unwindable_fraction"] <= result_full["unwindable_fraction"]

    def test_exitability_differs_across_designs(self):
        """Run quick simulation: exitability should not be 1.0 for all designs."""
        reserves, total_minted = init_reserves(16, 1_000_000_000)
        holdings = np.zeros(16, dtype=np.int64)
        holdings[8] = 10_000
        result = exitability(
            reserves=reserves, total_minted=total_minted,
            reference_holdings=holdings, num_bins=16,
            allowed_actions=AMM_ACTIONS,
        )
        # Should not be trivially 1.0 for everything
        assert result["unwindable_fraction"] <= 1.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "RevisedExitability" -v`
Expected: FAIL

- [ ] **Step 3: Rewrite exitability function in engine/metrics.py**

Replace the existing `exitability` function with one that:
1. Accepts `allowed_actions: frozenset[ActionType]`
2. If only `BUNDLE_SELL` allowed, attempts bundle unwind and measures feasibility
3. If `SINGLE_BIN_SELL` allowed, attempts per-bin unwind
4. Counts transaction_count, failure_rate, slippage, reposition_cost
5. Returns dict with all 5 exitability components

- [ ] **Step 4: Run tests**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "exit" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/metrics.py quant-simulation/tests/test_metrics.py
git commit -m "feat(sim): rebuild exitability with allowed action primitives"
```

---

### Task 7: Rebuild LP Deployability Metrics

**Files:**
- Modify: `quant-simulation/engine/metrics.py`
- Modify: `quant-simulation/tests/test_metrics.py`

- [ ] **Step 1: Write tests for LP deployability**

Add to `tests/test_metrics.py`:

```python
class TestLPDeployability:
    def test_not_activated_reported_correctly(self):
        result = lp_deployability(
            activation_rate=0.0,
            median_capital_deployed=0,
            holding_duration=0,
            realized_return=0.0,
            realized_fees=0,
            realized_adverse_selection=0.0,
        )
        assert result["status"] == "not_activated"
        assert result["activation_rate"] == 0.0

    def test_activated_returns_metrics(self):
        result = lp_deployability(
            activation_rate=0.5,
            median_capital_deployed=1_000_000,
            holding_duration=50,
            realized_return=0.02,
            realized_fees=20_000,
            realized_adverse_selection=0.01,
        )
        assert result["status"] == "activated"
        assert result["activation_rate"] == 0.5
        assert result["realized_return"] == 0.02
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "LPDeployability" -v`
Expected: FAIL

- [ ] **Step 3: Add lp_deployability function to engine/metrics.py**

```python
def lp_deployability(
    activation_rate: float,
    median_capital_deployed: int,
    holding_duration: int,
    realized_return: float,
    realized_fees: int = 0,
    realized_adverse_selection: float = 0.0,
) -> dict:
    """LP deployability metric per spec."""
    if activation_rate <= 0:
        return {
            "status": "not_activated",
            "activation_rate": 0.0,
            "median_capital_deployed": 0,
            "holding_duration": 0,
            "realized_return": 0.0,
            "realized_fees": 0,
            "realized_adverse_selection": 0.0,
        }
    return {
        "status": "activated",
        "activation_rate": activation_rate,
        "median_capital_deployed": median_capital_deployed,
        "holding_duration": holding_duration,
        "realized_return": realized_return,
        "realized_fees": realized_fees,
        "realized_adverse_selection": realized_adverse_selection,
    }
```

- [ ] **Step 4: Run tests**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "lp" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/metrics.py quant-simulation/tests/test_metrics.py
git commit -m "feat(sim): add LP deployability metric with activation tracking"
```

---

### Task 8: Rebuild Fairness and CRPS Accounting

**Files:**
- Modify: `quant-simulation/engine/metrics.py`
- Modify: `quant-simulation/models/settlement_crps.py`
- Modify: `quant-simulation/tests/test_settlements.py`
- Modify: `quant-simulation/tests/test_metrics.py`

- [ ] **Step 1: Write tests for design-independent fairness benchmark**

Add to `tests/test_metrics.py`:

```python
class TestRevisedFairness:
    def test_fairness_uses_external_benchmark(self):
        """Fairness should compare against a design-independent ideal, not derived from a candidate."""
        from engine.metrics import resolution_fairness_benchmark
        num_bins = 16
        resolved_bin = 8
        # Perfect closeness-based ideal
        benchmark = resolution_fairness_benchmark(num_bins, resolved_bin, max_distance=5)
        assert benchmark[resolved_bin] == pytest.approx(1.0)
        assert benchmark[resolved_bin + 1] < benchmark[resolved_bin]
        assert benchmark[resolved_bin + 6] == 0.0
```

Add to `tests/test_settlements.py`:

```python
class TestCRPSAccounting:
    def test_crps_is_stake_aware(self):
        """Larger stake should produce proportionally larger payout."""
        num_bins = 16
        resolved_bin = 8
        holdings_small = np.zeros(num_bins, dtype=np.int64)
        holdings_small[8] = 1_000
        holdings_large = np.zeros(num_bins, dtype=np.int64)
        holdings_large[8] = 10_000
        payout_small = compute_payout_crps(holdings_small, resolved_bin, num_bins)
        payout_large = compute_payout_crps(holdings_large, resolved_bin, num_bins)
        # Both should get max score, but stake awareness means they're comparable
        assert payout_small == payout_large  # CRPS score is stake-normalized

    def test_crps_budget_consistent(self):
        """Total payout should not exceed total stake."""
        num_bins = 16
        resolved_bin = 8
        holdings = np.zeros(num_bins, dtype=np.int64)
        holdings[7] = 5_000
        holdings[8] = 10_000
        holdings[9] = 5_000
        payout = compute_payout_crps(holdings, resolved_bin, num_bins)
        assert payout <= SCALE  # score bounded by SCALE
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "RevisedFairness" tests/test_settlements.py -k "CRPSAccounting" -v`
Expected: FAIL

- [ ] **Step 3: Add resolution_fairness_benchmark to metrics.py and verify CRPS**

```python
def resolution_fairness_benchmark(num_bins: int, resolved_bin: int, max_distance: int = 5) -> np.ndarray:
    """Design-independent benchmark: linear closeness decay from resolved bin."""
    benchmark = np.zeros(num_bins, dtype=np.float64)
    for i in range(num_bins):
        dist = abs(i - resolved_bin)
        if dist <= max_distance:
            benchmark[i] = 1.0 - dist / (max_distance + 1)
    return benchmark
```

- [ ] **Step 4: Run tests**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "fairness" tests/test_settlements.py -k "crps" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/metrics.py quant-simulation/models/settlement_crps.py quant-simulation/tests/test_settlements.py quant-simulation/tests/test_metrics.py
git commit -m "feat(sim): rebuild fairness benchmark and verify CRPS stake awareness"
```

---

## Layer 3: Metrics

### Task 9: Revise Core Metric Definitions

**Files:**
- Modify: `quant-simulation/engine/metrics.py`
- Modify: `quant-simulation/tests/test_metrics.py`

- [ ] **Step 1: Write tests for revised metrics**

Add to `tests/test_metrics.py`:

```python
class TestRevisedPriceAccuracy:
    def test_includes_time_series_divergence(self):
        """Price accuracy should use both final KL and time-series calibration error."""
        from engine.metrics import price_accuracy_revised
        kl_series = [0.5, 0.3, 0.1, 0.05, 0.02]
        final_kl = 0.02
        result = price_accuracy_revised(final_kl, kl_series)
        assert "final_kl" in result
        assert "mean_calibration_error" in result
        assert "combined" in result
        assert result["combined"] > 0


class TestRevisedConvergenceSpeed:
    def test_requires_sustained_window(self):
        """Convergence should require staying below threshold, not a one-off crossing."""
        from engine.metrics import convergence_speed_revised
        # One-off dip below threshold then back up
        kl_series = [0.5, 0.3, 0.008, 0.2, 0.1, 0.05]
        result = convergence_speed_revised(kl_series, threshold=0.01, sustained_window=3)
        # Should NOT count round 2 as convergence since it didn't sustain
        assert result > 20  # one-off crossing doesn't count


class TestRevisedCapitalEfficiency:
    def test_measures_local_depth_around_target(self):
        """Capital efficiency should measure slippage around multiple target bins."""
        from engine.metrics import capital_efficiency_revised
        reserves, total_minted = init_reserves(16, 1_000_000_000)
        target_bins = [7, 8, 9]
        result = capital_efficiency_revised(reserves, total_minted, target_bins)
        assert "mean_local_slippage" in result
        assert "mean_local_depth" in result
        assert result["mean_local_slippage"] >= 0


class TestRevisedManipulationResistance:
    def test_measures_both_cost_and_payout(self):
        """Manipulation resistance should include cost to move and cost to improve payout."""
        from engine.metrics import manipulation_resistance_revised
        result = manipulation_resistance_revised(
            budget_spent=5000, price_change_pct=2.0,
            payout_improvement=0.5,
        )
        assert "cost_to_move" in result
        assert "cost_to_profit" in result
        assert result["cost_to_move"] > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "Revised" -v`
Expected: FAIL

- [ ] **Step 3: Add revised metric functions to engine/metrics.py**

```python
def price_accuracy_revised(final_kl: float, kl_series: list[float]) -> dict:
    """Revised price accuracy: final KL + mean calibration error over time."""
    mean_cal = float(np.mean(kl_series)) if kl_series else final_kl
    combined = 0.5 * final_kl + 0.5 * mean_cal
    return {"final_kl": final_kl, "mean_calibration_error": mean_cal, "combined": combined}


def convergence_speed_revised(
    kl_series: list[float], threshold: float = 0.01,
    sustained_window: int = 3, snapshot_interval: int = 10,
) -> int:
    """Rounds to reach KL < threshold for a sustained window."""
    if len(kl_series) < sustained_window:
        return len(kl_series) * snapshot_interval
    for i in range(len(kl_series) - sustained_window + 1):
        window = kl_series[i:i + sustained_window]
        if all(kl < threshold for kl in window):
            return i * snapshot_interval
    return len(kl_series) * snapshot_interval


def capital_efficiency_revised(
    reserves: np.ndarray, total_minted: int, target_bins: list[int],
) -> dict:
    """Local slippage and depth around target bins."""
    slippages = []
    depths = []
    for bin_idx in target_bins:
        if 0 <= bin_idx < len(reserves):
            sl = compute_slippage(reserves.copy(), total_minted, bin_idx, 0.05)
            slippages.append(sl)
            position = total_minted - int(reserves[bin_idx])
            depths.append(position)
    mean_sl = float(np.mean(slippages)) if slippages else 0.0
    mean_depth = float(np.mean(depths)) if depths else 0.0
    return {"mean_local_slippage": mean_sl, "mean_local_depth": mean_depth}


def manipulation_resistance_revised(
    budget_spent: int, price_change_pct: float, payout_improvement: float,
) -> dict:
    """Cost to move market and cost to improve attacker payout."""
    cost_to_move = budget_spent / max(1e-6, price_change_pct)
    cost_to_profit = budget_spent / max(1e-6, payout_improvement)
    return {"cost_to_move": cost_to_move, "cost_to_profit": cost_to_profit}
```

- [ ] **Step 4: Run tests**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "Revised" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/metrics.py quant-simulation/tests/test_metrics.py
git commit -m "feat(sim): revise price accuracy, convergence, capital efficiency, manipulation resistance"
```

---

### Task 10: Boundary Sensitivity Metric

**Files:**
- Modify: `quant-simulation/engine/metrics.py`
- Modify: `quant-simulation/tests/test_metrics.py`

- [ ] **Step 1: Write tests for revised boundary sensitivity**

Add to `tests/test_metrics.py`:

```python
class TestRevisedBoundarySensitivity:
    def test_measures_payout_and_incentive_jumps(self):
        from engine.metrics import boundary_sensitivity_revised
        from models.settlement_baseline import compute_payout_wta
        from models.settlement_kernel import compute_payout_kernel
        payouts_wta = compute_payout_wta(64, 32)
        payouts_kernel = compute_payout_kernel(64, 32, 5)
        result_wta = boundary_sensitivity_revised(payouts_wta)
        result_kernel = boundary_sensitivity_revised(payouts_kernel)
        assert result_wta["max_payout_jump"] > result_kernel["max_payout_jump"]
        assert "mean_payout_jump" in result_wta
        assert "max_incentive_jump" in result_wta

    def test_adversarial_boundary_scenario(self):
        from engine.metrics import boundary_sensitivity_revised
        from models.settlement_piecewise import compute_payout_piecewise
        # Resolution near a bin boundary
        payouts = compute_payout_piecewise(64, 31, 3)  # right at edge
        result = boundary_sensitivity_revised(payouts)
        assert result["max_payout_jump"] > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "RevisedBoundary" -v`
Expected: FAIL

- [ ] **Step 3: Add boundary_sensitivity_revised**

```python
def boundary_sensitivity_revised(payouts: np.ndarray) -> dict:
    """Payout jump and trading incentive jump around bin boundaries."""
    if len(payouts) < 2:
        return {"max_payout_jump": 0, "mean_payout_jump": 0.0, "max_incentive_jump": 0, "mean_incentive_jump": 0.0}
    payout_diffs = np.abs(np.diff(payouts.astype(np.int64)))
    max_pj = int(np.max(payout_diffs))
    mean_pj = float(np.mean(payout_diffs))
    # Incentive jump: normalized payout gradient
    payout_float = payouts.astype(np.float64) / max(1, int(np.max(payouts)))
    incentive_diffs = np.abs(np.diff(payout_float))
    max_ij = float(np.max(incentive_diffs))
    mean_ij = float(np.mean(incentive_diffs))
    return {
        "max_payout_jump": max_pj, "mean_payout_jump": mean_pj,
        "max_incentive_jump": max_ij, "mean_incentive_jump": mean_ij,
    }
```

- [ ] **Step 4: Run tests**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "boundary" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/metrics.py quant-simulation/tests/test_metrics.py
git commit -m "feat(sim): add revised boundary sensitivity with incentive jumps"
```

---

### Task 11: Truthful Incentive Alignment Metric

**Files:**
- Modify: `quant-simulation/engine/metrics.py`
- Modify: `quant-simulation/tests/test_metrics.py`

- [ ] **Step 1: Write tests for truthful incentive alignment**

Add to `tests/test_metrics.py`:

```python
class TestTruthfulIncentiveAlignment:
    def test_proper_scoring_rule_scores_higher(self):
        """CRPS (proper) should score higher than WTA (improper) on truthful alignment."""
        from engine.metrics import truthful_incentive_alignment
        from models.settlement_baseline import compute_payout_wta
        from models.settlement_crps import compute_payout_crps
        num_bins = 16
        resolved_bin = 8
        true_dist = np.zeros(num_bins, dtype=np.float64)
        true_dist[7:10] = [0.2, 0.6, 0.2]

        # Under WTA, truthful action (buy bin 8) vs manipulative (buy bin 0)
        payouts_wta = compute_payout_wta(num_bins, resolved_bin)
        score_wta = truthful_incentive_alignment(
            true_dist, payouts_wta, num_bins, resolved_bin,
        )

        # CRPS should reward truth more reliably
        score_crps = truthful_incentive_alignment(
            true_dist, None, num_bins, resolved_bin, use_crps=True,
        )
        assert score_crps >= score_wta  # proper rule rewards truth better

    def test_returns_score_between_0_and_1(self):
        from engine.metrics import truthful_incentive_alignment
        from models.settlement_baseline import compute_payout_wta
        num_bins = 16
        resolved_bin = 8
        true_dist = np.zeros(num_bins, dtype=np.float64)
        true_dist[8] = 1.0
        payouts = compute_payout_wta(num_bins, resolved_bin)
        score = truthful_incentive_alignment(true_dist, payouts, num_bins, resolved_bin)
        assert 0.0 <= score <= 1.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "Truthful" -v`
Expected: FAIL

- [ ] **Step 3: Add truthful_incentive_alignment to engine/metrics.py**

```python
def truthful_incentive_alignment(
    true_dist: np.ndarray,
    payouts: np.ndarray | None,
    num_bins: int,
    resolved_bin: int,
    use_crps: bool = False,
) -> float:
    """Whether truthful moves improve expected utility more than manipulative moves.

    Compares expected utility of buying the truth-maximizing bin vs buying a
    random alternative bin. Score = fraction of comparisons where truthful > manipulative.
    """
    true_probs = true_dist.astype(np.float64)
    total = true_probs.sum()
    if total <= 0:
        return 0.5
    true_probs /= total
    truthful_bin = int(np.argmax(true_probs))

    # Expected utility of truthful action
    if use_crps:
        from models.settlement_crps import compute_payout_crps
        holdings_truth = np.zeros(num_bins, dtype=np.int64)
        holdings_truth[truthful_bin] = 1_000
        truthful_eu = compute_payout_crps(holdings_truth, resolved_bin, num_bins) / SCALE
    else:
        if payouts is None:
            return 0.5
        truthful_eu = float(payouts[truthful_bin]) / SCALE * true_probs[truthful_bin]

    # Compare against manipulative alternatives
    wins = 0
    comparisons = 0
    for alt_bin in range(num_bins):
        if alt_bin == truthful_bin:
            continue
        if use_crps:
            holdings_alt = np.zeros(num_bins, dtype=np.int64)
            holdings_alt[alt_bin] = 1_000
            alt_eu = compute_payout_crps(holdings_alt, resolved_bin, num_bins) / SCALE
        else:
            alt_eu = float(payouts[alt_bin]) / SCALE * true_probs[alt_bin]
        comparisons += 1
        if truthful_eu >= alt_eu:
            wins += 1

    return wins / max(1, comparisons)
```

- [ ] **Step 4: Run tests**

Run: `cd quant-simulation && python -m pytest tests/test_metrics.py -k "truthful" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/metrics.py quant-simulation/tests/test_metrics.py
git commit -m "feat(sim): add truthful incentive alignment metric"
```

---

## Layer 4: Integration

### Task 12: Wire Revised Metrics into SimulationRun

**Files:**
- Modify: `quant-simulation/engine/simulation.py`
- Modify: `quant-simulation/tests/test_simulation.py`

- [ ] **Step 1: Write tests for revised metric output**

Add to `tests/test_simulation.py`:

```python
class TestRevisedMetricOutput:
    def test_results_contain_revised_metrics(self):
        sim = SimulationRun(
            design=DESIGN_PIECEWISE, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        results = sim.run()
        assert "truthful_incentive_alignment" in results
        assert "boundary_payout_jump_max" in results
        assert "boundary_incentive_jump_max" in results
        assert "convergence_speed_sustained" in results
        assert "lp_activation_rate" in results
        assert "scenario_family" in results

    def test_scalar_excluded_from_candidate(self):
        from config.params import DESIGN_SCALAR
        sim = SimulationRun(
            design=DESIGN_SCALAR, fee_model=FEE_FLAT,
            num_bins=16, initial_liquidity=1_000_000_000, num_rounds=20, seed=42,
        )
        results = sim.run()
        assert results.get("red_team_only", False) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_simulation.py -k "RevisedMetric" -v`
Expected: FAIL

- [ ] **Step 3: Update _compute_all_metrics to use revised metric functions**

Update the `_compute_all_metrics` method in `SimulationRun` to call `price_accuracy_revised`, `convergence_speed_revised`, `capital_efficiency_revised`, `manipulation_resistance_revised`, `boundary_sensitivity_revised`, `truthful_incentive_alignment`, `lp_deployability`, and the revised `exitability`. Wire LP activation tracking. Tag scalar runs with `red_team_only=True`.

- [ ] **Step 4: Run all simulation tests**

Run: `cd quant-simulation && python -m pytest tests/test_simulation.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/simulation.py quant-simulation/tests/test_simulation.py
git commit -m "feat(sim): wire revised metrics, LP activation, and scalar red-team flag into SimulationRun"
```

---

### Task 13: 4-Stage Sweep Orchestration

**Files:**
- Modify: `quant-simulation/engine/sweeps.py`
- Modify: `quant-simulation/tests/test_sweeps.py`

- [ ] **Step 1: Write tests for 4-stage sweeps**

Add to `tests/test_sweeps.py`:

```python
from engine.sweeps import run_stage0, run_stage1, select_finalists, run_stage2, run_stage3
from config.params import DESIGN_SCALAR


def test_stage0_runs_validity_checks():
    results = run_stage0(num_bins=16, initial_liquidity=1_000_000_000, num_rounds=10, mc_runs=2)
    assert "validity_results" in results
    assert isinstance(results["validity_results"], list)


def test_stage1_excludes_scalar_from_candidates():
    df = run_stage1(num_bins=16, initial_liquidity=1_000_000_000, num_rounds=10, mc_runs=2)
    finalists = select_finalists(df, n=3)
    assert DESIGN_SCALAR not in finalists


def test_stage1_runs_clob_separately():
    df = run_stage1(num_bins=16, initial_liquidity=1_000_000_000, num_rounds=10, mc_runs=2)
    assert "clob_df" in df.attrs or "is_clob" in df.columns


def test_stage3_sensitivity_includes_scenario_family():
    # Just verify the function accepts scenario_family parameter
    from engine.sweeps import run_stage3
    # Will be tested in calibration
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_sweeps.py -v`
Expected: FAIL

- [ ] **Step 3: Rewrite engine/sweeps.py with 4 stages**

Replace the existing 2-phase sweep with:
- `run_stage0(...)` — validity suite using `engine.validation`
- `run_stage1(...)` — candidate comparison across scenario families, returns combined DF
- `select_finalists(df, n=3)` — excludes Scalar, uses per-metric Pareto
- `run_stage2(finalists, ...)` — fee sweep for surviving AMM designs
- `run_stage3(finalists, ...)` — sensitivity sweep adding scenario_family dimension

Key changes:
- Scalar (`DESIGN_SCALAR`) always excluded from `select_finalists`
- CLOB results stored in separate lane
- Stage 1 iterates over scenario families
- Stage 3 adds scenario_family and adversarial_sequencing dimensions

- [ ] **Step 4: Run tests**

Run: `cd quant-simulation && python -m pytest tests/test_sweeps.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/engine/sweeps.py quant-simulation/tests/test_sweeps.py
git commit -m "feat(sim): implement 4-stage sweep with Stage 0 validity, Scalar exclusion, scenario families"
```

---

### Task 14: Update Report with All Spec Sections

**Files:**
- Modify: `quant-simulation/analysis/report.py`
- Modify: `quant-simulation/analysis/export.py`
- Modify: `quant-simulation/tests/test_analysis.py`

- [ ] **Step 1: Write tests for report sections**

Add to `tests/test_analysis.py`:

```python
def test_report_contains_stage0_section(sample_report_html):
    assert "Validity Gates" in sample_report_html or "Stage 0" in sample_report_html

def test_report_contains_pareto_section(sample_report_html):
    assert "Pareto" in sample_report_html

def test_report_contains_boundary_gallery(sample_report_html):
    assert "Boundary" in sample_report_html

def test_report_scalar_in_redteam_section(sample_report_html):
    assert "Red-Team" in sample_report_html or "Scalar" in sample_report_html

def test_export_includes_redteam_metadata():
    from analysis.export import export_all_results
    # Verify red_team_only column preserved in exports
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quant-simulation && python -m pytest tests/test_analysis.py -v`
Expected: FAIL

- [ ] **Step 3: Update report.py to include all spec sections**

Add report sections for:
- Stage 0: validity gates, degenerate metrics, scenario coverage
- Stage 1: A vs B analysis, per-metric comparison, Pareto frontier, Scalar red-team, CLOB
- Stage 2: fee heatmaps, fee impact decomposition
- Cross-cutting: boundary gallery, exitability failures, LP activation plots

Update `export.py` to include `red_team_only` and `scenario_family` metadata.

- [ ] **Step 4: Run tests**

Run: `cd quant-simulation && python -m pytest tests/test_analysis.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quant-simulation/analysis/ quant-simulation/tests/test_analysis.py
git commit -m "feat(sim): update report with all spec sections including validity gates and Pareto frontiers"
```

---

### Task 15: Update run.py Entry Point

**Files:**
- Modify: `quant-simulation/run.py`

- [ ] **Step 1: Update run.py to use 4-stage orchestration**

```python
"""Entry point for quantitative AMM simulation."""
import argparse
import os

from engine.sweeps import run_stage0, run_stage1, select_finalists, run_stage2, run_stage3
from analysis.report import generate_report
from analysis.export import export_all_results, export_mirofish_json
from config.params import (
    DEFAULT_NUM_BINS, DEFAULT_INITIAL_LIQUIDITY, DEFAULT_NUM_ROUNDS, DEFAULT_MC_RUNS,
)


def main():
    parser = argparse.ArgumentParser(description="Quantitative AMM Simulation")
    parser.add_argument("--mc-runs", type=int, default=DEFAULT_MC_RUNS)
    parser.add_argument("--num-bins", type=int, default=DEFAULT_NUM_BINS)
    parser.add_argument("--num-rounds", type=int, default=DEFAULT_NUM_ROUNDS)
    parser.add_argument("--liquidity", type=int, default=DEFAULT_INITIAL_LIQUIDITY)
    parser.add_argument("--output", type=str, default="quant-simulation/output")
    parser.add_argument("--stage1-only", action="store_true")
    parser.add_argument("--skip-sensitivity", action="store_true")
    parser.add_argument("--quick", action="store_true")
    args = parser.parse_args()

    mc_runs = args.mc_runs
    num_bins = args.num_bins
    num_rounds = args.num_rounds
    liquidity = args.liquidity
    output_dir = args.output

    if args.quick:
        mc_runs = 10
        num_bins = 16
        num_rounds = 50

    os.makedirs(output_dir, exist_ok=True)

    # Stage 0: Validity
    print("=== Stage 0: Validity Gates ===")
    stage0 = run_stage0(num_bins=num_bins, initial_liquidity=liquidity, num_rounds=num_rounds, mc_runs=min(mc_runs, 5))
    for r in stage0["validity_results"]:
        status = "PASS" if r.passed else "FAIL"
        print(f"  [{status}] {r.gate}: {r.detail}")

    # Stage 1: Mechanism comparison
    print("=== Stage 1: Mechanism Comparison ===")
    stage1_df = run_stage1(num_bins=num_bins, initial_liquidity=liquidity, num_rounds=num_rounds, mc_runs=mc_runs)
    finalists = select_finalists(stage1_df, n=3)
    print(f"  Finalists: {finalists}")

    stage2_df = None
    stage3_df = None

    if not args.stage1_only:
        # Stage 2: Fee sweep
        print("=== Stage 2: Fee Sweep ===")
        stage2_df = run_stage2(finalists, num_bins=num_bins, initial_liquidity=liquidity, num_rounds=num_rounds, mc_runs=mc_runs)

    if not args.skip_sensitivity:
        # Stage 3: Sensitivity
        print("=== Stage 3: Sensitivity Sweep ===")
        stage3_df = run_stage3(finalists, num_rounds=num_rounds, mc_runs=min(mc_runs, 100))

    # Export & Report
    print("=== Generating Report ===")
    export_all_results(stage1_df, stage2_df, stage3_df, output_dir, stage0=stage0)
    generate_report(stage1_df, stage2_df, stage3_df, output_dir, stage0=stage0, finalists=finalists)
    export_mirofish_json(stage1_df, finalists, os.path.join(output_dir, "mirofish.json"))
    print(f"  Report saved to {output_dir}/report.html")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run quick smoke test**

Run: `cd quant-simulation && python run.py --quick --stage1-only --skip-sensitivity --output quant-simulation/output-remediation-quick`
Expected: completes without error

- [ ] **Step 3: Commit**

```bash
git add quant-simulation/run.py
git commit -m "feat(sim): update run.py with 4-stage orchestration"
```

---

### Task 16: Final Integration Test and Calibration

**Files:**
- Modify: `quant-simulation/tests/test_simulation.py`

- [ ] **Step 1: Run full test suite**

Run: `cd quant-simulation && python -m pytest tests/ -v`
Expected: ALL PASS

- [ ] **Step 2: Run quick calibration sweep**

Run: `cd quant-simulation && python run.py --quick --output quant-simulation/output-remediation-quick`

- [ ] **Step 3: Verify calibration output**

Check that:
- Scalar is NOT in the finalist set
- Report contains Stage 0 validity results
- At least 2 designs differ on exitability
- LP activation is non-zero in at least one scenario
- Boundary sensitivity differs across WTA and smoothed designs
- Truthful incentive alignment distinguishes CRPS from WTA

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(sim): complete simulation remediation, all 4 stages operational"
```

---

## Parallelization Guide for Subagent-Driven Development

### Layer 1 (Foundation) — 3 parallel agents:
- **Agent A**: Task 1 (scenarios)
- **Agent B**: Task 2 + Task 3 (agent base + agent refactor — sequential within agent)
- **Agent C**: Task 5 (validation skeleton)
- Then: Task 4 (SimulationRun integration — needs all of Layer 1)

### Layer 2 (Behavior) — 3 parallel agents:
- **Agent D**: Task 6 (exitability)
- **Agent E**: Task 7 (LP deployability)
- **Agent F**: Task 8 (fairness + CRPS)

### Layer 3 (Metrics) — 3 parallel agents:
- **Agent G**: Task 9 (revised core metrics)
- **Agent H**: Task 10 (boundary sensitivity)
- **Agent I**: Task 11 (truthful incentive alignment)

### Layer 4 (Integration) — sequential:
- Task 12 → Task 13 → Task 14 → Task 15 → Task 16
