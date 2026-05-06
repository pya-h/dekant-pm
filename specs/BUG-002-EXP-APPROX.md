# BUG-002: Broken exp(-z^2/2) Taylor Approximation in On-Chain Normal PDF

**Severity:** Critical (corrupts all continuous market distribution trades)
**Status:** Unfixed
**Discovered:** 2026-05-06
**File:** `programs/dekant-pm/src/engine/normal_pdf.rs` lines 16-59
**Function:** `exp_neg_half_approx(t_scaled: u128) -> u128`

---

## 1. Summary

The on-chain Gaussian weight computation uses a degree-4 Taylor polynomial to approximate `exp(-z^2/2)`. This polynomial is only accurate for |z| <= ~1.4. Beyond that, the quartic term causes the polynomial to **rebound upward** instead of decaying toward zero. Bins in the range |z| = 2.3 to 5.0 get weights **equal to the peak** (clamped to SCALE), producing a "Mexican hat" shape instead of a Gaussian bell curve.

Every `buy_distribution` and `sell_distribution` trade on every continuous market is affected. Users pay for a Gaussian-shaped position but receive a fundamentally different distribution.

---

## 2. Root Cause

The approximation at `normal_pdf.rs:16`:

```rust
pub fn exp_neg_half_approx(t_scaled: u128) -> u128 {
    // Taylor series: exp(-t/2) ~ 1 - t/2 + t^2/8 - t^3/48 + t^4/384
    // (Horner form evaluation)
    // ...
    if r <= 0 { 0 }
    else if r > s { SCALE }  // <-- clamps rebound to max!
    else { r as u128 }
}
```

The polynomial `f(u) = 1 - u/2 + u^2/8 - u^3/48 + u^4/384` (where `u = z^2`) has a local minimum at `u ~ 3.2` (`z ~ 1.79`) then **increases monotonically** due to the positive `u^4` term. By `u ~ 5.3` (`z ~ 2.3`), the polynomial exceeds 1.0 and gets clamped to `SCALE`.

### Error table

```
 z    | Taylor (clamped) | True exp(-z^2/2) | Error
------|------------------|------------------|----------
 0.0  | 1.000            | 1.000            | 0%
 1.0  | 0.607            | 0.607            | 0%
 1.4  | 0.382            | 0.375            | +1.7%
 1.8  | 0.271            | 0.198            | +37%
 2.0  | 0.333            | 0.135            | +146%
 2.4  | 1.000 (clamped)  | 0.056            | +1681%
 3.0  | 1.000 (clamped)  | 0.011            | +8902%
 4.0  | 1.000 (clamped)  | 0.000335         | +298000%
 5.0  | 1.000 (clamped)  | 0.0000037        | +26.8M%
```

---

## 3. Observed Symptoms

**Test case:** Continuous market [0, 100], 256 bins, user buys with mu=24.93, sigma=5.20, amount=10K USDC on a $99.5M liquidity pool.

**Expected:** Bell curve centered at 24.93, significant weight in ~81 bins (roughly values 10-40), peak normalized weight ~3.0%.

**Actual:** "Mexican hat" / bathtub shape spanning 130 bins (values 0-51):
- Flat plateau at peak weight (values 0-12 and 38-51) from clamped tails
- Dips at values ~15 and ~35 (the polynomial minimum at z~1.8)
- Central peak at value ~25 (correct location but same height as plateaus)
- Sharp cutoff to zero at value ~51 (Z_CUTOFF = 5)
- Zero from value 51-100

The position shape (from actual on-chain trade, shown in UI):

```
Taylor (actual):                   True Gaussian (correct):

|=================| (plateau)      |                 |
|=================|                |                 |
|=================|                |                 |
|=======          | (dip)          |  ##             |
|=====            |                |  ########       |
|===========      |                |  ################
|==================| (peak)        |  ####################  (bell peak)
|==================|               |  ####################
|===========      |                |  ################
|=====            | (dip)          |  ########       |
|=======          |                |  ##             |
|=================| (plateau)      |                 |
|=================|                |                 |
|                 | (z>5 cutoff)   |                 |
```

---

## 4. Impact

1. **Positions don't match intended Gaussian**: users specify mu/sigma but get a fundamentally different shape.
2. **Peak tokens ~3x lower**: collateral is wasted on tail bins that should have near-zero weight, reducing the central payout.
3. **UI mismatch**: the "Your prediction" preview (blue curve, computed client-side with `Math.exp`) shows the correct Gaussian, but the actual on-chain position is the distorted Mexican hat. The preview is misleading.
4. **All continuous markets affected**: every `buy_distribution` and `sell_distribution` instruction calls `compute_bin_weights` which calls `exp_neg_half_approx`.
5. **Financial loss**: users receive less concentrated positions than they pay for. The excess weight in tails is effectively wasted collateral.

---

## 5. Call Chain

```
buy_distribution (instructions/trading/buy_distribution.rs:99)
  -> normal_pdf::compute_bin_weights (engine/normal_pdf.rs:69)
       -> exp_neg_half_approx (engine/normal_pdf.rs:16)    <-- BUG HERE
       -> normalize weights to sum = SCALE
  -> amm::compute_distribution_buy (engine/amm.rs:179)
       -> tokens_out[b] = numerator * W[b] / W2
       (tokens_out is proportional to W[b], so distorted weights = distorted position)
```

Same chain for `sell_distribution`.

---

## 6. Fix Requirements

