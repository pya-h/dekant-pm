# How a Simulation Run Works

## Overview

Each simulation run models a complete prediction market lifecycle — from creation through trading to resolution and payout. The simulation measures how different AMM designs and fee mechanisms perform under realistic market conditions.

The simulation runs in two phases: Phase 1 down-selects AMM designs under flat fee, Phase 2 sweeps fee mechanisms on the surviving designs.

## Lifecycle Phases

### Phase 1: Initialize

1. Create a market with N bins (default: 256) spanning a defined continuous range
2. Seed initial liquidity (configurable: 1k, 10k, or 100k USDC)
3. Set reserves to uniform distribution: `reserves[i] = L - isqrt(L^2 / N)` for all bins
4. Select Gaussian weight implementation:
   - **Baseline A**: Taylor-4 approximation (matching on-chain `normal_pdf.rs`)
   - **Baseline B + all redesigns**: exact Gaussian via `scipy.stats.norm`
5. Inject the "true" underlying distribution that informed traders will trade toward (e.g., Normal(mu=50000, sigma=5000) for a BTC price market)
6. Initialize all agents with starting capital and strategy parameters
7. Select the AMM design (settlement function) and fee mechanism for this run

### Phase 2: Trade Rounds (100-500 rounds per run)

Each round proceeds in this order:

**Step 1 — Agent decisions.** Every active agent evaluates the current market state and decides whether to act:
- Informed traders compare AMM-implied probabilities to the true distribution, trade where mispricing exceeds their conviction threshold
- Noise traders randomly buy/sell random bins
- Arbitrageurs scan for probability sum deviations or irrational adjacent-bin pricing
- Manipulators spend from their budget to push their target bin's price
- Late-round whales activate only in the final 10% of rounds, depositing heavily to inflate a target bin's implied probability (specifically stress-tests the scalar design)
- Passive LPs evaluate their fee yield vs adverse selection losses, deposit or withdraw accordingly
- Rebalancing LPs do the same but also concentrate positions toward high-activity bins every R rounds, modeling what LPs would do if concentrated liquidity were available

**Step 2 — Trade execution.** All agent actions are queued and executed sequentially (random order within the round):
- For AMM designs (baseline A, baseline B, piecewise, kernel, scalar, CRPS): trades go through the L2-norm CFAMM math engine (pure numpy)
- For CLOB hybrid: trades are matched against the price-time priority limit orderbook (tick size = 1 bin width), unmatched orders rest on the book
- Fees are computed per the active fee mechanism and split between LP pool and protocol

**Step 3 — State update.** After all trades execute:
- Update reserves, total_minted, agent positions, agent balances
- Accumulate fees to LP pool and protocol
- Record implied probability distribution for this round

**Step 4 — Metrics snapshot.** Every 10 rounds:
- Compute KL divergence between AMM-implied and true distribution
- Record current LP P&L (passive and rebalancing separately)
- Record pool depth and slippage at standard trade sizes
- Test exitability: attempt to unwind a reference position and measure cost

### Phase 3: Resolve

1. Sample the resolved value from the true distribution (or use a fixed value for deterministic tests)
2. Map the resolved value to a bin via `value_to_bin`
3. Apply the design's settlement/payout function:
   - **Baseline A/B**: winning bin gets 100%, all others get 0%
   - **Piecewise-Linear**: winning bin gets 100%, bins within dynamic bandwidth W get linearly decaying payout `max(0, 1 - distance/W)`, rest get 0%. W scales with bin count to maintain constant economic meaning.
   - **Kernel-Smoothed**: `payout[bin] = exp(-distance^2 / (2 * bandwidth^2))` normalized so winning bin = 1.0. Smooth (C-infinity) decay, same dynamic bandwidth scaling as piecewise-linear.
   - **Scalar**: each bin pays proportional to its final implied probability
   - **CRPS**: payout computed via discretized Continuous Ranked Probability Score — rewards forecast quality directly based on proper scoring rule theory
   - **CLOB Hybrid**: payout based on order fill bin proximity to resolved bin, using same dynamic bandwidth formula

### Phase 4: Measure

Compute all 8 metrics for the completed run:

