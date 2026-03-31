# Settlement Design & Structure Reference

Comprehensive description of every structure simulated in the DekantPM quantitative AMM simulation framework.

---

## AMM Core (L2-Norm CFAMM)

All AMM-based designs (0-5) share the same constant-function automated market maker. The AMM maintains an **L2-norm invariant** across `N` outcome bins:

```
sum( (total_minted - reserves[i])^2 ) = total_minted^2
```

Each bin `i` has a reserve `reserves[i]`. The implied probability of bin `i` is:

```
P(i) = (total_minted - reserves[i])^2 / total_minted^2
```

**Buy:** A trader deposits collateral (minted across all bins as complete sets), then withdraws excess tokens from the target bin. The invariant is re-solved for the new reserve.

**Sell:** A trader returns tokens to a bin, the invariant determines how much collateral can be released, and that collateral is burned from all reserves.

**Distribution buy/sell:** Same mechanics but weight-proportional across multiple bins, allowing traders to express a full Gaussian belief in one transaction.

The AMM guarantees `sum(P(i)) ~ 1` and supports arbitrary bin counts (16 to 256+).

---

## Design 0: Baseline A (Taylor-4 + WTA)

**Settlement:** Winner-Take-All. The resolved bin receives the entire pool (`SCALE = 10^9`). Every other bin pays out zero.

```
payout[resolved_bin] = SCALE
payout[other]        = 0
```

**Weight computation:** Uses a degree-4 Taylor polynomial approximation of the Gaussian PDF, ported directly from the on-chain Rust implementation (`normal_pdf.rs`):

```
exp(-t/2) ~ 1 - t/2 + t^2/8 - t^3/48 + t^4/384
```

All arithmetic is integer fixed-point at `SCALE` precision with a hard cutoff at `|z| > 5`. This faithfully reproduces on-chain behavior, including its approximation errors.

**Characteristics:**
- Simplest possible settlement; matches current production behavior
- Extreme boundary unfairness: a trader one bin away from the truth gets nothing
- High manipulation incentive: binary win/lose encourages concentrated bets
- On-chain ready (it *is* the current on-chain design)

---

## Design 1: Baseline B (Exact + WTA)

**Settlement:** Identical to Baseline A -- Winner-Take-All.

**Weight computation:** Uses `scipy.stats.norm.pdf` (exact Gaussian) instead of the Taylor-4 polynomial. This isolates the effect of on-chain approximation error from the settlement design itself.

**Purpose:** Scientific control. Comparing A vs B reveals how much the Taylor-4 approximation degrades price accuracy, independent of settlement fairness.

---

## Design 2: Piecewise-Linear (Triangular)

**Settlement:** Triangular payout surface centered on the resolved bin, declining linearly to zero at the bandwidth edge.

```
distance[b]  = |b - resolved_bin|
raw[b]       = max(0, 1 - distance[b] / bandwidth)
payout[b]    = (raw[b] / max(raw)) * SCALE
```

The resolved bin always receives `SCALE`. Bins within the bandwidth radius receive a linearly declining share. Bins beyond the bandwidth receive zero.

**Dynamic bandwidth:**

```
bandwidth = max(1, ceil(num_bins * target_payout_width / range_span))
```

At 256 bins with the default `target_payout_width`, this gives `W ~ 5` -- meaning ~5 bins on each side of the resolution share in the payout.

**Characteristics:**
- Graceful degradation: "close but wrong" traders still earn partial payouts
- Clear boundary: there is a hard cutoff at `distance > bandwidth`
- Moderate fairness improvement over WTA
- Boundary sensitivity: `max_jump = 500M` (half of SCALE, at the edge where payout drops to 0)

---

## Design 3: Kernel-Smoothed (Gaussian)

**Settlement:** Gaussian bell curve centered on the resolved bin. Same bandwidth as piecewise but with exponential (not linear) decay.

