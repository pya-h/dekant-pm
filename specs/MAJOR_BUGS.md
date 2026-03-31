# Bug Report

Tracking file for known bugs, their analysis, and fix status.

---

## BUG-001: `compute_distribution_buy` overflows u128 at moderate liquidity

- **Status:** Open — validated 2026-03-27
- **Severity:** High
- **Affects:** Continuous markets only (distribution buy trades)
- **Discovered:** 2026-03-20
- **Last validated:** 2026-03-31 — all code references verified against current `amm.rs` (unchanged since d8875a1). Reviewed: overflow thresholds confirmed numerically, affected-operations table corrected, two new fix approaches (E, F) added.
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
| `sell_distribution`    | Continuous      | No        | Doesn't compute xw^2; Σx² safe to ~$1.15T |
| `buy` (discrete)       | Binary/Multi    | No        | k_new² safe to ~$18.4T (all outcome counts)|
| `sell` (discrete)      | Binary/Multi    | No        | Same as discrete buy (~$18.4T)             |
| `buy_to_price`         | Binary/Multi    | No        | x²·SCALE overflows at ~$583M (all n)      |
| `sell_to_price`        | Binary/Multi    | No        | Same as buy_to_price (~$583M)              |
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

### Related (non-BUG-001): `buy_to_price` / `sell_to_price` overflow at ~$583M

`compute_collateral_for_target_prob` and `compute_tokens_for_target_prob` (used by discrete markets) compute `x_i^2 * SCALE` and `sum_others_x_sq * SCALE` (lines 361, 377-380, 421-422 in amm.rs). These overflow u128 when `total_minted > ~5.83 * 10^14` raw (~$583M USDC), regardless of outcome count. This is a separate, much higher threshold than BUG-001 and unlikely to be hit in practice, but worth noting for completeness. The overflow produces `MathOverflow` — no silent corruption.

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
**Cons:** Multiple iterations needed (typically 2-3 for convergence — quadratic convergence from λ₀=0 on this convex quadratic). Higher compute cost per trade. Must handle convergence criteria carefully (tolerance, max iterations).
**Note on convergence safety:** Starting from λ₀=0, f(0) = k_old² - k_new² < 0. Since f is a convex quadratic with positive leading coefficient (w2), Newton produces monotonically increasing iterates that stay below the root. So all intermediate values of `x[b] + λ·w[b]` are bounded by their values at the solution, where `Σ(x+λw)² = k_new²`. This means each term fits u128 as long as k_new² fits (~$18.4T threshold). **No divergence risk.**

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

#### Approach E: Binary search with term-by-term evaluation

Instead of solving the quadratic algebraically, find `lambda` via binary search on `g(lambda) = SUM (x[b] + lambda * w[b])^2`. We need `g(lambda) = k_new^2`.

```rust
// Upper bound: lambda <= sqrt(excess) / isqrt(w2) + 1  (derived from quadratic formula)
let lambda_hi = isqrt(excess)
    .checked_mul(isqrt(SCALE))  // sqrt(SCALE) to compensate for sqrt(w2) ~ SCALE/sqrt(n)
    .unwrap_or(u128::MAX)
    / isqrt(w2).max(1)
    + 1;
let mut lo: u128 = 0;
let mut hi: u128 = lambda_hi;

for _ in 0..64 {
    if lo + 1 >= hi { break; }
    let mid = lo + (hi - lo) / 2;
    // Evaluate g(mid) = SUM (x[b] + mid * w[b])^2, term by term
    let g = reserves.iter().zip(weights.iter()).try_fold(0u128, |acc, (&h, &w)| {
        let x = total_minted.saturating_sub(h as u128);
        let xw = x.checked_add(mid.checked_mul(w as u128)?)?;
        acc.checked_add(xw.checked_mul(xw)?)
    });
    match g {
        Some(val) if val <= k_new_sq => lo = mid,
        _ => hi = mid,  // overflow or g > k_new^2 → lambda too high
    }
}
let numerator_approx = lo;
// tokens_out[b] = numerator_approx * w[b] / SCALE (approximately)
```

**Overflow analysis:** At the solution, `g(lambda) = k_new^2 = (T+C)^2`. Each term `(x + lambda*w)^2` sums to `(T+C)^2`, which fits u128 for `T+C < 1.84*10^19` (~$18.4T). During binary search, if `mid` overshoots, `checked_mul` returns `None` and the search moves `hi` down. **Safe to ~$18.4T.**

**Iteration count:** With a tight upper bound, `log2(lambda_hi)` iterations suffice. For typical trades, `lambda_hi < 10^7` → ~23 iterations. Worst case: 64 iterations.

