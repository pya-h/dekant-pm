# DekantPM Profitability — Combined Report

A unified analysis of when, how, and how much traders and LPs can profit in the current DekantPM continuous-market implementation, what is structurally broken, how the design compares to Paradigm's distribution-market article, and how forward-looking V2/V3 distribution families would shift the economics.

Compiled and cross-checked against:

- the JS playground in [`specs/math/math_doc_script.js`](../math/math_doc_script.js)
- the on-chain implementation in [`programs/dekant-pm/src/state/market.rs`](../../programs/dekant-pm/src/state/market.rs)
- [Paradigm — *Distribution Markets*, Dec 2024](https://www.paradigm.xyz/2024/12/distribution-markets)

---

## 1. Executive Verdict

The core geometry is interesting and parts of the algebra are correct, but the current design is not yet a logically clean or economically attractive production prediction market.

Bottom line:

- As a mathematical AMM experiment built around an `L2` sphere, it is coherent enough to study.
- As a user-facing prediction market where displayed probabilities should map cleanly to tradable odds, **it is not coherent enough yet.**
- **For traders**, it is only attractive for a narrow class of highly informed, highly concentrated bets.
- **For liquidity providers**, under the current implementation it is generally **not rational to participate for profit**.

The biggest problems are not minor details. They are structural:

1. The displayed quadratic "probability" is **not** the break-even probability a trader actually needs.
2. Broad continuous/distribution trades are usually **bad hold-to-resolution bets** under the current winner-take-all bin-resolution implementation.
3. The current LP accounting/resolution logic creates **deterministic LP loss even when no trader exists**.
4. The documentation and the actual JavaScript implementation **disagree on the default fee regime**.
5. The "market scoring rule" optimality argument in the design doc is **incomplete** (it ignores trading cost).

Sections 4–7 substantiate each of these. Sections 8–10 cover what to do about them.

---

## 2. The Two Ways to Participate

| Mode | What you do | How you earn | How you lose |
|---|---|---|---|
| **Trading** | Buy a distribution `N(mu, sigma)` (or a single bin) with collateral. Hold tokens to resolution or sell early. | Winning-bin tokens pay 1.00 collateral per token at resolution; or sell tokens at a higher price after the market moves. | Wrong-bin tokens pay 0. Fees eat margins. Broad shapes lose hold-to-resolution even when "right". |
| **LP** | Deposit collateral; the protocol mints shares uniformly across all bins. Earn share of trade fees. | LP fee share of every trade + residual reserves of the winning bin at resolution. | Divergence loss: market concentrates into one bin, your spread position loses value. **Plus a baseline `1/√N` loss even with zero traders** under the current implementation. |

---

## 3. What The Mechanism Actually Does

The page and the JS playground define:

- `k`: total minted collateral
- `x_i`: per-bin "positions"
- `h_i = k - x_i`: AMM reserves
- invariant: `sum_i x_i^2 = k^2`
- displayed quadratic probability: `p_hat_i = x_i^2 / k^2`

**Single-bin buy:**

```
k' = k + c_net
x_i' = sqrt(k'^2 - sum_{j != i} x_j^2)
tokens_out = x_i' - x_i
```

**Distribution buy** uses a normalized weight vector `W` and solves:

```
lambda = sqrt((x . W)^2 + ||W||^2 (k'^2 - k^2)) - x . W
tokens_out_j = lambda * W_j / ||W||^2
```

**LP add/remove** scales the state proportionally, which preserves the quadratic display distribution.

So far the algebra is internally consistent. What follows are the parts that are *not*.

---

## 4. Where The Mathematical Story Breaks Economically

### 4.1. The "market scoring rule" optimality argument is incomplete

The design doc argues `x* = k * p / ||p||` from Cauchy-Schwarz and concludes the market is truth-revealing.

That does **not** prove trader truthfulness in the actual implementation, because a trader does not choose `x` for free. A trader pays collateral to move the market from one state to another. The real objective is not "maximize expected payout on the sphere"; it is **"maximize expected payout minus trading cost"**.

That missing cost term matters. It is exactly why some trades that "match the truth" still have negative expected value in practice (Section 5.4 below).

### 4.2. There are three different "probabilities", and they do not agree

The page/implementation creates three different notions of "probability":

1. Quadratic display probability: `p_hat_i = x_i^2 / k^2`
2. "Recovered linear probability" from the doc: `x_i / sum_j x_j`
3. Actual small-trade break-even threshold: approximately `x_i / k`

Only the third one is directly tied to a trader's marginal economics.

For a small single-bin buy with trade fee `tau` and redemption fee `rho`, the trader's break-even belief is approximately:

```
q*_i ~= x_i / (k (1 - tau)(1 - rho)) = sqrt(p_hat_i) / ((1 - tau)(1 - rho))
```

So the trader's required probability is proportional to `sqrt(p_hat_i)`, not `p_hat_i`. **The displayed "probability" materially understates the confidence a trader really needs.** Section 5.1 quantifies this.

### 4.3. The implementation violates its own stated interpretation of `x_i`

The design doc says `x_i` is the position held by traders.

The JS implementation does not maintain that:

- `this.positions` is the AMM state
- `this.traderHoldings[name].holdings` is actual user-held inventory
- LP add/remove scales `this.positions` (lines 530–571 of `math_doc_script.js`)
- LP add/remove does **not** scale `traderHoldings`

So after any LP action, `positions[i] != total trader-held tokens in bin i`. This is not a small bookkeeping quirk; it breaks the doc's interpretation of `x_i` and it propagates into payout logic.

### 4.4. LP resolution underpays relative to actual residual vault

The implementation resolves LPs with `h_win = k - positions[win]` and pays each LP their fraction of `h_win`. But traders are paid based on `traderHoldings[win]`, not `positions[win]`. Because those are not the same thing after LP actions, the system can leave large value stranded.

The clearest proof is the no-trader case (5-bin, initial liquidity 1,000,000, no traders, resolution at any bin):

- payout = `1,000,000 * (1 - 1/sqrt(5)) = 552,786`
- P/L = **`-447,214`**

No trader exists, yet the LP loses 44.7%. This is not normal "impermanent loss" — in the current implementation it is a deterministic transfer to nobody. Economically, this is the single biggest red flag in the whole system.

**This is also a property of the on-chain Solana program, not just the JS playground.** Verified 2026-04-07: `compute_lp_resolved_payout` in `programs/dekant-pm/src/state/market.rs` returns `reserves[winning_outcome] * shares / lp_shares_total`, where on-chain `reserves[i]` is initialized to `L - isqrt(L²/N)` (i.e. `h_i = k - x_i`). So fixing it requires a deliberate accounting change in both layers, not a JS-only patch.

### 4.5. Documentation and code disagree on fees

The page prose says new markets default to:

- trade fee = `30 bps`
- LP fee share = `50%`
- redemption fee = `50 bps`

But `math_doc_script.js` (lines 13–15) sets:

- `DEFAULT_TRADE_FEE_BPS = 0`
- `DEFAULT_LP_FEE_SHARE_PCT = 0`
- `DEFAULT_REDEMPTION_FEE_BPS = 0`

…and the fee modal also says new markets default to zero. Under the actual default code path, **effective LP fee rate = 0**, so LP break-even volume is infinity. Sections 6.3 and 6.4 use the *prose* fee assumptions, but you should treat the actual default fee path as strictly worse.

---

## 5. Trader Profitability

### 5.1. The Hidden Break-Even Threshold (any bin count)

For a small single-bin buy on a uniform market with stated fees `tau = 0.3%, rho = 0.5%`, so `(1 - tau)(1 - rho) ~= 0.992`:

| Bins `N` | Displayed `p_hat` | Actual small-trade break-even |
|---:|---:|---:|
| 5 | 20.00% | 45.08% |
| 16 | 6.25% | 25.20% |
| 32 | 3.13% | 17.79% |
| 64 | 1.56% | 12.60% |
| 128 | 0.78% | 8.91% |
| 256 | 0.39% | 6.30% |

This is the most important trader-facing fact in the system: **if the UI shows 1.56%, the trader still needs roughly 12.6% confidence.** The displayed number is not a tradable probability in the ordinary prediction-market sense.

### 5.2. Concrete Single-Bin Scenario — 5 Bins, $100K trade on $1M pool

Parameters: `N = 5`, `L = 1,000,000`, gross spend `100,000`, trade fee `0.3%`, redemption fee `0.5%`.

Result:

- fee paid now = `300`
- tokens received in target bin = `192,583.32`
- max payout if target bin wins = `191,620.40`
- **max profit = `+91,620.40`**
- min profit = `-100,000`
- break-even true probability = **`52.19%`**
- quadratic display after trade = `33.85%`

This trade can make money, but only if the trader believes the chosen bin wins more than 52.19% of the time. The post-trade UI showing 33.85% would still understate the confidence required. A sharp trader can rationally participate; a naive trader reading the displayed probability as the actual break-even cannot.

### 5.3. Concrete Distribution Scenario — 64 Bins, $10K Gaussian on $100K pool

Parameters: `N = 64`, range `[0, 200]`, bin width `3.125`, `L = 100,000`, uniform `x_i = 12,500`, gross spend `10,000`, fees as above.

**If your prediction is perfectly correct (actual value lies in the peak bin):**

| Your sigma | Peak bin weight | Tokens in peak bin | Payout (after redemption fee) | Profit | ROI |
|---|---:|---:|---:|---:|---:|
| 5 (very narrow — close to single-bin) | 24.95% | ~14,742 | ~$14,668 | +$4,668 | **+47%** |
| 10 (moderate) | 12.47% | ~8,431 | ~$8,389 | -$1,611 | **-16%** |
| 20 (uncertain) | 6.23% | ~4,617 | ~$4,594 | -$5,406 | **-54%** |
| 40 (very uncertain) | 3.11% | ~2,463 | ~$2,451 | -$7,549 | **-76%** |

**This is the central, counter-intuitive fact about the L2-norm continuous AMM:**

> Even with a *perfectly correct* prediction, broad-distribution buys *lose money* on a hold-to-resolution basis. Only narrow distributions (here, `sigma <= 5` for a 64-bin range-200 market) profit when correct.

The reason is the tension flagged in 4.2 above. The marginal price of an infinitesimal token in bin `i` is `x_i / k = 1/sqrt(N) = 12.5%`, **not** the displayed `1.56%`. Tokens cost roughly the square root of what the displayed quadratic probability suggests. Spreading your buy across many bins multiplies that cost while still paying out only on a single winning bin.

A useful approximation for small trades on a uniform market:

```
peak_payout ~= c * (1 - tau)(1 - rho) * sqrt(N) * W_peak_normalized
ROI         ~= (1 - tau)(1 - rho) * sqrt(N) * W_peak_normalized - 1
```

For `N=64` and protocol fees, an *infinitesimal single-bin* buy gives ROI ≈ `0.992 * 8 * 1 - 1 ≈ +693%` — but only if `W_peak_normalized = 1`. For a Gaussian buy you must replace `W_peak` with `1/sum_W`, which collapses very fast as `sigma` grows.

**Wrong-prediction loss table** (`sigma = 10`, claimed `mu = 100`, actual value differs):

| Actual value | Distance from mu | Multiples of sigma | Payout | ROI |
|---|---:|---:|---:|---:|
| 100 (exact) | 0 | 0 | ~$8,389 | -16% |
| 97 (close) | 3 | 0.3 | ~$8,016 | -20% |
| 90 | 10 | 1.0 | ~$5,088 | -49% |
| 80 | 20 | 2.0 | ~$1,136 | -89% |
| 60 | 40 | 4.0 | ~$3 | -100% |
| 150 | 50 | 5.0 | ~$0 | -100% |

**Takeaway:** for broad distributions held to resolution, *every* outcome is a loss — being correct just makes the loss smaller. To profit on a hold-to-resolution basis, you need a narrow distribution AND for that bin to actually win.

### 5.4. Concrete Distribution Scenario — 5 Bins, Gaussian σ=400 on $1M pool

Parameters: same 5-bin / `L = 1,000,000` market as 5.2; buy a Gaussian centered at `3000` with `sigma = 400`; gross spend `100,000`. Weights over bins: `[0.0545, 0.2442, 0.4026, 0.2442, 0.0545]`.

Implementation output:

- tokens received: `[11,915.98, 53,403.71, 88,047.83, 53,403.71, 11,915.98]`
- best possible payout (center bin wins): `87,607.59`
- **max profit: `-12,392.41`**
- min profit: `-100,000`
- probability of finishing positive if held to resolution: **`0%`**

Even if the trader's true belief exactly equals that same Gaussian, expected value is still:

- expected payout = `62,516.74`
- expected P/L = `-37,483.26`

Why? `||W||_2^2 = 0.2873`, but the required threshold here is `0.4508`. The trade is too broad.

**A major result, restated:**

> Broad continuous trades are usually **not** investable hold-to-resolution positions. They are *market-shaping* positions, not good terminal bets.

A trader expressing a smooth distribution under the current logic is often paying money to *move* the market, not buying a profitable resolution claim.

For a distribution buy with normalized weights `W` from a uniform market, the break-even condition `q . W > 1 / ((1 - tau)(1 - rho) sqrt(N))` collapses (when the trader's belief equals `W`) to:

```
||W||_2^2 > 1 / ((1 - tau)(1 - rho) sqrt(N))
```

Broad distributions usually fail this. The 5-bin σ=400 example fails it; the 64-bin `sigma >= 10` examples in 5.3 fail it; only very narrow distributions on many-bin markets pass.

### 5.5. Probability of profit under a calibrated belief

If your submitted distribution genuinely reflects reality, how often do you profit on a hold-to-resolution basis? On the 64-bin / $100K-pool / $10K-trade scenario from 5.3:

| Your sigma | # bins where `q_j` ≥ break-even (~10,050) | Probability of profit (calibrated `N(100, sigma)`) | Best case (peak bin wins) | Worst case (tail bin wins) |
|---|---:|---:|---:|---:|
| 5 | 3 | ~65% | +$4,667 | ~-$10,000 |
| 10 | 0 | 0% | -$1,611 | ~-$10,000 |
| 20 | 0 | 0% | -$5,406 | ~-$10,000 |
| 40 | 0 | 0% | -$7,549 | ~-$10,000 |

**Why so much grimmer than a binary intuition would suggest?** On the L2-norm AMM, broad distributions get fewer tokens per bin than the displayed quadratic probability would imply. For `sigma >= 10` on this market there is *no* bin where holding to resolution is profitable — every realised outcome is a loss. Only very narrow distributions (here, `sigma <= 5`) carry any bins above break-even, and even then the profitable region covers only a few bins around the peak.

**The catch even for `sigma = 5`:** profit requires the actual outcome to land in one of the 3 profitable bins (a window of width ~9.4 around the peak — `±0.94 sigma`). Under a calibrated `N(100, 5)` belief that happens about 65% of the time, but the conditional best case is bounded at ~$4.7K. Roughly 35% of the time you land in a flanking bin and lose $7–10K.

For an **uncalibrated trader** (random `mu`, no edge), every bin is hit ~`1/N` of the time, so EV is strictly more negative than the calibrated row in the same `sigma` column.

### 5.6. Expected value (closed form + numerical)

The hold-to-resolution EV of a perfectly calibrated trader on a fresh uniform market is:

```
EV = (1 - rho) * lambda / S1 - c
   where  S1 = sum_j w_j  (un-normalized Gaussian weights)
          lambda is the AMM buy variable from Section 3
```

Numerically, on the same 64-bin / $100K / $10K-trade scenario:

| Sigma | Expected ROI (calibrated, $10K trade) | Tiny-trade limit (`c -> 0`) |
|---|---:|---:|
| 5 | ~+3.7% | ~+40% |
| 10 | ~-41% | ~-30% |
| 20 | ~-68% | ~-65% |
| 40 | ~-83% | ~-82% |

**Where do the limit numbers come from?** For an infinitesimal trade, all bins have the same marginal price `1/sqrt(N)` and price impact is zero. A short calculation gives the closed form:

```
ROI_inf = (1 - tau)(1 - rho) * sqrt(N) * S2/S1^2 - 1
```

For a Gaussian on a uniform grid with `sigma >> bin width`, the ratios collapse to `S2/S1 = 1/sqrt(2)` and `S1 ~= sigma * sqrt(2*pi) / Δ`, so `ROI_inf` depends only on `sqrt(N) / sigma` (more bins or narrower distribution → more edge, asymptotically).

**Why does the $10K trade do so much worse than the limit?** Because $10K on a $100K pool is not infinitesimal — the trade is 10% of the pool's L1 size, which causes substantial price impact in the targeted bins. The full nonlinear `lambda` is materially smaller than its linear approximation, especially for narrow distributions where the trade concentrates impact on a few bins.

**Bottom line:** on a fresh uniform market, only very narrow Gaussian buys give positive hold-to-resolution EV at realistic trade sizes, and even then the edge is single-digit percent — *not* the hundreds-of-percent figures a naive analysis might suggest. To monetize a broader belief you must *sell out* before resolution, after the market re-prices in your direction. **On a non-uniform market** the edge shrinks further; in a perfectly efficient market, EV = -fees.

### 5.7. Is the page's "Bob partially profits" story credible?

Not as a hold-to-resolution interpretation of the Gaussian trade.

The page's worked example says:

- Alice buys the center bin
- Bob buys `N(3000, 400)`
- resolution lands in the center bin
- Bob partially profits

That is not supported by the mechanism's hold-to-resolution math. For this 5-bin Gaussian shape, even before Alice trades the centered Gaussian buy has negative max profit; after Alice pushes the center bin higher, the Gaussian buy gets even *less* attractive, not more.

So "Bob partially profits" only makes sense if one of these is true:

- Bob sells before resolution
- Bob uses a materially narrower distribution
- Bob's action is described informally rather than literally

As written, the example is misleading.

### 5.8. Trader Conclusion + When to Trade

A logical trader may participate only if at least one of these is true:

- they have a sharp, concentrated edge on a small number of bins
- they understand the true break-even threshold, not just the displayed `p_hat`
- they plan to trade in and out before resolution

| Do this | Because |
|---|---|
| Trade on fresh / uniform markets | Tokens are cheap; your edge over uniform pricing is maximum. |
| Use moderate sigma (10–20 in typical ranges) only if you plan to *exit early* | Balances concentration with coverage, but only viable as a repricing trade. |
| Trade when you believe the market is wrong | In an efficient market, EV = -fees. Profit requires informational edge. |
| Sell before resolution if the market moved your way | Lock in gains without waiting for binary win/lose. |

| Don't do this | Because |
|---|---|
| Use very large sigma on a market with many bins | Tokens spread too thin; even winning barely covers cost. |
| Trade into a market that already reflects your belief | No edge = negative EV after fees. |
| Bet on continuous markets without strong conviction on *location* | Unlike binary markets, being directionally right isn't enough — you need bin-level accuracy. |

A casual trader, or a trader trying to express a broad distribution and *hold to resolution*, should usually avoid this market.

---

## 6. LP Profitability

### 6.1. Baseline LP Loss Is Built In

At uniform initialization, `x_i = k / sqrt(N)`, so LP payout on any resolution is `h_win = k - x_win = k (1 - 1/sqrt(N))`. The deterministic loss fraction is `1 / sqrt(N)`:

| Bins `N` | LP gets back (% of deposit) | Deterministic baseline loss |
|---|---:|---:|
| 5 | 55.28% | -44.72% |
| 16 | 75.00% | -25.00% |
| 32 | 82.32% | -17.68% |
| 64 | 87.50% | -12.50% |
| 128 | 91.16% | -8.84% |
| 256 | 93.75% | -6.25% |

A normal LP asks: *"If nobody trades, why do I lose money?"* Under the current implementation, they do. That alone makes the LP proposition very weak. More bins = lower baseline loss, but never zero.

**This is not inevitable for continuous markets.** It's a consequence of the current accounting and settlement design (see Section 4.4 and the Paradigm comparison in Section 8).

### 6.2. Break-Even Volume Requirement

Using the page's stated fee assumptions (trade fee `0.3%`, LP share `50%`, effective LP fee rate on volume `0.15%`):

```
break_even_volume_multiple ~= (1 / sqrt(N)) / 0.0015
```

| Bins `N` | Break-even volume / pool |
|---|---:|
| 5 | 298.14× |
| 16 | 166.67× |
| 64 | 83.33× |
| 128 | 58.93× |
| 256 | 41.67× |

For a $1M pool, 5 bins needs about $298M of volume; 64 bins needs about $83M. **And this is only to offset the baseline loss, before adverse selection.**

For a $100K pool on a 64-bin market, broken down by realised volume:

| Total Volume | Fee Income | Net Return | Verdict |
|---|---:|---:|---|
| $0 (dead market) | $0 | -12.5% | LOSS |
| $500K (5× pool) | $750 | -11.8% | LOSS |
| $2M (20× pool) | $3,000 | -9.5% | LOSS |
| $5M (50× pool) | $7,500 | -5.0% | LOSS |
| $8.3M (83× pool) | $12,500 | 0.0% | BREAKEVEN |
| $10M (100× pool) | $15,000 | +2.5% | PROFIT |
| $20M (200× pool) | $30,000 | +17.5% | PROFIT |

LPing is only profitable in **high-volume markets**, comparable to DEX LP economics — you need sustained activity to offset the structural position loss.

### 6.3. Actual Code Defaults Make LP Strictly Worse

In the current JavaScript implementation, default fees are zero unless the user manually sets them before creating the market. That means:

- effective LP fee rate = `0`
- LP break-even volume = infinity

So under the actual default code path, **a profit-seeking LP has no rational reason to participate.** The break-even tables in 6.2 are upper-bound estimates assuming the fees the *prose* claims, not the fees the *code* defaults to.

### 6.4. Concrete LP Scenarios

**Scenario A: 5 bins, no traders.** Initial LP deposit `1,000,000`. Payout on resolution = `552,786`. **Net P/L = `-447,214`** (deterministic, no adverse selection).

**Scenario B: 5 bins, one trader buys 100k in the target bin** (page fee assumptions, LP fee share collected = 150).

- if the trader's bought bin wins: LP payout = `460,053`, P/L = `-539,947`
- if any other bin wins: LP payout = `652,636`, P/L = `-347,364`

Even after collecting order flow, the LP still loses heavily in every resolution outcome.

### 6.5. LP Profit/Loss Range

Ignoring fees, LP payout under the current code is `LP payout = k - x_win`. Therefore:

- best case is when the winning bin has very low `x_win` → near `k`
- worst case is when the winning bin has very high `x_win` → near `0`

So LP outcome range relative to original deposit is:

- max loss: can approach `100%`
- profit: only possible if enough net trader flow and/or fee income has increased `k`, **and** the market resolves in a low-`x` bin

That is a very weak, highly path-dependent LP proposition.

### 6.6. LP Risk: Informed Traders (Adverse Selection)

The worst scenario for an LP: a trader with perfect information buys heavily into the eventual winning bin. This shifts reserves *away* from the winning bin (less residual for LP), and the fee earned (a small fraction of the trade) doesn't compensate the reserve shift. LP's post-resolution payout drops significantly. This is the continuous-market analogue of adverse selection in traditional market-making.

### 6.7. LP Conclusion + When LPing Makes Sense

Under the current implementation, a rational LP should generally **not** join for profit. The LP role here looks much more like:

- a subsidy provider
- a market sponsor
- a user willing to lose money to bootstrap trading

than a normal yield-seeking LP.

| Favorable | Unfavorable |
|---|---|
| Popular markets with high trading interest | Niche markets with few traders |
| Markets with many bins (lower baseline loss) | Markets with few bins (higher loss) |
| Markets with long duration | Markets near deadline |
| Markets where traders disagree (volume from both sides) | Markets with strong consensus (one-sided flow) |

---

## 7. How 1:1 Payout Affects Profitability (vs. Proportional)

The system was refactored from proportional (parimutuel) to **1:1 fixed payout**. Here is how this affects each participant.

### 7.1. For Traders

| Aspect | Proportional (old) | 1:1 (current) | Better? |
|---|---|---|---|
| Payout per token | `total_pool / total_winning_tokens` (variable) | Always $1.00 | 1:1 |
| Predictability | Unknown until all claims settle | Known at time of purchase | 1:1 |
| Late-buyer dilution | Yes — late buyers of winning bin dilute early buyers | No — each token always worth $1 | 1:1 |
| Pricing accuracy | Price ≠ expected payout (confusing) | Price ≈ probability ≈ expected payout (coherent) | 1:1 |

Under proportional payout, if Trader A and Trader B both buy the winning bin, they **dilute** each other: more winning tokens means less payout per token. This creates perverse incentives — you might *not* want to buy a bin you believe will win if others also believe it. Under 1:1, there's no dilution.

### 7.2. For LPs

| Aspect | Proportional (old) | 1:1 (current) | Better? |
|---|---|---|---|
| Post-resolution payout | Competes with traders for same pool | Gets own separate pool (residual reserves) | 1:1 |
| Solvency risk | BUG-003: vault could go insolvent | Solvent by design | 1:1 |
| Fee retention | Fees mixed into shared pool | Fees paid separately to LP | 1:1 |

Under the old proportional model, LP's reserves were part of the shared pool that traders also claimed from, causing BUG-003 (vault insolvency). Under 1:1:

```
Trader claims: total_minted - reserves[winning]   (their tokens, at $1 each)
LP claims:     reserves[winning] + fees            (residual, separate)
Total:         total_minted + fees ≤ vault balance ✓ Always solvent
```

### 7.3. Net Effect

**1:1 is strictly better for both traders and LPs.** It increases payout predictability for traders, eliminates solvency risk for LPs, and makes price = probability (cleaner mental model). The overall expected values don't fundamentally change (markets are still zero-sum minus fees), but the variance and risk structure are significantly improved.

> ⚠️ **Note:** the 1:1 refactor fixes solvency, but it does **not** fix the structural LP loss in Section 4.4 / 6.1. The two issues are independent. 1:1 makes the *vault* solvent; the LP-loss issue is about how the residual is *allocated* between LP shares and stranded mass.

---

## 8. Comparison With Paradigm's Distribution Markets

This section compares the current model with [Paradigm's December 2024 article](https://www.paradigm.xyz/2024/12/distribution-markets).

### 8.1. Short Answer

DekantPM does fit the broad family of "continuous-outcome prediction markets", but only in a discretized sense. Direct answer:

- **Yes**, the idea is genuinely aimed at continuous-outcome prediction.
- **No**, the current model is not the same core object as Paradigm's continuous distribution market.
- In its present implementation, it is more similar to an *extended discrete* prediction market than to Paradigm's full continuous function-space model.

So the most accurate label is:

> **An extended discrete market that points toward Paradigm's continuous model, but has not yet become that model.**

### 8.2. Where DekantPM Does Match Paradigm (High Level)

- both aim at a market over a continuous underlying variable rather than a fixed categorical question
- both want traders to express a *whole distribution-shaped view*, not just a single yes/no belief
- both use `L2` geometry as the core mathematical organizing idea
- both treat the AMM reserves as the mirror image of trader-held exposure
- both benefit from restricting the allowed family of distributions for practical onchain implementation

### 8.3. Where DekantPM Diverges From Paradigm's Core

Paradigm's article defines the continuous object as an outcome function `f : R -> R+`, with one token for every possible point `x`, continuous payout `f(x0)` at resolution, separate backing `b`, separate `L2` norm `k`, and an added solvency constraint `max f <= b`.

DekantPM's current implementation does not do that. Instead it:

- replaces the continuum with `N` bins
- stores a finite vector of bin positions rather than a function over `R`
- resolves by selecting **one winning bin** rather than paying a smooth function value at the realized point
- uses complete-set-style discrete token accounting rather than signed function-difference positions
- does not implement Paradigm's explicit trader collateralization rule for signed exposure `g - f`

Paradigm's continuous case is still continuous *at the level of the tradable object*. DekantPM turns the continuous question into a finite-dimensional approximation and then trades that approximation.

### 8.4. The Most Important Structural Differences

**1. Function-space vs finite bins.** Paradigm: position is a function over `R`. DekantPM: a finite vector over `N` bins. So DekantPM is *continuous in the underlying question* but *discrete in the tradable state*.

**2. Continuous payout vs winner-take-all.** Paradigm evaluates the held function at the realized point. DekantPM maps the realized value to one winning bin and pays only that bin. The step-function settlement is exactly why broad distribution buys perform badly when held to resolution (Section 5.4).

**3. Backing and collateralization.** Paradigm explicitly separates backing `b` from norm constant `k` because in infinite-dimensional function space the `L2` norm alone does not bound pointwise payout. Paradigm therefore adds `max f <= b` and requires traders moving from `f` to `g` to collateralize the negative part of `g - f`. DekantPM relies on the finite-dimensional bound `|x_i| <= k`, which is enough for the discrete approximation but not the same machinery.

**4. LP accounting.** Paradigm is very explicit:

- the pool holds `h = b - f`
- the initial LP keeps `f`
- a new LP who adds `y b` of collateral contributes `y h` to the pool and keeps `y f`
- after trades, market holdings + trader holdings still sum to `b`

DekantPM does not preserve this accounting identity. That is exactly *why* the no-trader LP loss in Section 4.4 / 6.1 appears.

### 8.5. Which Differences Are Inevitable, Which Are Choices?

**Inevitable** (caused by binning):

- a finite-bin state can only approximate a continuous function, not equal it
- fixed bins create approximation error and boundary effects
- if the market stores only bin values, it cannot literally be the same function-space object as Paradigm's `f : R -> R+`

**Choices** (not forced by binning):

- winner-take-all single-bin resolution — a binned system could still settle with interpolation or a local payout kernel
- the current LP payout/accounting logic
- showing quadratic `p_hat` as the main user-facing probability
- defaulting new markets to zero fees
- restricting the implementation to long-only nonnegative bin bundles

So: some divergence is inevitable, but **many of the economically important divergences are choices and can be improved without abandoning a binned architecture.**

### 8.6. Which Model Attracts Which Users Better?

| Audience | Better fit | Why |
|---|---|---|
| Sophisticated traders | Paradigm-style | More faithful way to monetize a continuous belief; avoids forcing broad views into single-bin terminal payouts |
| Sophisticated LPs | Paradigm-style | Structurally cleaner accounting; no deterministic no-trader loss |
| Casual / early users | DekantPM (current) | Bins, discrete labels, simple controls feel familiar — but the simplicity is partly purchased by weaker economics |

If the objective is **easiest first demo**, DekantPM's current model can be friendlier. If the objective is **strongest long-run attraction for profit-seeking users**, Paradigm-style is likely better.

### 8.7. What Would Make DekantPM Closer to Paradigm

If you evolve the design in these directions, it becomes much closer to Paradigm's continuous construction:

- treat the state more explicitly as a payout function rather than only bin balances
- replace single winning-bin settlement with a smoother payout kernel around the realized value
- separate backing from norm if you want a more faithful continuous analogue
- implement trader collateralization for signed changes in payoff shape, not only purchases of nonnegative bin bundles
- preserve the invariant that market holdings + all participant-held claims = total backing

If you want to stay computationally practical and still improve trader/LP economics:

- keep bins if needed for implementation, but settle continuously across nearby bins rather than winner-take-all in one bin
- make LP minting/removal preserve a Paradigm-like backing identity
- add explicit max-loss collateral for shape-changing trades so traders can take signed views
- expose a user-facing quote that matches real marginal break-even economics rather than quadratic display alone
- use nonzero default fees and potentially width-sensitive or impact-sensitive fees so LPs are compensated for informed flow
- if you stay with parametric families such as Normal distributions, use that structure to make collateral checks and smooth settlement cheap onchain

This hybrid path makes the system more Paradigm-like without abandoning a finite approximation entirely. See [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md) for one concrete proposal in this direction.

---

## 9. How V2/V3 Distribution Models *Would* Affect Profitability

> **Status:** Forward-looking only. The current MVP supports the **Normal (Gaussian)** family alone. Log-normal, uniform, mixture, and user-drawn PDFs are listed in [PRD §5.3 "Distribution Family Roadmap"](../PRD.md) as **V2 / V3** items and have **no active implementation tasks** at the time of writing. Treat this section as a design preview, not a description of shipped behaviour.

### 9.1. What Would Change

New distribution models don't change the AMM math — they change **how traders express beliefs**. This has indirect but significant effects on profitability.

### 9.2. Log-Normal (V2)

**What it enables:** skewed distributions. *"I think ETH will be around $3,500, but there's more upside risk than downside."*

| Effect on traders | Effect on LPs |
|---|---|
| Better calibration for inherently skewed quantities (prices, populations, durations); a trader who correctly models skew earns more than one forced to use symmetric Gaussian; on price-prediction markets log-normal is the "correct" model → better-calibrated traders → higher EV | More diverse trading → more volume → more fees; better price discovery → market converges faster → less late-stage directional pressure |

### 9.3. Uniform (V2)

**What it enables:** bounded flat distributions. *"I think it'll be between 40 and 60, but I have no idea where within that range."*

| Effect on traders | Effect on LPs |
|---|---|
| Allows expressing genuine uncertainty without wasting weight on tails; more efficient use of collateral when belief is bounded but imprecise; tokens spread evenly across relevant bins → moderate payoff per bin, high probability of *some* payoff (a "hedging within a range" feel) | Uniform bets are less adversarial to LP (less concentrated extraction); encourages casual participants who wouldn't trade with forced Gaussian |

### 9.4. Mixture Distributions (V3)

**What it enables:** multimodal beliefs. *"I think it'll be either around $50 or around $80, but probably not $65."*

| Effect on traders | Effect on LPs |
|---|---|
| Models real-world bimodal scenarios (election results, binary-like outcomes within ranges); a trader who sees two likely clusters can express both in one trade; without mixtures: forced to make two separate trades (each with fees) or pick one | More complex beliefs → more disagreement → more trading → more fees; sophisticated traders attract sophisticated counter-traders |

### 9.5. User-Drawn Arbitrary PDFs (V3)

**What it enables:** complete freedom — draw any curve.

| Effect on traders | Effect on LPs |
|---|---|
| Maximum expressiveness → minimum information loss; optimal for domain experts with complex non-standard beliefs; eliminates the "my belief doesn't fit any parametric family" problem | Attracts the highest-skill traders → highest-quality price discovery, but also: highest adverse-selection risk (experts extract more from LPs) |

### 9.6. Summary of New Models' Impact

| Model | Trader EV change | LP fee change | Overall market health |
|---|---|---|---|
| Log-normal | Higher (better calibration for prices) | Higher (more volume) | Better price discovery |
| Uniform | Slightly higher (less waste) | Higher (more participants) | Broader participation |
| Mixture | Higher (multimodal expression) | Higher (more disagreement) | Deeper markets |
| User-drawn | Highest (zero info loss) | Mixed (volume up, adverse selection up) | Best discovery, highest LP risk |

**Key point:** none of these change the fundamental math (1:1 payout, one winning bin, zero-sum minus fees). They improve the **efficiency of belief expression**, which increases volume and price discovery quality — benefiting both traders (better prices) and LPs (more fees). But **they do not fix the structural problems in Section 4.** Adding log-normal on top of winner-take-all settlement still leaves broad distribution buys as money-losing terminal bets. Distribution-family upgrades and Section-4 fixes are independent axes of improvement.

---

## 10. What Must Be Fixed Before This Looks Production-Ready

Concretely, in priority order:

1. **Make one probability notion economically primary.** Right now `p_hat`, `x/sum x`, and `x/k` all compete. Pick the one that matches small-trade break-even (`x/k`) and surface it.
2. **Stop presenting quadratic `p_hat` as if it were the trader's ordinary break-even probability.** It is at best a "shape display", and labeling it "probability" misleads users.
3. **Rework LP payout** so LPs receive actual residual vault value after trader redemptions, not `k - positions[win]` when `positions[win]` is not actual user-held inventory. (Same fix needed in `compute_lp_resolved_payout` on-chain.)
4. **Align the prose and the code on default fees.** Either flip the code defaults to nonzero, or correct the prose. Today they contradict each other.
5. **Decide whether broad distribution trades are meant to be hold-to-resolution bets or temporary market-moving trades**, and document that intent clearly.
6. **If broad continuous beliefs are supposed to be investable to expiry**, replace single-bin winner-take-all resolution with a smoother payout kernel or pro-rata neighborhood payout.
7. **If `x_i` is supposed to mean trader-held position, implement it that way consistently** — don't let LP actions break the identity.

Until those issues are resolved, the market is more convincing as a research prototype than as a venue where a typical logical user would expect robust risk-adjusted profit.

---

## 11. Final Assessment / Big Picture

### For Traders

```
Profit = (tokens_in_winning_bin × $1.00) - cost - fees

To profit, you need:
  1. Predict the right LOCATION (within ~1 sigma of the winning bin)
  2. Buy at a price below fair value (market mispricing)
  3. Total fees (~0.8%) must be less than your edge
```

- **Informed traders** on mispriced markets: high expected profit (concentrated narrow bets)
- **Uninformed traders**: expected return ≈ -fees. It's gambling.
- **Partially informed traders**: profit scales with calibration quality
- **Narrow sigma**: higher profit IF correct, total loss if wrong
- **Wide sigma**: structurally bad as hold-to-resolution, only viable as repricing trades

### For LPs

```
Net Return = residual_reserves + fee_income - initial_deposit

To break even on baseline loss alone, you need:
  Volume > deposit × (42–298)×   (42× for 256 bins, 298× for 5 bins)
```

- **High-volume markets**: profitable (fees > divergence loss + baseline loss)
- **Low-volume markets**: unprofitable (fees can't cover the 6–45% baseline loss)
- **More bins** = lower baseline loss but also lower per-bin probability
- **Best case**: many traders, balanced flow, long market duration
- **Worst case**: one informed trader extracts value, no volume

### The Market as a Whole

DekantPM continuous markets are **zero-sum minus fees**. Every dollar a trader profits, another participant (trader or LP) loses. The protocol takes ~0.65% per round-trip (0.15% to protocol + 0.5% redemption). The system's value is not in creating profit from nothing — it's in **price discovery**.

### One-Sentence Summary

> DekantPM is a mathematically interesting spherical AMM experiment that points toward continuous distribution markets, but in its current form it still behaves more like an extended discrete market than a clean Paradigm-style continuous market — and several of the most economically important gaps are *design choices*, not consequences of binning.
