# AMM Continuous Market Comparison: Improved BIN vs Paradigm vs LMSR

Briefed comparison of three AMM architectures for continuous-outcome prediction markets.

**Models compared:**

| # | Model | Mechanism | Status |
|---|---|---|---|
| A | **DekantPM Improved BIN** | L2-norm sphere AMM, smooth settlement kernel, passive LPs | Design phase (current BIN deployed) |
| B | **Paradigm Distribution Market** | L2-norm function-space AMM, continuous settlement, passive LPs | Theoretical |
| C | **LMSR** (Hanson, original Gnosis PM) | Logarithmic scoring rule, L1-simplex pricing, sponsor-funded | Deployed (Gnosis PM, Augur v1) |

**Bypass for LMSR:** Since LMSR natively supports N discrete outcomes, we compare an N-outcome LMSR market directly against N-bin DekantPM and N-equivalent Paradigm markets.

**DekantPM N values:** N = 8, 32, 64. **LMSR binary reference:** N = 2 included in all N-specific tables.

**Fee assumptions:** DekantPM — 30 bps trade fee (50% to LP → 0.15% effective), 50 bps redemption. LMSR — 2% on winning payouts (standard Gnosis PM). Paradigm — same as DekantPM (configurable).

---

## 1. Structural Overview

| Property | DekantPM Improved BIN | Paradigm | LMSR |
|---|---|---|---|
| **Geometry** | L2 sphere (discrete bins) | L2 sphere (continuous functions) | L1 simplex |
| **Invariant** | `Σ x_i² = k²` | `‖f‖₂ = B` | `C(q) = b·ln(Σ exp(q_i/b))` |
| **Marginal price** (uniform, per outcome) | `1/√N` | `~1/√N` | `1/N` |
| **Price sum** | `Σ(x_i/k) = √N` (>1) | `~√N` (>1) | `Σ p_i = 1` always |
| **Settlement** | Smooth kernel (adjacent bins partial) | Continuous `f(x₀)` | Winner-take-all (one outcome = $1) |
| **LP model** | Passive pool, anyone can add | Passive pool, anyone can add | **No native LP role** — sponsor funds market |
| **Short selling** | Yes (v2 signed positions) | Yes (signed functions) | No (long-only shares) |
| **Capital type** | Locked pool, recoverable | Locked pool, recoverable | Subsidy (max loss budget) |
| **Probability display** | Linear `x_i/k` (~break-even) | Continuous density (~break-even) | `1/N` (= break-even) |
| **On-chain cost** | Medium | High | Low |

---

## 2. Capital Requirements

### 2.1 Capital for Standard Market (<10% slippage on $1K single-outcome trade)

| N | DekantPM Improved | Paradigm | LMSR |
|---:|---:|---:|---:|
| **2** (binary) | **$5K** (pool) | ~$3.5K (pool) | $3.5K (subsidy) |
| **8** | **$37K** (pool) | ~$26K (pool) | $73K (subsidy) |
| **32** | **$138K** (pool) | ~$97K (pool) | $537K (subsidy) |
| **64** | **$253K** (pool) | ~$177K (pool) | $1,310K (subsidy) |

### 2.2 Capital Nature

| | DekantPM | Paradigm | LMSR |
|---|---|---|---|
| **No-trade recovery** | 100% | 100% | 100% (unused subsidy) |
| **Locked?** | Yes, on invariant curve | Yes, under backing constraint | No (but at-risk budget) |
| **Passive LP income** | Yes (fees) | Yes (fees) | **No** (sponsor absorbs all P/L) |
| **Capital scales with N** | As `~√N` | As `~0.7√N` | As `~N·ln(N)` |

### 2.3 Capital Ratio vs DekantPM (DekantPM = 1.0×)

| N | DekantPM | Paradigm | LMSR |
|---:|---:|---:|---:|
| 2 (binary) | 1.0× | 0.7× | 0.7× |
| 8 | 1.0× | 0.7× | 2.0× |
| 32 | 1.0× | 0.7× | 3.9× |
| 64 | 1.0× | 0.7× | **5.2×** |

At N=2, LMSR capital is comparable to DekantPM/Paradigm. As N grows, LMSR capital explodes because the subsidy budget is `b·ln(N)` and b itself must scale linearly with N for constant slippage.

---

## 3. Slippage

### 3.1 At Equal Capital ($250K committed, single-outcome $1K trade)