**CU cost:** ~25 iterations × n bins × 5 ops ≈ 32K CU (n=256). Fits within 200K budget.

**Pros:** No algebraic overflow. Exact integer arithmetic (no precision loss). Guaranteed convergence. Simple to implement. Safe to ~$18.4T.
**Cons:** More CU than Newton (~3x). Binary search gives the integer-floor result, may need a final check of `lo` vs `lo+1`.

#### Approach F: Tiered exact/approximate (pragmatic hybrid)

Try the original exact computation first. If any `checked_mul` fails, fall back to the scale-down path. This preserves exact behavior for all existing tests and small/medium markets, and only uses the approximation for large markets where precision loss is proportionally negligible.

```rust
let sqrt_disc = if let Some(disc) = xw.checked_mul(xw)
    .and_then(|xw_sq| w2.checked_mul(excess)
        .and_then(|we| xw_sq.checked_add(we)))
{
    // Exact path — no precision loss
    isqrt(disc)
} else {
    // Scale-down fallback — only reached for large markets
    let s: u128 = 1_000_000; // or isqrt(SCALE) for even more headroom
    let xw_s = xw / s;
    let disc_s = xw_s * xw_s + (w2 / s) * (excess / s);
    isqrt(disc_s) * s
};
```

**Precision analysis of the fallback path (S = 10^6):**
- The fallback triggers when `xw^2 > u128::MAX`, i.e., `xw > ~1.84*10^19`.
- At that point, `numerator = sqrt(disc) - xw` is at least ~10^6 (since the market holds ~$26K+ for n=2).
- The scale-down error in `isqrt(disc_s) * S` is at most ±S = ±10^6.
- Relative error: at most `10^6 / 10^6 = 100%` for the smallest possible numerator at the threshold.
- **Improvement:** Use `S = isqrt(SCALE) ≈ 31623` instead. This gives ±31623 error (~$0.03 USDC). The fallback triggers at the same threshold (xw^2 overflow), and numerator at that point is ~$26K+, so relative error is ~0.1%. The threshold of the fallback path itself increases to ~$820M (n=2).

**Pros:** Zero behavior change for existing markets. No precision loss below overflow threshold. Minimal code change (~10 lines). No dependencies. No CU overhead for normal markets.
**Cons:** Two code paths to test. Precision loss in fallback path for trades near the overflow boundary (mitigated by choosing S carefully). Still has a (much higher) overflow ceiling in the fallback path.

### Recommendation

**Approach F** (tiered exact/approximate) is the safest pragmatic choice — zero behavior change for all current markets, minimal code, no dependencies. Combined with `S = isqrt(SCALE)`, it raises the ceiling from ~$300K to ~$820M with negligible precision loss.

**Approach B** (u256) is the "correct" choice if exact precision is required at all scales and CU budget permits. The `ethnum` crate is lightweight and no_std compatible.

**Approach E** (binary search) is the best choice if zero-dependency AND exact precision are both required — at the cost of higher CU usage (~32K for 256 bins).

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

## ✅ BUG-003: Vault Insolvency — `claim_payout` does not decrement `total_minted`

- **Status:** Fixed — resolved by 1:1 payout refactor (2026-03-28)
- **Severity:** Critical (fund loss / protocol insolvency)
- **Affects:** All market types, post-resolution
- **Discovered:** 2026-03-27
- **Category:** Accounting logic bug in on-chain program

### Resolution

Fixed by switching from proportional to 1:1 fixed payout model. See `RESOLUTION_REFACTOR_TASKS.md` for full task plan.

**Changes (commit `847795c`):**
- `claim_payout.rs`: `gross_payout = winning_tokens` (1:1, no `total_minted` dependency)
- `market.rs`: Added `compute_lp_resolved_payout()` — LP payout from `reserves[winning]`
- `remove_liquidity.rs`: Resolved-market branch uses residual reserves instead of `total_minted`

With 1:1 payouts, `total_minted` is never used for claim/LP withdrawal computation on resolved markets, eliminating the insolvency by design. Verified by 18 new integration tests in `tests/resolution-1to1.ts` and `tests/continuous-deep.ts`.

### Summary

`claim_payout` transfers collateral from the vault but **never decrements `market.total_minted`**. Meanwhile, `remove_liquidity` computes LP payouts as `total_minted × shares / lp_shares_total`. Because `total_minted` is stale after claims, the protocol becomes insolvent: either LPs cannot withdraw (vault insufficient) or LPs steal trader collateral (if they withdraw first).

This is a **fund-loss bug** — depending on the order of operations, either traders or LPs lose their collateral.

### Location

