# AMM Continuous Market Comparison: Improved BIN vs Paradigm vs LMSR

Briefed comparison of three AMM architectures for continuous-outcome prediction markets.

**Models compared:**

| # | Model | Mechanism | Status |
|---|---|---|---|
| A | **DekantPM Improved BIN** | L2-norm sphere AMM, smooth settlement kernel, passive LPs, **N discrete bins** | Design phase (current BIN deployed) |
| B | **Paradigm Distribution Market** | L2-norm function-space AMM, continuous settlement, passive LPs, **no discrete N** | Theoretical |
| C | **LMSR** (Hanson, original Gnosis PM) | Logarithmic scoring rule, L1-simplex pricing, sponsor-funded, **N discrete outcomes** | Deployed (Gnosis PM, Augur v1) |

**Critical distinction:** DekantPM and LMSR are parameterized by N (bin/outcome count). **Paradigm has no N** — it operates over continuous functions `f: [a,b] → ℝ`. Its properties depend on pool backing B and the trader's chosen distribution width w, not on any discrete resolution parameter.

**Fee assumptions:** DekantPM — 30 bps trade fee (50% to LP → 0.15% effective), 50 bps redemption. LMSR — 2% on winning payouts. Paradigm — same as DekantPM (configurable).

In N-indexed tables below, DekantPM/LMSR values vary with N. Paradigm values are **constant** (marked **†**) — they represent a standard continuous market at reference pool B=$100K with standard concentrated trade width w=10% of range.

---

## 1. Structural Overview

| Property | DekantPM Improved BIN | Paradigm | LMSR |
|---|---|---|---|
| **Geometry** | L2 sphere (N discrete bins) | L2 sphere (continuous functions) | L1 simplex |
| **Invariant** | `Σ x_i² = k²` | `‖f‖₂ = B` | `C(q) = b·ln(Σ exp(q_i/b))` |
| **Outcome space** | N bins (finite, user sets N) | **Continuous** `f: [a,b] → ℝ` | N outcomes (finite) |
| **N parameter** | **Yes** (2–256) | **None** | **Yes** (2+) |
| **Marginal price** | `1/√N` per bin (uniform) | `√w` for spike of width w | `1/N` per outcome |
| **Price sum** | `√N` (> 1) | N/A (continuous density) | `1` always |
| **Settlement** | Smooth kernel (adjacent bins partial) | **Continuous `f(x₀)`** | Winner-take-all ($1 for winning outcome) |
| **LP model** | Passive pool, permissionless | Passive pool, permissionless | **No native LP** — sponsor funds |
| **Short selling** | Yes (v2 signed positions) | Yes (signed functions) | No (long-only shares) |
| **Capital type** | Locked pool, recoverable | Locked pool, recoverable | Subsidy (max loss budget) |
| **On-chain cost** | Medium | High | Low |

---

## 2. Paradigm: N-Independence

Paradigm has **no bins, no outcomes, no N**. Traders hold continuous distribution functions. Properties depend entirely on:
- **B** — pool backing (L2 norm budget)
- **w** — trade's distribution width (fraction of outcome range `[a,b]`)
- **c** — trade size in dollars

**Paradigm formulas** (at uniform state, small trade):

| Metric | Formula |
|---|---|
| Marginal price for spike of width w | `√w` |
| Slippage on $c trade | `≈ c / (B × w)` |
| ROI if correct (small trade) | `≈ 1/√w − 1` (before fees) |
| Break-even probability | `≈ √w` (before fees) |

Note: these match DekantPM's formulas with `N = 1/w`. Both models share L2 geometry — the difference is Paradigm's w is continuous while DekantPM's N is discrete.

### 2.1 Paradigm Properties by Trade Width (B = $100K pool)

| Trade width w | Marginal price | ROI (correct) | Break-even | $1K slippage | B needed for ≤10% slip |
|---:|---:|---:|---:|---:|---:|
| **50%** (half range) | 70.7% | +40% | 71.3% | 2.0% | $20K |
| **12.5%** | 35.4% | +181% | 35.6% | 8.0% | $80K |
| **10%** (standard†) | 31.6% | +214% | 31.9% | 10.0% | $100K |
| **3.1%** | 17.6% | +463% | 17.7% | 32.3% | $323K |
| **1.6%** | 12.6% | +684% | 12.8% | 62.5% | $625K |

**† Standard reference trade:** w=10% of range is used throughout this report as the Paradigm standard concentrated trade. This represents a realistic moderate-width bet on a continuous market. Traders can choose any width — narrower for more leverage (higher slippage), broader for safety (lower slippage).