| N | DekantPM | Paradigm | LMSR |
|---:|---:|---:|---:|
| 2 (binary) | **0.20%** | ~0.14% | 0.14% |
| 8 | **1.5%** | ~1.0% | 2.9% |
| 32 | **5.5%** | ~3.9% | 21.5% |
| 64 | **10.1%** | ~7.0% | **52.5%** |

### 3.2 At Standard Capital (each model funded for ~10% slip on $1K), varying trade size

**N = 64:**

| Trade size | DekantPM ($253K) | Paradigm (~$177K) | LMSR ($1.31M) |
|---:|---:|---:|---:|
| $100 | ~1.0% | ~1.0% | ~1.0% |
| $1,000 | ~10% | ~10% | ~10% |
| $10,000 | ~71% | ~55% | ~81% |
| $50,000 | ~200%+ | ~150%+ | ~250%+ |

**N = 8:**

| Trade size | DekantPM ($37K) | Paradigm (~$26K) | LMSR ($73K) |
|---:|---:|---:|---:|
| $100 | ~1.0% | ~1.0% | ~1.0% |
| $1,000 | ~10% | ~10% | ~10% |
| $10,000 | ~63% | ~50% | ~55% |

**N = 2 (binary):**

| Trade size | DekantPM ($5K) | Paradigm (~$3.5K) | LMSR ($3.5K) |
|---:|---:|---:|---:|
| $100 | ~1.3% | ~1.0% | ~1.0% |
| $1,000 | ~8% | ~8% | ~10% |
| $10,000 | pool too thin | pool too thin | ~53% |

At equal slippage targets, small-trade behaviour is similar. Large trades diverge: Paradigm best, LMSR worst. At N=2, all three models need only $3.5–5K for standard slippage — binary markets are cheap to run.

---

## 4. Trader Profitability

### 4.1 Single-Outcome Bet ($1K, outcome wins, at standard capital)

| N | DekantPM ROI | Paradigm ROI | LMSR ROI |
|---:|---:|---:|---:|
| **2** (binary) | **+30%** | ~+30% | **+80%** |
| **8** | **+159%** | ~+160% | **+615%** |
| **32** | **+399%** | ~+400% | **+2,755%** |
| **64** | **+614%** | ~+615% | **+5,607%** |

LMSR gives dramatically higher leverage because simplex pricing (`1/N`) makes each outcome much cheaper than sphere pricing (`1/√N`). The gap is smallest at N=2 (where `1/√2 = 0.71` vs `1/2 = 0.50`) and widens with N.

### 4.2 Trader Break-Even Probability (uniform market)

| N | DekantPM | Paradigm | LMSR |
|---:|---:|---:|---:|
| 2 (binary) | **71.3%** | ~71.3% | **51.0%** |
| 8 | **35.6%** | ~35.6% | **12.8%** |
| 32 | **17.8%** | ~17.8% | **3.2%** |
| 64 | **12.6%** | ~12.6% | **1.6%** |

DekantPM/Paradigm traders need much higher conviction per outcome (L2 pricing). LMSR traders need conviction only slightly above `1/N`. At N=2, DekantPM requires 71.3% confidence to break even on a 50/50 market — LMSR needs only 51%.

### 4.3 Broad Distribution Trade (Gaussian, N=64, perfectly correct prediction)

| σ (bins) | DekantPM Improved | Paradigm | LMSR |
|---:|---:|---:|---:|
| 5 (narrow) | **+65%** | **+70%** | **+160%** |
| 10 (moderate) | **+15%** | **+25%** | **+75%** |
| 20 (broad) | -25% | **+5%** | -10% |
| 40 (very broad) | -55% | -20% | -50% |

- **LMSR wins narrow-to-moderate** distributions because simplex pricing makes each bin cheap — even with WTA settlement.
- **Paradigm wins broad** distributions because continuous settlement pays `f(x₀)` — no WTA loss.
- **DekantPM Improved** is between them: smooth kernel helps but L2 pricing limits upside.

### 4.4 Trader Summary

| Metric | DekantPM Improved | Paradigm | LMSR |
|---|---|---|---|
| **Narrow bet ROI** | Moderate | Moderate | **Highest** |
| **Broad bet ROI** | Moderate | **Best (broad)** | Best (moderate σ) |
| **Break-even threshold** | High (~1/√N) | High (~1/√N) | **Low (~1/N)** |
| **Probability transparency** | Good (linear display) | **Best** (continuous) | **Best** (simplex = intuitive) |
| **Distribution expressiveness** | Good (smooth kernel) | **Best** (continuous) | Moderate (WTA limits) |

