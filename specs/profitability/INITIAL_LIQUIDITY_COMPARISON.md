# Initial Liquidity Comparison: BIN-Style Continuous Markets vs Reference Binary/Multi-Outcome Markets

Companion document to [`PROFITABILITY.md`](PROFITABILITY.md) and [`DEKANT_REDESIGN_MODELS.md`](DEKANT_REDESIGN_MODELS.md). The focus here is narrower: given a fixed budget of starting capital, which of the discussed designs can actually keep running, and how do they compare — in both directions — to the binary and multi-outcome reference markets users are already familiar with on Polymarket-style venues.

## 1) Executive Answer

If we compare all discussed models under the same initial capital budget, the **current BIN implementation** is the weakest for LP economics because it has a built-in no-trade LP loss of `1/sqrt(N)` before any adverse selection. That flaw is geometric — it comes from pricing on an `L2` sphere while reference markets price on an `L1` simplex (see §3.4) — and it is independent of volume.

Relative to reference binary and multi-outcome markets (Polymarket-style discrete markets), the current BIN model can run technically, but it usually needs much higher volume multiples to keep LPs whole. Trader profitability is also more fragile for broad beliefs under winner-take-all bin settlement.

**A critical, easy-to-miss point:** Dekant's *own* on-chain binary and multi-outcome markets ([`programs/dekant-pm/src/state/market.rs`](../../programs/dekant-pm/src/state/market.rs)) use the **same** L2-norm AMM as the continuous variant. So when this doc says "current BIN", it applies equally to *all three* Dekant market types, not only to continuous. A Dekant-native binary market (`N = 2`) has a baseline LP loss of `1 - 1/sqrt(2) ≈ 70.71%` — worse than any continuous configuration. See §3.5.

If the goal is to keep BIN structure but make it competitive at similar starting capital, the necessary path is:

1. Fix LP accounting identity (remove deterministic no-trade LP loss).
2. Use a smooth resolution kernel (not single winning bin only).
3. Keep nonzero default LP fees.

With those changes (BIN v2, specced in [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md)), capital efficiency becomes much closer to reference discrete markets and materially closer to Paradigm-style distribution markets.

---

## 2) Scope, Models, and Assumptions

### Compared Models

Reference models:

- **Reference A:** Binary discrete market (major prediction-market style)
- **Reference B:** Multi-outcome discrete market (`K` outcomes; example `K = 5`)

Continuous/discussed models:

- **Model 1:** Current Dekant BIN (winner-take-all bin resolution)
- **Model 2:** Improved BIN (fixed accounting + smooth settlement)
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

From [`PROFITABILITY.md`](PROFITABILITY.md) assumptions (these match the on-chain defaults in [`constants.rs`](../../programs/dekant-pm/src/constants.rs)):

- trade fee `tau = 0.3%`
- redemption fee `rho = 0.5%`
- LP fee share of trade fee = `50%` ⇒ effective LP fee rate `alpha = 0.15% = 0.0015`

(The JS playground defaults to zero fees by contrast. Under that setting LP break-even volume is infinite. This report uses the on-chain defaults everywhere.)

---

## 3) Math Anchors For Current BIN (Critical)

These are the key formulas already established in the merged profitability report:

### 3.1 LP deterministic no-trade loss

For uniform initialization:

`no_trade_loss_fraction = 1 / sqrt(N)`

Examples:

| `N` | Deterministic LP loss at uniform, no trades |
|---:|---:|
| 2 | 70.71% |
| 3 | 57.74% |
| 5 | 44.72% |
| 16 | 25.00% |
| 32 | 17.68% |
| 64 | 12.50% |
| 128 | 8.84% |
| 256 | 6.25% |

### 3.2 LP break-even volume multiple (using on-chain default fees)

`V_break_even / B ~= (1 / sqrt(N)) / alpha`

With `alpha = 0.0015`:

| `N` | Break-even volume multiple `V / B` |
|---:|---:|
| 2 | 471.41× |
| 3 | 384.90× |
| 5 | 298.14× |
| 16 | 166.67× |
| 64 | 83.33× |
| 128 | 58.93× |
| 256 | 41.67× |

