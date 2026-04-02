# How a Simulation Run Works

## Overview

Each simulation run models a complete prediction market lifecycle from creation through trading to resolution and payout. The revised lifecycle is built to test continuous-market failure modes end-to-end, not just compare payout functions after a shared trading path.

Every run must preserve the causal chain:

`scenario -> agent beliefs -> allowed actions -> market state -> settlement -> realized utility -> metrics`

## Phase 0: Initialize Scenario

1. Select a scenario family:
   - Gaussian center
   - Gaussian edge
   - skewed
   - bimodal
   - truncated / clipped
   - regime shift
   - adversarial boundary
2. Sample the latent truth process for the run.
3. Sample heterogeneous agent belief models, which may differ from the truth family.
4. Select the design under test:
   - Baseline A
   - Baseline B
   - Piecewise-Linear
   - Kernel-Smoothed
   - CRPS
   - Scalar (red-team only)
   - CLOB Hybrid
5. Select the fee mechanism.

## Phase 1: Market Initialization

1. Create a market with `N` bins spanning a defined continuous range.
2. Seed initial liquidity.
3. Initialize reserves or orderbook state according to the design.
4. Select the weight implementation:
   - Baseline A: Taylor-4 approximation
   - Baseline B and redesigns: exact Gaussian weights where applicable
5. Initialize agents with live portfolio state containers.
6. Register the action primitives allowed in this run:
   - single-bin buy
   - single-bin sell
   - bundle buy
   - bundle sell
   - LP deposit
   - LP withdraw
   - LP rebalance
   - order placement / cancellation for CLOB

## Phase 2: Trading Rounds

Each round proceeds in this order.

### Step 1: Build decision context

Create a snapshot for every agent containing:
- current implied distribution
- live capital
- live holdings
- accumulated fees / P&L
- design identifier
- settlement rule
- scenario metadata
- allowed action primitives

### Step 2: Agent decisions

Every active agent evaluates the live snapshot and proposes actions.

Required behavior:

- **Informed traders** maximize expected utility under the active design and their current belief.
- **Noise traders** generate both single-bin and bundle noise flow as configured.
- **Arbitrageurs** target probability-sum errors, local discontinuities, shape inconsistencies, and design-specific pricing inconsistencies.
- **Manipulators** optimize for one of the explicit adversarial objectives required by the scenario:
  - temporary price distortion
  - end-of-market payout capture
  - boundary crossing
  - cheap late-stage payout gaming
- **Late-round whales** activate only in the designated adversarial suites by default.
- **LPs** decide whether to deploy, withdraw, or rebalance from live economics.

### Step 3: Action sequencing

1. Queue all actions for the round.
2. Shuffle them unless the scenario specifies adversarial sequencing.
3. Execute actions through the relevant engine:
   - CFAMM for AMM designs
   - orderbook for CLOB
4. Apply the active fee model.

### Step 4: State update

After every action:
- update reserves or orderbook
- update total minted
- update the acting agent's live state
- update LP accounting
- update realized trade logs

At round end:
- refresh implied probabilities
- refresh local depth and imbalance statistics
- refresh LP placement state

### Step 5: Periodic snapshots

At configured intervals, record:
- price accuracy
- calibration error
- local slippage / depth
- LP activation and live deployment
- exitability probes
- manipulation probes where enabled

## Phase 3: Resolution

1. Draw the realized outcome from the scenario's truth process.
2. Map the resolved value to a bin.
3. Apply the design's settlement rule.
4. Compute each trader's realized utility using that design's payout accounting.

Important:

- Scalar remains a red-team settlement and is never promoted from this stage into the candidate finalist set.
- CRPS payouts must be stake-aware and comparable across traders.

## Phase 4: Metric Computation

Compute the revised metrics for the completed run.

### Market quality

1. **Price accuracy** - final and time-series divergence from truth
2. **Convergence speed** - sustained threshold crossing, not a one-off dip
3. **Capital efficiency** - local depth and slippage around active bins

### LP quality

4. **LP deployability** - activation rate, median live capital deployed, holding duration, and realized return

### Adversarial quality

5. **Manipulation resistance** - cost to move price and cost to improve attacker payout
6. **Boundary sensitivity** - payout jump and incentive jump around boundaries

### User experience quality

7. **Exitability** - feasible unwind fraction, transaction count, slippage, reposition cost, and failure rate under supported actions
8. **Resolution fairness** - payout versus a common external benchmark
9. **Truthful incentive alignment** - whether truthful action improves expected utility more than nearby manipulative alternatives

### Metric validity rules

Before results are used for ranking:

1. Flag metrics that are constant or degenerate across designs.
2. Report LP metrics as "not activated" if LP activation is zero.
3. Exclude red-team-only designs from finalist selection.

## Phase 5: Sweep Orchestration

The sweep engine runs in staged mode.

### Stage 0: Validity suite

Run small targeted fixtures to verify:
- design differences affect trading behavior
- agents use live state
- non-Gaussian scenarios are covered
- LP activation is possible in at least some fixtures
- exitability is non-trivial

### Stage 1: Mechanism comparison

For each candidate design:
1. run across the scenario family matrix
2. collect per-metric distributions
3. build per-metric comparison tables
4. compute Pareto frontiers

Scalar runs only in the red-team lane.
CLOB runs in its own comparison lane.

### Stage 2: Fee sweep

For each surviving AMM design:
1. sweep the fee models
2. compare fee impact on already-valid metrics

### Stage 3: Sensitivity

Vary:
- bin count
- liquidity
- agent mix
- scenario family
- sequencing

## Phase 6: Report

The report is staged as follows:

### Stage 0

1. Validity gate results
2. Metrics flagged as degenerate or invalid
3. Scenario coverage summary

### Stage 1

4. Baseline A vs Baseline B analysis
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

No top-level composite leaderboard is shown unless the validity suite explicitly marks the metric bundle as safe for ranking.
