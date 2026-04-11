# Initial Liquidity Comparison: BIN-Style Continuous Markets vs Reference Binary/Multi-Outcome Markets

Updated 2026-04-11 after the `trader_token_totals` fix. Companion document to [`PROFITABILITY_V2.md`](PROFITABILITY_V2.md), [`COMPARE.md`](COMPARE.md), and [`DEKANT_REDESIGN_MODELS.md`](DEKANT_REDESIGN_MODELS.md).

The focus here is narrower: given a fixed budget of starting capital, which of the discussed designs can actually keep running, and how do they compare — in both directions — to the binary and multi-outcome reference markets users are already familiar with on Polymarket-style venues.

## 1) Executive Answer

After the `trader_token_totals` fix, the **current BIN implementation** no longer has a deterministic no-trade LP loss. The old `1/sqrt(N)` structural leak — which made current BIN the weakest model for LP economics — is **eliminated**. LPs in a zero-trade market now recover 100% of their deposit at resolution, for all values of `N`.

This fundamentally changes the capital comparison:

- **Before the fix:** Current BIN required 42–471× pool volume just to break even on the structural leak. LPs were subsidizing the protocol regardless of market quality.
- **After the fix:** Current BIN LP economics are qualitatively similar to reference binary/multi markets — profitability depends on fee income vs adverse selection, not on overcoming a geometric tax.

**The remaining capital-efficiency differences** between current BIN and reference markets are now:

1. **Slippage scaling.** Single-bin slippage still scales as `N × c / k` on the L2-sphere AMM. For high-N continuous markets, this means larger pools are needed to support the same trade sizes as reference binary CLOBs.
2. **Winner-take-all settlement.** Broad distribution trades remain EV-negative when held to resolution — a design limitation, not a capital requirement issue.
3. **Locked capital.** AMM pool capital is locked on the invariant curve. Polymarket MMs can withdraw quotes freely.

**A critical, easy-to-miss point:** Dekant's *own* on-chain binary and multi-outcome markets ([`programs/dekant-pm/src/state/market.rs`](../../programs/dekant-pm/src/state/market.rs)) use the **same** L2-norm AMM as the continuous variant. Post-fix, all three market types (Binary, Multi, Continuous) have zero baseline LP loss.

If the goal is to keep BIN structure but further improve capital efficiency, the remaining path is:

1. Use a smooth resolution kernel (not single winning bin only).
2. Expose linear marginal price as primary probability display.
3. Add width-sensitive fees and signed positions.

With those changes (BIN v2, specced in [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md)), capital efficiency becomes even closer to Paradigm-style distribution markets.

---

## 2) Scope, Models, and Assumptions

### Compared Models

Reference models:

- **Reference A:** Binary discrete market (major prediction-market style)
- **Reference B:** Multi-outcome discrete market (`K` outcomes; example `K = 5`)

Continuous/discussed models:

- **Model 1:** Current Dekant BIN (post-fix, winner-take-all bin resolution)
- **Model 2:** Improved BIN (smooth settlement + linear display + signed positions)
- **Model 3:** Parametric cost-function market
- **Model 4:** Basis-function / spline coefficient market
- **Model 5:** Paradigm-style restricted-family function-space market
- **Model 6:** Dynamic pari-mutuel market

### Initial-Liquidity Baseline Used Here

Polymarket does not publish one universal "standard initial liquidity" figure for every market. Informal observation of the site suggests that medium-interest markets typically launch with roughly `$1k – $50k` of seeded/pool depth and scale up via market-maker orderbook depth to the `$100k – $1M+` range as interest grows. Flagship political markets go well beyond that.

For apples-to-apples comparison this report uses equal-capital stress tests at two levels:

- `B_small = $100,000`  (low end of "real market" depth — representative of a typical launch)
- `B_large = $1,000,000` (headline market size — representative of a healthy mature market)

And compares what each discussed model can do with that same starting budget.