**Key observation:** A Paradigm trader choosing spike width w=1/N gets identical economics to a DekantPM N-bin single-bin trade. But Paradigm traders are **free to choose any width**, while DekantPM forces trades into 1/N-wide bins.

---

## 3. Capital Requirements

### 3.1 Capital for Standard Market (< 10% slippage on $1K concentrated trade)

| N | DekantPM Improved | LMSR | Paradigm† |
|---:|---:|---:|---:|
| **2** (binary) | **$5K** (pool) | $3.5K (subsidy) | $100K (pool) |
| **8** | **$37K** (pool) | $73K (subsidy) | $100K (pool) |
| **32** | **$138K** (pool) | $537K (subsidy) | $100K (pool) |
| **64** | **$253K** (pool) | $1,310K (subsidy) | $100K (pool) |

† Paradigm B=$100K supports ≤10% slippage on $1K trades at width w≥10%. This is the same pool regardless of what DekantPM/LMSR N is being compared. For narrower trades: $323K for w≥3.1%, $625K for w≥1.6% (see §2.1).

**Paradigm's capital is high for simple markets, low for complex ones.** At N=2, DekantPM needs only $5K — Paradigm's $100K buys a full continuous market that's overkill for a binary question. At N=64, DekantPM needs $253K while Paradigm's $100K already provides 10% slippage at w=10%.

### 3.2 Capital Nature

| | DekantPM | Paradigm | LMSR |
|---|---|---|---|
| **No-trade recovery** | 100% | 100% | 100% (unused subsidy) |
| **Locked?** | Yes, on invariant curve | Yes, under backing constraint | No (but at-risk budget) |
| **Passive LP income** | Yes (fees) | Yes (fees) | **No** (sponsor absorbs all P/L) |
| **Capital scales with** | `~√N` | Trade width: `~1/w` | `~N·ln(N)` |
| **Permissionless LP?** | **Yes** | **Yes** | **No** |

### 3.3 Capital for Equivalent Narrow-Trade Quality

If we require each model to handle a "single-bin equivalent" trade (width = 1/N) at ≤10% slippage on $1K:

| N | DekantPM | Paradigm (w=1/N) | LMSR |
|---:|---:|---:|---:|
| 2 | $5K | $20K | $3.5K |
| 8 | $37K | $80K | $73K |
| 32 | $138K | $323K | $537K |
| 64 | $253K | $625K | $1,310K |

Paradigm needs ~2× DekantPM capital for the same narrow-trade quality. But this is the **wrong comparison** — Paradigm traders don't need to trade at width 1/N. They naturally trade at whatever width suits their belief. DekantPM traders are forced into 1/N-wide bins.

---

## 4. Slippage

### 4.1 At Equal Capital ($250K committed, $1K concentrated trade)

| N | DekantPM | LMSR | Paradigm† |
|---:|---:|---:|---:|
| **2** (binary) | **0.20%** | 0.14% | 4.0% |
| **8** | **1.5%** | 2.9% | 4.0% |
| **32** | **5.5%** | 21.5% | 4.0% |
| **64** | **10.1%** | **52.5%** | 4.0% |

† Paradigm at B=$250K, standard trade w=10%. DekantPM/LMSR compare single-bin/outcome trades (width 1/N). Paradigm's 4% is for a 10%-width trade — a wider bet than single-bin at N≥10.

At N=2, DekantPM has far less slippage (0.20%) because its "single bin" is 50% of the range — much broader than Paradigm's 10% standard trade. At N=64, DekantPM's 1.6%-width bin has much worse slippage (10.1%) than Paradigm's 10%-width trade (4.0%).

### 4.2 Slippage Formulas

| Model | Slippage formula (small trade) |
|---|---|
| DekantPM | `≈ N × c / k` (scales linearly with N) |
| Paradigm | `≈ c / (B × w)` (scales with 1/w, continuous) |
| LMSR | `≈ c / (b × N)` for small trades (degrades at large N) |

At matching trade width (w=1/N, same pool): DekantPM ≈ Paradigm. Both L2.

---

## 5. Trader Profitability

### 5.1 Concentrated Bet ($1K, outcome correct, at standard capital per model)

| N | DekantPM ROI | LMSR ROI | Paradigm† ROI |
|---:|---:|---:|---:|
| **2** (binary) | **+30%** | **+80%** | +214% |
| **8** | **+159%** | **+615%** | +214% |
| **32** | **+399%** | **+2,755%** | +214% |
| **64** | **+614%** | **+5,607%** | +214% |

