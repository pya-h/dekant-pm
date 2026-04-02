# Quantitative AMM Simulation Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing `quant-simulation/` package so it can credibly diagnose the fundamental issues in DekantPM's continuous market design. The revised simulator must model design-aware incentives, non-Gaussian scenarios, practical exitability, and real LP deployability before any design ranking is trusted.

**Current state:** The package exists and tests pass, but several outputs are not valid for mechanism selection:
- settlement variants mostly share the same trading path,
- agents do not consume live portfolio state,
- truth and informed flow are overly Gaussian,
- LP activation is often zero,
- exitability is structurally trivial,
- Scalar is still treated as an optimization candidate.

**Spec:** `docs/superpowers/specs/2026-03-30-quant-simulation-design.md`
**Lifecycle:** `docs/superpowers/specs/2026-03-30-simulation-run-lifecycle.md`

---

## Success Gates

The remediation is complete only when all of the following are true:

- [ ] Design variants produce different trading behavior before resolution when incentives differ.
- [ ] Agent decisions are driven from live `AgentState` and current holdings.
- [ ] Scenario sweeps include non-Gaussian and boundary-heavy families.
- [ ] Trader belief families are implemented independently from truth families.
- [ ] LP metrics distinguish "not activated" from "activated and unprofitable."
- [ ] Exitability metrics penalize unsupported unwind paths and multi-step execution.
- [ ] Boundary sensitivity metric produces non-degenerate results across designs.
- [ ] Truthful incentive alignment metric distinguishes proper from improper settlement rules.
- [ ] All revised metric definitions (price accuracy, convergence speed, capital efficiency, manipulation resistance) are implemented per spec.
- [ ] Scalar is excluded from finalist selection.
- [ ] The report contains all staged sections including A vs B, Pareto frontiers, fee heatmaps, boundary gallery, and CLOB separate section.
- [ ] Stage 3 sensitivity sweep is implemented and runnable.
- [ ] The report can show per-metric results and Pareto frontiers without relying on a misleading composite leaderboard.

---

## File Targets

Primary files to modify:

- `quant-simulation/config/params.py`
- `quant-simulation/config/__init__.py`
- `quant-simulation/agents/base.py`
- `quant-simulation/agents/informed_trader.py`
- `quant-simulation/agents/noise_trader.py`
- `quant-simulation/agents/arbitrageur.py`
- `quant-simulation/agents/manipulator.py`
- `quant-simulation/agents/late_round_whale.py`
- `quant-simulation/agents/lp.py`
- `quant-simulation/engine/simulation.py`
- `quant-simulation/engine/metrics.py`
- `quant-simulation/engine/sweeps.py`
- `quant-simulation/models/math_engine.py`
- `quant-simulation/models/weights.py`
- `quant-simulation/models/settlement_baseline.py`
- `quant-simulation/models/settlement_crps.py`
- `quant-simulation/models/settlement_kernel.py`
- `quant-simulation/models/settlement_piecewise.py`
- `quant-simulation/models/settlement_scalar.py`
- `quant-simulation/models/orderbook.py`
- `quant-simulation/models/fee_models.py`
- `quant-simulation/analysis/report.py`
- `quant-simulation/analysis/export.py`
- `quant-simulation/tests/test_agents.py`
- `quant-simulation/tests/test_metrics.py`
- `quant-simulation/tests/test_simulation.py`
- `quant-simulation/tests/test_settlements.py`

New files expected:

- `quant-simulation/config/scenarios.py`
- `quant-simulation/engine/validation.py`
- `quant-simulation/tests/test_scenarios.py`
- `quant-simulation/tests/test_validation.py`

---

## Task 1: Add Scenario Framework

**Objective:** Replace the single Gaussian world with an explicit scenario library that covers the continuous-market failure modes.

- [ ] Create `config/scenarios.py` with scenario-family definitions and samplers.
- [ ] Implement at least these scenario families:
  - Gaussian center
  - Gaussian edge
  - skewed
  - bimodal
  - truncated / clipped
  - regime shift
  - adversarial boundary