**Important interpretation gap.** In Polymarket-style references, "initial liquidity" is mostly posted orderbook depth from market makers — quotes that can be *withdrawn* at any time. There is no single locked AMM pool that must be held on an invariant surface. In the models below (especially current BIN), the budget is locked into an invariant pool and cannot be withdrawn without accounting loss. That is not a fee difference; it is a structural difference in what the money is *doing*. A $100k orderbook quote is closer to a $100k credit line than to a $100k committed pool.

### Fee/Math Baseline (aligned with existing docs)

From [`PROFITABILITY_V2.md`](PROFITABILITY_V2.md) and on-chain defaults in [`constants.rs`](../../programs/dekant-pm/src/constants.rs):

- trade fee `tau = 0.3%`
- redemption fee `rho = 0.5%`
- LP fee share of trade fee = `50%` ⇒ effective LP fee rate `alpha = 0.15% = 0.0015`

(The JS playground defaults to zero fees by contrast. Under that setting LP break-even volume is infinite. This report uses the on-chain defaults everywhere.)

---

## 3) Math Anchors For Current BIN

### 3.1 LP No-Trade Loss: Eliminated

Post-fix, with `trader_token_totals` tracking actual trader-held tokens per outcome, the LP residual at resolution is:

```
reserves[win] = total_minted - trader_token_totals[win]
```

With zero traders, `trader_token_totals[win] = 0`, so LP residual = `total_minted` = full deposit.

| `N` | OLD: Deterministic LP loss (no trades) | NEW: LP loss (no trades) |
|---:|---:|---:|
| 2 | 70.71% | **0%** |
| 3 | 57.74% | **0%** |
| 5 | 44.72% | **0%** |
| 16 | 25.00% | **0%** |
| 32 | 17.68% | **0%** |
| 64 | 12.50% | **0%** |
| 128 | 8.84% | **0%** |
| 256 | 6.25% | **0%** |

### 3.2 LP Break-Even Volume: No Baseline to Overcome

Previously, LPs needed to earn enough fees to offset the `1/sqrt(N)` structural loss:

```
V_break_even / B ~= (1 / sqrt(N)) / alpha
```

**Post-fix, there is no structural loss.** Break-even depends entirely on realized adverse selection:

| Market condition | LP outcome |
|---|---|
| Balanced flow (random traders) | **Profitable from 1st trade** |
| Moderate adverse selection (50% informed) | Break-even at moderate volume |
| Heavy adverse selection (all informed) | Unprofitable (standard market-making risk) |

For reference, the OLD break-even volume multiples that are no longer relevant:

| `N` | OLD break-even `V / B` | NEW break-even `V / B` |
|---:|---:|---:|
| 2 | 471.41× | **~0× (balanced flow)** |
| 5 | 298.14× | ~0× |
| 64 | 83.33× | ~0× |
| 256 | 41.67× | ~0× |

### 3.3 Trader Small-Trade Break-Even Threshold (Single-Bin)

**Unchanged by the fix.** The trader break-even is still:

`p_break_even ~= 1 / ((1 - tau)(1 - rho) sqrt(N))`

Examples:

- `N = 2` → `71.28%`
- `N = 5` → `45.08%`
- `N = 64` → `12.60%`

So the displayed quadratic probability is *not* the true break-even probability. For `N = 2` a trader needs more than `71%` confidence before a single-bin buy becomes EV-positive, even though the pre-trade display shows `50%`.

### 3.4 Sphere vs Simplex Pricing (Still Relevant for Trader Economics)

Reference Polymarket-style markets price outcomes on an `L1` *simplex*: the per-outcome prices sum to `1`, a complete set of one-of-each token costs `$1`, and minting a complete set and holding it is a no-op at resolution — no matter which outcome wins, the holder gets `$1` back. This is *conservation by construction*.

DekantPM's L2-norm AMM instead constrains `sum_i x_i^2 = k^2`, which places state on a *sphere*. At uniform initialization the per-bin value `x_i = k/sqrt(N)`. The "complete set" analogue — what a uniform LP is effectively holding — sums to `k * sqrt(N)` on the `L1` axis, but the vault only holds `k`.