† Paradigm at B=$100K, w=10% standard trade. This ROI is for a 10%-width bet — the trader bets on ~10% of the range and wins. DekantPM/LMSR compare single-bin/outcome bets (width 1/N). Different trade shapes produce different ROIs.

**Reading this table:** LMSR gives dramatically higher leverage than both L2 models because simplex pricing (`1/N`) makes each outcome much cheaper than sphere pricing (`1/√N`). Paradigm's constant +214% reflects its standard w=10% trade — a trader choosing a narrower spike (e.g., w=1.6%) would see +684% ROI, comparable to DekantPM N=64.

### 5.2 Trader Break-Even Probability

| N | DekantPM | LMSR | Paradigm† |
|---:|---:|---:|---:|
| **2** (binary) | **71.3%** | **51.0%** | 31.9% |
| **8** | **35.6%** | **12.8%** | 31.9% |
| **32** | **17.8%** | **3.2%** | 31.9% |
| **64** | **12.6%** | **1.6%** | 31.9% |

† Break-even for Paradigm w=10% standard trade: trader needs ≥31.9% confidence that outcome falls within the 10% window. For w=50%: 71.3%. For w=1.6%: 12.8%. The formula is `√w / 0.992`.

### 5.3 Broad Distribution Trade (Gaussian, $10K on $100K pool, correct prediction)

This comparison is the most natural for Paradigm. Distribution widths σ are given as fraction of range.

| σ (% of range) | DekantPM Improved | Paradigm | LMSR |
|---:|---:|---:|---:|
| **~8%** (narrow) | **+65%** | **+70%** | **+160%** |
| **~16%** (moderate) | **+15%** | **+25%** | **+75%** |
| **~31%** (broad) | -25% | **+5%** | -10% |
| **~63%** (very broad) | -55% | -20% | -50% |

*DekantPM values from N=64 binned market (σ mapped from bins: 5, 10, 20, 40 out of 64).*

- **LMSR wins narrow-to-moderate** because simplex pricing makes each point cheap — even with WTA settlement.
- **Paradigm wins broad** because continuous `f(x₀)` settlement rewards partial correctness — no WTA cutoff.
- **DekantPM** is between: smooth kernel helps but L2 pricing and bin boundaries limit broad-trade upside.

### 5.4 Partial Correctness ($10K Gaussian σ=16%, outcome 0.3σ from peak)

| Model | ROI |
|---|---:|
| DekantPM (WTA, N=64) | -20% |
| DekantPM Improved (smooth kernel) | -5% |
| **Paradigm** (continuous) | **-2%** |
| LMSR (WTA) | -15% |

Paradigm's continuous settlement `f(x₀)` naturally rewards being close. DekantPM Improved's smooth kernel approximates this.

### 5.5 Trader Summary

| Metric | DekantPM Improved | Paradigm | LMSR |
|---|---|---|---|
| **Concentrated bet ROI** | Moderate (N-dependent) | **Trader chooses** (width-dependent) | **Highest** (simplex) |
| **Broad bet ROI** | Moderate (smooth kernel) | **Best** (continuous settlement) | Good (but WTA limits) |
| **Break-even threshold** | High (`~1/√N`) | **Trader chooses** (`~√w`) | **Low** (`~1/N`) |
| **Probability transparency** | Good (linear display) | **Best** (continuous density) | **Best** (simplex = intuitive) |
| **Partial correctness** | Moderate (kernel) | **Best** (continuous) | None (WTA) |
| **Trade shape freedom** | Fixed 1/N-wide bins | **Any width** | Fixed per-outcome |

---

## 6. LP / Market Maker Profitability

### 6.1 No-Trade Loss

All three models: **0%** loss with zero volume.

### 6.2 Per $1K Informed Trade (trader picks winning outcome/spike, at standard capital)

| N | DekantPM LP loss | LMSR MM loss | Paradigm† LP loss |
|---:|---:|---:|---:|
| **2** (binary) | -$311 (-6.2%) | **-$833** (-24.0%) | -$2,137 (-2.1%) |
| **8** | -$1,600 (-4.3%) | **-$6,300** (-8.6%) | -$2,137 (-2.1%) |
| **32** | -$4,000 (-2.9%) | **-$28,100** (-5.2%) | -$2,137 (-2.1%) |
| **64** | -$6,200 (-2.4%) | **-$57,200** (-4.4%) | -$2,137 (-2.1%) |

† Paradigm at B=$100K, w=10%. The informed trader bets on a 10%-width spike and wins. DekantPM/LMSR: trader bets on a single bin/outcome (width 1/N). DekantPM standard capital varies by N ($5K→$253K); Paradigm is fixed at $100K.