- [ ] Implement trader belief families:
  - Gaussian believers
  - Skewed believers
  - Multi-peak believers
  - Localized one-sided traders
  - Belief shifters that must unwind and re-enter after a regime change
- [ ] Allow trader belief family to differ from truth family.
- [ ] Thread scenario metadata into `SimulationRun`.
- [ ] Add tests that each scenario family produces valid bins / truth samples and reproducible seeds.

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_scenarios.py`
- [ ] Run a quick script that prints one sampled scenario from each family

---

## Task 2: Refactor Agent API to Use Live State

**Objective:** Make agent decisions depend on live capital, holdings, and current design, rather than construction-time constants.

- [ ] Extend `agents/base.py` with a live decision context object passed into every agent containing all required inputs: current implied distribution, live capital, live holdings, accumulated fees / P&L, design identifier, settlement rule, allowed action primitives, and scenario metadata.
- [ ] Implement an action primitives registry in the decision context supporting: single-bin buy, single-bin sell, bundle buy, bundle sell, LP deposit, LP withdraw, LP rebalance, and order placement / cancellation for CLOB.
- [ ] Remove static-capital decision logic from all trading agents.
- [ ] Refactor `simulation.py` so agents receive current `AgentState` and market snapshot at decision time.
- [ ] Implement the lifecycle state-update bookkeeping in `simulation.py` after every action: reserves or orderbook, total minted, acting-agent live state, LP accounting, and realized trade logs.
- [ ] Refresh implied probabilities, local depth / imbalance statistics, and LP placement state at round end.
- [ ] Update noise traders to generate both random single-bin and random bundle flow so the simulator can distinguish noise in a forced-Gaussian interface from noise in a freer interface.
- [ ] Ensure LP agents also use live deposited state rather than stale constructor fields.
- [ ] Add tests proving that reduced capital / changed holdings modify the next action.

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_agents.py`
- [ ] Add a targeted regression proving informed traders and LPs react to updated balances

---

## Task 3: Make Trading Incentives Design-Aware

**Objective:** Ensure settlement design changes agent behavior during trading instead of only affecting ex post payouts.

- [ ] Add design metadata to the decision context.
- [ ] Update informed traders to maximize expected utility under the active settlement rule.
- [ ] Update manipulators to optimize for all required scenario-dependent targets: temporary price distortion, end-of-market payout capture, boundary crossing, and cheap late-stage payout gaming.
- [ ] Update arbitrageurs to attack boundary and local shape inconsistencies, not just sum-to-one errors.
- [ ] Gate late-round whales so they run only in red-team suites by default.
- [ ] Add regression tests showing at least one seed where Baseline B, Piecewise, Kernel, and CRPS generate different trade paths.

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_simulation.py -k incentive`
- [ ] Execute a small sweep and confirm trade logs differ across candidate designs before resolution

---

## Task 4: Rebuild Exitability

**Objective:** Measure practical exit quality under allowed action primitives.

- [ ] Redefine exitability in `engine/metrics.py` to include:
  - unwindable fraction
  - transaction count
  - slippage
  - reposition cost
  - failure rate
- [ ] Encode supported action constraints, especially bundle sell requirements and any fresh-Gaussian dependency.
- [ ] Add scenario fixtures where belief shifts force realistic unwind / re-entry behavior.
- [ ] Remove the current trivial all-design `unwind=1.0` behavior.

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_metrics.py -k exit`
- [ ] Run a quick sweep and confirm exitability differs across at least two designs

---

## Task 5: Rebuild LP Modeling

**Objective:** Turn LP results into a deployability metric rather than a mostly-zero placeholder.