```
raw[b]    = exp( -(b - resolved_bin)^2 / (2 * bandwidth^2) )
payout[b] = (raw[b] / max(raw)) * SCALE
```

**Characteristics:**
- Smoothest settlement surface: infinitely differentiable, no hard cutoff
- Broadest participation: even distant bins get small but nonzero payouts via Gaussian tails
- Best resolution fairness in simulation (median 0.24 vs 0.73 piecewise, 0.88 WTA)
- Lowest boundary sensitivity (`max_jump = 282M` vs 500M piecewise, 1B WTA)
- Natural fit: the payout shape matches the Gaussian prior used for weight computation
- Encourages calibrated forecasting over concentrated bets

---

## Design 4: Scalar (Probability-Proportional)

**Settlement:** Payout is proportional to each bin's **final market probability**, regardless of where the market resolved.

```
payout[b] = (final_probability[b] / sum(final_probabilities)) * SCALE
```

**Characteristics:**
- Does NOT reward proximity to truth -- rewards bins that ended with high market price
- Perverse incentive: a manipulator who inflates a wrong bin's probability captures payout proportional to their manipulation
- Late-round whale vulnerability: large last-minute trades can dramatically shift the payout distribution
- Resolution fairness near 1.0 (worst) -- payouts decorrelated from accuracy
- Included as a **stress test** to demonstrate why settlement design matters, not as a viable candidate

---

## Design 5: CRPS (Continuous Ranked Probability Score)

**Settlement:** A proper scoring rule from probability forecasting theory. Each trader's payout depends on how well their *entire position distribution* matches the resolution.

For a trader with holdings `h[0..N-1]` and a market that resolved at bin `R`:

```
CDF[b]       = sum(h[0..b]) / sum(h)
indicator[b] = 1 if b >= R, else 0
CRPS         = sum_b (CDF[b] - indicator[b])^2
max_crps     = num_bins - 1
payout       = ((max_crps - CRPS) / max_crps) * SCALE
```

A perfect forecast (step function at `R`) gives `CRPS = 0` and full `SCALE` payout. A maximally wrong forecast gives zero.

**Characteristics:**
- **Proper scoring rule**: the optimal strategy is to report your true belief distribution
- Per-trader evaluation: different traders receive different payouts based on their individual holdings
- Rewards understanding the full distribution shape, not just the mode
- Most theoretically sound settlement mechanism
- Most complex: requires tracking per-trader holdings throughout the market lifecycle
- In simulation, showed extreme variance (median fairness 9.8, mean 1462) -- outlier sensitivity due to degenerate trader positions

---

## Design 6: CLOB Hybrid (Central Limit Order Book)

**Mechanism:** A traditional order book running in parallel with the AMM reserve system. Each bin has its own independent bid/ask book.

```
Orderbook per bin:
  bids: sorted by price DESC, then timestamp ASC
  asks: sorted by price ASC, then timestamp ASC
```

**Order matching:** Price-time priority. A buy order walks the ask side; a sell order walks the bid side. Partial fills are supported. Resting orders provide passive liquidity.

**Price discovery:** Mid-price per bin = `(best_bid + best_ask) / 2`. Implied probability = `mid_price / SCALE`.

**Settlement:** Uses piecewise-linear payouts (same as Design 2) at resolution.

**Characteristics:**
- Dramatically superior price accuracy: KL divergence 0.20 vs 3.0+ for AMM designs (15x better)
- Near-zero slippage for moderate trades (order book provides direct matching)
- 50x higher manipulation resistance (2.85B vs 54M cost per % distortion)
- No inherent LP profitability mechanism (makers earn spread, not protocol fees)
- Price discovery is per-bin and independent -- no cross-bin arbitrage enforcement by the mechanism itself
- Vulnerable to thin book conditions: low participation = wide spreads and poor execution
- Highest implementation complexity

---

## Fee Mechanisms

