# Quantitative AMM Simulation Design Spec

## Problem Statement

DekantPM's continuous market AMM has fundamental bin-related issues that block commercial viability:

1. **Winner-take-all resolution** - a single bin wins 100%, adjacent bins get nothing, creating discontinuous payoff cliffs
2. **Coarse granularity** - MAX_BINS = 256 yields about 0.4% range resolution per bin
3. **Normal PDF approximation is severely wrong** - Taylor degree-4 is materially inaccurate in the tails and systematically distorts weights
4. **Liquidity fragmentation** - uniform reserves across 256 bins means about 1/256th depth per bin
5. **LPs cannot concentrate liquidity** - forced uniform exposure creates adverse selection
6. **Bin boundary arbitrage** - hard boundaries create exploitable edge effects
7. **Forced Gaussian sell** - traders cannot unwind arbitrary inventories; the current mechanism requires a fresh Normal(mu, sigma) vector

## Simulator Validity Findings

The first simulator version is not sufficient for mechanism down-selection because it mostly compares ex post payout surfaces on top of a shared trading process.

The revised simulator must correct these issues before design ranking is trusted:

1. **Settlement-only comparisons are not enough** - if two designs share the same trading microstructure and agent objective during rounds, then differences seen only at resolution do not explain how incentives change during trading.
2. **Gaussian-only worlds are too forgiving** - a simulator that only samples Gaussian truths and Gaussian informed flow cannot expose the forced-Gaussian expression problem.
3. **Agents must use live portfolio state** - decisions must depend on current capital, holdings, and P&L, not static initialization parameters.
4. **Exitability must reflect allowed actions** - unwind quality must include legal execution primitives, transaction count, path dependence, and reposition cost.
5. **LP conclusions require real deployability** - if LPs never activate, or concentrated liquidity is represented only as fee-share weighting, then LP profitability is not an informative output.
6. **Stress-test designs must not pollute optimization** - Scalar remains a red-team design and is excluded from the candidate leaderboard even though it stays in the scenario suite.

## Goal

Build a quantitative simulation framework that can distinguish:

1. whether improvements come from fixing the Gaussian weight approximation,
2. whether improvements come from changing settlement,
3. whether improvements come from changing agent incentives and market microstructure,
4. whether fee changes improve a valid design rather than masking a broken one.

Output: a standalone HTML report plus CSV/JSON exports that are suitable for design down-selection before MiroFish behavioral simulation.

## Research Questions

The simulator must answer these questions directly:

1. How much of the current failure is caused by the Taylor-4 weight bug versus winner-take-all settlement?
2. Which designs improve truth-tracking under non-Gaussian, boundary-heavy, and adversarial flows?
3. Which designs remain tradable when beliefs change and inventories must be unwound using actual supported actions?
4. Which designs can support LP participation without fake concentration assumptions?
5. Which fee models improve already-credible designs, instead of just distorting the metric bundle?

## Simulation Stages

### Stage 0: Validity Gates

Before running large sweeps, the simulator must pass these gates:

1. Settlement variants produce different trading behavior when incentives differ.
2. Agents consume live `AgentState` and portfolio information.
3. Non-Gaussian scenario families are present.
4. LP activation is observable in at least some baseline scenarios.
5. Exitability metrics penalize unsupported unwind paths.

No composite ranking is published until these gates pass.

### Stage 1: Mechanism Down-Selection

Compare candidate designs under validated agent behavior and scenario families.

Optimization set:
- Baseline A
- Baseline B
- Piecewise-Linear
- Kernel-Smoothed
- CRPS

Separate analysis sets:
- Scalar: red-team only
- CLOB Hybrid: separate microstructure analysis

### Stage 2: Fee Sweep

Run fee sweeps only on the finalist AMM designs that survive Stage 1.

### Stage 3: Sensitivity and Red-Team

Stress the finalists across:
- bins
- liquidity
- agent mix
- scenario family
- adversarial sequencing

## Design Set

| Design | Trading Microstructure | Settlement | Role |
|--------|------------------------|------------|------|
| **Baseline A** | Current CFAMM, Taylor-4 weights | Winner-take-all | Control: current on-chain behavior |
| **Baseline B** | Current CFAMM, exact Gaussian weights | Winner-take-all | Isolates weight bug vs settlement |
| **Piecewise-Linear** | CFAMM, exact weights | Triangular payout around resolution with dynamic bandwidth | Candidate |
| **Kernel-Smoothed** | CFAMM, exact weights | Gaussian-kernel payout around resolution with dynamic bandwidth | Candidate |
| **CRPS Scoring Rule** | CFAMM or scoring-rule compatible accounting | Proper scoring rule payout with stake-aware normalization | Candidate, only if payouts remain comparable and budget-consistent |
| **Scalar** | CFAMM, exact weights | Payout proportional to final market probability | Red-team only, not eligible for top-N |
| **CLOB Hybrid** | Price-time priority orderbook | Piecewise or kernel settlement | Separate microstructure comparison |

## Scenario Library

The simulator must sample from multiple scenario families. A valid sweep mixes all of them.

### Truth / observation families

1. **Gaussian center** - broad centered normal, mainly for continuity with existing tests
2. **Gaussian edge** - narrow distribution near range boundaries
3. **Skewed** - asymmetric distribution with a long tail
4. **Bimodal** - two local peaks
5. **Truncated / clipped** - mass pressed against one boundary
6. **Regime shift** - truth proxy changes during trading
7. **Adversarial boundary** - resolution intentionally near a bin edge

### Trader belief families

1. Gaussian believers
2. Skewed believers
3. Multi-peak believers
4. Localized one-sided traders
5. Belief shifters that must unwind and re-enter after a regime change

The simulator must allow belief family to differ from truth family.