- [ ] Replace fee-share-only concentration logic with actual liquidity placement or range exposure logic.
- [ ] Record LP activation rate, median live capital deployed, holding duration, and realized return.
- [ ] Track supporting LP diagnostics including realized fees and realized adverse selection.
- [ ] Report "not activated" when LP entry conditions are never met.
- [ ] Ensure at least one baseline scenario activates LPs.
- [ ] Add tests for passive and rebalancing LP activation / withdrawal / rebalance behavior.

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_agents.py -k lp`
- [ ] Run a quick sweep and confirm LP activation rate is non-zero in at least one scenario family

---

## Task 6: Rebuild Fairness and CRPS Accounting

**Objective:** Remove metric bias toward one settlement shape and make CRPS payouts comparable.

- [ ] Replace the current hand-built fairness benchmark with a design-independent benchmark utility.
- [ ] Ensure CRPS payout accounting in `models/settlement_crps.py` is stake-aware and budget-consistent.
- [ ] Remove proxy boundary calculations that reuse kernel payouts for CRPS unless explicitly labeled as a proxy.
- [ ] Update `tests/test_settlements.py` with tests covering fairness ranking in simple toy cases and CRPS accounting sanity.

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_metrics.py -k fairness`
- [ ] Run `pytest -q quant-simulation/tests/test_settlements.py -k crps`

---

## Task 7: Revise Existing Metric Definitions

**Objective:** Align Price Accuracy, Convergence Speed, Capital Efficiency, and Manipulation Resistance implementations with the spec's revised definitions.

- [ ] Revise Price Accuracy in `engine/metrics.py` to use KL divergence plus calibration error measured over time during trading and at close, not only at resolution.
- [ ] Revise Convergence Speed to require a sustained window below threshold, not a one-off crossing.
- [ ] Revise Capital Efficiency to measure local slippage and depth around target bins, not a single representative bin.
- [ ] Revise Manipulation Resistance to measure both cost to move market state and cost to improve attacker payout under the active settlement rule, distinguishing cosmetic from profitable manipulation.
- [ ] Add configured periodic snapshot collection during trading so the simulator records price accuracy, calibration error, local slippage / depth, LP activation and live deployment, exitability probes, and manipulation probes where enabled.
- [ ] Update settlement models (`models/settlement_*.py`) as needed to expose payout accounting required by the revised metrics.
- [ ] Add tests for each revised metric confirming it produces different values across designs.

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_metrics.py -k "accuracy or convergence or efficiency or manipulation"`
- [ ] Run a quick sweep and confirm revised metrics vary across designs

---

## Task 8: Add Boundary Sensitivity Metric

**Objective:** Measure payout and incentive discontinuity at bin boundaries.

- [ ] Implement Boundary Sensitivity in `engine/metrics.py` measuring payout jump and trading incentive jump around bin boundaries.
- [ ] Update settlement models to expose boundary payout gradients where needed.
- [ ] Add scenario fixtures with resolution near bin edges to exercise boundary effects.
- [ ] Add tests showing boundary sensitivity differs across settlement designs (e.g. winner-take-all vs smoothed).

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_metrics.py -k boundary`
- [ ] Run a quick sweep with adversarial-boundary scenarios and confirm non-degenerate output

---

## Task 9: Add Truthful Incentive Alignment Metric

**Objective:** Directly test whether truthful trading is incentive-compatible under each design.