**Post-fix, this no longer causes LP losses** — the `trader_token_totals` tracking ensures the LP receives the true vault residual regardless of the sphere/simplex mismatch. However, the sphere geometry still has **two ongoing effects**:

1. **Probability display:** `p_hat = x²/k²` is quadratic, not marginal price `x/k`. This misleads traders about break-even thresholds (see §3.3).
2. **Slippage scaling:** Single-bin slippage scales linearly with `N` (see §3.5), which is more aggressive than simplex-based AMMs.

### 3.5 Slippage As The Other Side Of "Initial Liquidity"

LP sustainability is only half the question. The other half is: *what does a single trade feel like* at a given initial capital? Slippage on the current BIN L2-norm AMM for a small single-bin buy has the closed-form first-order approximation

```
relative move in x_i  ≈  N * c / k
```

on a uniformly initialized pool, where `c` is the trade size, `k` is the pool size, and `N` is the bin count. The `N` factor here is the critical thing: **BIN single-bin slippage scales *linearly* with bin count at fixed pool size**. More bins are not "finer" in the sense a user might expect from an AMM — they are dramatically *more* slippage-heavy for concentrated trades.

Verified numerically on a `$100k` pool with a single-bin buy (`reserves` computed exactly, no approximation):

| `N` | Trade `$100` | Trade `$500` | Trade `$1,000` | Trade `$10,000` |
|---:|---:|---:|---:|---:|
| 2 (Dekant Binary) | 0.05% over mid | 0.25% over mid | 0.49% over mid | 4.36% over mid |
| 64 (Continuous) | 3.05% over mid | 13.78% over mid | 24.98% over mid | 128.57% over mid |
| 64 ($1M pool) | 0.31% over mid | 1.55% over mid | 3.05% over mid | 24.98% over mid |

Reading across: at `$100k` pool size with `N = 64`, a `$1,000` single-bin trade already pays roughly `25%` over the pre-trade marginal price, and a `$10,000` single-bin trade pays `128%` over mid (i.e. the trader buys tokens at more than double the advertised price). Scaling the pool up by `10×` to `$1M` reduces slippage by `10×` but does not change the fundamental `N * c / k` law.

Reference Polymarket-style CLOB venues route `$1,000` binary trades with typically sub-percent slippage and `$10,000` trades with low-single-digit slippage, because market makers post and pull orderbook depth freely and do not pay a locked-pool invariant cost on every fill.

**Post-fix, the uncomfortable trade-off has changed character:**

- Low `N` (e.g. `N = 2` Dekant Binary) now has zero LP loss **and** best trader slippage — the best overall point for binary questions.
- High `N` (e.g. `N = 256`) also has zero LP loss but the *worst* trader slippage on single-bin trades.
- The old "no value of N is simultaneously good for LPs and traders" conclusion **no longer holds** — the LP side is fixed for all N. The remaining tradeoff is purely on the trader side: more bins = better resolution granularity but worse per-bin slippage.

**Implication for equal-capital comparison:** at `B_small = $100k`, current BIN continuous markets give acceptable slippage for genuinely retail-sized trades (`$10–$100`) but degrade rapidly for the `$1k+` range where sophisticated traders operate. Polymarket-style CLOB venues comfortably cover the `$1k–$10k` range without meaningful impact.

---

## 4) Equal-Capital Stress Test Against Reference Models

### 4.1 LP/Market Sustainability Under Same Starting Budget