## Agent Model Requirements

All agents must decide from live state, not static construction-time capital.

Required inputs per decision:
- current implied distribution
- live capital
- live holdings
- accumulated fees / P&L
- design identifier
- settlement rule
- allowed action primitives
- scenario metadata

### Informed Trader

Must optimize expected utility under the active design, not just trade toward a fixed Gaussian mismatch. Truthful behavior should differ across winner-take-all, smoothed settlement, and CRPS-like payout rules.

### Noise Trader

Should include both random singles and random bundles so the simulator can distinguish noise in a forced-Gaussian interface from noise in a freer interface.

### Arbitrageur

Must target:
- probability-sum deviations
- local boundary discontinuities
- cross-bin shape violations
- design-specific pricing inconsistencies

### Manipulator

Must be able to optimize for:
- temporary price distortion
- end-of-market payout capture
- boundary crossing
- cheap late-stage payout gaming

### Late-Round Whale

Default scope is red-team suites and Scalar stress tests. It should not be mixed into the optimization leaderboard unless the report explicitly labels that run as adversarial-all-designs.

### LPs

LPs must make deploy / withdraw / rebalance decisions from realized economics.

The model must support:
- activation rate
- realized holding period
- realized fees
- realized adverse selection
- actual liquidity placement, not only fee-share adjustments

## Metrics

The simulator keeps per-run metrics, but some previous definitions are replaced.

| Metric | Revised Definition | Purpose |
|--------|--------------------|---------|
| **Price Accuracy** | KL divergence and additional calibration error over time, measured during trading and at close | Truth tracking |
| **Convergence Speed** | First round where calibrated error stays below threshold for a sustained window | Avoid one-off crossings |
| **Capital Efficiency** | Local slippage and depth around target bins, not only a single representative bin | Detect fragmentation |
| **LP Deployability** | Activation rate, median live capital deployed, holding duration, and realized return | Separate "LPs never entered" from "LPs entered and lost" |
| **Manipulation Resistance** | Cost to move market state and cost to improve attacker payout under the active settlement rule | Distinguish cosmetic vs profitable manipulation |
| **Resolution Fairness** | Payout compared against a common external benchmark utility, not a benchmark derived from one candidate settlement shape | Avoid biasing toward piecewise or kernel by construction |
| **Boundary Sensitivity** | Payout jump and trading incentive jump around bin boundaries | Measure discontinuity directly |
| **Exitability** | Fraction unwindable using allowed actions, transaction count, slippage, reposition cost, and failure rate | Measure practical exit quality |
| **Truthful Incentive Alignment** | Whether truthful moves improve expected utility more than nearby manipulative moves for informed traders | Directly test properness / incentive quality |

### Metric validity rules

1. If a metric is constant or structurally degenerate across designs, it is flagged and excluded from ranking.
2. If LP activation rate is zero in a scenario family, LP return is reported as "not activated" instead of `0`.
3. If a design is red-team only, it is excluded from finalist selection even if some metrics score well.

### Selection rules

1. No composite leaderboard is shown until Stage 0 validity gates pass.
2. Stage 1 uses per-metric tables plus a Pareto frontier.
3. Finalist selection excludes Scalar.
4. CLOB remains in a separate comparison section.

## Fee Mechanisms

Fee models remain:
- Flat
- Dynamic
- Tiered
- Spread-based
- Time-weighted

But fee sweeps happen only after mechanism validity is established.

## Architecture

```
quant-simulation/
├── config/
│   ├── params.py
│   └── scenarios.py            # scenario families, sampling, validity gates
├── models/
│   ├── math_engine.py
│   ├── weights.py
│   ├── settlement_*.py
│   ├── orderbook.py
│   └── fee_models.py
├── agents/
│   ├── base.py                 # live decision context + action primitives
│   ├── informed_trader.py
│   ├── noise_trader.py
│   ├── arbitrageur.py
│   ├── manipulator.py
│   ├── late_round_whale.py
│   └── lp.py
├── engine/
│   ├── simulation.py
│   ├── metrics.py
│   ├── sweeps.py
│   └── validation.py           # Stage 0 validity checks
├── analysis/
│   ├── report.py
│   └── export.py
└── run.py
```

Key principle: math remains pure and testable, but orchestration must explicitly model the causal chain:

`scenario -> agent incentives -> actions -> market state -> resolution -> payouts -> metrics`

## Report Output

The report should contain:

### Stage 0

1. Validity gate results
2. Metrics flagged as degenerate or invalid
3. Scenario coverage summary

### Stage 1

4. Baseline A vs B analysis
5. Candidate design comparison by metric
6. Pareto frontier for candidate designs
7. Scalar red-team section
8. CLOB separate section

### Stage 2

9. Fee heatmaps for finalist AMM designs only
10. Fee impact decomposition: price quality, LP deployability, manipulation resistance

### Cross-cutting

11. Boundary case gallery
12. Exitability failure cases
13. LP activation and concentration plots
14. Structured export for downstream behavioral simulation

## Technical Notes

### Weight bug measurement

The simulator must keep a direct A-vs-B comparison so the weight approximation error can be isolated from settlement changes.

### CRPS handling

CRPS remains a proper scoring rule reference for continuous forecast evaluation. The implementation must use stake-aware normalization and keep payouts comparable across traders and runs. See:
- [Fortnow & Sami, "Multi-outcome and Multidimensional Market Scoring Rules"](https://arxiv.org/abs/1202.1712)
- [scoringrules CRPS estimators](https://scoringrules.readthedocs.io/en/latest/crps_estimators.html)

### Monte Carlo scale

The eventual target scale can remain around the current order of magnitude, but only after Stage 0 validity checks pass. During remediation, quick suites and adversarial fixtures take priority over large run counts.