Replace `exp_neg_half_approx` with an approximation that:
1. Is monotonically decreasing for t >= 0
2. Is accurate to within ~1-2% for the full range 0 <= z <= Z_CUTOFF (z^2 from 0 to 25)
3. Uses only u128/i128 integer arithmetic (Solana BPF constraint)
4. Has reasonable compute cost (called once per bin, up to 256 bins)
5. Returns values in [0, SCALE] with SCALE = 10^9

### Approach A: Range reduction + polynomial

Factor `exp(-t/2)` using `exp(-a) * exp(-b)` identity:
- Let `n = floor(t)`, `frac = t - n` (both SCALE-denominated)
- `exp(-frac/2)` is accurate with degree-4 Taylor since `frac < 1` (so z < 1)
- `exp(-n/2) = exp(-0.5)^n` — precompute `exp(-0.5) = 606_530_880` (SCALE-denominated), then repeated multiplication

```
exp(-t/2) = exp(-n/2) * exp(-frac/2)
           = (0.60653...)^n * taylor(frac)
```

Pros: High accuracy, simple to understand.
Cons: Loop of n multiplications (up to 25 for z=5). Each mult is u128*u128/SCALE.

### Approach B: Lookup table + linear interpolation

Precompute `exp(-k/2) * SCALE` for k = 0, 1, 2, ..., 25 as a const array (26 entries).
Interpolate linearly between entries.

```rust
const EXP_TABLE: [u128; 26] = [
    1_000_000_000,  // exp(0)
    606_530_660,    // exp(-0.5)
    367_879_441,    // exp(-1.0)
    223_130_160,    // exp(-1.5)
    135_335_283,    // exp(-2.0)
    // ... etc to exp(-12.5)
];
```

Then: `exp(-t/2) = lerp(EXP_TABLE[floor(t)], EXP_TABLE[ceil(t)], frac(t))`

Pros: O(1) computation, guaranteed monotonic, very accurate.
Cons: Linear interpolation introduces ~1-2% error between table entries (acceptable). Slightly larger code size from the const array.

### Approach C: Piecewise polynomial (minimax)

Fit separate low-degree polynomials for ranges [0,2], [2,6], [6,12], [12,25] using minimax/Chebyshev optimization. Each segment uses a polynomial tuned for that range.

Pros: Can achieve very high accuracy.
Cons: More complex code, harder to verify/audit.

### Recommended: Approach B (lookup table)

Simplest, most robust, guaranteed monotonic, essentially zero error at table points with acceptable interpolation error between them. 26 u128 constants is negligible code size. O(1) compute per call.

---

## 7. Files to Modify

| File | Change |
|------|--------|
| `programs/dekant-pm/src/engine/normal_pdf.rs` | Replace `exp_neg_half_approx` body |
| `programs/dekant-pm/src/constants.rs` | Possibly adjust `Z_CUTOFF` if desired (current value 5 is fine) |
| `programs/dekant-pm/src/engine/normal_pdf.rs` | Unit tests for new approximation |
| Integration tests (`tests/*.ts`) | Add/update distribution trade tests verifying position shape |

No changes needed to:
- `amm.rs` (consumes weights, logic is correct)
- `buy_distribution.rs` / `sell_distribution.rs` (just call compute_bin_weights)
- Frontend (client-side uses `Math.exp`, which is correct)
- Backend (doesn't compute weights on-chain)

---

## 8. Testing Plan

### Unit tests (Rust, in normal_pdf.rs or a test module)
1. Verify `exp_neg_half_approx(z^2 * SCALE)` matches `exp(-z^2/2) * SCALE` within 2% for z = 0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0
2. Verify monotonicity: for z1 < z2, result(z1) >= result(z2)
3. Verify boundary: result(0) = SCALE, result(Z_CUTOFF^2 * SCALE) = 0 or near-zero
4. Verify `compute_bin_weights` produces a bell-shaped output (peak at mu bin, monotonically decreasing outward)

### Integration tests (TypeScript, in tests/)
1. `buy_distribution` with mu=center, sigma=range/10 on a fresh market
2. Verify user holdings are bell-shaped: holdings[mu_bin] > holdings[mu_bin +/- 1] > holdings[mu_bin +/- 2] > ...
3. Verify no "rebound": holdings should not increase as you move away from mu beyond 1.5 sigma
4. Compare total tokens received with expected value (should concentrate ~95% within 2 sigma)

### Regression
- Run full `cargo test` and `anchor test` suites after the fix
- Verify existing distribution trade tests still pass (the fix changes weight distribution, so expected values in existing tests may need updating)

---

## 9. Migration / Deployment Considerations

- This is an **on-chain program change** — requires `anchor build` + `anchor deploy` (or `solana program deploy`)
- Existing positions on devnet were created with the broken weights. They cannot be retroactively corrected.
- After deployment, new trades will use correct weights. Existing holdings remain as-is.
- No database migration needed (backend doesn't store weights).
- The program upgrade is backward-compatible (same instruction interface, same account layouts).

---

## 10. Reference

- Paradigm article: https://www.paradigm.xyz/2024/12/distribution-markets
- The article's L2-norm AMM assumes the position vector f is proportional to the true probability density p. For Gaussian beliefs, f should be a discretized Gaussian. The broken approximation violates this assumption.
- Project AMM implementation: `programs/dekant-pm/src/engine/amm.rs` — `compute_distribution_buy` computes `tokens_out[b] = numerator * W[b] / W2`, so tokens are directly proportional to weights W[b]. Fixing the weights fixes the positions.