| Model | No-trade capital decay | Practical continuation condition | What happens at `B_small = $100k` |
|---|---|---|---|
| Reference Binary (Polymarket CLOB) | None | Active two-sided depth; market makers can withdraw at any time | Runs cleanly; quality depends on active depth, not structural burn |
| Reference Multi-outcome (`K=5`, Polymarket CLOB) | None | Deeper distributed liquidity across outcomes | Runs cleanly; depth fragmentation is the main issue |
| Current BIN — Dekant Binary (`N=2`) | **None (post-fix)** | Fee income vs adverse selection | Runs cleanly. LP P/L is normal market-making |
| Current BIN — Dekant Multi (`N=5`) | **None (post-fix)** | Fee income vs adverse selection | Runs cleanly. LP P/L is normal market-making |
| Current BIN — Continuous (`N=64`) | **None (post-fix)** | Fee income vs adverse selection | Runs cleanly. Single-bin slippage is the limiting factor, not LP loss |
| Improved BIN (v2) | None | Same as current BIN, with better broad-trade economics | Can run at $100k comparably to discrete markets |
| Parametric cost-function | No pool decay (sponsor model) | Sponsor loss budget must be calibrated to depth/slippage | Can run, but there is no native permissionless LP yield role |
| Basis-function (pool-backed) | None if accounting is correct | Fees must beat adverse selection | Can run; typically better capital usage than coarse bins for smooth beliefs |
| Paradigm-style restricted family | None under backing identity | Fees vs adverse selection; cleaner collateral accounting | Best continuous LP structure among discussed LP-based models |
| Dynamic pari-mutuel | No pool-decay requirement | Buy-side can run with low startup; sell-side liquidity is weak | Can start with low capital, but exit/sell behavior is fragile |

### 4.2 What Actually Happens If Each Model Is Forced To Use "Reference-Style" `$100k` Capital

Suppose every model launches with exactly `B_small = $100,000` and waits. This is the scenario: create a continuous Dekant market with the same initial liquidity a Polymarket binary would typically have, and see what happens.

- **Reference binary (Polymarket CLOB).** Main risk is thin orderbook spreads; no deterministic capital loss. A dead market simply stays quoted with wide spreads, or makers pull their quotes and the market becomes illiquid but not underwater.
- **Reference multi-outcome (Polymarket, `K=5`).** Same as binary, but depth is fragmented across five outcome books. Thinness shows up as wider per-outcome spreads, not as deterministic loss to the makers.
- **Current BIN — Dekant Binary (`N=2`).** Post-fix, this runs cleanly. If zero trades happen, the LP recovers the full `$100k` at resolution. With trades, LP P/L is the standard market-making tradeoff: earns fees vs loses to informed flow.
- **Current BIN — Dekant Multi (`N=5`).** Same as binary — zero baseline loss. LP is viable at `$100k`.
- **Current BIN — Continuous (`N=64`).** LP-side is viable at `$100k`. The **slippage problem** is the main issue: a `$1,000` single-bin trade sees ~25% slippage (§3.5). This limits the market to retail-sized trades or distribution buys (which have their own hold-to-resolution EV problem under winner-take-all).
- **Current BIN — Continuous (`N=256`).** Same LP economics as N=64 (zero baseline loss). But per-bin slippage is even worse, and traders are pushed into broad distribution buys that are themselves EV-negative when held to resolution (see [`PROFITABILITY_V2.md` §4.3](PROFITABILITY_V2.md)).
- **Improved BIN / Basis / Paradigm-style.** Runs at `$100k` comparably to current BIN post-fix. The main advantages are: smooth settlement makes broad trades viable, signed positions enable short selling, and linear display eliminates probability confusion.
- **Parametric cost-function.** Runs cleanly for traders with `$100k` as a sponsor loss budget (e.g. LMSR with `b ~= $100k`), but that money is a market-maker subsidy, not refundable LP capital. There is no permissionless LP role, so "initial liquidity" and "LP yield" are decoupled in a way that does not match Polymarket-style expectations.
- **Dynamic pari-mutuel.** Can accept unlimited buy-side volume with tiny startup capital (zero operator risk). But exit liquidity is weak: a user who wants to sell before resolution often cannot, and `$100k` does not change that. Better for one-shot "subscribe to an outcome" UX than for continuous trading.

**Summary verdict at `B_small = $100k`:** Post-fix, **all Dekant BIN variants** (binary, multi, and continuous) can run at `$100k` with sound LP economics. The binding constraint for continuous markets is no longer LP sustainability — it is **slippage** on concentrated trades. Current BIN, improved BIN, basis-function, and Paradigm-style all work at this budget. Cost-function works with a sponsor model. Dynamic pari-mutuel works for buy-only use cases.