**Percentage comparison is most meaningful:** DekantPM LP loses 2.4–6.2% per informed trade. LMSR MM loses 4.4–24.0%. Paradigm LP loses 2.1%. Paradigm's low percentage reflects both L2 geometry and the wider trade shape (10% vs 1.6% at N=64).

### 6.3 Consecutive $1K Informed Trades Before LP/MM Wipeout

| N | DekantPM LP | LMSR MM | Paradigm† LP |
|---:|---:|---:|---:|
| **2** (binary) | ~16 trades | **~4 trades** | ~47 trades |
| **8** | ~23 trades | ~12 trades | ~47 trades |
| **32** | ~35 trades | ~19 trades | ~47 trades |
| **64** | ~41 trades | ~23 trades | ~47 trades |

† Paradigm at B=$100K, w=10%. $100K / $2,137 ≈ 47.

### 6.4 Expected P/L Per $1K Random Trade (uniform outcome resolution)

| N | DekantPM LP | LMSR MM | Paradigm† LP |
|---:|---:|---:|---:|
| **2** (binary) | **+$343** | +$84 | +$686 |
| **8** | **+$672** | +$88 | +$686 |
| **32** | **+$840** | +$90 | +$686 |
| **64** | **+$885** | +$90 | +$686 |

† Paradigm at B=$100K, w=10%. E[P/L] = 0.9 × $1K − 0.1 × $2,137 = +$686.

DekantPM/Paradigm LPs earn **4–10× more** per random trade than LMSR market makers. Paradigm's +$686 sits between DekantPM N=8 (+$672) and N=32 (+$840), as expected for the w=10% ≈ N=10 equivalent.

### 6.5 Fee Economics

| | DekantPM | Paradigm | LMSR |
|---|---|---|---|
| **Fee model** | 0.15% of volume to LP | Configurable, ~0.15% | 2% on winning payouts |
| **LP fee on $1M volume** | $1,500 | ~$1,500 | ~$3,000–$5,000 |
| **Who earns fees?** | Passive LPs | Passive LPs | **Sponsor only** |
| **Permissionless LP?** | **Yes** | **Yes** | **No** |

### 6.6 LP/MM Summary

| Metric | DekantPM LP | Paradigm LP | LMSR MM |
|---|---|---|---|
| **Adverse selection resilience** | **Good** (L2 limits leverage) | **Good** (L2 + width flexibility) | Poor (high leverage) |
| **Per-trade expected P/L** | **High** | **High** | Low |
| **Capital flexibility** | Locked per N | **Locked, covers all widths** | At-risk budget |
| **Passive/permissionless** | **Yes** | **Yes** | **No** |
| **Rational to participate** | Yes | Yes | Only as sponsor |

---

## 7. Settlement & Expressiveness

| | DekantPM Improved | Paradigm | LMSR |
|---|---|---|---|
| **Settlement type** | Smooth kernel (adjacent bins partial) | **Continuous `f(x₀)`** | Winner-take-all |
| **Partial correctness reward** | Yes (nearby bins pay) | **Yes (best — continuous)** | **None** |
| **Short selling** | Yes (signed positions) | **Yes** (signed functions) | No |
| **Distribution buying** | Atomic, weighted across N bins | **Atomic, any continuous shape** | Composite (buy each outcome) |
| **Trade shape freedom** | Fixed bin width 1/N | **Any width, any shape** | Fixed per-outcome |
| **Exit before resolution** | Sell tokens to AMM | Sell function back | Sell shares back |
| **Bin boundary artifacts** | Minimal (smooth kernel) | **None** (continuous) | N/A (discrete outcomes) |

---

## 8. Head-to-Head at $250K Capital

**Trade definitions:** DekantPM N=64 single-bin trade. Paradigm w=10% standard concentrated trade. LMSR N=64 single-outcome trade. Not equivalent widths — each model's natural concentrated bet.

| Metric | DekantPM (N=64) | Paradigm (w=10%) | LMSR (N=64) |
|---|---|---|---|
| **Effective capital** | $250K pool | $250K pool | $250K subsidy (b≈$60K) |
| **Trade width** | 1.6% of range | 10% of range | 1.6% of range |
| **$1K concentrated slip** | 10.1% | 4.0% | 52.5% |
| **ROI if correct ($1K)** | +614% | +214% | +4,279% |
| **LP/MM loss per $1K informed** | -$6,200 (-2.5%) | -$2,137 (-0.9%) | -$42,800 (-17.1%) |
| **E[P/L] per $1K random** | +$885 | +$686 | +$90 |
| **Broad σ=16% ROI** | +15% | +25% | +75% |
| **Broad σ=31% ROI** | -25% | +5% | -10% |
| **No-trade LP loss** | 0% | 0% | 0% |
| **Passive LP role** | Yes | Yes | No |

