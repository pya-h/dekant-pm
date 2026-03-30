# Quantitative AMM Simulation Design Spec

## Problem Statement

DekantPM's continuous market AMM has fundamental bin-related issues that block commercial viability:

1. **Winner-take-all resolution** — a single bin wins 100%, adjacent bins get nothing, creating discontinuous payoff cliffs
2. **Coarse granularity** — MAX_BINS = 256 yields ~0.4% range resolution per bin
3. **Normal PDF approximation is severely wrong** — Taylor degree-4 is ~3.9% high at |z|=1.5, ~146% high at |z|=2, and explodes past |z|=2.5 (3644% error). The clamped polynomial effectively saturates by z~2.5, systematically overpricing near-center bins and destroying tail accuracy
4. **Liquidity fragmentation** — uniform reserves across 256 bins means ~1/256th depth per bin
5. **LPs can't concentrate liquidity** — forced uniform exposure causes adverse selection losses
6. **Bin boundary arbitrage** — hard boundaries create exploitable edge effects
7. **Forced Gaussian sell** — traders cannot unwind arbitrary bin positions; selling requires specifying a fresh Normal(mu, sigma) vector

## Goal

Build a quantitative simulation framework (pure numpy math engine + cadCAD orchestration) that isolates whether improvements come from fixing the Gaussian weight approximation vs changing the settlement design. Two-phase approach: Phase 1 down-selects AMM designs under flat fee, Phase 2 sweeps fee mechanisms on the top designs.

Output: a standalone HTML report with comparison charts and structured data for MiroFish behavioral simulation.

## Simulation Phases

### Phase 1: Design Down-Selection (flat fee only)

**7 designs x 1 fee mechanism x 1000 Monte Carlo = 7,000 runs.**

Goal: isolate which settlement/payoff design actually fixes the commercial blockers.

### Phase 2: Fee Sweep (top 3 designs from Phase 1)

**3 designs x 5 fee mechanisms x 1000 Monte Carlo = 15,000 runs.**

Goal: find optimal fee mechanism for each surviving design.

### Total: ~22,000 runs (down from 25,000), more focused.

## AMM Designs

Two baselines to isolate the Gaussian approximation effect from settlement design changes:

| Design | Gaussian Weights | Resolution Payout | Purpose |
|--------|-----------------|-------------------|---------|
| **Baseline A** (current on-chain) | Taylor-4 approximation (as implemented in `normal_pdf.rs`) | Winner-take-all | Control: current behavior exactly as deployed |
| **Baseline B** (fixed Gaussian) | Exact Gaussian via `scipy.stats.norm` | Winner-take-all | Isolates: how much does fixing the weight bug alone improve things? |
| **Piecewise-Linear** | Exact Gaussian | Triangular: `max(0, 1 - distance/W)` with dynamic bandwidth. `W = max(1, ceil(num_bins * target_payout_width / range_span))`. Default `target_payout_width` tuned so W=5 at 256 bins. | Smooth-ish settlement, simple to implement on-chain |
| **Kernel-Smoothed** | Exact Gaussian | `payout[bin] = exp(-distance^2 / (2 * bandwidth^2))`, normalized so winning bin = 1.0. C-infinity decay, same dynamic bandwidth scaling. Naturally extends the Normal PDF paradigm. | Smoothest settlement, elegant but more compute |
| **Scalar** | Exact Gaussian | Each bin pays proportional to its final implied probability. Pro-rata distribution of payout pool. Vulnerable to late-stage whale attacks (see Agents). | Tests market-driven settlement |
| **CRPS Scoring Rule** | Exact Gaussian | Discretized Continuous Ranked Probability Score. Each trader's payout is based on the proper scoring rule: `CRPS = E|X - x| - 0.5 * E|X - X'|` where X is the forecast CDF and x is the resolved value. Rewards forecast quality directly rather than approximating it with ad hoc kernels. | Gold standard for continuous forecast evaluation |
| **CLOB Hybrid** | N/A (orderbook) | Price-time priority limit orderbook. Tick size = 1 bin width. Orders specify bin + price (probability). Matching: incoming orders walk the book at price-time priority. Payout uses same dynamic bandwidth as piecewise-linear. | Fundamentally different microstructure |

**CLOB Hybrid is analyzed separately** — it changes market microstructure so fundamentally that a single composite leaderboard mixing it with AMM variants would be misleading. It gets its own report section with qualitative comparison.

## Fee Mechanisms (Phase 2 only)

| Fee Mechanism | Description |
|---------------|-------------|
| **Flat fee** (current) | 30 bps on every trade, 50/50 LP/protocol split |
| **Dynamic fee** | Fee scales with volatility or utilization (higher fee when pool is imbalanced) |
| **Tiered fee** | Lower fees for larger trades / repeat traders (volume incentives) |
| **Spread-based fee** | Fee proportional to distance from current consensus — trading against the crowd costs more |
| **Time-weighted fee** | Fee starts low (e.g., 10 bps) early in market lifecycle and increases toward deadline (e.g., 100 bps). Analogous to theta decay in options. Fee at round t: `base_fee + (max_fee - base_fee) * (t / total_rounds)^2` |

## Architecture

```
quant-simulation/
├── pyproject.toml              # Dependencies: numpy, scipy, pandas, plotly, jinja2, cadcad
├── config/
│   └── params.py               # All tunable parameters (bins, fees, trader profiles, phases)
├── models/
│   ├── math_engine.py          # Pure numpy vectorized AMM math (L2-norm, isqrt, probabilities)
│   ├── weights.py              # Gaussian weight generation: Taylor-4 (baseline A) + exact (baseline B+)
│   ├── settlement_baseline.py  # Winner-take-all payout
│   ├── settlement_piecewise.py # Piecewise-linear payout (dynamic bandwidth)
│   ├── settlement_kernel.py    # Kernel-smoothed Gaussian payout
│   ├── settlement_scalar.py    # Implied-probability pro-rata payout
│   ├── settlement_crps.py      # CRPS proper scoring rule payout
│   ├── orderbook.py            # Price-time priority CLOB matching engine
│   └── fee_models.py           # All 5 fee mechanisms
├── agents/
│   ├── informed_trader.py      # Trades toward "true" distribution
│   ├── noise_trader.py         # Random trades (market noise)
│   ├── arbitrageur.py          # Exploits mispricings between bins
│   ├── manipulator.py          # Tries to move price with minimal capital
│   ├── late_round_whale.py     # Last-minute probability manipulation (scalar design stress test)
│   └── lp.py                   # Passive and rebalancing LP strategies
├── engine/
│   ├── simulation.py           # cadCAD orchestration: state machine, round loop
│   ├── metrics.py              # Computes all 8 metrics per run
│   └── sweeps.py               # Phase 1 + Phase 2 sweep configs
├── analysis/
│   ├── report.py               # Generates HTML comparison report with plotly charts
│   └── export.py               # Exports results as CSV/JSON (for MiroFish ingestion)
└── run.py                      # Entry point: phase 1 -> down-select -> phase 2 -> report
```

**Key architectural principle:** the math engine (`math_engine.py`, `weights.py`, settlement modules) is pure numpy vectorized code with no cadCAD dependency. cadCAD is used only for orchestration (sweep configuration, state machine bookkeeping, Monte Carlo scheduling). This keeps the core microstructure math testable and fast independently.

## Agent Behavior Models

| Agent | Strategy | Parameters |
|-------|----------|------------|
| **Informed Trader** | Knows the "true" distribution (injected). Buys underpriced bins, sells overpriced. Trade size proportional to mispricing magnitude. | `conviction` (0-1), `capital_limit` |
| **Noise Trader** | Picks random bins, random direction, random size within bounds. Models uninformed retail flow. | `trade_range` (min/max size), `frequency` |
| **Arbitrageur** | Compares implied probabilities across bins. If sum deviates from 1.0 or adjacent bins have irrational pricing, trades to correct. | `min_edge` (minimum profit threshold) |
| **Manipulator** | Targets a specific bin. Buys aggressively to inflate price, measures capital needed. Used for manipulation resistance metric. | `target_bin`, `budget` |
| **Late-Round Whale** | Only acts in the final 10% of rounds. Deposits heavily into a target bin to inflate its implied probability before resolution. Specifically stress-tests the scalar design. | `target_bin`, `budget`, `activation_round_pct` (default 0.9) |
| **LP (Passive)** | Deposits liquidity when fee yield exceeds threshold, withdraws when adverse selection losses exceed fees. Tracks P&L per round. | `yield_threshold`, `loss_tolerance` |
| **LP (Rebalancing)** | Same as passive LP but concentrates position toward high-activity bins. Models what LPs would do if concentrated liquidity were available, revealing whether adding that functionality is worth the complexity. Rebalances every R rounds. | `yield_threshold`, `loss_tolerance`, `rebalance_interval`, `concentration_factor` |

Default agent mix: 45% noise, 25% informed, 13% arbitrageur, 5% manipulator, 2% late-round whale, 5% passive LP, 5% rebalancing LP. Configurable in `config/params.py`.

## Metrics

| Metric | Formula / Method | Output |
|--------|-----------------|--------|
| **Price Accuracy** | KL divergence: `sum(p_true(i) * log(p_true(i) / p_amm(i)))` measured every 10 rounds. Final KL at resolution. Lower = better. | Time series + final value |
| **Convergence Speed** | Number of rounds to reach KL < 0.01 (first crossing). If never reached, record total_rounds. | Rounds to convergence |
| **Capital Efficiency** | Execute test trades at 1%, 5%, 10%, 25% of pool depth. Measure `slippage = (avg_price - mid_price) / mid_price`. | Slippage curve per trade size |
| **LP Profitability** | `net_return = (fees_earned - impermanent_loss) / capital_deposited` over full lifecycle. Separately report passive LP vs rebalancing LP returns. | Distribution of returns across Monte Carlo paths |
| **Manipulation Resistance** | Manipulator spends budget B to move target bin price by X%. `cost_per_percent = B / X`. Higher = more resistant. For scalar design, additionally run late-round whale attack: capital needed in final 10% of rounds to capture >50% of payout pool. | Cost curve: capital needed vs distortion achieved |
| **Resolution Fairness** | For traders within +/-K bins of resolved outcome: `expected_payout_ratio = actual_payout / ideal_payout`. | Payout distribution heat map by distance from resolved bin |
| **Boundary Sensitivity** | Payout jump for an epsilon move across each bin boundary: `max_b |payout(b + epsilon) - payout(b - epsilon)|`. Measures how discontinuous the payoff function is. Ideal = 0 (smooth). Baseline will show maximum discontinuity (1.0 jump). | Max and mean boundary jump across all bins |
| **Exitability** | After a trader holds positions, shift their belief (delta_mu, delta_sigma). Measure: max feasible unwind as fraction of position, and slippage cost to reposition. Tests whether traders can exit or adjust without being locked in. | Max unwind fraction + repositioning cost |

**Default metric weights for composite score**: Resolution Fairness 0.20, Price Accuracy 0.15, Convergence Speed 0.15, Capital Efficiency 0.10, LP Profitability 0.10, Manipulation Resistance 0.10, Boundary Sensitivity 0.10, Exitability 0.10. Weights configurable in `config/params.py`.

Aggregation: report **median, p5, p95** for each metric across Monte Carlo paths. Flag combos where metric distributions overlap (inconclusive).

## Report Output

The HTML report contains:

### AMM Design Comparison (Phase 1)

1. **Leaderboard** — Ranked table of 6 AMM designs (excluding CLOB) with weighted composite score under flat fee
2. **Baseline A vs B analysis** — Isolated chart showing how much fixing the Gaussian approximation alone improves each metric. This answers: "is the weight bug or the settlement design the bigger problem?"
3. **Per-metric comparison charts** — Plotly charts showing all 6 AMM designs with error bars (p5/p95)
4. **Boundary sensitivity heatmap** — Visual showing payout continuity across bin boundaries for each design
5. **Exitability comparison** — How well each design supports position unwinding

### CLOB Hybrid Analysis (separate section)

6. **CLOB vs top AMM designs** — Qualitative comparison on each metric, noting where microstructure differences make direct comparison inappropriate
7. **CLOB-specific metrics** — Order book depth, fill rates, spread dynamics

### Fee Mechanism Sweep (Phase 2)

8. **Fee heatmaps** — Top 3 designs x 5 fee mechanisms, one heatmap per metric
9. **Optimal fee per design** — Which fee mechanism works best for each surviving design

### Cross-Cutting

10. **Sensitivity analysis** — Results varying bins (16-256), agent mix, initial liquidity
11. **MiroFish export** — Top 3 combos with structured JSON for knowledge graph seeding
12. **Raw data** — CSV download for all Monte Carlo results

## Technical Details

### AMM Math Engine

Pure numpy vectorized code, no cadCAD dependency:
- L2-norm invariant: `sum((total_minted - reserves[i])^2) = total_minted^2`
- Integer arithmetic with SCALE = 10^9
- isqrt via Newton's method
- Two Gaussian weight implementations:
  - Taylor-4 approximation (faithful port of `normal_pdf.rs` for Baseline A)
  - Exact Gaussian via `scipy.stats.norm.pdf` (for Baseline B and all redesigns)

### cadCAD Integration (orchestration only)

- **State variables**: reserves, total_minted, agent_positions, agent_balances, fee_accumulators, orderbook_state
- **Policies**: one per agent type (informed_trade, noise_trade, arb_trade, manipulate, whale_attack, lp_passive, lp_rebalance)
- **State update functions**: apply_trade, apply_fees, update_positions, rebalance_lps, compute_metrics
- **Phase 1 sweeps**: `M = {'amm_design': [0,1,2,3,4,5], 'fee_model': [0]}` (flat only)
- **Phase 2 sweeps**: `M = {'amm_design': [top_3], 'fee_model': [0,1,2,3,4]}`
- **Monte Carlo**: `N = 1000` runs per parameter combo

### Dependencies

- numpy >= 1.24
- scipy >= 1.11
- pandas >= 2.0
- plotly >= 5.18
- jinja2 >= 3.1 (for HTML report templating)
- cadCAD >= 0.5.3 (orchestration only)
