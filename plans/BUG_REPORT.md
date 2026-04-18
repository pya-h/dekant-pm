# Bug Report

Tracking file for known bugs, their analysis, and fix status.

---

## BUG-001: `compute_distribution_buy` overflows u128 at moderate liquidity

- **Status:** Open
- **Severity:** High
- **Affects:** Continuous markets only (distribution buy trades)
- **Discovered:** 2026-03-20
- **Reported by:** User report ("market with initial liquidity >10M fails")

### Summary

The quadratic discriminant computation in `compute_distribution_buy` overflows `u128` at moderate liquidity levels, blocking distribution buy trades on continuous markets. The overflow is **checked** (returns `MathOverflow`, transaction rejected) — no silent corruption occurs, but trading becomes impossible above the threshold.

### Location

**File:** `programs/dekant-pm/src/engine/amm.rs`, lines 189–223

```rust
// Lines 189-195: accumulate xw and w2
let mut xw: u128 = 0;
let mut w2: u128 = 0;
for (&h, &w) in reserves.iter().zip(weights.iter()) {
    let x = total_minted.saturating_sub(h as u128);
    xw += x * (w as u128);       // xw grows as total_minted * SCALE
    w2 += (w as u128) * (w as u128);
}

// Lines 215-220: THE OVERFLOW POINT
let xw_sq = xw
    .checked_mul(xw)              // <-- overflows u128
    .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
let w2_excess = w2
    .checked_mul(excess)
    .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
```

The quadratic formula being computed is:

```
lambda = (sqrt(xw^2 + w2 * excess) - xw) / w2
```

Where:
- `xw = SUM(x[b] * w[b])` — dot product of positions and weights
- `w2 = SUM(w[b]^2)` — sum of squared weights
- `excess = k_new^2 - k_old^2`
- Weights sum to `SCALE` (10^9), so `xw` contains a SCALE factor
- `xw^2` therefore contains a `SCALE^2 = 10^18` factor, consuming most of u128 headroom

### Mathematical Analysis

**u128 max = 2^128 - 1 ~ 3.4 * 10^38**

For a market with `n` bins, `total_minted = T` (USDC raw, 6 decimals), at uniform initial state:

```
x[b] = T / sqrt(n)           (position per bin)
w[b] = SCALE / n              (uniform weight)

xw = SUM x[b] * w[b]
   = n * (T / sqrt(n)) * (SCALE / n)
   = T * SCALE / sqrt(n)

xw^2 = T^2 * SCALE^2 / n
     = T^2 * 10^18 / n
```

Overflow condition: `T^2 * 10^18 / n > 3.4 * 10^38`

Solving: `T > sqrt(3.4 * 10^38 * n / 10^18) = sqrt(3.4 * 10^20 * n)`

| Bins (n) | Max total_minted (raw) | Max USDC  | Notes                        |
|----------|------------------------|-----------|------------------------------|
| 2        | ~2.6 * 10^10           | **~$26K** | Minimum continuous bins      |
| 16       | ~7.4 * 10^10           | **~$74K** |                              |
| 64       | ~1.5 * 10^11           | **~$148K**|                              |
| 128      | ~2.1 * 10^11           | **~$209K**|                              |
| 256      | ~2.95 * 10^11          | **~$295K**| Maximum bins (MAX_BINS=256)  |

These are thresholds for the **uniform (initial)** state. After trading, the threshold depends on position-weight correlation:

- **Correlated** (trader buys where market already has high position): threshold **decreases**
- **Anti-correlated** (trader buys where position is low): threshold **increases**, could reach millions

This explains why the user report says "10M" — the threshold is state-dependent and could be reached at various liquidity levels depending on trading history.

### What IS and IS NOT affected

| Operation              | Market Type     | Affected? | Notes                                     |
|------------------------|-----------------|-----------|--------------------------------------------|
| `buy_distribution`     | Continuous      | **YES**   | The overflow point                         |
| `sell_distribution`    | Continuous      | No        | Doesn't compute xw^2                      |
| `buy` (discrete)       | Binary/Multi    | No        | Safe to ~$580M+ (binary), ~$33M+ (32-out) |
| `sell` (discrete)      | Binary/Multi    | No        | Same as discrete buy                       |
| `buy_to_price`         | Binary/Multi    | No        | Uses sum_others * SCALE, not xw^2          |
| `sell_to_price`        | Binary/Multi    | No        | Same as buy_to_price                       |
| `add_liquidity`        | All             | No        | Uses scale_reserves, safe at 10M+          |
| `remove_liquidity`     | All             | No        | Uses scale_reserves, safe at 10M+          |
| `create_market`        | All             | No        | liq^2 fits u128 for any u64 input          |
| `claim_payout`         | All             | No        | No AMM math                                |

### Secondary overflow: `w2 * excess` (line 219)

Also checked, also can overflow at similar magnitudes:

```
w2 ~ SCALE^2 / n  (for uniform weights, ~3.9 * 10^15 for n=256)
excess = k_new^2 - k_old^2 ~ 2 * T * C  (for small trade C on market T)

w2 * excess ~ 3.9 * 10^15 * 2 * T * C
```

For a $1 trade (C = 10^6) on market T: overflows when `T > 4.35 * 10^16` (~$43B) — not the binding constraint.
For a large trade (C = T, doubling liquidity): overflows when `T > ~1.7 * 10^11` (~$170K) — similar to xw^2.

In practice, `xw^2` overflows first in most scenarios.

### Root Cause