### 3.3 Trader small-trade break-even threshold (single-bin)

`p_break_even ~= 1 / ((1 - tau)(1 - rho) sqrt(N))`

Examples:

- `N = 2` → `71.28%`
- `N = 5` → `45.08%`
- `N = 64` → `12.60%`

So the displayed quadratic probability is *not* the true break-even probability. For `N = 2` a trader needs more than `71%` confidence before a single-bin buy becomes EV-positive, even though the pre-trade display shows `50%`.

### 3.4 Why this leak exists: sphere vs simplex pricing

Reference Polymarket-style markets price outcomes on an `L1` *simplex*: the per-outcome prices sum to `1`, a complete set of one-of-each token costs `$1`, and minting a complete set and holding it is a no-op at resolution — no matter which outcome wins, the holder gets `$1` back. This is *conservation by construction*.

DekantPM's L2-norm AMM instead constrains `sum_i x_i^2 = k^2`, which places state on a *sphere*. At uniform initialization the per-bin value `x_i = k/sqrt(N)`. The "complete set" analogue — what a uniform LP is effectively holding — sums to `k * sqrt(N)` on the `L1` axis, but the vault only holds `k`. The `(sqrt(N) - 1)` excess is exactly the "stranded mass" that becomes baseline LP loss at resolution.

Restated compactly:

- Simplex markets price the *truth* (`sum p = 1`). Complete sets are self-funding.
- Sphere markets price the *shape* (`sum p^2 = 1`). Uniform shapes under-fund themselves by a factor of `1/sqrt(N)` relative to what a winner-take-all payout demands.

This is not a fee problem and cannot be papered over with larger initial liquidity. It is the root cause of the `1/sqrt(N)` structural loss and it applies to the on-chain program and the JS playground identically.

### 3.5 Dekant's Binary and Multi-Outcome markets are BIN markets too

