# Bug Report

Tracking file for known bugs, their analysis, and fix status.

---

## BUG-001: `compute_distribution_buy` overflows u128 at moderate liquidity

- **Status:** Open — validated 2026-03-27
- **Severity:** High
- **Affects:** Continuous markets only (distribution buy trades)
- **Discovered:** 2026-03-20
- **Last validated:** 2026-03-27 — all code references verified against current `amm.rs` (unchanged since d8875a1)
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

Also checked, also can overflow — and for large trades on small-bin markets, can overflow **before** `xw^2`:

```
w2 ~ SCALE^2 / n  (for uniform weights)
excess = k_new^2 - k_old^2 ~ 2 * T * C  (for small trade C on market T)
For doubling trade (C = T): excess ~ 3 * T^2
```

| Scenario (uniform weights)         | n=2        | n=256      |
|-------------------------------------|------------|------------|
| $1 trade (C = 10^6)                | ~$340M     | ~$43B      |
| 10% trade (C = 0.1T)               | ~$57K      | ~$646K     |
| Doubling trade (C = T)             | **~$15K**  | ~$170K     |

**Key finding:** For n=2 with a doubling trade, `w2 * excess` overflows at **~$15K** — lower than the `xw^2` threshold ($26K). The report's original "xw^2 overflows first" claim only holds for **typical trade sizes (C << T)**. For very large trades on small-bin markets, `w2 * excess` is the binding constraint.

### Root Cause

The quadratic formula requires squaring `xw`, which already contains a `SCALE` (10^9) factor from the weight normalization. So `xw^2` has a `SCALE^2 = 10^18` factor that eats 18 of the ~38 decimal digits available in u128, leaving only ~10^20 of headroom for `total_minted^2`. Since USDC uses 6 decimals, this limits markets to ~$300K-level liquidity.

### Safety note: overflow-checks = true

The workspace `Cargo.toml` has `overflow-checks = true` in `[profile.release]`. This means **all** arithmetic (including the "unchecked" `+=` and `*` in the accumulation loop at lines 193–194) will **panic** on overflow rather than silently wrapping. The checked_mul at line 215 returns a clean `MathOverflow` error; if it weren't there, the unchecked xw accumulation would panic at a much higher threshold (~$10^20). Bottom line: **no silent corruption is possible** — the transaction always fails cleanly.

### Proposed Fixes

#### Approach A: Factor out SCALE before squaring (simplest, some precision loss)

Divide `xw` by a scaling factor before squaring, then compensate inside the square root.

```rust
// Instead of:
//   disc = xw^2 + w2 * excess
// Compute:
//   disc_scaled = (xw / S)^2 + (w2 / S) * (excess / S)
//   sqrt_disc = isqrt(disc_scaled) * S
// Where S is a chosen scale-down factor (e.g., SCALE or sqrt(SCALE))

let S: u128 = 1_000_000; // or isqrt(SCALE)
let xw_down = xw / S;
// ⚠ Must split the division: w2.checked_mul(excess) overflows too!
// Use (w2 / S) * (excess / S) instead.
let w2_excess_down = (w2 / S)
    .checked_mul(excess / S)
    .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
let disc_down = xw_down.checked_mul(xw_down)? + w2_excess_down;
let sqrt_disc = isqrt(disc_down) * S;
let numerator = sqrt_disc.saturating_sub(xw);
```

**Pros:** Minimal code change, no new dependencies.
**Cons:** Loses ~6 digits of precision in the discriminant from two floor divisions. Could cause rounding errors on small trades. Need to verify precision empirically. The two separate divisions (w2/S and excess/S) can lose up to S² ≈ 10^12 total, negligible relative to the discriminant magnitude.
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
**Cons:** Adds a dependency or requires implementing u256 multiply + isqrt. Higher compute cost (Solana CU budget concern — need to benchmark). Solana programs are size-constrained (BPF loader limits); verify that adding a crate doesn't push the program over the limit. Default CU limit per instruction is 200K — with 256 bins the function already uses significant CUs, so u256 multiply overhead needs profiling.
**Crate options:** `ethnum` (lightweight, no_std, ~2KB code size impact), `uint` (more features, heavier), or hand-rolled u256 multiply using 4 u64 limbs (zero dependency, most control).

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