**Paradigm at w=1.6% (matching DekantPM bin width):** slip = 25%, ROI = +684%, LP loss = -$6,850 (-2.7%). Nearly identical to DekantPM — both L2 at same width.

---

## 9. Comprehensive Summary

| Dimension | DekantPM Improved | Paradigm | LMSR |
|---|---|---|---|
| **N parameter** | **Yes** (defines resolution) | **None** (continuous) | **Yes** (defines outcomes) |
| **Capital (standard)** | $5K–$253K (scales with N) | ~$100K (single pool, any width) | $3.5K–$1,310K (scales with N) |
| **Capital recoverable?** | Yes | Yes | No (subsidy) |
| **LP no-trade loss** | 0% | 0% | 0% |
| **LP resilience** | **Good** (L2) | **Good** (L2) | Poor (L1 leverage) |
| **LP expected P/L** | **High** (L2) | **High** (L2) | Low |
| **Permissionless LP** | **Yes** | **Yes** | **No** |
| **Trader leverage** | Moderate (1/√N pricing) | **Trader chooses** (1/√w) | **Highest** (1/N pricing) |
| **Trade shape freedom** | Fixed 1/N bins | **Any continuous shape** | Fixed per-outcome |
| **Broad trade viability** | Moderate (smooth kernel) | **Best** (continuous f(x₀)) | Good but WTA limited |
| **Partial correctness** | Moderate | **Best** | None |
| **Settlement** | Smooth kernel | **Continuous** | WTA |
| **Short selling** | Yes | Yes | No |
| **On-chain complexity** | Medium | High | Low |
| **Implementation** | Near-term (base deployed) | Years (theoretical) | Deployed |

---

## 10. Key Trade-Offs

### L2 sphere (DekantPM, Paradigm) vs L1 simplex (LMSR)

| | L2 (DekantPM / Paradigm) | L1 (LMSR) |
|---|---|---|
| Token price (concentrated) | Higher (`1/√N` or `√w`) | **Lower** (`1/N`) |
| Trader leverage | Lower | **Higher** |
| LP/MM adverse selection | **Lower** | Higher |
| LP expected P/L per trade | **~10× higher** | Lower |
| LP sustainability | **Strong** | Weak (sponsor model) |
| Trader attractiveness | Moderate | **High** |

**L2 favours LPs:** moderate trader returns, strong LP economics.
**L1 favours traders:** high leverage, intuitive pricing, but requires large subsidies.

### DekantPM vs Paradigm (both L2)

| | DekantPM Improved | Paradigm |
|---|---|---|
| **Trade shape** | Fixed 1/N bins | **Any width/shape (continuous)** |
| **Settlement** | Smooth kernel | **Continuous `f(x₀)` (better)** |
| **N dependency** | Yes — capital, slippage, ROI all scale with N | **None — pool B serves all widths** |
| **Capital for simple markets** | **Low** ($5K for N=2, $37K for N=8) | Higher ($100K minimum pool) |
| **Capital for complex markets** | High ($253K for N=64) | **Lower** ($100K for w=10% trades) |
| **At equivalent trade width** | ROI, slippage, LP loss **≈ identical** | Same L2 math |
| **Implementation** | **Practical** (vec arithmetic) | Hard (function-space ops) |
| **Time to deploy** | **Near-term** | Years |

The core mathematical economics are identical — both L2 spheres. The differences are:
1. **Paradigm removes the N parameter** — one pool handles all resolutions
2. **Paradigm gives traders width freedom** — no bin discretization
3. **Paradigm's continuous settlement** eliminates bin boundary artifacts
4. **DekantPM is implementable now** — Paradigm requires function-space on-chain ops

---

## References

- [`COMPARE.md`](COMPARE.md) — four-model comparison (DekantPM/Paradigm/Polymarket)
- [`PROFITABILITY_V2.md`](PROFITABILITY_V2.md) — post-fix LP/trader profitability
- [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md) — improved BIN v2 specification
- [`INITIAL_LIQUIDITY_COMPARISON.md`](INITIAL_LIQUIDITY_COMPARISON.md) — capital comparison across models
- [Paradigm — *Distribution Markets*, Dec 2024](https://www.paradigm.xyz/2024/12/distribution-markets)
- [Hanson — *Logarithmic Market Scoring Rules*, 2003](https://mason.gmu.edu/~rhanson/mktscore.pdf)