The quadratic formula requires squaring `xw`, which already contains a `SCALE` (10^9) factor from the weight normalization. So `xw^2` has a `SCALE^2 = 10^18` factor that eats 18 of the ~38 decimal digits available in u128, leaving only ~10^20 of headroom for `total_minted^2`. Since USDC uses 6 decimals, this limits markets to ~$300K-level liquidity.

### Proposed Fixes

#### Approach A: Factor out SCALE before squaring (simplest, some precision loss)

Divide `xw` by a scaling factor before squaring, then compensate inside the square root.

```rust
// Instead of:
//   disc = xw^2 + w2 * excess
// Compute:
//   disc_scaled = (xw / S)^2 + w2 * excess / S^2
//   sqrt_disc = isqrt(disc_scaled) * S
// Where S is a chosen scale-down factor (e.g., SCALE or sqrt(SCALE))

let S: u128 = 1_000_000; // or isqrt(SCALE)
let xw_down = xw / S;
let w2_excess_down = w2.checked_mul(excess)? / (S * S);
let disc_down = xw_down.checked_mul(xw_down)? + w2_excess_down;
let sqrt_disc = isqrt(disc_down) * S;
let numerator = sqrt_disc.saturating_sub(xw);
```

**Pros:** Minimal code change, no new dependencies.
**Cons:** Loses ~6 digits of precision in the discriminant. Could cause rounding errors on small trades. Need to verify precision empirically.
**Estimated threshold improvement:** ~10^6x (from ~$300K to ~$300B), far beyond practical needs.

#### Approach B: u256 arithmetic for the discriminant

Use a u256 type (e.g., `ethnum::U256`, `uint::U256`, or a manual hi/lo u128 pair) for the discriminant computation only.

```rust
// Pseudocode with u256:
let xw_256 = U256::from(xw);
let w2_256 = U256::from(w2);
let excess_256 = U256::from(excess);

let disc = xw_256 * xw_256 + w2_256 * excess_256;
let sqrt_disc = isqrt_256(disc);  // Need u256 isqrt
let numerator = sqrt_disc - xw_256;
// numerator fits u128 since it represents a token amount
let numerator = numerator.as_u128();
```

**Pros:** Exact arithmetic, no precision loss. Clean separation.
**Cons:** Adds a dependency or requires implementing u256 multiply + isqrt. Higher compute cost (Solana CU budget concern — need to benchmark).
**Crate options:** `ethnum` (lightweight, no_std), `uint` (more features), or hand-rolled u256 multiply using 4 u64 limbs.

#### Approach C: Newton's method iteration (avoid closed-form quadratic)

Replace the algebraic solution with iterative Newton's method for `lambda`:

```
f(lambda) = SUM (x[b] + lambda * w[b])^2 - k_new^2 = 0
f'(lambda) = 2 * SUM w[b] * (x[b] + lambda * w[b])
```

Each iteration: `lambda_next = lambda - f(lambda) / f'(lambda)`

Only needs to compute `SUM (x + lw)^2` per iteration, which is `n` multiply-accumulates — no squaring of the full dot product.

**Pros:** Avoids xw^2 entirely. Each iteration stays within u128. Mathematically elegant.
**Cons:** Multiple iterations needed (typically 5-10 for convergence). Higher compute cost per trade. Must handle convergence criteria carefully (tolerance, max iterations). Risk of non-convergence in edge cases.

#### Approach D: Algebraic reformulation using normalized quantities

Reformulate the quadratic in terms of normalized positions `x[b] / total_minted` and normalized weights `w[b] / SCALE`, keeping everything in [0, 1] range.

```
Let p[b] = x[b] / T  (normalized position, in [0, 1])
Let q[b] = w[b] / SCALE  (normalized weight, sums to 1)
Then xw / (T * SCALE) = SUM p[b] * q[b]  (bounded by 1)

Reformulate quadratic in terms of these normalized quantities,
then scale the result back.
```

**Pros:** All intermediate products bounded by ~1 in real terms. Can use fixed-point with full SCALE precision.
**Cons:** Requires careful algebraic rework. Multiple divisions introduce cumulative rounding. Most complex to implement correctly.

### Recommendation

**Approach A** (factor out SCALE) is the pragmatic choice — minimal code change, massive threshold improvement, acceptable precision for a financial protocol. Should be validated with edge-case unit tests comparing results against the current implementation at small values where both work.

**Approach B** (u256) is the "correct" choice if precision matters and CU budget permits. The `ethnum` crate is lightweight and no_std compatible.

### Reproduction

Create a continuous market with 256 bins and ~$300K USDC initial liquidity, then attempt a `buy_distribution` trade. The transaction should fail with `MathOverflow`.

```bash
# Using devkit (approximate):
cd devkit
npx ts-node src/market.ts create-continuous \
  --bins 256 --range-min 0 --range-max 100 \
  --liquidity 300000000000  # 300K USDC in raw (6 dec)
npx ts-node src/trade.ts buy-dist \
  --market <id> --mu 50000000000 --sigma 10000000000 \
  --amount 1000000  # 1 USDC — should fail with MathOverflow
```

### Key Files for Implementation

- `programs/dekant-pm/src/engine/amm.rs` — lines 178-246 (`compute_distribution_buy`)
- `programs/dekant-pm/src/engine/sqrt.rs` — `isqrt` (may need u256 variant)
- `programs/dekant-pm/src/constants.rs` — `SCALE`, `MAX_BINS`
- `programs/dekant-pm/src/engine/mod.rs` — module declarations (if adding u256 module)
- `programs/dekant-pm/Cargo.toml` — if adding `ethnum` or similar dependency
- `programs/dekant-pm/tests/unit/engine_amm.rs` — unit tests for AMM engine

---
