# Quantitative AMM Simulation Design Spec

## Problem Statement

DekantPM's continuous market AMM has fundamental bin-related issues that block commercial viability:

1. **Winner-take-all resolution** — a single bin wins 100%, adjacent bins get nothing, creating discontinuous payoff cliffs
2. **Coarse granularity** — MAX_BINS = 256 yields ~0.4% range resolution per bin
3. **Normal PDF approximation degrades** — Taylor degree-4 is only accurate to ~0.1% for |z| <= 1.5, systematically mispricing tails
4. **Liquidity fragmentation** — uniform reserves across 256 bins means ~1/256th depth per bin
5. **LPs can't concentrate liquidity** — forced uniform exposure causes adverse selection losses
6. **Bin boundary arbitrage** — hard boundaries create exploitable edge effects

## Goal

Build a Python + cadCAD quantitative simulation framework that compares 5 AMM redesigns across 5 fee mechanisms, measuring 6 metrics over 1000 Monte Carlo paths per combination. Output: a standalone HTML report with a leaderboard, comparison charts, and structured data for MiroFish behavioral simulation.

## Simulation Matrix

**5 designs x 5 fee mechanisms = 25 combinations**, each run 1000 times.

### AMM Designs

| Design | Resolution Payout | Key Change |
|--------|------------------|------------|
| **Baseline** (current) | Winner-take-all: winning bin gets 100%, rest get 0% | None — control group |
| **Piecewise-Linear** | Triangular: winning bin gets 100%, bins within dynamic bandwidth W get payout `max(0, 1 - distance/W)`. Bins beyond W get 0%. W scales with bin count: `W = max(1, ceil(num_bins * target_payout_width / range_span))` so the economic meaning (e.g., "payout if within 2% of resolved value") stays constant regardless of bin count. Default `target_payout_width` tuned so W=5 at 256 bins. | Change `claim_payout` only |
| **Kernel-Smoothed** | Gaussian-kernel payout: `payout[bin] = exp(-distance^2 / (2 * bandwidth^2))`, normalized so winning bin = 1.0. Same spirit as piecewise-linear but with smooth (C-infinity) decay — no discontinuous derivative at edges. Bandwidth parameter uses the same dynamic scaling as piecewise-linear. Naturally extends the Normal PDF paradigm traders already use to express beliefs. | Change `claim_payout` only |
| **Scalar** | Proportional: each bin pays based on its final implied probability at resolution time. Total payout pool is distributed pro-rata by probability weight. **Note**: vulnerable to late-stage whale attacks — a whale can inflate a bin's implied probability right before resolution. The manipulation resistance metric specifically tests this via a "last-round whale attack" agent variant (see Agents section). | Change `resolve` + `claim_payout` |
| **CLOB Hybrid** | Price-time priority limit orderbook with on-chain settlement. Tick size = 1 bin width. Orders specify a bin and a price (probability). Matching engine: incoming orders walk the book at price-time priority until filled or resting. Unmatched orders rest on the book. Payout = `max(0, 1 - |order_bin - resolved_bin| / W)` using the same dynamic bandwidth as piecewise-linear, applied to each filled order's bin. | Replace AMM with orderbook for continuous markets |

### Fee Mechanisms

| Fee Mechanism | Description |
|---------------|-------------|
| **Flat fee** (current) | 30 bps on every trade, 50/50 LP/protocol split |
| **Dynamic fee** | Fee scales with volatility or utilization (higher fee when pool is imbalanced) |
| **Tiered fee** | Lower fees for larger trades / repeat traders (volume incentives) |
| **Spread-based fee** | Fee proportional to distance from current consensus — trading against the crowd costs more |
| **Time-weighted fee** | Fee starts low (e.g., 10 bps) early in market lifecycle and increases toward deadline (e.g., 100 bps). Models the fact that late trading carries more information content and should be priced higher. Analogous to theta decay in options markets. Fee at round t: `base_fee + (max_fee - base_fee) * (t / total_rounds)^2` |

## Architecture

```
quant-simulation/
├── pyproject.toml              # Dependencies: cadcad, numpy, scipy, plotly, pandas
├── config/
│   └── params.py               # All tunable parameters (bins, fees, trader profiles, etc.)
├── models/
│   ├── amm_baseline.py         # Current L2-norm CFAMM (faithful port from Rust)
│   ├── amm_piecewise.py        # Piecewise-linear payoff variant (dynamic bandwidth)
│   ├── amm_kernel.py           # Kernel-smoothed Gaussian payoff variant
│   ├── amm_scalar.py           # Scalar market payoff variant
│   ├── amm_clob.py             # CLOB hybrid model (price-time priority orderbook)
│   └── fee_models.py           # All 5 fee mechanisms
├── agents/
│   ├── informed_trader.py      # Trades toward "true" distribution
│   ├── noise_trader.py         # Random trades (market noise)
│   ├── arbitrageur.py          # Exploits mispricings between bins
│   ├── manipulator.py          # Tries to move price with minimal capital
│   ├── late_round_whale.py     # Last-minute probability manipulation (scalar design stress test)
│   └── lp.py                   # Passive and rebalancing LP strategies
├── engine/
│   ├── simulation.py           # cadCAD state machine: init -> trade rounds -> resolve
│   ├── metrics.py              # Computes all 5 metrics per run
│   └── sweeps.py               # Parameter sweep config (4x4 matrix + Monte Carlo)
├── analysis/
│   ├── report.py               # Generates HTML comparison report with plotly charts
│   └── export.py               # Exports results as CSV/JSON (for MiroFish ingestion)
└── run.py                      # Entry point: run sweeps -> compute metrics -> generate report
```

## Agent Behavior Models