### 4.3 Large-Budget Scaling Check (`B_large = $1,000,000`)

Post-fix, LP sustainability is no longer the concern at any budget level. The question is purely about **trading quality** at `$1M`:

| Market type | `N` | LP baseline loss | Single-bin slippage on $10K trade | Broad-trade viability |
|---|---:|---:|---:|---|
| Dekant Binary | 2 | 0% | ~4.36% | N/A (only 2 outcomes) |
| Dekant Multi | 5 | 0% | ~9.7% | Moderate (few bins) |
| Dekant Continuous | 64 | 0% | ~24.98% | Poor (winner-take-all) |
| Dekant Continuous | 256 | 0% | ~62.5% | Poor (winner-take-all) |

Volume figures for fee income: at `$1M` pool and `0.15%` LP fee rate, `$50M` of balanced volume yields `$75,000` in LP fees (7.5% return). This is achievable on flagship markets but not on quiet ones.

For improved BIN / basis / Paradigm-style, the main advantage at scale is that **smooth settlement** makes broad distribution trades viable, unlocking a category of trading that current BIN cannot support.

---

## 5) Trader Profitability Comparison Under Equal Budget

### 5.1 Current BIN (winner-take-all) vs Reference Binary/Multi

**Unchanged by the fix.** From [`PROFITABILITY_V2.md`](PROFITABILITY_V2.md):

- **Single-bin concentrated trade (best case):** on a `$1M` pool with `N=5`, a `$100k` single-bin buy has max profit `+$91,620` (≈ `+91.6%` ROI) — but only if the trader's true belief for that bin exceeds `52.19%`. The pre-trade display shows `20%`; the real threshold is above that.
- **Broad distribution trade (worst case):** on `N=64`, a `$10k` Gaussian buy with `σ ≥ 10` is EV-negative even when perfectly correct. Only `σ ≤ 5` (effectively near single-bin) is profitable.

Compared with reference binary/multi:

- Binary/multi are easier to reason about: share price ≈ probability ≈ expected payout, with a simple `$1` terminal payout on the winning outcome.
- Current BIN is more demanding. The trader needs sharper *location* precision (not just directional conviction) and must also understand that the displayed quadratic probability is *not* the break-even probability. Section 3.3 quantifies that gap.
- With equal capital and equal sophistication, many traders logically prefer reference binary/multi over current BIN for anything that isn't a razor-thin concentrated view.

**Best-case vs worst-case trader summary at `$100k` of market capital:**

| Trader behaviour | Current BIN (`N=64`) | Reference binary (Polymarket) |
|---|---|---|
| Best case (sharp, correct single-bin) | Can earn multi-hundred-percent ROI if actually right; break-even requires confidence >>> displayed `p_hat` | Can earn up to `(1 - displayed price) / displayed price` if correct; edge is roughly (your belief − market belief) |
| Worst case (broad shape held to resolution) | Near-total loss even when "right at peak" | Still a simple 0 or 1 payoff; losing on a correct broad belief is structurally impossible |
| Average informed trader | Positive EV only in narrow corner of parameter space | Positive EV in a much larger corner of parameter space |
| Average uninformed trader | ≈ `−(τ + ρ)` per round trip | ≈ `−(τ + ρ)` per round trip |

### 5.2 Improved BIN / Basis / Paradigm-style

For these models, trader economics improve because settlement and exposure are smoother:

- Broad beliefs are not punished as harshly as in single-winning-bin settlement (a smooth resolution kernel pays out something to bins *near* the winning value).
- Sell-side behaviour is cleaner because AMM state and trader-held state stay consistent after LP actions.
- The consensus display can stay cumulative and informative instead of collapsing onto the last trade.

Against reference binary/multi:

- For genuinely continuous questions ("what will GDP be", "what will ETH cost"), these models are superior for informed traders who can express distribution-shaped beliefs directly.
- For casual users, binary/multi may still attract more participation because of the simpler mental model. Expressiveness cuts both ways.

---

## 6) LP Profitability Comparison Under Equal Budget

### 6.1 Current BIN (Post-Fix)