All fee models split proceeds between LPs and protocol at a configurable ratio (default 50/50).

### Flat (30 bps)
Constant rate on every trade. `fee = gross_amount * 30 / 10000`. Simple, predictable, no market-state dependency.

### Dynamic
Scales with pool imbalance. Base 30 bps, rising to 100 bps when one outcome dominates. Measures `max(|P(i) - 1/N|)` and scales fee proportionally. Discourages extreme concentration.

### Tiered
Volume discount. Starts at 30 bps, decreases 5 bps per $1M cumulative volume (floor: 1 bps). Rewards high-frequency participants.

### Spread-Based
Penalizes contrarian trades. 30 bps on outcomes above uniform probability; up to 100 bps on outcomes below uniform. Discourages betting against consensus.

### Time-Weighted
Quadratic ramp toward resolution. `fee = 10 + (100 - 10) * (round / total_rounds)^2` bps. Low fees early (encourage participation), high fees late (discourage last-minute manipulation).

**Simulation finding:** Only the Dynamic fee model generated nonzero LP profit (median 636% return). All others produced zero LP earnings.

---

## Agent Types

### Noise Trader (45% of agents)
Random uninformed trades. Acts with 80% probability each round. Trade size: $0.001 -- $100 USDC. Random bin, random direction. Provides background liquidity and tests market stability under noise.

### Informed Trader (25% of agents)
Trades toward the true distribution. Computes mispricing as `true_probs - market_probs`, then executes weight-proportional distribution buys/sells scaled by a conviction factor (default 0.5). Capital limit: $1k USDC per agent. Drives price discovery.

### Arbitrageur (13% of agents)
Exploits cross-bin mispricings. Two strategies: (1) if `sum(P) != 1`, buy the cheapest bin; (2) if adjacent bins differ by >1%, trade the cheaper one. Minimum edge threshold: 0.5%. Position size: 2-5% of capital per action. Enforces inter-bin consistency.

### Manipulator (5% of agents)
Aggressively buys a single target bin (default: middle bin). Budget: $5k per agent, spent in 10 equal tranches across the trading period. Tests manipulation resistance across settlement designs.

### Late-Round Whale (2% of agents)
Dormant until the final 10% of rounds, then spends entire budget ($50k per agent) on a target bin. Stress-tests late-round vulnerability, especially devastating for the Scalar design.

### Passive LP (5% of agents)
Deposits liquidity when fee yield exceeds 0.1% per round. Withdraws if unrealized loss exceeds 5%. Holds position without rebalancing. Tests baseline LP profitability.

### Rebalancing LP (5% of agents)
Same deposit/withdraw logic as Passive LP, but periodically rebalances (every 10 rounds) to concentrate 2x weight on high-activity bins. Tests whether active LP management improves returns.

---

## Metric Definitions

| Metric | Formula | Better |
|--------|---------|--------|
| **Price Accuracy** | KL divergence: `sum(P_true * log(P_true / P_amm))` | Lower |
| **Convergence Speed** | Rounds until KL < 0.01 (capped at total rounds) | Lower |
| **Capital Efficiency** | Slippage: `(avg_price - mid_price) / mid_price` at various trade sizes | Lower |
| **LP Profitability** | `(fees_earned - impermanent_loss) / capital_deposited` | Higher |
| **Manipulation Resistance** | `budget_spent / price_change_pct` (cost per % distortion) | Higher |
| **Resolution Fairness** | Mean absolute payout-ratio error for traders near resolved bin | Lower |
| **Boundary Sensitivity** | Maximum payout jump between adjacent bins at settlement | Lower |
| **Exitability** | Max unwind fraction + slippage + reposition cost after belief shift | Higher unwind, lower slippage |

**Composite score** weights: resolution fairness 20%, price accuracy 15%, convergence 15%, capital efficiency 10%, LP profitability 10%, manipulation resistance 10%, boundary sensitivity 10%, exitability 10%.