---

## 5. LP / Market Maker Profitability

### 5.1 Baseline (No Trades)

| | DekantPM | Paradigm | LMSR |
|---|---|---|---|
| **Loss at zero volume** | **0%** | **0%** | **0%** |
| **Fee income at zero volume** | $0 | $0 | $0 |

### 5.2 Per $1K Informed Trade (trader picks winning outcome, at standard capital)

| N | DekantPM LP loss | Paradigm LP loss | LMSR MM loss |
|---:|---:|---:|---:|
| **2** (binary) | -$311 (-6.2%) | ~-$311 | **-$833** (-24.0%) |
| **8** | -$1,600 (-4.3%) | ~-$1,600 | **-$6,300** (-8.6%) |
| **32** | -$4,000 (-2.9%) | ~-$4,000 | **-$28,100** (-5.2%) |
| **64** | -$6,200 (-2.4%) | ~-$6,200 | **-$57,200** (-4.4%) |

LMSR market makers lose **3–9× more** per informed trade because simplex pricing gives traders much higher leverage. Even at N=2, the LMSR MM loses 2.7× more than DekantPM LP per informed trade.

### 5.3 Trades Absorbed Before Wipeout (at standard capital)

How many consecutive $1K perfectly-informed trades before the LP/MM capital is exhausted:

| N | DekantPM LP | Paradigm LP | LMSR MM |
|---:|---:|---:|---:|
| 2 (binary) | ~16 trades | ~11 trades | **~4 trades** |
| 8 | ~23 trades | ~16 trades | ~12 trades |
| 32 | ~35 trades | ~24 trades | ~19 trades |
| 64 | ~41 trades | ~29 trades | ~23 trades |

DekantPM's L2 pricing is a natural defense against adverse selection — the LP survives more informed trades.

### 5.4 Expected P/L Per $1K Random Trade (uniform outcome resolution)

| N | DekantPM LP | Paradigm LP | LMSR MM |
|---:|---:|---:|---:|
| 2 (binary) | **+$343** | ~+$343 | **+$84** |
| 8 | **+$672** | ~+$672 | **+$88** |
| 32 | **+$840** | ~+$840 | **+$90** |
| 64 | **+$885** | ~+$885 | **+$90** |

DekantPM/Paradigm LPs earn **4–10× more** per random trade than LMSR market makers. The L2 geometry retains more value in the pool. Even at N=2, the advantage is 4×.

### 5.5 Fee Economics

| | DekantPM | Paradigm | LMSR |
|---|---|---|---|
| **Fee model** | 0.15% of volume to LP | Configurable, ~0.15% | 2% on winning payouts |
| **LP fee on $1M volume** | $1,500 | ~$1,500 | ~$3,000–$5,000 |
| **LP fee on $10M volume** | $15,000 | ~$15,000 | ~$30,000–$50,000 |
| **Who earns fees?** | Passive LPs | Passive LPs | **Sponsor only** |
| **Permissionless LP?** | **Yes** | **Yes** | **No** |

### 5.6 LP/MM Summary

| Metric | DekantPM LP | Paradigm LP | LMSR MM |
|---|---|---|---|
| **Adverse selection resilience** | **Best** (L2 limits leverage) | **Good** | Poor (high leverage) |
| **Per-trade expected P/L** | **Highest** | **High** | Low |
| **Fee income** | Moderate | Moderate | Higher per dollar |
| **Capital flexibility** | Locked | Locked | At-risk budget |
| **Passive/permissionless** | **Yes** | **Yes** | **No** |
| **Rational to participate** | Yes | Yes | Only as sponsor |

---

## 6. Settlement & Expressiveness

| | DekantPM Improved | Paradigm | LMSR |
|---|---|---|---|
| **Settlement type** | Smooth kernel (adjacent bins partial) | **Continuous f(x₀)** | Winner-take-all |
| **Partial correctness reward** | Yes (nearby bins pay) | **Yes (best)** | **None** |
| **Short selling** | Yes (signed positions) | **Yes** (signed functions) | No |
| **Distribution buying** | Atomic, weighted across bins | Atomic, function-space | Composite (buy each outcome) |
| **Exit before resolution** | Sell tokens back to AMM | Sell function back | Sell shares back |
| **Bin boundary artifacts** | Minimal (smooth kernel) | **None** (continuous) | Moderate (WTA at bin edges) |