`MarketType::Binary` (exactly `N = 2`), `MarketType::MultiOutcome` (`3 ≤ N ≤ 32`), and `MarketType::Continuous` (`2 ≤ N ≤ 256`) **all use the same `L2`-norm AMM** ([`market.rs::initialize`](../../programs/dekant-pm/src/state/market.rs#L170)). They only differ in which `N` values are allowed and in how the resolved outcome is determined. That means the `1/sqrt(N)` baseline LP loss applies to every Dekant market type, not just "continuous":

| Dekant market type | `N` | Deterministic baseline LP loss |
|---|---:|---:|
| Binary | 2 | **70.71%** |
| Multi-Outcome (smallest allowed) | 3 | 57.74% |
| Multi-Outcome (example) | 5 | 44.72% |
| Multi-Outcome (max) | 32 | 17.68% |
| Continuous (low bin count) | 16 | 25.00% |
| Continuous (typical) | 64 | 12.50% |
| Continuous (max) | 256 | 6.25% |

A reference binary market on Polymarket has **no** such deterministic leak (see §3.4 and §4). A Dekant-native binary market with `N = 2` has the **worst** leak in the entire table. This inverts the usual intuition that "binary is simple and safe".

Everywhere below, read "current BIN" as applying to all three market types.

---

## 4) Equal-Capital Stress Test Against Reference Models

### 4.1 LP/Market Sustainability Under Same Starting Budget

| Model | No-trade capital decay | Practical continuation condition | What happens at `B_small = $100k` |
|---|---|---|---|
| Reference Binary (Polymarket CLOB) | None | Active two-sided depth; market makers can withdraw at any time | Runs cleanly; quality depends on active depth, not on structural LP burn |
| Reference Multi-outcome (`K=5`, Polymarket CLOB) | None | Deeper distributed liquidity across outcomes | Runs cleanly; depth fragmentation is the main issue, not deterministic capital loss |
| Current BIN — Dekant Binary (`N=2`) | **−70.71% deterministic LP loss** | Needs ~`471×` pool volume | No-trade LP loss `−$70,710`; needs ~`$47.1M` volume to break even |
| Current BIN — Dekant Multi (`N=5`) | **−44.72% deterministic LP loss** | Needs ~`298×` pool volume | No-trade LP loss `−$44,721`; needs ~`$29.8M` volume to break even |
| Current BIN — Continuous (`N=64`) | **−12.5% deterministic LP loss** | Needs ~`83×` pool volume | No-trade LP loss `−$12,500`; needs ~`$8.33M` volume to break even |
| Improved BIN (v2) | ~0% (if accounting identity is restored) | LP P/L driven by fees vs adverse selection | Can run at $100k comparably to discrete markets; risk is flow quality and bin granularity |
| Parametric cost-function | No pool decay (sponsor model) | Sponsor loss budget must be calibrated to depth/slippage | Can run, but there is no native permissionless LP yield role |
| Basis-function (pool-backed) | ~0% if accounting is correct | Fees must beat adverse selection | Can run; typically better capital usage than coarse bins for smooth beliefs |
| Paradigm-style restricted family | ~0% under backing identity | Fees vs adverse selection; cleaner collateral accounting | Best continuous LP structure among discussed LP-based models |
| Dynamic pari-mutuel | No pool-decay requirement | Buy-side can run with low startup; sell-side liquidity is weak | Can start with low capital, but exit/sell behavior is fragile |

### 4.2 What Actually Happens If Each Model Is Forced To Use "Reference-Style" `$100k` Capital

Suppose every model launches with exactly `B_small = $100,000` and waits. This is the scenario the user asked about directly: create a continuous Dekant market with the same initial liquidity a Polymarket binary would typically have, and see what breaks.

- **Reference binary (Polymarket CLOB).** Main risk is thin orderbook spreads; no deterministic capital loss. A dead market simply stays quoted with wide spreads, or makers pull their quotes and the market becomes illiquid but not underwater.
- **Reference multi-outcome (Polymarket, `K=5`).** Same as binary, but depth is fragmented across five outcome books. Thinness shows up as wider per-outcome spreads, not as deterministic loss to the makers.
- **Current BIN — Dekant Binary (`N=2`).** Catastrophic. The LP immediately sits on a `−$70,710` unrealized baseline loss (70.71% of the pool). Breakeven requires `$47.1M` of sustained two-sided trading volume before any profit. A real binary market with `$100k` of Polymarket-style liquidity almost never sees `$47M` of volume. This configuration is effectively a donation.
- **Current BIN — Dekant Multi (`N=5`).** Still bad. Unrealized baseline loss `−$44,721`, requires `$29.8M` volume to break even. Most multi-outcome markets never reach that.
- **Current BIN — Continuous (`N=64`).** Marginally viable. Baseline loss `−$12,500`; `$8.33M` break-even volume is achievable on a popular market, not on a quiet one.
- **Current BIN — Continuous (`N=256`).** Least bad of the current configurations. Baseline loss `−$6,250`; `$4.17M` break-even volume. But now individual-bin granularity is finer than most user beliefs, so traders are pushed into broad distribution buys that are themselves EV-negative when held to resolution (see [`PROFITABILITY.md` §5.3](PROFITABILITY.md)).
- **Improved BIN / Basis / Paradigm-style.** Runs at `$100k` comparably to a Polymarket discrete market. No deterministic leak; LP P/L is the normal fee-vs-adverse-selection tradeoff. These are the only LP-native models that compete with the reference at this budget.
- **Parametric cost-function.** Runs cleanly for traders with `$100k` as a sponsor loss budget (e.g. LMSR with `b ~= $100k`), but that money is a market-maker subsidy, not refundable LP capital. There is no permissionless LP role, so "initial liquidity" and "LP yield" are decoupled in a way that does not match Polymarket-style expectations.
- **Dynamic pari-mutuel.** Can accept unlimited buy-side volume with tiny startup capital (zero operator risk). But exit liquidity is weak: a user who wants to sell before resolution often cannot, and `$100k` does not change that. Better for one-shot "subscribe to an outcome" UX than for continuous trading.

**Summary verdict at `B_small = $100k`:** only *Improved BIN*, *Basis-function*, *Paradigm-style*, and *cost-function-with-sponsor* can realistically run a market at the same initial capital as a Polymarket reference market. Every flavour of current BIN — binary, multi, and continuous — requires pool volumes that are unrealistic relative to `$100k` of launch capital, with the binary case being the most absurd.

### 4.3 Large-Budget Scaling Check (`B_large = $1,000,000`)

For current BIN, the core constraints scale linearly with pool size:

| Market type | `N` | Baseline LP loss at `B_large` | Break-even volume |
|---|---:|---:|---:|
| Dekant Binary | 2 | −$707,107 | ~$471M |
| Dekant Multi | 5 | −$447,214 | ~$298M |
| Dekant Continuous | 64 | −$125,000 | ~$83.3M |
| Dekant Continuous | 256 | −$62,500 | ~$41.7M |

Volume figures at this scale exist on a handful of flagship Polymarket events per year but are not the median market experience.

For improved BIN / basis / Paradigm-style, there is no deterministic no-trade burn if accounting is correct, so scaling is primarily about:

- slippage targets
- fee rate
- realized adverse selection

### 4.4 Slippage As The Other Side Of "Initial Liquidity"

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

**The uncomfortable trade-off this creates:**

- Low `N` (e.g. `N = 2` Dekant Binary) has the *worst* LP structural leak (`70.71%`) but the *best* trader slippage.
- High `N` (e.g. `N = 256`) has the *best* LP structural leak (`6.25%`) but the *worst* trader slippage on single-bin trades.
- Broad distribution buys avoid single-bin slippage but suffer the worse-than-naive-expectation hold-to-resolution EV documented in [`PROFITABILITY.md` §5.3](PROFITABILITY.md).

**There is no value of `N` at which current BIN is simultaneously good for LPs and good for traders.** Paradigm-style and basis-function models break this trade-off because their invariants do not scale with `N` in the same way and their settlement kernels smooth the broad-buy EV cliff.

**Implication for equal-capital comparison:** at `B_small = $100k`, current BIN continuous markets give acceptable slippage for genuinely retail-sized trades (`$10–$100`) but degrade rapidly for the `$1k+` range where sophisticated traders operate. Polymarket-style CLOB venues comfortably cover the `$1k–$10k` range without meaningful impact.

---

## 5) Trader Profitability Comparison Under Equal Budget

### 5.1 Current BIN (winner-take-all) vs reference binary/multi

From the existing scenarios in [`PROFITABILITY.md`](PROFITABILITY.md):

- **Single-bin concentrated trade (best case):** on a `$1M` pool with `N=5`, a `$100k` single-bin buy has max profit `+$91,620` (≈ `+91.6%` ROI) — but only if the trader's true belief for that bin exceeds `52.19%` ([`PROFITABILITY.md` §5.2](PROFITABILITY.md)). The pre-trade display shows `20%`; the post-trade display shows `33.85%`. The real threshold is above both.
- **Broad distribution trade (worst case):** on the same `$1M` 5-bin pool, a `$100k` Gaussian-shaped buy with `σ=400` has max profit `−$12,392` — the trader loses money *even if the center bin wins* ([`PROFITABILITY.md` §5.4](PROFITABILITY.md)). Probability of finishing positive under hold-to-resolution: `0%`.
- **On 64 bins:** Gaussian buys with `σ ≥ 10` on a `$100k` pool are EV-negative under a perfectly calibrated belief ([`PROFITABILITY.md` §5.3](PROFITABILITY.md)). Only `σ ≤ 5` (effectively "near single-bin") is profitable.

Compared with reference binary/multi:

- Binary/multi are easier to reason about: share price ≈ probability ≈ expected payout, with a simple `$1` terminal payout on the winning outcome.
- Current BIN is more demanding. The trader needs sharper *location* precision (not just directional conviction) and must also understand that the displayed quadratic probability is *not* the break-even probability. Section 3.3 quantifies that gap.
- With equal capital and equal sophistication, many traders logically prefer reference binary/multi over current BIN for anything that isn't a razor-thin concentrated view.

**Best-case vs worst-case trader summary at `$100k` of market capital:**

| Trader behaviour | Current BIN (`N=64`) | Reference binary (Polymarket) |
|---|---|---|
| Best case (sharp, correct single-bin) | Can earn multi-hundred-percent ROI if actually right; break-even requires confidence >>> displayed `p_hat` | Can earn up to `(1 - displayed price) / displayed price` if correct; edge is roughly (your belief − market belief) |
| Worst case (broad shape held to resolution) | Near-total loss even when "right at peak" (§5.3 above, §5.4 in the referenced doc) | Still a simple 0 or 1 payoff; losing on a correct broad belief is structurally impossible |
| Average informed trader | Positive EV only in narrow corner of parameter space | Positive EV in a much larger corner of parameter space |
| Average uninformed trader | ≈ `−(τ + ρ)` per round trip + occasional catastrophic broad-buy losses | ≈ `−(τ + ρ)` per round trip |

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

### 6.1 Current BIN

Current BIN is structurally hardest for LPs:

- baseline loss at zero volume: `1/sqrt(N)` (applies to all three Dekant market types)
- requires unusually high volume multiples to break even (§3.2)
- if default LP fees are zero (JS playground default), LP break-even is unreachable

**Worst case at `B_small = $100k`, current BIN, `N = 5`:**

- market gets no volume, resolves immediately → LP payout `$55,279`, net P/L **`−$44,721`**
- one informed trader buys heavily into the eventual winning bin → LP payout shrinks further (adverse selection) while fees earned (`50%` of `0.3%` of the trader's notional) do not offset the reserve shift ([`PROFITABILITY.md` §6.4 Scenario B](PROFITABILITY.md))

**Best case at `B_small = $100k`, current BIN, `N = 5`:**

- market gets massive two-sided volume (`V ≫ $29.8M`), resolves in a low-`x` bin (one that traders *sold off* rather than bought into) → LP collects fees on the way up and retains most of the vault on the way out
- this best case requires both `V / B > 298×` and a fortunate resolution location; it is possible but rare
- the *expected* return at any fixed `V` is still dragged down by the baseline `1/sqrt(N)` leak, so even in a high-volume market with balanced flow the LP only sees positive P/L after crossing the break-even volume threshold

**Worst/best case at `N = 2` (Dekant Binary):**

- worst case: `−$70,710` no-trader loss on `$100k`
- best case: requires >$47M of two-sided volume just to break even on the structural leak — effectively, the LP cannot win on a `$100k` binary pool under any realistic volume profile

This is exactly why a rational LP may choose reference binary/multi-style markets (or any model without deterministic no-trade decay) over current BIN.

### 6.2 Improved BIN / Basis / Paradigm-style

If accounting identity is fixed and settlement is smooth:

- no deterministic LP capital burn in the no-trade case
- LP outcome becomes the normal market-maker problem: fee income vs informed-flow loss
- break-even depends on realized adverse selection, not on guaranteed protocol-level leakage

**Worst case at `B_small = $100k`, improved BIN:**

- one informed trader buys heavily into the eventual winning bin → LP eats the adverse-selection loss, partially offset by trade fee income
- zero volume → LP sits flat, collecting nothing but losing nothing
- resolution of a dead market returns the LP's full deposit

**Best case at `B_small = $100k`, improved BIN:**

- balanced two-sided flow of `V` at LP fee rate `0.15%` → LP earns `0.0015 × V` in fees
- at `V = 50× pool` (`$5M`), LP fee income ≈ `$7,500` (7.5% of deposit) — no structural leak to offset
- at `V = 200× pool` (`$20M`), LP fee income ≈ `$30,000` (30% of deposit)

This makes LP participation materially more credible at the same starting budget used in reference discrete markets. The model also avoids the "dead market is automatic loss" failure mode that kills current BIN on low-volume launches.

### 6.3 Comparison to Reference Binary/Multi (Polymarket) At `$100k`

Reference binary/multi markets do not have committed LP capital in the AMM sense — they have orderbook depth from market makers who can withdraw quotes at will. A rough equivalent:

- **Worst case:** a Polymarket maker quoting `$100k` of depth faces adverse selection (informed flow picks off stale quotes) but can always pull orders. Capital loss is bounded by how stale the quotes were before the pull.
- **Best case:** same maker earns the spread on every executed trade. On a busy market they might turn over the book many times a day.

This is categorically different from what an LP on a current BIN market faces. Even the *best* outcome on current BIN is bounded by structural leak repayment; the best outcome for a Polymarket MM is simply "spread × volume" with no analogous leak.

---

## 7) Why Users Might Pick Reference Binary/Multi Instead

### Traders

- easier payoff intuition (yes/no or finite outcomes)
- no hidden "display probability vs true break-even" confusion
- often stronger immediate depth visibility in mature discrete venues

### LPs / Market Makers

- no deterministic no-trade capital decay (in standard discrete setups)
- easier inventory/risk tooling ecosystem
- less model-complexity risk

For your **current BIN**, these user-choice pressures are strong.
For **improved BIN** or **Paradigm-style**, they become much weaker.

---

## 8) Which Model Is Most Viable At Similar Initial Capital?

If the goal is **continuous market + native LP role + realistic profitability** at capital levels comparable to reference binary/multi:

1. Paradigm-style restricted-family function-space
2. Improved BIN (fixed accounting + smooth settlement)
3. Basis-function pool-backed market
4. Current BIN (winner-take-all) - only if used as interim demo, not final economics
5. Parametric cost-function (good trader market, weak native LP role)
6. Dynamic pari-mutuel (good operator-risk profile, weak LP/sell-side profile)

If the goal is **short-term mass onboarding with simple UX**, reference binary/multi still has an adoption edge.

---

## 9) Practical Recommendations To Make BIN Competitive With Reference Markets

To keep BIN structure while matching reference-style startup capital viability:

1. Enforce the LP/trader/backing identity from [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md).
2. Remove winner-take-all settlement; use local smooth payout kernel.
3. Keep nonzero default LP fees (never zero by default).
4. Expose economically correct marginal break-even quote in UI.
5. Use adaptive/non-uniform bins so capital is concentrated where users actually trade.
6. Add bounded signed-shape collateralization later (Paradigm-like direction).

With these changes, BIN can run with roughly the same order of startup capital as reference binary/multi markets, while preserving continuous-market advantages.

---

## 10) Final Bottom Line

With equal initial investment, the **current BIN** model — in all three of its Dekant flavours (Binary, Multi, Continuous) — is strictly less sustainable than reference binary/multi markets because of the structural `1/sqrt(N)` LP loss and winner-take-all settlement effects. The binary case (`N = 2`) is the *worst* point in the family, not the safest.

The **improved BIN (v2 path)** specced in [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md) can become economically credible at similar initial capital, and the **Paradigm-style** model remains the strongest long-term target for continuous markets where both informed traders and serious LPs should find rational reasons to participate.

The simplest way to summarize this whole document in one line:

> *You cannot fix current BIN's initial-liquidity problem by putting more money in. The leak is geometric, and every dollar of new liquidity leaks at the same `1/sqrt(N)` rate.*

---

## References

- [`PROFITABILITY.md`](PROFITABILITY.md) — combined trader/LP profitability report (same folder)
- [`DEKANT_REDESIGN_MODELS.md`](DEKANT_REDESIGN_MODELS.md) — alternative model analysis (same folder)
- [`DEKANT_V2_PROTOCOL_SPEC.md`](DEKANT_V2_PROTOCOL_SPEC.md) — BIN v2 proposal (same folder)
- [`programs/dekant-pm/src/state/market.rs`](../../programs/dekant-pm/src/state/market.rs) — on-chain market logic (confirms Binary/Multi/Continuous share the same L2-norm AMM)
- [`programs/dekant-pm/src/constants.rs`](../../programs/dekant-pm/src/constants.rs) — on-chain fee defaults (30bps trade, 50bps redemption, 50% LP share)
- [Paradigm — *Distribution Markets*, Dec 2024](https://www.paradigm.xyz/2024/12/distribution-markets)