**Primary file:** `programs/dekant-pm/src/instructions/trading/claim_payout.rs`

```rust
// Line 85-92: the comment explains the intent but creates the bug
// The payout pool is total_minted: the aggregate collateral backing all
// complete sets.  We must NOT derive this from vault_balance because the
// vault balance shrinks with every prior claim, creating a first-claimer
// advantage ...
let payout_pool = market.total_minted;    // reads total_minted
// ... computes and transfers gross_payout ...
// ⚠ total_minted is NEVER decremented
```

**Secondary file:** `programs/dekant-pm/src/instructions/trading/remove_liquidity.rs`

```rust
// Line 89: LP withdrawal based on un-decremented total_minted
let collateral_out = market.compute_collateral_for_withdrawal(args.shares_to_burn)?;
// → returns total_minted * shares / lp_shares_total  (stale total_minted!)
```

### The two failure modes

#### Scenario A: Traders claim first → LP withdrawal fails

1. Market resolves. Vault holds `total_minted + lp_fee + protocol_fee`.
2. Winning traders call `claim_payout` → collateral transferred from vault. `total_minted` unchanged.
3. LP calls `remove_liquidity` → computes `collateral_out = total_minted × shares / lp_shares_total` (the original, un-decremented value).
4. **SPL Token transfer fails** — vault doesn't have enough tokens.

#### Scenario B: LP removes first → Traders get nothing

1. Market resolves. LP calls `remove_liquidity` first.
2. `collateral_out = total_minted × shares / lp_shares_total` — LP takes **all** collateral (including trader-owed portion).
3. `total_minted` is decremented to 0 (or near-0).
4. Trader calls `claim_payout` → `payout_pool = total_minted = 0` → payout = 0.
5. **Trader receives nothing.**

### Numerical proof

```
Binary market, outcome 0 (YES) wins.
Initial liquidity (net) = 1000 USDC.
After trading: total_minted = 1100, reserves = [258, 393]

x_YES = 1100 - 258 = 842 (total winning position)
Trader holds 135 YES tokens (pool implicit position = 707)
Vault = 1100 + 35 (fees) = 1135

Trader claims first:
  gross_payout = 135 × 1100 / 842 = 176 USDC
  vault: 1135 → 959,  total_minted: still 1100

LP removes 100% shares:
  collateral_out = 1100,  fee_share = 30,  total = 1130
  vault has 959 → TX FAILS (shortfall = 171)

LP removes first instead:
  collateral_out = 1100,  fee_share = 30,  total = 1130
  vault: 1135 → 5,  total_minted: 1100 → 0

Trader claims:
  payout_pool = 0 → payout = 0
  TRADER GETS NOTHING
```

### Root cause

The bug has two layers — an accounting error and a deeper architectural mismatch:

**Accounting error:** `claim_payout` never decrements `total_minted`, so `remove_liquidity` computes LP payouts from a stale value.

**Architectural mismatch:** The current payout model is **parimutuel** (proportional pool distribution), where traders claim the ENTIRE `total_minted` pool. LPs also try to withdraw from `total_minted`. Both mechanisms draw from the same pool — whoever goes second gets nothing. This double-claim is inherent to the proportional model when combined with a separate LP share system.

In the proportional formula `payout = winning_tokens × total_minted / x[winning]`, the sum of all trader payouts equals exactly `total_minted` — leaving zero for LPs. The LP's implicit winning position (`reserves[winning]` tokens) is dissolved and given to traders.

### Why the existing test passes

The [binary-market.ts](tests/binary-market.ts) integration test (line 269→327) does claim-then-LP-remove but passes by coincidence:
- Only the **external LP** (small fraction of shares) withdraws — the **creator's LP** stays
- The trader's claim is small relative to vault balance
- No test exists where ALL LP shares are withdrawn from a resolved market after claims
- The creator never attempts to withdraw their LP position

### What the lp-analysis.md gets wrong

`plans/lp-analysis.md` lines 73–76 and 157 state:
> "total_minted is reduced by the collateral portion of each claim"

This is **false**. `claim_payout` never modifies `total_minted`. The entire section 7 analysis of "LPs get less after claims" is based on this incorrect premise.

### Fix: Switch to 1:1 Fixed Payout (Recommended)

**Status: DECIDED — this is the approach we are implementing.**

The root cause isn't just a missing decrement — it's that the proportional (parimutuel) model is architecturally incompatible with a separate LP share system. The fix is to switch to **1:1 fixed payout**, where each winning token redeems for exactly 1 unit of collateral. This is the model used by Polymarket, Kalshi, Augur, Gnosis CTF, and every major prediction market.