| Agent | Strategy | Parameters |
|-------|----------|------------|
| **Informed Trader** | Knows the "true" distribution (injected). Buys underpriced bins, sells overpriced. Trade size proportional to mispricing magnitude. | `conviction` (0-1), `capital_limit` |
| **Noise Trader** | Picks random bins, random direction, random size within bounds. Models uninformed retail flow. | `trade_range` (min/max size), `frequency` |
| **Arbitrageur** | Compares implied probabilities across bins. If sum deviates from 1.0 or adjacent bins have irrational pricing, trades to correct. | `min_edge` (minimum profit threshold) |
| **Manipulator** | Targets a specific bin. Buys aggressively to inflate price, measures capital needed. Used for manipulation resistance metric. | `target_bin`, `budget` |
| **Late-Round Whale** | Variant of manipulator that only acts in the final 10% of rounds. Deposits heavily into a target bin to inflate its implied probability before resolution. Specifically designed to test the scalar design's vulnerability to last-minute probability manipulation. | `target_bin`, `budget`, `activation_round_pct` (default 0.9) |
| **LP (Passive)** | Deposits liquidity when fee yield exceeds threshold, withdraws when adverse selection losses exceed fees. Tracks P&L per round. | `yield_threshold`, `loss_tolerance` |
| **LP (Rebalancing)** | Same as passive LP but also observes market flow and concentrates position toward high-activity bins. Even though the on-chain protocol doesn't support concentrated liquidity yet, modeling this reveals whether adding that functionality would be worth the complexity. Rebalances every R rounds. | `yield_threshold`, `loss_tolerance`, `rebalance_interval`, `concentration_factor` |

Default agent mix: 45% noise, 25% informed, 13% arbitrageur, 5% manipulator, 2% late-round whale, 5% passive LP, 5% rebalancing LP. Configurable in `config/params.py`.

## Metrics

| Metric | Formula / Method | Output |
|--------|-----------------|--------|
| **Price Accuracy** | KL divergence: `sum(p_true(i) * log(p_true(i) / p_amm(i)))` measured every 10 rounds. Final KL at resolution. Lower = better. | Time series + final value |
| **Convergence Speed** | Number of rounds to reach KL < 0.01 (first crossing). A design that converges in 20 rounds vs 200 is dramatically more useful even if final KL is identical. If KL never reaches 0.01, record total_rounds as the value. | Rounds to convergence |
| **Capital Efficiency** | Execute test trades at 1%, 5%, 10%, 25% of pool depth. Measure `slippage = (avg_price - mid_price) / mid_price`. | Slippage curve per trade size |
| **LP Profitability** | `net_return = (fees_earned - impermanent_loss) / capital_deposited` over full market lifecycle. Track per-round P&L. Separately report passive LP vs rebalancing LP returns. | Distribution of returns across Monte Carlo paths |
| **Manipulation Resistance** | Manipulator spends budget B to move target bin price by X%. `cost_per_percent = B / X`. Higher = more resistant. For the scalar design, additionally run the late-round whale attack: measure how much capital is needed in the final 10% of rounds to capture >50% of the payout pool. | Cost curve: capital needed vs distortion achieved |
| **Resolution Fairness** | For traders within +/-K bins of resolved outcome: `expected_payout_ratio = actual_payout / ideal_payout`. | Payout distribution heat map by distance from resolved bin |

**Default metric weights for composite score**: Resolution Fairness 0.25, Price Accuracy 0.20, Convergence Speed 0.20, Capital Efficiency 0.15, LP Profitability 0.10, Manipulation Resistance 0.10. Weights configurable in `config/params.py`.

Aggregation: report **median, p5, p95** for each metric across Monte Carlo paths. Flag combos where metric distributions overlap (inconclusive).

## Report Output

The HTML report contains:

1. **Leaderboard** — Ranked table of all 25 combos with weighted composite score (see Metrics section for default weights)
2. **Per-metric comparison charts** — Plotly charts showing all 25 combos with error bars (p5/p95), interactive hover/click
3. **Head-to-head matrices** — 5x5 heatmap per metric: rows = designs, columns = fee mechanisms, color = performance
4. **Sensitivity analysis** — Results varying:
   - Number of bins (16, 32, 64, 128, 256)
   - Agent mix (noise-heavy vs informed-heavy)
   - Initial liquidity depth (1k, 10k, 100k USDC)
5. **MiroFish export** — Top 3 combos with structured JSON for knowledge graph seeding
6. **Raw data** — CSV download for all Monte Carlo results

## Technical Details

### AMM Math Port

The Python AMM models faithfully replicate the on-chain Rust math:
- L2-norm invariant: `sum((total_minted - reserves[i])^2) = total_minted^2`
- Integer arithmetic with SCALE = 10^9
- isqrt via Newton's method
- Normal PDF bin weights via same Taylor-4 approximation (for baseline; improved versions for redesigns)

### cadCAD Integration

- **State variables**: reserves, total_minted, agent_positions, agent_balances, fee_accumulators
- **Policies**: one per agent type (informed_trade, noise_trade, arb_trade, manipulate, whale_attack, lp_passive, lp_rebalance)
- **State update functions**: apply_trade, apply_fees, update_positions, rebalance_lps, compute_metrics
- **Parameter sweeps**: `M = {'amm_design': [0,1,2,3,4], 'fee_model': [0,1,2,3,4]}`
- **Monte Carlo**: `N = 1000` runs per parameter combo

### Dependencies

- cadCAD >= 0.5.3
- numpy >= 1.24
- scipy >= 1.11
- pandas >= 2.0
- plotly >= 5.18
- jinja2 >= 3.1 (for HTML report templating)