Current BIN LP economics are now fundamentally sound:

- **Baseline loss at zero volume: 0%** (was `1/sqrt(N)`, now eliminated by `trader_token_totals` fix)
- **LP P/L is the standard market-making tradeoff:** fee income vs adverse selection loss
- **If default LP fees are zero (JS playground default), LP break-even requires infinite volume** — this is a configuration issue, not a structural one

**Scenario at `B_small = $100k`, current BIN, `N = 5`:**

- Market gets no volume, resolves → LP payout `$100,000`, net P/L **`$0`**
- One informed trader buys `$10k` heavily into the eventual winning bin → LP loses adverse selection (~`-$9.3k`) but earns trade fee (`$15`). Net LP P/L ≈ **-$9,285** (if trader is right) or **+$9,985** (if trader is wrong)
- With random trader flow: LP is profitable from the first trade

**Scenario at `B_small = $100k`, current BIN, `N = 64`:**

- Same zero baseline loss
- LP P/L depends on trade flow quality
- At balanced `$500k` volume: LP fee income ≈ `$750` (0.75% return)
- At balanced `$5M` volume: LP fee income ≈ `$7,500` (7.5% return)

### 6.2 Improved BIN / Basis / Paradigm-style

If settlement is also smooth:

- No deterministic LP capital burn (same as post-fix current BIN)
- LP outcome is the normal market-maker problem: fee income vs informed-flow loss
- **Additionally:** smooth settlement reduces LP payout variance (LP P/L is less dependent on which exact bin the outcome lands in)
- Width-sensitive fees improve LP economics on broad trades
- Signed positions create more balanced flow, improving LP fee collection

**At `B_small = $100k`, improved BIN:**

- zero volume → LP sits flat, collecting nothing but losing nothing (same as current BIN post-fix)
- balanced two-sided flow of `V` at LP fee rate `0.15%` → LP earns `0.0015 × V` in fees
- at `V = 50× pool` (`$5M`), LP fee income ≈ `$7,500` (7.5% of deposit) — same base economics as current BIN, but improved by width-sensitive fees
- smooth settlement reduces the variance of LP loss conditional on adverse selection

### 6.3 Comparison to Reference Binary/Multi (Polymarket) At `$100k`

Reference binary/multi markets do not have committed LP capital in the AMM sense — they have orderbook depth from market makers who can withdraw quotes at will. A rough equivalent:

- **Worst case:** a Polymarket maker quoting `$100k` of depth faces adverse selection (informed flow picks off stale quotes) but can always pull orders. Capital loss is bounded by how stale the quotes were before the pull.
- **Best case:** same maker earns the spread on every executed trade. On a busy market they might turn over the book many times a day.

**Post-fix, the qualitative comparison has changed dramatically:**

| LP metric | Current BIN (post-fix) | Polymarket CLOB MM |
|---|---|---|
| No-trade loss | **0%** | 0% |
| Can withdraw before resolution? | Proportional withdrawal | **Yes, freely** |
| Fee income model | 0.15% of volume | Spread × volume |
| Adverse selection risk | Standard | Standard (but can pull quotes) |
| Capital efficiency | Locked on curve | **Freely deployable** |

The remaining advantage of Polymarket MMs is **capital flexibility** — the ability to pull and redeploy capital. This is structural to CLOB vs AMM, not specific to the BIN model.

---

## 7) Why Users Might Pick Reference Binary/Multi Instead

### Traders

- easier payoff intuition (yes/no or finite outcomes)
- no hidden "display probability vs true break-even" confusion
- often stronger immediate depth visibility in mature discrete venues

### LPs / Market Makers

- ~~no deterministic no-trade capital decay~~ (post-fix, current BIN also has zero baseline loss)
- easier inventory/risk tooling ecosystem
- can withdraw capital at any time (CLOB advantage)
- less model-complexity risk

**Post-fix, the LP-side reasons to prefer Polymarket are weaker.** The main remaining advantages are capital flexibility and ecosystem maturity, not fundamental economic superiority.

