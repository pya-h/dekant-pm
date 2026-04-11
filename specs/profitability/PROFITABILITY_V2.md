# DekantPM Profitability — Post-Fix Report (v2)

Updated analysis after the `trader_token_totals` fix (2026-04-11). This report supersedes [`PROFITABILITY.md`](PROFITABILITY.md) for the current state of the codebase.

Cross-checked against:
- on-chain implementation in [`programs/dekant-pm/src/state/market.rs`](../../programs/dekant-pm/src/state/market.rs)
- JS playground in [`specs/math/math_doc_script.js`](../math/math_doc_script.js)
- [Paradigm — *Distribution Markets*, Dec 2024](https://www.paradigm.xyz/2024/12/distribution-markets)

---

## 1. Executive Summary

The `trader_token_totals` fix eliminates the single most damaging flaw — the deterministic `1/√N` LP loss. LPs now receive the true vault residual at resolution. This converts the LP proposition from "structurally unprofitable subsidy role" to "normal market-making with fee income vs adverse selection", comparable to Uniswap-style AMM LPs.

**Post-fix bottom line:**

- **Traders:** Economics unchanged. Narrow bets profitable for informed traders. Broad distributions still bad as hold-to-resolution positions (this is a settlement design choice, not a bug).
- **LPs:** No-trader loss = 0% (was 6–71%). Break-even volume collapses from 42–471× pool to ~0× for balanced flow. LP is now a rational profit-seeking role in active markets.
- **Remaining issues:** Quadratic probability display, broad-distribution hold-to-resolution losses, winner-take-all settlement. These are design choices addressable in v2 (see [COMPARE.md](COMPARE.md)).

---

## 2. What Changed: The Fix

### The Bug (§4.3–4.4 of old report)

`compute_lp_resolved_payout` used `reserves[resolved_outcome]` as the LP residual. But `reserves[i] = total_minted - positions[i]`, where `positions[i]` includes the structural AMM position (`isqrt(k²/N)`) — a mathematical artifact, not trader-held tokens. LP operations scaled positions without changing trader holdings, widening the divergence.

**Effect:** LPs received less than owed. In the worst case (no trades, N=2), LP lost 70.7% of deposit to nobody.

### The Fix

Added `trader_token_totals: Vec<u64>` to Market account. Maintained on every buy/sell instruction. At resolution:

```rust
let win = self.resolved_outcome as usize;
reserves[win] = total_minted - trader_token_totals[win];
```

Now `compute_lp_resolved_payout` reads the true LP residual: everything in the vault that isn't owed to traders.

### What Did NOT Change

- **AMM math** (buy/sell/distribution algorithms) — identical
- **Price impact** — identical
- **Trader payouts** — identical (uses `position.holdings`, not reserves)
- **Initial liquidity requirements** for trading — identical
- **Probability display** — still quadratic `p_hat = x²/k²`

---

## 3. Mechanism Overview

- `k` = total_minted (total collateral deposited as complete sets)
- `x_i` = positions (AMM state variables): `x_i = k - reserves[i]`
- Invariant: `Σ x_i² = k²` (L2-norm sphere)
- Displayed probability: `p_hat_i = x_i² / k²`
- Marginal price (small-trade break-even): `≈ x_i / k = √p_hat_i`

**Buy:** mint complete sets, then solve for new position via `isqrt`. Tokens out = Δx.
**Sell:** return tokens, compute new k via sum-of-squares, drain collateral.
**LP add/remove:** scale reserves proportionally (preserves shape, not trader holdings).

Fees: trade fee 30 bps (on-chain default), LP gets 50% share → effective LP fee rate = 0.15% of volume. Redemption fee 50 bps on winning payouts.

---

## 4. Trader Profitability (Unchanged by Fix)

### 4.1. The Break-Even Gap

The displayed quadratic `p_hat` is **not** the trader's break-even. The marginal break-even is `√p_hat / ((1-τ)(1-ρ))`:

| Bins N | Displayed p_hat | Actual break-even |
|---:|---:|---:|
| 2 | 50.00% | 71.28% |
| 5 | 20.00% | 45.08% |
| 16 | 6.25% | 25.20% |
| 64 | 1.56% | 12.60% |
| 256 | 0.39% | 6.30% |

### 4.2. Single-Bin Trades: Profitable for Informed Traders

**Example:** N=5, L=$1M, $100K single-bin buy, fees τ=0.3% ρ=0.5%.

- Tokens received: 192,583
- Max payout (if target bin wins): $191,620
- Max profit: +$91,620 (ROI +91.6%)
- Break-even belief: 52.19%

Sharp traders with concentrated edge can profit. Uninformed traders lose fees.

### 4.3. Distribution Trades: Structural Hold-to-Resolution Problem

**Example:** N=64, L=$100K, $10K Gaussian buy:

| σ | Peak-bin tokens | Payout if correct | ROI |
|---:|---:|---:|---:|
| 5 (narrow) | ~14,742 | ~$14,668 | **+47%** |
| 10 (moderate) | ~8,431 | ~$8,389 | **-16%** |
| 20 (broad) | ~4,617 | ~$4,594 | **-54%** |

**Root cause:** Under winner-take-all bin resolution, only the winning bin pays $1. Broad distributions spread tokens across many bins; most pay $0. The marginal token price is `1/√N`, not the displayed `1/N`. Spreading across bins multiplies this cost.

**Break-even condition** for a distribution buy with normalized weights W:

```
||W||₂² > 1 / ((1-τ)(1-ρ)√N)
```

Broad Gaussians fail this. Only narrow distributions (σ ≤ ~5 on 64-bin markets) pass.

### 4.4. Trader Summary

| Strategy | Viability |
|---|---|
| Narrow single-bin, strong conviction | Profitable if belief > break-even |
| Narrow Gaussian (σ ≤ 5) | Marginally profitable when correct |
| Broad Gaussian (σ ≥ 10) | **Unprofitable** even when perfectly correct |
| Early exit (sell before resolution) | Viable if market moves your way |
| Uninformed / random | Expected loss = fees |

**This is a design limitation, not a bug.** Winner-take-all settlement punishes broad beliefs. Fixing it requires smooth settlement (see §8.7 of the old report; see [COMPARE.md](COMPARE.md) for analysis).

---

## 5. LP Profitability (Dramatically Improved)

### 5.1. Baseline Loss: Eliminated

| Bins N | OLD: no-trade LP loss | NEW: no-trade LP loss |
|---:|---:|---:|
| 2 | **-70.71%** | **0%** |
| 5 | -44.72% | 0% |
| 16 | -25.00% | 0% |
| 64 | -12.50% | 0% |
| 256 | -6.25% | 0% |

With zero traders, `trader_token_totals[win] = 0`, so LP residual = `total_minted = L`. LP gets 100% of deposit back.

### 5.2. LP P/L Now Depends on Trade Flow (Normal Market-Making)

**Scenario: N=5, L=$1M, one trader buys $100K in bin 0**

If bin 0 wins (trader correct):
- total_minted = 1,099,700
- trader_token_totals[0] = 192,583
- LP residual = 1,099,700 - 192,583 = 907,117
- LP fee = $150
- **LP P/L = -$92,733 (-9.3%)**

If any other bin wins (trader wrong):
- trader_token_totals[other] = 0
- LP residual = 1,099,700
- LP fee = $150
- **LP P/L = +$99,850 (+10.0%)**

Compare OLD behavior:
- If trader's bin wins: LP P/L was **-$539,947 (-54%)**
- If other bin wins: LP P/L was **-$347,364 (-35%)**

The LP went from losing in ALL outcomes to the standard market-making tradeoff: lose when the informed trader is right, profit when they're wrong.

### 5.3. Expected LP Return by Scenario

**N=5, L=$1M, single $100K trade, on-chain fees:**

| Scenario | Expected LP P/L |
|---|---:|
| Random trader (uniform resolution) | **+$61,333 (+6.1%)** |
| Perfectly informed trader (always right) | -$92,733 (-9.3%) |
| 50/50 informed/uninformed | -$15,700 (-1.6%) |
| No traders | $0 (0%) |

**N=64, L=$100K, $10K trade:**

| Scenario | Expected LP P/L |
|---|---:|
| Random trader (uniform resolution) | **+$9,705 (+9.7%)** |
| Perfectly informed trader | -$8,451 (-8.5%) |
| No traders | $0 (0%) |

### 5.4. Break-Even Volume (Post-Fix)

The old `1/√N` baseline loss required volume of `(1/√N) / 0.0015 × pool` just to break even.

**Post-fix:** there is no baseline loss to overcome. LP profitability depends entirely on the fee-vs-adverse-selection balance, like any standard AMM:

| Market condition | LP outcome |
|---|---|
| Balanced flow (random traders) | **Profitable from first trade** |
| Moderate adverse selection (50% informed) | Break-even at moderate volume |
| Heavy adverse selection (all informed) | Unprofitable (standard market-making risk) |

For balanced markets, the LP is profitable with **any** positive volume. For adversarial markets, the LP's defense is the same as any market maker: fees, diversification, and volume.

### 5.5. LP Summary

| Metric | OLD | NEW |
|---|---:|---:|
| No-trade loss (N=5) | -44.72% | **0%** |
| No-trade loss (N=64) | -12.50% | **0%** |
| Break-even volume (N=64, balanced) | 83× pool | **~0×** |
| Loss per $100K informed trade (N=5, $1M pool) | -$540K | -$93K |
| Profit per $100K uninformed trade (N=5, $1M pool) | -$347K | **+$100K** |
| Rational to participate? | No (subsidy role) | **Yes (market-making)** |

---

## 6. Remaining Design Issues

### 6.1. Quadratic Probability Display

`p_hat = x²/k²` is still shown to users. The marginal break-even is `√p_hat / ((1-τ)(1-ρ))`, which is materially higher. This misleads casual traders.

**Fix:** display `x_i/k` (marginal price) or `√p_hat` as the primary probability, with `p_hat` available as "shape weight" for advanced users.

### 6.2. Winner-Take-All Settlement

The single biggest remaining design limitation. Broad distribution trades lose money even when correct because only one bin pays $1. This discourages the very behavior (distribution expression) that makes continuous markets distinctive.

**Fix:** smooth settlement kernel — bins near the winning value get partial payout (e.g., triangular or Gaussian kernel). See [COMPARE.md](COMPARE.md) Model 2 for analysis.

### 6.3. Fee Defaults in JS Playground

The on-chain program defaults to 30 bps trade fee / 50% LP share (correct). The JS playground defaults to zero fees. These should be aligned.

### 6.4. Slippage Scaling

Single-bin slippage scales as `N × c / k` on a uniform pool. For N=64 and a $100K pool, a $1K trade sees ~25% slippage. Distribution buys avoid this but have the hold-to-resolution EV problem.

---

## 7. Assessment

### Post-Fix Status

| Component | Status |
|---|---|
| AMM math (buy/sell) | Correct |
| LP accounting (resolution) | **Fixed** |
| Vault solvency | Guaranteed |
| Trader payouts | Correct |
| Fee accrual | Correct |
| Probability display | Misleading (quadratic, not marginal) |
| Broad distribution EV | Structurally negative (design choice) |
| Settlement model | Winner-take-all (design choice) |

### For Traders

Informed traders with concentrated views can profit. Broad distributions are market-shaping tools, not investable hold-to-resolution positions. This is unchanged by the fix — it's inherent to winner-take-all settlement on an L2-norm AMM.

### For LPs

The LP proposition is now fundamentally sound. LPs earn fees and face normal adverse selection risk, with no structural tax. The market is now comparable to other AMM-based venues for LP economics.

### One-Sentence Summary

> DekantPM's L2-norm AMM is now economically sound for LPs after the `trader_token_totals` fix; the remaining limitations — quadratic probability display and winner-take-all settlement penalizing broad distributions — are design choices addressable in a v2 upgrade.