### Test Gap

No existing unit test exercises the overflow threshold or verifies behavior near the boundary. The current test suite uses `L = 1_000_000` (1 USDC) — far below overflow levels. **Any fix must include:**
- A threshold test: create reserves at ~$25K (n=2) and ~$295K (n=256), verify `compute_distribution_buy` returns `MathOverflow`
- A near-threshold test: verify the fix works at values slightly above the old threshold
- A regression test: compare fix results against the current implementation at small values where both work (e.g. L = 1M)

### Key Files for Implementation

- `programs/dekant-pm/src/engine/amm.rs` — lines 178-246 (`compute_distribution_buy`)
- `programs/dekant-pm/src/instructions/trading/buy_distribution.rs` — instruction handler that calls the AMM function
- `programs/dekant-pm/src/engine/sqrt.rs` — `isqrt` (may need u256 variant)
- `programs/dekant-pm/src/constants.rs` — `SCALE`, `MAX_BINS`
- `programs/dekant-pm/src/engine/mod.rs` — module declarations (if adding u256 module)
- `programs/dekant-pm/Cargo.toml` — if adding `ethnum` or similar dependency
- `programs/dekant-pm/tests/unit/engine_amm.rs` — unit tests for AMM engine
- `Cargo.toml` — workspace-level (`overflow-checks = true` in release profile)

---

## BUG-002: Oracle Unavailability / Compromise — Paused Market Deadlock

- **Status:** Open — needs team discussion & group decision
- **Severity:** High (design-level)
- **Affects:** All market types
- **Discovered:** 2026-03-25
- **Category:** Protocol design gap, not a code bug

### Summary

Two related issues around oracle trust and availability that can permanently lock trader funds.

### Issue A: Admin/Superadmin inheriting Oracle resolve permission

The roles hierarchy currently allows Superadmin (and potentially Admin) to implicitly satisfy any role check. If this extends to resolution, it breaks the trust model: Admins/Superadmins must NOT be able to resolve markets, because resolution is a trust-critical operation that should only be performed by the specifically assigned oracle.

Additionally, no oracle other than the one assigned at market creation should be able to resolve that market — the on-chain `resolve_market` instruction enforces `market.oracle == oracle.key()`.

Future consideration: support for decentralized oracles (e.g., UMA, Pyth, Switchboard).

### Issue B: Oracle becomes unavailable or compromised

**Scenario 1 — Compromised oracle:**
An admin can pause the market to prevent malicious resolution. However, once paused, only the same oracle can resolve it after an admin unpauses. The `oracle` field is immutable after creation (by design). Result: the market stays paused forever, locking all trader and LP funds.

**Scenario 2 — Unavailable oracle (lost keys, disappeared):**
The market passes its deadline and transitions to PendingResolution, but no one can call `resolve_market` because only the assigned oracle wallet can sign. The market remains in PendingResolution indefinitely with all funds locked.

**Scenario 3 — LP vs trader impact:**
LP providers can still withdraw liquidity from Active/PendingResolution/Resolved markets, but traders with open positions have no recourse.

### What IS protected (by design)

- Market oracle, question, outcomes, range, and type are all immutable after creation. No instruction exists to modify these fields. Correct for trust/integrity.
- Only the specific oracle assigned at creation can resolve; no admin or superadmin can override.
- `resolve_market` validates `market.oracle == oracle.key()` — no bypass exists.

### What is NOT covered

- No emergency resolution path (multi-sig override, governance vote, timelock refund).
- No way to reassign the oracle for a specific market.
- No automatic refund mechanism if a market goes unresolved past a grace period.

### Potential solutions for team discussion

1. **Governance / multi-sig emergency resolution** — for markets stuck past a configurable grace period.
2. **Time-locked automatic refund** — if a market stays in PendingResolution for X days, allow traders to reclaim collateral proportionally (void the market).
3. **Decentralized oracle integration** — UMA, Pyth, Switchboard — removes single-oracle dependency.
4. **Dispute mechanism** — stakeholders can flag an unresolved market for admin review.

### Priority

Not urgent for current stage. Must be addressed before production launch. Requires team discussion to decide which approach(es) to implement.

---