---

## 7. Head-to-Head at N = 64, $250K Capital

| Metric | DekantPM Improved | Paradigm | LMSR |
|---|---|---|---|
| **Effective pool/subsidy** | $250K pool | $250K pool | $250K subsidy (b=$60K) |
| **$1K single-outcome slip** | 10.1% | 7.0% | **52.5%** |
| **$10K single-outcome slip** | ~71% | ~55% | **~280%** |
| **Trader ROI (correct, $1K)** | +614% | +615% | +4,279% |
| **LP/MM loss per $1K informed** | -$6,200 | -$6,200 | **-$42,800** |
| **LP/MM E[P/L] per $1K random** | +$885 | +$885 | +$90 |
| **Broad trade σ=10 ROI** | +15% | +25% | +69% |
| **Broad trade σ=20 ROI** | -25% | +5% | -10% |
| **No-trade LP loss** | 0% | 0% | 0% |
| **Passive LP role** | Yes | Yes | No |

---

## 8. Comprehensive Summary

| Dimension | DekantPM Improved | Paradigm | LMSR |
|---|---|---|---|
| **Capital needed (N=64)** | $253K | ~$177K | $1,310K |
| **Capital recoverable?** | Yes | Yes | No (subsidy) |
| **LP no-trade loss** | 0% | 0% | 0% |
| **LP resilience to informed flow** | **Best** | Good | **Poor** |
| **LP expected P/L per trade** | **Highest** | High | Low |
| **Permissionless LP** | **Yes** | **Yes** | **No** |
| **Trader leverage / ROI** | Moderate | Moderate | **Highest** |
| **Trader break-even (N=64)** | 12.6% | ~12.6% | 1.6% |
| **Probability = break-even?** | ~Yes (linear) | ~Yes | **Exact** |
| **Broad trade viability** | Moderate (smooth kernel) | **Best** | Good (simplex) but WTA |
| **Very broad (σ≥20) viability** | Poor | **Only viable model** | Poor |
| **Settlement** | Smooth kernel | **Continuous** | WTA |
| **Short selling** | Yes | Yes | No |
| **On-chain complexity** | Medium | High | Low |
| **Implementation status** | Design (base deployed) | Theoretical | Deployed |

---

## 9. Key Trade-Offs

### L2 sphere (DekantPM, Paradigm) vs L1 simplex (LMSR)

The fundamental difference is **who bears the cost of market-making:**

| | L2 (DekantPM / Paradigm) | L1 (LMSR) |
|---|---|---|
| Token price per outcome (N=64) | ~12.5% (1/√N) | ~1.56% (1/N) |
| Trader leverage | **Lower** | **8× higher** |
| LP/MM adverse selection per trade | **Lower** | **8× higher** |
| Capital needed for same slippage | **Lower** | **~5× higher** |
| LP expected P/L per random trade | **~10× higher** | Lower |
| LP sustainability | **Strong** | Weak (sponsor model) |
| Trader attractiveness | Moderate | **High** |

**L2 favours LPs:** moderate trader returns, strong LP economics, lower capital.
**L1 favours traders:** high leverage, intuitive pricing, but requires large subsidies.

### DekantPM vs Paradigm (both L2)

| | DekantPM Improved | Paradigm |
|---|---|---|
| **Settlement** | Smooth kernel | **Continuous (better)** |
| **Representation** | Finite bins | **Continuous functions (richer)** |
| **Capital efficiency** | ~70% of Paradigm | **Best** |
| **Implementation** | Practical (vec arithmetic) | **Hard** (function-space ops) |
| **Broad trade support** | Good (kernel helps) | **Best** (native) |
| **Time to deploy** | Near-term | Years |

---

## References

- [`COMPARE.md`](COMPARE.md) — four-model comparison (DekantPM/Paradigm/Polymarket)
- [`PROFITABILITY_V2.md`](PROFITABILITY_V2.md) — post-fix LP/trader profitability
- [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md) — improved BIN v2 specification
- [`INITIAL_LIQUIDITY_COMPARISON.md`](INITIAL_LIQUIDITY_COMPARISON.md) — capital comparison across models
- [Paradigm — *Distribution Markets*, Dec 2024](https://www.paradigm.xyz/2024/12/distribution-markets)
- [Hanson — *Logarithmic Market Scoring Rules*, 2003](https://mason.gmu.edu/~rhanson/mktscore.pdf)