1. **Price accuracy**: final KL divergence between AMM-implied and true distribution
2. **Convergence speed**: round number at which KL first dropped below 0.01. If never reached, record total_rounds.
3. **Capital efficiency**: slippage measurements at 1%, 5%, 10%, 25% of pool depth (sampled at mid-run and end-of-run)
4. **LP profitability**: `(fees_earned - impermanent_loss) / capital_deposited` for each LP agent. Report passive and rebalancing LP returns separately.
5. **Manipulation resistance**: total capital spent by manipulator vs price distortion achieved. For scalar design, additionally measure late-round whale attack: capital needed in final 10% of rounds to capture >50% of payout pool.
6. **Resolution fairness**: for each trader, compute `actual_payout / ideal_payout` where ideal = proportional to prediction accuracy (distance from resolved bin)
7. **Boundary sensitivity**: for each bin boundary, compute `|payout(b + epsilon) - payout(b - epsilon)|`. Report max and mean boundary jump. Measures payoff discontinuity — ideal = 0 (smooth), baseline will show 1.0 (maximum discontinuity).
8. **Exitability**: shift a reference trader's belief by (delta_mu, delta_sigma). Measure max feasible unwind as fraction of position, and slippage cost to reposition. Tests whether traders can exit or adjust positions without being locked in.

### Phase 5: Sweep (cadCAD orchestration)

cadCAD orchestrates the sweep in two phases:

**Phase 1 — Design down-selection (flat fee only):**
```
For each AMM design in [baseline_a, baseline_b, piecewise, kernel, scalar, crps]:
  fee_mechanism = flat
  For each Monte Carlo run in range(1000):
    - Randomize: agent initial positions, noise trader behavior, true distribution parameters
    - Execute phases 1-4
    - Store all metrics

CLOB hybrid runs separately with same 1000 MC paths for qualitative comparison.
```
Phase 1 total: 7 x 1000 = 7,000 runs.

After Phase 1: rank designs by composite score, select top 3 (excluding CLOB which is analyzed separately).

**Phase 2 — Fee mechanism sweep (top 3 designs):**
```
For each AMM design in [top_3_from_phase_1]:
  For each fee mechanism in [flat, dynamic, tiered, spread, time_weighted]:
    For each Monte Carlo run in range(1000):
      - Execute phases 1-4
      - Store all metrics
```
Phase 2 total: 3 x 5 x 1000 = 15,000 runs.

**Grand total: ~22,000 simulation runs.**

### Phase 6: Report

Aggregate results into the comparative HTML report:

**Phase 1 report:**
1. Baseline A vs B analysis (isolating weight bug vs settlement design)
2. Design leaderboard (6 AMM designs under flat fee)
3. CLOB hybrid qualitative comparison (separate section)
4. Down-select decision with justification

**Phase 2 report:**
5. Fee mechanism heatmaps for top 3 designs
6. Optimal fee per design recommendation

**Cross-cutting:**
7. Sensitivity analysis (bins, agent mix, liquidity)
8. MiroFish export (top 3 combos as structured JSON)
9. Raw data (CSV download)

Bundle everything into a self-contained HTML file.

## Sensitivity Runs

After the main sweep, additional runs vary:

| Parameter | Values | Purpose |
|-----------|--------|---------|
| Number of bins | 16, 32, 64, 128, 256 | Does bin granularity matter more for some designs? Also tests dynamic bandwidth scaling. |
| Agent mix | 80/10/5/3/2/0/0, 45/25/13/5/2/5/5, 20/30/15/10/5/10/10 | Noise-heavy vs balanced vs adversarial (7 agent types) |
| Initial liquidity | 1k, 10k, 100k USDC | Does more liquidity disproportionately help some designs? |

These use the top 3 designs from Phase 1 only (to keep runtime manageable).

## Randomization

Each Monte Carlo path randomizes:
- **True distribution**: mu sampled from range center +/- 20%, sigma sampled from range_span/10 to range_span/3
- **Noise trader actions**: fully random each round
- **Agent order within rounds**: shuffled per round
- **Resolved value**: sampled from the true distribution (not fixed)

Seeds are recorded for reproducibility.
