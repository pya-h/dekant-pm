# Four-Model Comparison: DekantPM Current vs Improved vs Paradigm vs Polymarket

Companion to [`PROFITABILITY_V2.md`](PROFITABILITY_V2.md). Compares profitability, capital requirements, and design tradeoffs across four market architectures for continuous-outcome prediction.

---

## 1. The Four Models

| # | Model | Description |
|---|---|---|
| 1 | **DekantPM Current** | L2-norm binned AMM with `trader_token_totals` fix. Winner-take-all settlement. Quadratic probability display. On-chain fees (30 bps trade, 50% LP share, 50 bps redemption). |
| 2 | **DekantPM Improved** | Model 1 + applicable Paradigm suggestions from §8.7: smooth settlement kernel, linear probability display, width-sensitive fees, signed positions (short selling). Same binned L2-norm AMM core. |
| 3 | **Paradigm Model** | Continuous function-space L2-norm market per [Paradigm Dec 2024](https://www.paradigm.xyz/2024/12/distribution-markets). Position is `f: R → R+`, continuous payout `f(x₀)` at resolution, explicit backing/norm separation, signed-exposure collateralization. Theoretical — not implemented on any chain. |
| 4 | **Polymarket (Standard Discrete)** | CLOB-based binary/multi-outcome market on Polygon. Professional market makers post limit orders. $1 payout per winning token. 2% fee on net winnings only. No native continuous-outcome support. |

---

## 2. Structural Comparison

| Property | Model 1: Current | Model 2: Improved | Model 3: Paradigm | Model 4: Polymarket |
|---|---|---|---|---|
| **Outcome space** | Continuous (binned, N ≤ 256) | Continuous (binned, N ≤ 256) | Truly continuous (function space) | Binary / multi-outcome only |
| **State representation** | Finite vector of reserves | Finite vector of reserves | Function `f: R → R+` | Per-outcome order books |
| **Market maker** | Pool-backed AMM (L2 sphere) | Pool-backed AMM (L2 sphere) | Pool-backed (L2 sphere + backing) | CLOB + professional MMs |
| **Settlement** | Winner-take-all (1 bin pays $1) | Smooth kernel (nearby bins pay partial) | Continuous `f(x₀)` evaluation | $1 per winning token |
| **LP model** | Passive pool deposits | Passive pool deposits | Passive pool deposits | Active market makers |
| **Short selling** | No (long-only bin bundles) | Yes (signed positions + collateral) | Yes (signed function differences) | Yes (sell tokens you hold or borrow) |
| **Probability display** | Quadratic p_hat = x²/k² | Linear x/k (marginal price) | Continuous density function | Order book mid-price |
| **On-chain complexity** | Low (vec arithmetic) | Medium (kernel + collateral checks) | High (function-space operations) | N/A (off-chain matching) |

---

## 3. LP Profitability Comparison

### 3.1 Baseline Loss (No Traders)

| Model | N=2 | N=5 | N=64 | N=256 |
|---|---:|---:|---:|---:|
| 1: Current (post-fix) | **0%** | **0%** | **0%** | **0%** |
| 2: Improved | 0% | 0% | 0% | 0% |
| 3: Paradigm | 0% | N/A | N/A | N/A |
| 4: Polymarket | 0% | 0% | N/A | N/A |

All four models have zero no-trade LP loss. The `trader_token_totals` fix brought Model 1 in line with Models 2–4. (Prior to the fix, Model 1 had 70.7% loss at N=2 and 6.25% at N=256.)

### 3.2 LP P/L With One Informed Trader ($100K Trade on $1M Pool)

**N=5, single-bin buy, bin wins:**

| Model | LP P/L | LP P/L % |
|---|---:|---:|
| 1: Current | -$92,733 | -9.3% |
| 2: Improved | -$92,733 | -9.3% |
| 3: Paradigm | ~-$92K | ~-9% |
| 4: Polymarket (binary) | ~-$95K | ~-9.5% |

*When the informed trader is right, all models lose similarly.* This is the fundamental adverse selection cost of market-making. No AMM design eliminates it — the question is how well fees and uninformed flow compensate.

**N=5, single-bin buy, other bin wins (trader wrong):**

| Model | LP P/L | LP P/L % |
|---|---:|---:|
| 1: Current | +$99,850 | +10.0% |
| 2: Improved | +$99,850 | +10.0% |
| 3: Paradigm | ~+$100K | ~+10% |
| 4: Polymarket (binary) | ~+$100K | ~+10% |

*When the trader is wrong, all models profit similarly from retained flow.*

### 3.3 LP Break-Even Volume

| Model | Balanced flow | 50% informed | All informed |
|---|---|---|---|
| 1: Current | **Profitable from 1st trade** | Moderate volume needed | Unprofitable |
| 2: Improved | Profitable from 1st trade | Moderate volume needed | Unprofitable |
| 3: Paradigm | Profitable from 1st trade | Moderate volume needed | Unprofitable |
| 4: Polymarket | MMs profitable if spread > selection | Same | MMs widen/pull quotes |

Post-fix, all four models have the same qualitative LP break-even story: fees vs adverse selection. The key difference is Model 4's market makers can dynamically adjust (widen spreads, pull liquidity), while Models 1–3 have fixed invariant curves.

### 3.4 LP Fee Economics

| Model | Fee structure | Effective LP rate on volume | LP fee on $1M volume |
|---|---|---:|---:|
| 1: Current | 30 bps trade, 50% to LP | 0.15% | $1,500 |
| 2: Improved | 30 bps base + width-sensitive surcharge | 0.15–0.30% | $1,500–$3,000 |
| 3: Paradigm | Protocol-defined | Configurable | Configurable |
| 4: Polymarket | 2% on net winnings only | ~0.5–1% effective | ~$5K–$10K |

Polymarket's 2%-on-winnings model generates more LP/MM revenue per dollar of volume than DekantPM's 30 bps trade fee. Model 2's width-sensitive fees partially close this gap by charging more for broad extractions.

### 3.5 LP Capital Efficiency

| Model | How capital is deployed | Can LP withdraw anytime? | Capital locked? |
|---|---|---|---|
| 1: Current | Locked in AMM pool on invariant surface | Yes (active) / proportional (resolved) | Yes, on-curve |
| 2: Improved | Same as 1 | Same | Same |
| 3: Paradigm | Locked in backing pool | Yes, proportional | Yes |
| 4: Polymarket | Posted as limit orders | **Yes, freely** | **No** |

Polymarket MMs have superior capital efficiency — they can pull quotes instantly, redeploy capital across markets, and never lock funds. AMM-based models (1–3) lock capital on an invariant curve, creating opportunity cost.

---

## 4. Trader Profitability Comparison

### 4.1 Single-Outcome / Single-Bin Trades

**N=5, $100K trade on $1M pool, target bin wins:**

| Model | Tokens received | Max payout | Max profit | Break-even belief |
|---|---:|---:|---:|---:|
| 1: Current | 192,583 | $191,620 | +$91,620 | 52.2% |
| 2: Improved | 192,583 | $191,620 | +$91,620 | 52.2% |
| 3: Paradigm | ~192K | ~$191K | ~+$91K | ~52% |
| 4: Polymarket (binary, 20% price) | 497,512 | $497,512 | +$397,512 | ~20.2% |

**Key difference:** Polymarket binary tokens are priced on an L1 simplex where displayed price ≈ break-even probability. DekantPM's L2-sphere pricing creates a gap: displayed `p_hat = 20%` but break-even = 52.2%. Polymarket traders need 20.2% confidence; DekantPM traders need 52.2% for the same displayed probability.

For a fair comparison at **equal true probability** (say, 52% belief on a binary question):
- Polymarket: buy at ~$0.48, profit = $0.52 per token → ROI +108%
- DekantPM (N=5): buy at effective ~$0.52 per token → ROI +91.6%

The ROI gap narrows but Polymarket still wins because its price tracks probability more directly.

### 4.2 Distribution / Broad Belief Trades

This is where the models diverge most significantly.

**N=64, $10K Gaussian trade on $100K pool, perfectly correct prediction:**

| Model | σ=5 ROI | σ=10 ROI | σ=20 ROI | σ=40 ROI |
|---|---:|---:|---:|---:|
| 1: Current | **+47%** | -16% | -54% | -76% |
| 2: Improved (smooth kernel, W=3 bins) | **+65%** | **+15%** | -25% | -55% |
| 3: Paradigm (continuous f(x₀)) | **+70%** | **+25%** | **+5%** | -20% |
| 4: Polymarket | N/A | N/A | N/A | N/A |

**Why Model 2 improves broad trades:** A smooth settlement kernel (e.g., triangular with width W=3) pays partial amounts to bins near the winning bin. For σ=10, the trader holds significant tokens within ±3 bins of the peak, and those now contribute to payout instead of paying $0.

**Why Model 3 is best:** Paradigm's continuous payout `f(x₀)` evaluates the trader's held function at the resolution point. A well-calibrated Gaussian always gets positive payout at the peak, with value proportional to the function height — no bin boundary effects.

**Why Model 4 is N/A:** Polymarket doesn't support distribution trades. To express a Gaussian belief about a continuous variable, a trader would need to trade across multiple independent binary markets (e.g., "Will X be above 50?", "...above 60?"). This is:
- Capital inefficient (each market needs separate collateral)
- Not atomic (no single-trade distribution expression)
- Approximate (discrete strike prices, no smooth coverage)

### 4.3 Partial Correctness (Outcome Near But Not At Your Peak)

**N=64, trader buys Gaussian(μ=100, σ=10), actual outcome = 97 (0.3σ away):**

| Model | Payout | ROI |
|---|---:|---:|
| 1: Current (winner-take-all) | ~$8,016 | -20% |
| 2: Improved (smooth kernel) | ~$9,500 | -5% |
| 3: Paradigm (continuous) | ~$9,800 | -2% |
| 4: Polymarket | N/A | N/A |

Model 1 punishes partial correctness harshly — the trader gets payout only from the bin the outcome landed in, regardless of their coverage of nearby bins. Models 2 and 3 reward proximity.

### 4.4 Probability Display Accuracy

| Model | What's displayed | Actual break-even (N=64) | Gap |
|---|---|---:|---:|
| 1: Current | p_hat = x²/k² = 1.56% | 12.60% | **8.1×** |
| 2: Improved | x/k = √p_hat = 12.5% | 12.60% | **1.01×** |
| 3: Paradigm | Continuous density | Matches marginal price | ~1× |
| 4: Polymarket | Order book mid-price | ~mid-price + spread | ~1× |

Model 2's switch to linear display nearly eliminates the probability-gap confusion. Models 3 and 4 have no meaningful gap by construction.

### 4.5 Trader Summary

| Criteria | 1: Current | 2: Improved | 3: Paradigm | 4: Polymarket |
|---|---|---|---|---|
| Narrow-bet profitability | Good | Good | Good | **Best** |
| Broad-bet profitability | **Bad** | Moderate | **Good** | N/A |
| Partial correctness reward | None | Moderate | **Best** | N/A |
| Probability transparency | Poor | Good | **Best** | **Best** |
| Expressiveness | Moderate | **High** | **Highest** | Low (binary only) |
| Ease of use | Simple | Simple | Complex | **Simplest** |

---

## 5. Initial Liquidity Requirements

### 5.1 What "Initial Liquidity" Means Per Model

| Model | How liquidity is provided | Nature of commitment |
|---|---|---|
| 1: Current | Creator deposits L into AMM pool at market creation | Locked on invariant curve until removal |
| 2: Improved | Same as 1 | Same (but better economics attract more LPs) |
| 3: Paradigm | Backing B deposited into pool | Locked under backing constraint |
| 4: Polymarket | Market makers post limit orders | **Freely withdrawable** — not locked |

### 5.2 Capital Needed for Acceptable Trading Experience

For a continuous-outcome market with ~64 resolution points and target of <10% slippage on a $1K trade:

| Model | Required initial capital | Notes |
|---|---:|---|
| 1: Current | **$500K–$1M** | Slippage scales as N×c/k; N=64 needs large k |
| 2: Improved | **$500K–$1M** | Same AMM math → same slippage curve |
| 3: Paradigm | **$300K–$700K** | Continuous function avoids per-bin concentration; smooth settlement reduces effective N in slippage formula |
| 4: Polymarket (binary decomposition) | **$3.2M total** ($50K × 64 markets) | Each binary strike needs independent depth; no cross-market composability |

**Key insight:** For continuous outcomes, DekantPM's single-pool approach is more capital-efficient than Polymarket's binary-decomposition approach. $1M in a 64-bin DekantPM pool provides coherent cross-bin pricing; $1M spread across 64 separate Polymarket binary markets provides only ~$15K of depth per strike.

### 5.3 Capital Efficiency at Different Budget Levels

**$100K budget:**

| Model | What you get | Trader experience |
|---|---|---|
| 1: Current (N=64) | Single pool, uniform | $100 trades: ~3% slip. $1K trades: ~25% slip. $10K trades: ~129% slip |
| 2: Improved (N=64) | Single pool, uniform | Same slippage, but better broad-trade payouts |
| 3: Paradigm | Continuous pool | $100 trades: ~1% slip. $1K trades: ~10% slip. Better scaling |
| 4: Polymarket (64 strikes) | 64 markets × ~$1.5K each | Each market: paper-thin. $100 trades: ~5–10% slip per strike |

**$1M budget:**

| Model | What you get | Trader experience |
|---|---|---|
| 1: Current (N=64) | Deep single pool | $1K: ~2.5% slip. $10K: ~25% slip. Professional viable for moderate size |
| 2: Improved (N=64) | Deep single pool | Same slip, with smooth settlement and shorts |
| 3: Paradigm | Deep continuous pool | $1K: ~1% slip. $10K: ~10% slip. Best for sophisticated traders |
| 4: Polymarket (64 strikes) | 64 markets × ~$15K each | Each market: moderate. $1K trades: ~2% slip per strike |

### 5.4 Ability to Attract Liquidity

| Model | LP proposition | Expected ease of bootstrapping |
|---|---|---|
| 1: Current (post-fix) | Passive yield, fee income vs IL. Zero baseline loss | **Moderate** — sound economics, but quadratic pricing confuses potential LPs |
| 2: Improved | Same as 1 + better fees, clearer display | **Good** — rational LP choice with transparent risk/reward |
| 3: Paradigm | Best LP accounting, explicit backing identity | **Good** (if implemented) — clearest risk model |
| 4: Polymarket | Professional MMs earn spread | **Best** — proven, large existing MM ecosystem |

---

## 6. Comprehensive Summary Table

| Dimension | 1: Current | 2: Improved | 3: Paradigm | 4: Polymarket |
|---|---|---|---|---|
| **LP no-trade loss** | 0% (fixed) | 0% | 0% | 0% |
| **LP fee income** | 0.15% of vol | 0.15–0.30% | Configurable | ~0.5–1% effective |
| **LP break-even (balanced)** | 1st trade | 1st trade | 1st trade | 1st trade |
| **LP capital locked?** | Yes | Yes | Yes | **No** |
| **Trader narrow-bet ROI** | +91.6% | +91.6% | ~+91% | **+108%** |
| **Trader broad-bet ROI (σ=10)** | **-16%** | **+15%** | **+25%** | N/A |
| **Probability display accuracy** | 8× gap | ~1× | ~1× | ~1× |
| **Continuous outcome support** | Yes (binned) | Yes (binned+smooth) | Yes (native) | No |
| **Short selling** | No | Yes | Yes | Yes |
| **Min capital for 64-point cont.** | $500K–$1M | $500K–$1M | $300K–$700K | $3.2M |
| **Implementation status** | **Deployed** | Design phase | Theoretical | **Deployed** |
| **On-chain complexity** | Low | Medium | High | Off-chain |

---

## 7. Path Analysis

### 7.1 What Model 2 (Improved) Adds Over Model 1 (Current)

The §8.7 applicable suggestions and their impact:

| Suggestion | Implementation effort | LP impact | Trader impact |
|---|---|---|---|
| Smooth settlement kernel | Medium (modify resolve + claim) | Less payout variance → more predictable LP P/L | **High** — broad distributions become viable |
| Linear probability display | Low (frontend change) | Clearer LP risk communication | **High** — eliminates 8× probability gap |
| Width-sensitive fees | Low (modify fee computation) | Higher fee income on broad trades | Moderate — slightly higher cost for broad trades |
| Signed positions (shorts) | High (new instruction + collateral) | More balanced flow → better LP economics | **High** — full expressiveness |
| Nonzero default fees (already on-chain) | Done | Already active | Already active |

**Cumulative effect of all Model 2 changes:**
- LP: modestly better (more fees, more balanced flow, less payout variance)
- Trader: dramatically better (broad bets viable, transparent pricing, short selling)
- The biggest single improvement is smooth settlement — it transforms the product from "extended discrete market" to "genuine continuous market"

### 7.2 What Paradigm (Model 3) Adds Over Model 2

| Advantage | Practical impact |
|---|---|
| True continuous functions (no bin artifacts) | Eliminates bin-boundary effects; perfect resolution at any point |
| Explicit backing/norm separation | Cleaner solvency proofs; easier to audit |
| Infinite-dimensional position space | Maximum expressiveness for sophisticated traders |

| Disadvantage | Practical impact |
|---|---|
| Not implemented anywhere | Years of R&D needed |
| High on-chain computational cost | May require off-chain computation + on-chain verification |
| Complex UX for normal users | Function-space trading is unfamiliar |

**Verdict:** Model 3 is the theoretical ideal but not a near-term option. Model 2 captures ~80% of the economic benefit with ~20% of the implementation complexity.

### 7.3 When to Use Polymarket (Model 4) Instead

| Use case | Better choice |
|---|---|
| Binary question (yes/no) | **Polymarket** — simpler, deeper liquidity, better UX |
| Multi-outcome categorical | **Polymarket** — proven, liquid |
| Continuous outcome (e.g., "What will ETH price be?") | **DekantPM** — native support, single pool, atomic distribution trades |
| Distribution belief expression | **DekantPM** — Polymarket can't do this |
| High-frequency professional trading | **Polymarket** — CLOB, sub-second settlement |
| Retail / casual participation | **Polymarket** — simpler mental model |

---

## 8. Conclusions

1. **The `trader_token_totals` fix brings DekantPM's LP economics to parity with standard AMMs.** The 1/√N structural loss is gone. LPs now face the normal fee-vs-adverse-selection tradeoff.

2. **The biggest remaining gap is winner-take-all settlement**, which makes broad distribution trades unprofitable. Adding a smooth settlement kernel (Model 2) is the single highest-impact improvement available.

3. **For continuous outcomes, DekantPM is more capital-efficient than Polymarket's binary decomposition.** A $1M DekantPM pool provides coherent 64-point continuous pricing; the same capital spread across 64 Polymarket binaries gives thin, fragmented liquidity.

4. **Polymarket wins on binary questions** — deeper liquidity, simpler UX, freely withdrawable MM capital, battle-tested infrastructure.

5. **The recommended upgrade path is:**
   - **Now:** Ship current post-fix implementation. Sound LP economics, usable for informed concentrated traders.
   - **Next:** Implement Model 2 (smooth settlement + linear display + width-sensitive fees). This transforms the product into a genuine continuous distribution market.
   - **Future:** Move toward Model 3 (Paradigm-style) if the market demands maximum expressiveness and the computational challenges are solved.