For **improved BIN** or **Paradigm-style**, user-choice pressures toward reference markets become even weaker — smooth settlement and linear pricing address the trader-side concerns too.

---

## 8) Which Model Is Most Viable At Similar Initial Capital?

If the goal is **continuous market + native LP role + realistic profitability** at capital levels comparable to reference binary/multi:

1. Paradigm-style restricted-family function-space — best long-term
2. Improved BIN (smooth settlement + linear display) — best near-term
3. **Current BIN (post-fix, winner-take-all)** — viable, LP economics sound, slippage and settlement are the main limitations
4. Basis-function pool-backed market — good intermediate option
5. Parametric cost-function (good trader market, weak native LP role)
6. Dynamic pari-mutuel (good operator-risk profile, weak LP/sell-side profile)

**Post-fix ranking change:** Current BIN moved from #4 (non-viable for LPs) to **#3** (viable, with known design limitations). The gap between current BIN and improved BIN is now about **trading quality** (settlement, display, expressiveness), not **LP sustainability**.

If the goal is **short-term mass onboarding with simple UX**, reference binary/multi still has an adoption edge.

---

## 9) Practical Recommendations To Further Improve BIN Capital Efficiency

The `trader_token_totals` fix has achieved the most impactful single change — eliminating the deterministic LP loss. The remaining improvements, in priority order:

1. **Replace winner-take-all settlement** with a local smooth payout kernel — this unlocks broad-distribution trading, the product's key differentiator.
2. **Expose economically correct marginal break-even quote** in UI — reduces the 8× probability display gap.
3. **Keep nonzero default LP fees** (already done on-chain; align JS playground).
4. **Add width-sensitive fees** so broad distribution changes pay proportionally more.
5. **Add signed-shape collateralization** (short selling) to enable richer trader expression and more balanced flow.
6. **Use adaptive/non-uniform bins** so capital is concentrated where users actually trade.

With these changes, BIN can run with roughly the same order of startup capital as reference binary/multi markets, while preserving continuous-market advantages.

---

## 10) Final Bottom Line

With equal initial investment, the **current BIN** model — in all three of its Dekant flavours (Binary, Multi, Continuous) — is now **LP-viable** after the `trader_token_totals` fix. The old `1/sqrt(N)` structural leak is eliminated, and LP economics are qualitatively comparable to reference binary/multi markets.

The **remaining capital-efficiency gaps** are:

- **Slippage:** High-N continuous markets need larger pools than binary CLOBs to support the same trade sizes (the `N × c / k` law).
- **Settlement:** Winner-take-all punishes broad-distribution trades, reducing the product's appeal for continuous-outcome expression.
- **Capital lock:** AMM pool capital is locked on the invariant curve, unlike CLOB market-maker capital.

The **improved BIN (v2 path)** specced in [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md) addresses the settlement and display gaps, and the **Paradigm-style** model remains the strongest long-term target for continuous markets.

The simplest way to summarize this whole document in one line:

> *The `trader_token_totals` fix eliminated the structural LP loss. The remaining capital-efficiency question for BIN markets is slippage on concentrated trades and winner-take-all settlement on broad trades — both addressable with smooth settlement and better UX.*

---

## References

- [`PROFITABILITY_V2.md`](PROFITABILITY_V2.md) — post-fix trader/LP profitability report (same folder)
- [`COMPARE.md`](COMPARE.md) — four-model comparison (same folder)
- [`DEKANT_REDESIGN_MODELS.md`](DEKANT_REDESIGN_MODELS.md) — alternative model analysis (same folder)
- [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md) — BIN v2 proposal (same folder)
- [`programs/dekant-pm/src/state/market.rs`](../../programs/dekant-pm/src/state/market.rs) — on-chain market logic (confirms Binary/Multi/Continuous share the same L2-norm AMM)
- [`programs/dekant-pm/src/constants.rs`](../../programs/dekant-pm/src/constants.rs) — on-chain fee defaults (30bps trade, 50bps redemption, 50% LP share)
- [Paradigm — *Distribution Markets*, Dec 2024](https://www.paradigm.xyz/2024/12/distribution-markets)