- [ ] Implement Truthful Incentive Alignment in `engine/metrics.py` measuring whether truthful moves improve expected utility more than nearby manipulative moves for informed traders.
- [ ] This requires computing expected utility under each settlement rule for both truthful and alternative actions.
- [ ] Add tests with toy cases where the metric should clearly distinguish a proper scoring rule from a non-proper one.
- [ ] Ensure the metric is computed per-design and included in the per-metric comparison tables.

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_metrics.py -k truthful`
- [ ] Run a quick sweep and confirm the metric distinguishes CRPS (proper) from winner-take-all (improper)

---

## Task 10: Add Validation Harness

**Objective:** Prevent invalid metrics from silently flowing into ranking and reports.

- [ ] Create `engine/validation.py`.
- [ ] Add Stage 0 validity checks:
  - LP activation detection
  - design-path differentiation checks
  - scenario coverage checks
  - agents consume live `AgentState` and portfolio information
  - exitability metrics penalize unsupported unwind paths
- [ ] Add metric validity rules:
  - degenerate metric detection
  - report LP return as "not activated" when LP activation is zero
  - exclude red-team-only designs from finalist selection
- [ ] Mark Scalar as `red_team_only` and exclude it from finalist selection in `engine/sweeps.py`.
- [ ] Disable the composite leaderboard when validity gates fail.

**Verification**

- [ ] Run `pytest -q quant-simulation/tests/test_validation.py`
- [ ] Run a quick sweep and confirm invalid metrics are flagged instead of silently ranked

---

## Task 11: Update Sweep Logic and Reporting

**Objective:** Align the experiment runner and report with the corrected methodology, including all four stages and all report sections from the spec.

- [ ] Update `engine/sweeps.py` to run:
  - Stage 0 validity suite
  - Stage 1 candidate comparison
  - Stage 1 red-team scalar suite
  - Stage 1 CLOB separate suite
  - Stage 2 fee sweep only for surviving AMM designs
  - Stage 3 sensitivity sweep varying: bin count, liquidity, agent mix, scenario family, and adversarial sequencing
- [ ] Replace the default ranking output with per-metric tables and Pareto fronts.
- [ ] Add report sections for:
  - Stage 0: validity gate results, metrics flagged as degenerate, scenario coverage summary
  - Stage 1: Baseline A vs Baseline B analysis, candidate design comparison by metric, Pareto frontier for candidate designs, Scalar red-team section, CLOB separate section
  - Stage 2: fee heatmaps for finalist AMM designs, fee impact decomposition (price quality, LP deployability, manipulation resistance)
  - Cross-cutting: boundary case gallery, exitability failure cases, LP activation and concentration plots
- [ ] Keep raw CSV / JSON export, but add metadata that identifies red-team-only and excluded designs.
- [ ] Add structured export for downstream behavioral simulation.

**Verification**

- [ ] Run `python3 quant-simulation/run.py --quick --stage1-only --skip-sensitivity --output quant-simulation/output-remediation-quick`
- [ ] Review the generated report and confirm Scalar is not in the candidate finalist set
- [ ] Confirm the report contains all required sections: validity gates, A vs B, candidate comparison, Pareto frontier, Scalar red-team, CLOB, and cross-cutting appendices

---

## Task 12: Final Calibration Sweep

**Objective:** Confirm the remediated simulator produces informative outputs before scaling run counts.

- [ ] Run a medium sweep across all scenario families with reduced Monte Carlo counts.
- [ ] Inspect whether:
  - candidate designs now diverge on trading metrics,
  - LP deployability is informative,
  - exitability is non-trivial,
  - manipulation resistance differs between cosmetic and payout capture attacks,
  - boundary sensitivity is non-degenerate,
  - truthful incentive alignment distinguishes proper from improper designs.
- [ ] Only after this step, restore larger Monte Carlo counts for production reporting.

**Verification**

- [ ] Run the full targeted regression suite
- [ ] Run a medium scenario sweep and archive the report under `quant-simulation/output-*`

---

## Deliverables

At completion, the repo should contain:

- updated simulator code that passes the existing and new tests,
- all 9 spec metrics implemented with revised definitions (including boundary sensitivity and truthful incentive alignment),
- a Stage 0 validity harness,
- all 4 stages implemented in sweep logic (validity, mechanism comparison, fee sweep, sensitivity),
- revised reports with all spec sections (A vs B, Pareto frontier, fee heatmaps, boundary gallery, CLOB, LP concentration plots),
- candidate-vs-red-team separation,
- action primitives registry and noise trader single/bundle support,
- scenario-family-aware exports for downstream behavioral simulation.

---

## Notes

- The first objective is scientific validity, not preserving backwards-compatible metrics.
- Quick fixtures and adversarial regression cases are more valuable than high Monte Carlo counts during remediation.
- If a metric remains structurally degenerate after refactoring, remove it from ranking rather than normalizing noise.