See `plans/resolution-compare.md` for the full analysis and `plans/resolution-report-tl.md` for the decision report.

#### The change

```rust
// BEFORE (proportional — buggy):
let winning_tokens_total = market.total_minted
    .checked_sub(market.reserves[winning_outcome] as u128)?;
let payout_pool = market.total_minted;
let gross_payout = mul_div(winning_tokens as u128, payout_pool, winning_tokens_total)?;

// AFTER (1:1 — correct):
let gross_payout = winning_tokens as u128;   // 1 token = 1 collateral
```

Post-resolution LP withdrawal draws from the residual (`reserves[winning]`) instead of `total_minted`:

```rust
// In remove_liquidity, when market is resolved:
let lp_residual = market.reserves[market.resolved_outcome as usize] as u128;
let collateral_out = lp_residual * shares / lp_shares_total;
```

#### Why this eliminates BUG-003 by design

```
Vault holds:     total_minted + fees
Traders claim:   x[winning]                     (= total_minted - reserves[winning])
LPs claim:       reserves[winning] + fee_share

x[winning] + reserves[winning] = total_minted   (by definition, always)
→ No overlap, no double-counting, order-independent  ✓
```

The two claim pools are **disjoint portions** of `total_minted`. No shared mutable denominator, no need to decrement anything during claims.

#### Why 1:1 over fixing proportional

| Issue | Fix within proportional | 1:1 fix |
|-------|------------------------|---------|
| BUG-003 (double-claim) | Complex — needs careful accounting of two overlapping pools | Eliminated by design |
| Payout uncertainty | Inherent to the model — cannot fix | Eliminated (payout always = tokens × 1) |
| LP value donation | Inherent — pool's winning tokens go to traders | LP retains winning position |
| Mental model mismatch | Inherent — AMM prices ≠ settlement | Eliminated (price ≈ probability, payout = 1) |
| Industry alignment | No major platform uses proportional | Matches all major platforms |

#### Development cost

~1.5–2 days. Core change is ~45 lines of Rust. No state migration, no new accounts/instructions. Most effort goes to testing.

See `plans/resolution-report-detailed.md` §3 for the full implementation plan.

### Alternative approaches (kept for reference)

The following approaches attempt to fix BUG-003 WITHIN the proportional model. They are **not recommended** — we are proceeding with 1:1 instead. Documented here for completeness.

#### Alt-A: Snapshot payout pool at resolution

Store `trader_payout_pool` and `winning_tokens_total` at resolution time. Problem: computing the trader pool requires summing all user positions on-chain, which isn't feasible in a single transaction.

#### Alt-B: Decrement total_minted in claim_payout

```rust
market.total_minted = market.total_minted.checked_sub(gross_payout as u128)?;
```

Problem: changes `payout_pool` for subsequent claimers. The formula becomes order-dependent unless `reserves[winning]` is also decremented.

#### Alt-C: Separate LP and trader pools at resolution

Split `total_minted` into `trader_payout_pool` and `lp_residual_pool`. Problem: same as Alt-A — requires iterating all UserPosition accounts.

#### Alt-D: Decrement both total_minted and reserves in claim_payout

```rust
market.total_minted = market.total_minted.checked_sub(gross_payout as u128)?;
market.reserves[winning] = market.reserves[winning].checked_sub(winning_tokens as u64)?;
```

Keeps the ratio constant. Needs algebraic verification of order-independence. Even if correct, still has the proportional model's inherent problems (payout uncertainty, LP value donation, mental model mismatch).

### Key files for implementation

- `programs/dekant-pm/src/instructions/trading/claim_payout.rs` — change formula to 1:1
- `programs/dekant-pm/src/instructions/trading/remove_liquidity.rs` — add resolved-market branch
- `programs/dekant-pm/src/state/market.rs` — optional helper method
- `backend/src/amm/amm.service.ts` — update payout estimation
- `tests/binary-market.ts` — existing test passes by coincidence; needs update
- `plans/lp-analysis.md` — Section 4 and Section 7 need correction

### Required tests

- **Basic 1:1 claim:** trader claims winning tokens, receives exactly that amount in collateral
- **Claim-then-LP-remove (100% shares):** trader claims, then LP removes all → both succeed, vault = 0 + protocol fees
- **LP-remove-then-claim:** LP removes first, then trader claims → both get correct amounts
- **Multiple claims then LP remove:** several traders claim, then LP removes → LP gets residual
- **Interleaved claims and LP removes:** mix of claims and LP withdrawals → all amounts correct
- **No-trade market:** market resolves without any trading → LP gets full collateral back (reserves[winning] = total_minted/sqrt(N), so LP gets that amount)

---
