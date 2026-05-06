# BUG-002: Broken exp(-z²/2) Taylor Approximation in On-Chain Normal PDF

**Severity:** Critical (corrupts all continuous market distribution trades)
**Status:** Fixed (2026-05-07)
**Discovered:** 2026-05-06
**File:** `programs/dekant-pm/src/engine/normal_pdf.rs`
**Function:** `exp_neg_half_approx(t_scaled: u128) -> u128`

---

## 1. Summary

The on-chain Gaussian weight computation used a degree-4 Taylor polynomial to approximate `exp(-z²/2)`. This polynomial is only accurate for |z| ≤ ~1.4. Beyond that, the quartic term causes the polynomial to **rebound upward**, producing a "Mexican hat" shape instead of a Gaussian bell curve. All `buy_distribution` / `sell_distribution` trades on continuous markets were affected.

---

## 2. Root Cause

The polynomial `f(u) = 1 - u/2 + u²/8 - u³/48 + u⁴/384` (where `u = z²`) has a local minimum at `u ~ 3.2` (`z ~ 1.79`) then increases monotonically due to the positive `u⁴` term. By `u ~ 5.3` (`z ~ 2.3`), it exceeds 1.0 and gets clamped to `SCALE`.

```
 z    | Taylor (clamped) | True exp(-z²/2) | Error
------|------------------|-----------------|----------
 0.0  | 1.000            | 1.000           | 0%
 1.4  | 0.382            | 0.375           | +1.7%
 2.0  | 0.333            | 0.135           | +146%
 2.4  | 1.000 (clamped)  | 0.056           | +1681%
 3.0  | 1.000 (clamped)  | 0.011           | +8902%
 5.0  | 1.000 (clamped)  | 0.0000037       | +26.8M%
```

---

## 3. Fix Applied — Lookup Table + Linear Interpolation *(Approach B)*

Replaced the Taylor polynomial with a 51-entry precomputed lookup table covering `exp(-k/4)` for k = 0..50 (t = 0, 0.5, 1.0, ..., 25.0 in z²-space), with linear interpolation between entries.

- O(1) computation, guaranteed monotonically decreasing
- ~0.78% max relative interpolation error (at midpoints between table entries)
- 51 × 16 = 816 bytes of const data
- Compile-time assertion: `EXP_TABLE.len() == 2 * Z_CUTOFF² + 1`
- All weights normalized (sum to SCALE) by `compute_bin_weights`

**Unit tests (230 total, all pass):** accuracy at table points, midpoint accuracy (< 1%), monotonicity (0 to 25, step 0.1), no-rebound, bell-shaped weights, BUG-002 reproduction scenario.

---

## 4. Alternative Approaches (Not Taken)

### Approach A: Range reduction + polynomial
Factor `exp(-t/2) = exp(-n/2) · exp(-frac/2)` where Taylor is accurate for `frac < 1`.
Pro: High accuracy. Con: Loop of n multiplications (up to 25), higher compute cost.

### Approach C: Piecewise minimax polynomials
Fit separate polynomials per range segment using Chebyshev optimization.
Pro: ~0.01-0.1% accuracy. Con: No monotonicity guarantee, harder to audit, more complex.

---

## 5. Call Chain

```
buy_distribution / sell_distribution
  → normal_pdf::compute_bin_weights
       → exp_neg_half_approx    ← FIXED
       → normalize weights to sum = SCALE
  → amm::compute_distribution_buy / sell
       → tokens_out[b] ∝ W[b]
```

---

## 6. Files Modified

| File | Change |
|------|--------|
| `programs/dekant-pm/src/engine/normal_pdf.rs` | Replaced Taylor body with 51-entry lookup table + linear interpolation |
| `programs/dekant-pm/tests/unit/engine_normal_pdf.rs` | Rewrote all tests for new implementation |

---

## 7. Deployment Notes

- On-chain program change — requires `anchor build` + deploy.
- Existing positions created with broken weights cannot be retroactively corrected.
- New trades will use correct weights. Same instruction interface, same account layouts.
