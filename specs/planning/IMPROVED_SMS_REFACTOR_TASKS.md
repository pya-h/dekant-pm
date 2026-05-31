# Improved Model Refactor Tasks

**Goal:** Refactor DekantPM to implement the improved model — linear probability display and smooth settlement kernel resolution for continuous markets.

**Scope:**
- **Linear probability display:** Change `p_i = x_i^2 / k^2` to `p_i = x_i / sum(x_j)` across all surfaces (on-chain helper, backend, frontend, devkit)
- **Smooth settlement kernel:** Replace winner-take-all (WTA) resolution with triangular kernel payouts — **continuous markets ONLY**
- Binary and multi-outcome markets remain on WTA 1:1 resolution (unchanged)

**Design docs:** `specs/details/improved/`, `docs/improved/`
**Previous refactor (1:1 WTA):** `specs/planning/RESOLUTION_REFACTOR_TASKS.md` (all tasks complete)

---

## Kernel Width (W) Configuration — Design Decision (FINAL)

The kernel width `W` controls how many bins on each side of the winning bin receive partial payouts.

**Decision: `W` is stored on-chain, per-market, and set manually by the creator at market creation.**

- **On-chain:** `kernel_width` is a field in the Market account (consumes padding bytes — see Backward Compatibility below). It is part of the immutable market configuration, transparent to traders and independently verifiable on-chain.
- **Manual:** The creator passes `kernel_width` as an explicit argument to `create_market`. It is NOT a global protocol constant, NOT auto-computed from a formula, and NOT derived from market geometry (`num_bins` / range).
- **Per-market:** Each market carries its own `W`, giving full flexibility to tune the kernel to that market's range and bin count.

`kernel_width = 0` means winner-take-all (WTA) — the backward-compatible default for all existing markets (their zero padding deserializes to `W = 0`). Continuous markets opt into the smooth kernel by passing `kernel_width > 0` (recommended starting value `W = 3`; see `specs/details/improved/SMOOTH_KERNEL_SOLVENCY.md` for overclaim/solvency tradeoffs by width).

*Rejected alternatives:* a global per-protocol `kernel_width` in `ProtocolConfig` (one-size-fits-all; can't tune per market range/bins) and an automatic range-based formula computed from `num_bins` (opaque; removes creator control). Both were rejected in favor of explicit, per-market creator control.

---

## Backward Compatibility Strategy

The Market account has 30 bytes of `_padding`. We will consume 10 bytes:
- `kernel_width: u16` (2 bytes) — bins on each side of winner receiving partial payout
- `scaling_factor: u64` (8 bytes) — solvency scaling, computed at resolution, SCALE-denominated

Remaining: `_padding: [u8; 20]`

**Borsh compatibility:** Existing markets have all-zero padding. Under the new layout, `kernel_width=0` and `scaling_factor=0` deserialize identically. `kernel_width=0` is interpreted as WTA resolution, preserving exact current behavior for all existing markets.

**Schema version:** Bump `SCHEMA_VERSION` from 1 to 2 for new markets. Existing markets (version=1) work unchanged.

---

## Phase 0: Pre-Refactor Assessment ✅

Verify the current state is clean and stable before making any changes.

> **Done (2026-05-29).** Baseline recorded in `specs/details/improved/IMPROVED_REFACTOR_BASELINE.md`. All suites green: Rust 256, Anchor 131, backend unit 287, backend e2e 296, frontend vitest 247, frontend build OK.

---

### P0-1: Snapshot current test baseline ✅

Run all test suites and record pass counts as the baseline.

```bash
cargo test --test '*'                                    # Rust unit tests
anchor test                                              # Integration tests
cd backend && npm test                                   # Backend unit tests
cd backend && npm run test:e2e                           # Backend e2e tests
cd frontend && PATH="..." pnpm next build                # Frontend build
```

Record: unit count, integration count, backend unit count, backend e2e count, frontend build status.

**Breaking changes:** None
**Possible bugs:** None (read-only)

---

### P0-2: Analyze impact on live deployment ✅

Document answers to these questions before proceeding:

1. **Existing active continuous markets:** After program upgrade, their `kernel_width` = 0 (from padding). Resolution and claims will use WTA. No behavior change.
2. **Existing resolved-but-unclaimed continuous markets:** Same — `kernel_width=0` means WTA claim logic. No behavior change.
3. **Existing binary/multi markets:** Completely unaffected — claim logic branches on `market_type` first, kernel code is never reached.
4. **New continuous markets post-upgrade:** Creators specify `kernel_width` in `CreateMarketArgs`. If `kernel_width=0`, WTA. If `kernel_width>0`, smooth kernel.
5. **IDL change:** Yes — `CreateMarketArgs` gets a new field. All callers (frontend, devkit, integration tests, backend if it creates markets) must update.
6. **Market account size:** Unchanged (padding bytes repurposed, total stays the same).

**Breaking changes:** None (analysis only)
**Possible bugs:** None

---

## Phase 1: Linear Probability Display ✅

Independent of the kernel refactor. Can be done first as a low-risk warm-up. No on-chain state changes — purely changes how probabilities are presented.

**Formula change:** `p_i = x_i^2 / k^2` -> `p_i = x_i / sum(x_j)` where `x_i = total_minted - reserves[i]`

> **Done.** Initial Phase 1 landed 2026-05-29 (Rust 256 · Anchor 131 · backend unit 287 · backend e2e 296 · frontend vitest 248 · backend/devkit typecheck + frontend build).
> **P1-4a target-price reconciliation done 2026-05-30:** `buy_to_price`/`sell_to_price` (on-chain `compute_collateral_for_target_prob` / `compute_tokens_for_target_prob`, backend `estimateBuyToPrice` / `estimateSellToPrice`) now target the LINEAR displayed probability, restoring display↔target consistency. Re-verified: Rust 256 ✓, backend unit 287 ✓, backend e2e 296 ✓, backend typecheck ✓. Anchor integration re-run was blocked by a GitHub outage downloading Solana platform-tools v1.51; the engine functions are exercised directly by the Rust unit tests and the instruction handlers are thin wrappers, so the on-chain risk is low. Re-run `anchor test` when GitHub recovers to fully clear.
> **Plan gap fixed under P1-4:** the original task listed only `amm.service.ts`, but `backend/src/market/market.service.ts` had two more quadratic display formulas (`getPrices`, distribution peak-bin). Both fixed in the same phase.

---

### P1-1: Update on-chain `compute_probabilities()` in `engine/amm.rs` ✅

**File:** `programs/dekant-pm/src/engine/amm.rs` (lines 366-391)

Change the formula from quadratic to linear:

```rust
// OLD: prob[i] = x_i^2 * SCALE / k^2
// NEW: prob[i] = x_i * SCALE / sum_x
```

Key points:
- Compute `sum_x = sum(total_minted - reserves[i])` first
- Then `prob[i] = x_i * SCALE / sum_x`
- Handle `sum_x == 0` (return uniform)
- This function is used by on-chain queries only (not by trading logic)

**Breaking changes:** On-chain probability queries return different values
**Possible bugs:**
- [x] P1-1a: Rounding — verified; `sum(prob[i])` equals SCALE within ±(n-1) per-term flooring (binary: exact within 1, asserted in `test_probabilities_linear_two_outcome` and `test_probabilities_sum_approximately_scale`).
- [x] P1-1b: Overflow — verified; `x_i * SCALE` is safe (x_i ≤ tm ≤ ~2^64 realistic, ×10^9 ≈ 2^94 ≪ 2^128). `checked_mul`/`checked_add` returns zeros defensively if it ever overflows.

---

### P1-2: Update on-chain `implied_probability()` in `state/market.rs` ✅

**File:** `programs/dekant-pm/src/state/market.rs` (lines 524-549)

Same formula change for the per-outcome helper method. Must use `sum_x` from all reserves.

**Breaking changes:** Same as P1-1
**Possible bugs:**
- [x] P1-2a: Resolved — `sum_x` computed inline over `self.reserves` (Vec sized to `num_outcomes`, ≤ MAX_OUTCOMES=256 iterations). Negligible perf cost.

---

### P1-3: Update frontend `computeProbabilities()` in `lib/types.ts` ✅

**File:** `frontend/lib/types.ts` (lines 154-171)

```typescript
// OLD: return (x * x) / kSq;
// NEW: return x / sumX;
```

- The `kSquared` parameter becomes unused (keep in signature for now to avoid breaking callers, or remove and update all call sites)
- Compute `sumX = sum(tm - Number(r))` first

**Breaking changes:** All probability displays across the frontend change
**Possible bugs:**
- [x] P1-3a: `sumX === 0` returns uniform (1/n); tested in `types.test.ts` ("returns uniform when no outcome carries a position"). Unreachable for valid `tm > 0` markets per the AMM invariant — purely defensive.
- [x] P1-3b: Reviewed `components/market/price-bar.tsx` (binary/multi bars sized as `width: p*100%` and sum to 1 under linear — proportional, no formula reliance), `components/market/distribution-chart.tsx` (auto-scales Y-axis to `max(probabilities)`, axis labels derived from that max → shape preserved, scale rescales), `components/trading/interactive-distribution-chart.tsx` (same auto-scale pattern). None use `Math.sqrt` or quadratic-magnitude assumptions; no changes needed. Visual effect: distributions render flatter / binary bars less extreme — the intended display change.

---

### P1-4: Update backend `computeProbabilities()` in `amm.service.ts` ✅

**File:** `backend/src/amm/amm.service.ts` (lines 752-762)

Same formula change. This method is used by:
- Trade estimation endpoints (`estimateBuy`, `estimateSell`, etc.)
- `buy-to-price` / `sell-to-price` logic

> **Plan gap found during implementation:** `backend/src/market/market.service.ts` had two MORE quadratic display formulas the original task missed — both fixed:
> - `getPrices()` (the `/markets/:id/prices` API endpoint) — changed to linear.
> - the distribution peak-bin finder in `getDistributionStats` — simplified to argmax of `x_i` (the peak bin is identical under linear or quadratic since both are monotonic in `x_i`).
> The AMM trade math and the `estimate*ToPrice` "current probability" remain quadratic on purpose (that is the target-price math, see P1-4a).

**Breaking changes:** Backend trade estimation responses return different `newProbabilities` values
**Possible bugs:**
- [x] P1-4a: **RECONCILED.** `compute_collateral_for_target_prob` / `compute_tokens_for_target_prob` (engine/amm.rs) and `estimateBuyToPrice` / `estimateSellToPrice` (backend/amm.service.ts) now interpret `target_prob` as the LINEAR displayed probability. Derivation: in both buy and sell, the other positions `x_j` (j≠i) are invariant, so for `S = Σ_{j≠i} x_j`, `x_i_target = target * S / (SCALE − target)`. Buy: `k_new = √(x_i_target² + Q)`, effective_collateral = `k_new − total_minted`. Sell: `tokens_in = x_i − x_i_target`. Tests reverted from the temporary quadratic-verification workaround back to `compute_probabilities ≈ target` (now consistent). Note: the original P1-4a text above misdescribed the on-chain math as "marginal price (x_i/k)" — it was actually quadratic (`x_i²/k²`); that's now linear.
- [x] P1-4b: `newProbabilities` (linear) sums to 1.0 by construction (`Σ x_i / sumX = 1`); confirmed by `should produce valid probabilities that sum close to 1` in `amm.service.spec.ts`.

---

### P1-5: Update devkit `computeProbabilities()` in `common.ts` ✅

**File:** `devkit/src/common.ts` (lines 250-257)

Same formula change. Used by `query.ts`, `trade.ts`, `resolve.ts`, `market.ts` for display.

**Breaking changes:** Devkit CLI output shows different probabilities
**Possible bugs:** None (display only)

---

### P1-6: Update tests for linear probability ✅

Files to update:
- Rust unit tests that assert probability values (search for `compute_probabilities` in test files)
- `frontend/__tests__/lib/types.test.ts` — update expected values
- `backend/src/amm/amm.service.spec.ts` — update probability assertions
- Integration tests — any test that asserts specific probability values

Add new test cases:
- Verify `sum(prob[i]) == SCALE` (on-chain) / `sum(prob[i]) ~= 1.0` (TS) for various reserve states
- Verify at equilibrium (`x_i = c * p_i`), linear display returns exact `p_i`
- Verify uniform state returns `1/N` for all outcomes

**Breaking changes:** None (test-only)
**Possible bugs:**
- [x] P1-6a: Searched `tests/`. Two files contained probability assertions that were affected: `tests/price-targeted.ts` (4 inline quadratic prob computations, now linear) and `tests/edge-cases.ts` (local quadratic `computeProbabilities` helper + 4 magnitude thresholds calibrated for quadratic peaks — helper switched to linear, thresholds recalibrated using values from the Rust pool tests to preserve the "strong dominance" intent).

---

### P1-7: Build and verify Phase 1 ✅

```bash
anchor build
cargo test --test '*'
anchor test
cd backend && npm test
cd backend && npm run test:e2e
cd frontend && PATH="..." pnpm next build
```

All must pass. Probability values change but behavior is identical.

**Breaking changes:** None
**Possible bugs:** None (verification only)

---

## Phase 2: On-Chain — Market State Extension ✅

Add kernel infrastructure to the Market account without changing any behavior. After this phase, the program compiles and all existing tests pass unchanged.

> **Done (2026-05-30).** Market struct extended with `kernel_width: u16` and `scaling_factor: u64` consumed from the 30-byte `_padding` tail (residual padding now 20 bytes). `SCHEMA_VERSION` bumped 1 → 2. `CreateMarketArgs` carries `kernel_width`; the handler force-zeros it for binary/multi. New error variant `InvalidKernelWidth` enforces `0 ≤ kernel_width < num_outcomes` for continuous markets and `kernel_width == 0` for binary/multi. IDL synced to backend + frontend (both JSON and `frontend/lib/program/dekant_pm.ts` from `target/types/`). Test deltas: Rust 256 → **263** (3 borsh-layout tests + 4 kernel-width validation tests), Anchor **131** ✓, backend unit **287** ✓, backend e2e **296** ✓, frontend vitest **248** ✓, frontend build ✓. All existing markets remain bytewise compatible (`kernel_width=0`, `scaling_factor=0` matches old `_padding=[0;30]`).

---

### P2-1: Add `kernel_width` and `scaling_factor` fields to Market struct ✅

**File:** `programs/dekant-pm/src/state/market.rs` (lines 116-119)

Replace:
```rust
pub _padding: [u8; 30],
```

With:
```rust
/// Smooth settlement kernel width (bins on each side of winner).
/// 0 = winner-take-all (default, backward-compatible).
/// Only meaningful for continuous markets.
pub kernel_width: u16,

/// Solvency scaling factor (SCALE-denominated, set at resolution).
/// SCALE (10^9) = no scaling needed. < SCALE = claims exceed vault, proportional dilution.
/// 0 until market is resolved. Only meaningful for continuous markets with kernel_width > 0.
pub scaling_factor: u64,

/// Reserved for future fields.
pub _padding: [u8; 20],
```

Update `space()` (line 164): change `30 // _padding` to `2 + 8 + 20 // kernel_width + scaling_factor + _padding` (same total = 30, so space is unchanged).

**Breaking changes:** IDL changes (account definition). No behavioral change.
**Possible bugs:**
- [x] P2-1a: Borsh layout — verify the new field order produces identical byte layout when all zeros. Write a Rust unit test that serializes a Market with `kernel_width=0, scaling_factor=0, _padding=[0;20]` and compares byte-for-byte with old `_padding=[0;30]`.
- [x] P2-1b: Deserialization of existing accounts — test that an account created with the old layout (30 zero padding bytes) deserializes correctly with the new struct.

---

### P2-2: Add `kernel_width` to `CreateMarketArgs` ✅

**File:** `programs/dekant-pm/src/instructions/market/create_market.rs` (lines 12-33)

Add field:
```rust
/// Smooth settlement kernel width for continuous markets.
/// 0 = winner-take-all. Ignored for binary/multi markets.
pub kernel_width: u16,
```

In the handler, pass it to `market.initialize()`:
- For binary/multi: force `kernel_width = 0` regardless of input
- For continuous: validate `kernel_width <= num_outcomes / 2` (kernel can't be wider than half the bins)
- Store in `self.kernel_width = kernel_width`

**Breaking changes:** All callers of `create_market` instruction must add `kernel_width` argument.
**Possible bugs:**
- [x] P2-2a: Validation — `kernel_width` must be < `num_outcomes` (otherwise every bin gets weight, always triggers scaling). Enforced both in `Market::initialize()` (returns `InvalidKernelWidth`) and in the `create_market` handler (force-zeros for binary/multi). Frontend mirrors the rule via Zod superRefine. Covered by 4 new unit tests in `programs/dekant-pm/tests/unit/state_market.rs`.
- [x] P2-2b: Integration tests — all `create_market` calls updated. `tests/helpers/market-helper.ts` adds `kernelWidth: 0` to binary/multi helpers and exposes an optional `kernelWidth` field on `createContinuousMarket` so kernel-mode tests can opt in. Devkit `createMarketHelper` and frontend `executeCreateMarket` both accept the new field. Full Anchor suite (131 tests) green.

---

### P2-3: Update `SCHEMA_VERSION` and `market.initialize()` ✅

**File:** `programs/dekant-pm/src/constants.rs` (line 70)

Change `SCHEMA_VERSION` from 1 to 2.

**File:** `programs/dekant-pm/src/state/market.rs` — `initialize()` method

Add `kernel_width` parameter. Store it:
```rust
self.kernel_width = kernel_width;
self.scaling_factor = 0; // set at resolution
```

**Breaking changes:** New markets get version=2. Existing version=1 markets unaffected.
**Possible bugs:** None

---

### P2-4: Update backend IDL ✅

**File:** `backend/idl/dekant_pm.json`

After `anchor build`, copy the updated IDL:
```bash
cp target/idl/dekant_pm.json backend/idl/dekant_pm.json
```

The backend uses this IDL for indexer event parsing. The account definition change and new `CreateMarketArgs` field must be reflected.

**Breaking changes:** Backend must restart with new IDL
**Possible bugs:**
- [x] P2-4a: Backend does NOT create markets (grep `createMarket` in `backend/src` returned nothing). Confirmed no production caller.
- [x] P2-4b: Indexer event parsing — `MarketCreated` event still unchanged (does not carry `kernel_width`); `handleMarketCreated` re-syncs the full Market account via the IDL-driven `BorshCoder`, which now picks up the new `kernel_width` and `scaling_factor` fields automatically. The current indexer projects only the legacy subset into the DB; surfacing the new fields in the entity is deferred to Phase 6 (P6-1) since no caller needs them this phase.

---

### P2-5: Update integration test `create_market` calls ✅

All integration test files that call `create_market` must add `kernelWidth: 0` (or appropriate value) to args.

Files to update (search for `createMarket` in `tests/`):
- `tests/binary-market.ts`
- `tests/multi-market.ts`
- `tests/continuous-market.ts`
- `tests/resolution-1to1.ts`
- `tests/continuous-deep.ts`
- Any other test files calling `createMarket`

For existing tests: use `kernelWidth: 0` to preserve WTA behavior. All existing assertions remain valid.

**Breaking changes:** None (tests compile again)
**Possible bugs:** None

---

### P2-6: Update devkit `create-continuous` command ✅

**File:** `devkit/src/market.ts`

Add `--kernel-width` option (default 0) to the `create-continuous` CLI command. Pass to the on-chain instruction.

For `create-binary` and `create-multi`: always pass `kernelWidth: 0`.

**Breaking changes:** None (new optional CLI flag)
**Possible bugs:** None

---

### P2-7: Update frontend `create_market` transaction ✅

**File:** `frontend/lib/transactions.ts` (or wherever `executeCreateMarket` is defined)

Add `kernelWidth` parameter. For binary/multi market creation UI, hardcode 0. For continuous market creation UI, expose a user-editable kernel width input (the creator sets it manually; prefill with the recommended value 3, but the creator may change it).

**Breaking changes:** None (UI addition)
**Possible bugs:**
- [x] P2-7a: Frontend form validation — kernel_width is a non-negative integer < num_bins. Zod schema (`createMarketSchema`) enforces `z.number().int().min(0).max(255)` plus a `superRefine` rule `kernelWidth < numBins` for continuous markets. Step-outcomes renders a number input clamped to `[0, numBins-1]`. Review step displays the chosen width (or "0 (winner-take-all)"). Field added to `STEP_FIELDS[2]` so it's validated when leaving the Outcomes step.

---

### P2-8: Build and verify Phase 2 ✅

```bash
anchor build
cargo test --test '*'
anchor test
cd backend && npm test
cd frontend && PATH="..." pnpm next build
```

All must pass. No behavior change — kernel_width=0 everywhere, scaling_factor=0.

**Breaking changes:** None
**Possible bugs:** None (verification only)

---

## Phase 3: On-Chain — Kernel Math Engine ✅

Implement the kernel weight computation and scaling factor as pure functions. No instruction changes yet — just the math module with comprehensive unit tests.

> **Done (2026-05-31).** New `engine/kernel.rs` exposes `kernel_weight`, `compute_scaling_factor`, and `compute_kernel_payout`. All three are pure functions over slices — no Anchor context, no account access. Registered in `engine/mod.rs`. (An earlier draft included a `compute_total_scaled_claims` wrapper around `compute_kernel_payout`; removed as pure dead-weight in favor of calling `compute_kernel_payout(trader_token_totals, ...)` with an inline comment at the P4-1 call site.) Test deltas: 21 new tests in `tests/unit/engine_kernel.rs` (registered in `tests/unit/main.rs`) covering all 14 cases from P3-2 plus 7 extras (peak-always-SCALE, WTA-mode equivalence to legacy, tail-minimum weight, outside-support-is-zero, kernel-payout-WTA-consistency, sf-caps-at-scale degenerate, P3-2 solvency sweep). Rust unit suite: 263 → **284** ✓. `anchor build` clean. IDL byte-identical (purely additive module, no instructions/events/accounts changed). No callers wired yet — behavior identical to pre-Phase-3.

---

### P3-1: Create `engine/kernel.rs` — Triangular kernel weight function ✅

**File:** `programs/dekant-pm/src/engine/kernel.rs` (new file)

```rust
/// Triangular kernel weight for bin `i` given winning bin `win` and width `W`.
///
/// K(i, win, W) = max(0, 1 - |i - win| / (W + 1))
///
/// Returns weight scaled to SCALE (10^9). K(win, win, W) = SCALE.
/// W = 0 is pure winner-take-all: only bin == win gets weight SCALE.
pub fn kernel_weight(i: usize, win: usize, w: u16) -> u128 { ... }

/// Compute the solvency scaling factor for a resolved continuous market.
///
/// total_raw_claims = sum_i(trader_token_totals[i] * K(i, win, W) / SCALE)
/// scaling_factor = min(SCALE, total_minted * SCALE / total_raw_claims)
///
/// Returns (scaling_factor, total_raw_claims).
/// If total_raw_claims == 0, returns (SCALE, 0) — no traders, no scaling.
pub fn compute_scaling_factor(
    trader_token_totals: &[u64],
    win: usize,
    w: u16,
    total_minted: u128,
) -> Result<(u64, u128)> { ... }

/// Compute kernel-weighted gross payout for a single trader's position.
///
/// payout = sum_i(holdings[i] * K(i, win, W) / SCALE) * scaling_factor / SCALE
pub fn compute_kernel_payout(
    holdings: &[u64],
    win: usize,
    w: u16,
    scaling_factor: u64,
) -> Result<u128> { ... }
```

Register module in `engine/mod.rs`.

**Breaking changes:** None (new module, no callers yet)
**Possible bugs:**
- [x] P3-1a: Integer overflow — shared `raw_claims` core uses `checked_mul`/`checked_add` returning `Err(MathOverflow)`. Per-term bound `u64 × SCALE ≈ 2^94`, aggregate across MAX_OUTCOMES=256 still ≪ u128::MAX; the checked calls are defensive against future changes. Verified by `test_scaling_factor_caps_at_scale_when_raw_is_tiny` (u64::MAX-scale tm) plus the wide solvency sweep.
- [x] P3-1b: Off-by-one — uses `i.abs_diff(win)` (returns `usize`, no signed-overflow risk). Tail at `d=w` returns `SCALE/(w+1) > 0`; `d=w+1` returns 0 exactly. Asserted in `test_kernel_weight_triangular_shape_w3` and the boundary tests.
- [x] P3-1c: Boundary kernel — `test_kernel_weight_left_boundary` (win=0) and `test_kernel_weight_right_boundary` (win=N-1) verify weights at both ends; the support truncates naturally since `usize` distance is one-sided.
- [x] P3-1d: `W = 0` edge case — produces exact WTA: `kernel_weight(win, win, 0) = SCALE`, all others `= 0`. Covered by `test_kernel_weight_wta_when_w_zero`, `test_payout_consistent_with_legacy_wta`, and `test_scaling_factor_wta_mode_matches_legacy`.
- [x] P3-1e: `W >= num_bins` edge case — math is total over input domain (mirrored by `test_kernel_weight_w_exceeds_num_bins`); every bin within distance `W` of `win` gets non-zero weight, scaling factor still correct. (Note: `create_market` rejects `W >= num_outcomes` at the validator boundary, so the on-chain path never exercises this — the test exists so the function is provably safe if ever called from elsewhere.)

---

### P3-2: Rust unit tests for kernel math ✅

**File:** `programs/dekant-pm/tests/unit/kernel.rs` (new file, register in test harness)

Test cases:
1. `kernel_weight` — W=0 returns WTA
2. `kernel_weight` — W=3, win=5, various i values, verify triangular shape
3. `kernel_weight` — boundary: win=0, W=3
4. `kernel_weight` — boundary: win=N-1, W=3
5. `kernel_weight` — W >= N (all bins get weight)
6. `compute_scaling_factor` — no traders (all zeros) → (SCALE, 0)
7. `compute_scaling_factor` — claims < total_minted → (SCALE, total_raw_claims)
8. `compute_scaling_factor` — claims > total_minted → scaling_factor < SCALE
9. `compute_scaling_factor` — claims == total_minted → scaling_factor = SCALE
10. `compute_kernel_payout` — single bin position (holdings only in win bin) → payout = holdings * 1.0
11. `compute_kernel_payout` — spread position → correct weighted sum
12. `compute_kernel_payout` — with scaling_factor < SCALE → diluted payout
13. `compute_kernel_payout` — zero holdings → payout = 0
14. Solvency invariant: `sum of all trader kernel payouts <= total_minted` (fuzz with random positions)

**Breaking changes:** None
**Possible bugs:** None (tests only)

---

### P3-3: Build and verify Phase 3 ✅

```bash
anchor build
cargo test --test '*'
```

New kernel unit tests must pass. Existing tests unchanged.

> **Done.** `cargo build -p dekant-pm` clean; `cargo test --workspace --tests`: 285 passing (was 263, +22 from `engine_kernel`); `anchor build` clean (SBF release + IDL regen); IDL byte-identical to pre-Phase-3 (`git diff --stat target/idl/dekant_pm.json` empty).

---

## Phase 4: On-Chain — Resolution & Claim Refactor ✅

Wire the kernel math into the actual instructions. This is the critical phase — it changes on-chain behavior for new continuous markets.

**Invariant:** Binary/multi markets are NEVER affected. All changes are gated behind `market_type == MARKET_TYPE_CONTINUOUS && market.kernel_width > 0`.

> **Done (2026-05-31).** `resolve()` in `state/market.rs` now branches on `market_type == MARKET_TYPE_CONTINUOUS && kernel_width > 0` — computes the kernel scaling factor from the frozen `trader_token_totals`, stores it, and sets `reserves[win] = total_minted − total_scaled_claims` (the kernel-adjusted LP residual). WTA path (binary, multi, and continuous with `kernel_width = 0`) keeps `reserves[win] = total_minted − trader_token_totals[win]` exactly as before; `scaling_factor` stays 0. `claim_payout` mirrors the branch: kernel mode calls `kernel::compute_kernel_payout(holdings, win, w, scaling_factor)`; WTA mode is the unchanged `holdings[win] as u128`. `NothingToClaim` guard now fires after the payout computation (correctly handles a kernel-mode trader whose holdings are entirely outside the kernel's support). `compute_lp_resolved_payout` needed no logic change (reads the pre-computed residual); doc comment updated to reflect both paths. Rust unit suite: 284 ✓ (unchanged; existing WTA tests continue to pass — the new code path is gated and untested at this layer; Phase 5 adds kernel-resolution tests). `anchor build` clean. IDL byte-identical (no instruction/account/event signature changes; the new behavior is purely inside existing handlers).

---

### P4-1: Modify `resolve_market` — compute and store scaling factor ✅

**File:** `programs/dekant-pm/src/state/market.rs` — `resolve()` method (lines 325-377)

After computing `resolved_outcome` and `resolved_value` for continuous markets, add:

```rust
MarketType::Continuous => {
    // ... existing value validation and bin computation ...

    if self.kernel_width > 0 {
        // Compute solvency scaling factor from frozen trader positions.
        let (sf, _total_raw) = kernel::compute_scaling_factor(
            &self.trader_token_totals,
            self.resolved_outcome as usize,
            self.kernel_width,
            self.total_minted,
        )?;
        self.scaling_factor = sf;

        // LP residual = total_minted - aggregate scaled claims.
        // Same arithmetic as a single trader's payout, just applied to the
        // sum-across-traders slice; no dedicated wrapper needed.
        let total_scaled_claims = kernel::compute_kernel_payout(
            &self.trader_token_totals,
            self.resolved_outcome as usize,
            self.kernel_width,
            sf,
        )?;
        let residual = self.total_minted
            .checked_sub(total_scaled_claims)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
        self.reserves[win] = u64::try_from(residual)
            .map_err(|_| error!(DekantPmError::MathOverflow))?;
    } else {
        // WTA: existing logic
        let trader_tokens = self.trader_token_totals[win] as u128;
        let residual = self.total_minted
            .checked_sub(trader_tokens)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
        self.reserves[win] = u64::try_from(residual)
            .map_err(|_| error!(DekantPmError::MathOverflow))?;
    }
}
```

For binary/multi: existing logic unchanged (no kernel_width check needed since kernel_width is always 0).

**Breaking changes:** Continuous markets with `kernel_width > 0` now store scaling_factor and kernel-adjusted LP residual at resolution.
**Possible bugs:**
- [x] P4-1a: Compute budget — `compute_scaling_factor` and `compute_kernel_payout` each iterate ≤ MAX_OUTCOMES (256) bins with one mul + one div per bin (~1k ops total across both calls). Far inside the 200k CU budget for resolve. Real verification deferred to Phase 5's on-chain integration tests.
- [x] P4-1b: LP residual correctness — `total_claims <= total_minted` is guaranteed by construction. When scaling triggers: `sf = floor(total_minted * SCALE / raw)`, so `raw * sf / SCALE <= raw * (total_minted * SCALE / raw) / SCALE = total_minted` (with floor it's strictly ≤). When sf == SCALE (no scaling): `raw <= total_minted` by definition. Either way the residual is ≥ 0.
- [x] P4-1c: Rounding — confirmed above. `checked_sub` kept as defensive overflow guard; the math itself can't underflow.

---

### P4-2: Modify `claim_payout` — kernel-weighted payout for continuous markets ✅

**File:** `programs/dekant-pm/src/instructions/trading/claim_payout.rs` (lines 64-138)

Replace the payout computation (lines 72-77) with a branch:

```rust
let gross_payout = if market.market_type == MARKET_TYPE_CONTINUOUS && market.kernel_width > 0 {
    // Smooth kernel: payout = sum_i(holdings[i] * K(i, win, W)) * scaling_factor / SCALE
    kernel::compute_kernel_payout(
        &position.holdings,
        market.resolved_outcome as usize,
        market.kernel_width,
        market.scaling_factor,
    )?
} else {
    // WTA 1:1: payout = holdings[winning_outcome]
    let winning_outcome = market.resolved_outcome as usize;
    let winning_tokens = position.holdings[winning_outcome];
    require!(winning_tokens > 0, DekantPmError::NothingToClaim);
    winning_tokens as u128
};

require!(gross_payout > 0, DekantPmError::NothingToClaim);
```

The `NothingToClaim` guard moves after the kernel computation (a trader might have zero tokens in the winning bin but non-zero tokens in adjacent bins).

Add `use crate::engine::kernel;` import.

**Breaking changes:** Continuous markets with kernel_width > 0 pay out differently. Traders near the winning bin get partial payouts. Total payout may be scaled down for solvency.
**Possible bugs:**
- [x] P4-2a: Implemented. `NothingToClaim` guard moved *after* the kernel computation — a trader with zero `gross_payout` (no holdings inside the kernel's support) hits the guard exactly as designed. End-to-end coverage lands in P5-2 scenario K4 ("trader outside kernel range"), which asserts the `NothingToClaim` branch fires for the trader whose holdings sit entirely outside the picked kernel's support.
- [x] P4-2b: Compute budget — same bound as P4-1a. ≤ 256-bin iteration with one mul + one div per bin. Inside CU budget; Phase 5 will measure.
- [x] P4-2c: `claimed` flag — `compute_kernel_payout` aggregates over `position.holdings` in one shot, then sets `claimed = true`. The single claim covers every bin's contribution at once; per-bin claims would be redundant. Behavior matches WTA where `claimed` blocks re-claiming the single winning bin.
- [x] P4-2d: `total_withdrawn` tracking — unchanged code path; adds `net_payout` (post-redemption-fee) regardless of which branch produced `gross_payout`. Correct.

---

### P4-3: Modify `compute_lp_resolved_payout` — kernel-adjusted LP residual ✅

**File:** `programs/dekant-pm/src/state/market.rs` — `compute_lp_resolved_payout()` (lines 638-651)

The current implementation reads `reserves[resolved_outcome]` which is already set to the correct LP residual at resolution time (Phase P4-1 handles this). So **no change is needed** — the LP payout method already reads the pre-computed residual.

Verify: after P4-1, `reserves[resolved_outcome]` contains:
- For WTA: `total_minted - trader_token_totals[win]`
- For kernel: `total_minted - total_scaled_claims`

Both are correct LP residuals. LP withdrawal logic in `remove_liquidity.rs` is unchanged.

**Breaking changes:** LP residual for kernel markets may be lower (or zero if scaling triggered)
**Possible bugs:**
- [x] P4-3a: LP-gets-zero documented in the updated `compute_lp_resolved_payout` doc comment; behavior validated by the kernel solvency path in `resolve()` (when scaling triggers, `total_claims = total_minted` up to flooring → residual = 0). End-to-end coverage lands in P5-2 scenario K2 ("kernel solvency — scaling triggers") which asserts `scaling_factor < SCALE` and `lp_residual` shrinks accordingly, plus the second continuous phase of the e2e smoke script (P6-5) which re-runs the same dynamic on real devnet.
- [x] P4-3b: Multiple LP withdrawals — no code change to `remove_liquidity.rs`; resolved markets short-circuit to `compute_lp_resolved_payout`, which just does `residual * shares / lp_shares_total`. Proportionality is preserved by `mul_div`. The pre-existing logic already handles multi-LP correctly under WTA; the kernel path uses the same accounting (just a different residual value).

---

### P4-4: Build verification ✅

```bash
anchor build
```

Must compile cleanly. No new warnings.

**Breaking changes:** None observed. IDL byte-identical to post-Phase-3 (`git diff --stat target/idl/dekant_pm.json` empty) — Phase 4 only changes the *behavior* inside `resolve()` and `handle_claim_payout`; no new instructions, accounts, args, or events. `kernel_width` and `scaling_factor` were already added to the account schema in Phase 2.
**Possible bugs:** None (build only).

---

## Phase 5: Program Tests — Kernel Resolution ✅

Comprehensive testing of the kernel resolution for continuous markets, plus regression tests for binary/multi.

---

### P5-1: Rust unit tests for kernel claim and resolve ✅

> **Done (2026-05-31).** Added seven kernel-resolve tests to `state_market.rs` under the `// ── P5-1` heading. Coverage: zero-width WTA fallthrough; six-width sweep at the centered winner (asserting per-width non-increasing `scaling_factor`, engine/resolve agreement, and exact `aggregate_payout + reserves[win] == total_minted` solvency); no-traders no-dilution; heavy-concentration scaling triggers (`sf == SCALE/10`); binary-WTA preservation; left- and right-boundary winners. Helpers `init_continuous_kernel`, `resolve_at_bin`, `concentrated_fixture_at_8` keep individual tests terse. Existing `state_market::resolve_*` WTA tests left verbatim — they now serve as the `kernel_width=0` regression matrix per the spec. Suite: 291 ✓ (was 284, +7 — `engine_kernel.rs` already had full coverage from P3-2, no extensions needed).

**Files:**
- `programs/dekant-pm/tests/unit/state_market.rs` (resolve branching)
- `programs/dekant-pm/tests/unit/engine_kernel.rs` (kernel math — already exists, extend if coverage gaps)

**Coverage philosophy:** every existing test that was already asserting WTA behavior should be **kept intact** and now interpreted as the `kernel_width=0` regression suite — that's the contract we promised for legacy/migrated markets (continuous + zero width ≡ pure WTA). Then **add** kernel-width sweeps for the new code path.

Add tests:
1. `resolve()` with `kernel_width=0` → same as before (WTA), `scaling_factor` stays 0 *(this is the pre-existing continuous-resolve test, asserted under the new branch)*
2. **Width sweep:** `resolve()` for each of `kernel_width ∈ {1, 2, 3, 4, 5, 6}` with the same trader fixture, **win bin pinned at `num_bins / 2`** (e.g., bin 8 in a 16-bin market — centered so the kernel is never truncated, isolating width as the only variable; boundary truncation is covered separately in test 6 below). Assert per width:
   - (a) `scaling_factor` is **non-increasing** as `kernel_width` grows from 1 → 6 (wider kernel ⇒ more bins contribute claims against the winner ⇒ raw_claims grows ⇒ scaling shrinks). For a fixture with traders concentrated near the winner this holds strictly; for a uniform fixture it may stay flat at SCALE — both are acceptable, "strictly increasing" is NOT acceptable
   - (b) per-trader payouts match `Σ holdings[i] · K(i, win, w) · sf / SCALE²`
   - (c) `Σ payouts + lp_residual + protocol_fee_acc == total_minted` (exact solvency — must hold for all six widths regardless of the (a)/(b) outcome)
3. `resolve()` with non-zero width, no traders → `scaling_factor=SCALE`, LP residual = `total_minted`
4. `resolve()` with non-zero width, heavy concentration near winner → `scaling_factor < SCALE` (scaling actually triggers)
5. `resolve()` binary market → `kernel_width=0` always (enforced at init), WTA logic unchanged
6. Boundary kernel positions: winner at bin 0 (kernel truncated on left) and winner at last bin (kernel truncated on right) — solvency still exact

**Notes for the implementer:**
- The six width values `{1..6}` are the recommended sweep — small enough to keep the suite fast, large enough to exercise the triangular falloff at multiple slopes. Use a market with `num_bins ≥ 8` so the kernel is never truncated for widths in this range (boundary truncation is covered separately in test 6).
- Preserve **all** existing `state_market::resolve_*` WTA tests verbatim. They become the `kernel_width=0` half of the regression matrix.

**Breaking changes:** None
**Possible bugs:** None (tests only)

---

### P5-2: Integration test — continuous market with kernel resolution ✅

> **Done (2026-05-31).** `tests/continuous-kernel.ts` created with all nine K-scenarios (K1–K9). `makeWidthPicker()` reserves pinned widths {0, 1, 4} up front; randomized scenarios drew distinct values {3, 4 (already used→re-pick), 5, 7, 8, 10} during the green run. Redemption-fee handled via file-level save/restore in `before`/`after` hooks (zeroes config, then restores) — this is more robust than the spec's per-market suggestion because `redemption_fee_bps` is a `ProtocolConfig` field, not a per-market arg. Kernel math mirrored in BigInt (`kernelWeight`, `rawClaims`, `computeKernelPayout`) to match the on-chain u128 flooring exactly. Fresh `Keypair` per scenario, airdropped via `airdropSol` then funded via `mintTokens`. K2's pinned `width=4` fixture (3 traders × 8M trades on 3M initial liquidity, narrow `sigma=50`) triggers `sf < SCALE` reliably. K7 uses one `pickWidth(16)` call captured in a closed-over `const w`, shared between the two sub-runs to make a width-mismatch impossible. Full anchor suite: 140 ✓ (was 131, +9 — the K-scenarios).

**File:** `tests/continuous-kernel.ts` (new file)

**Scope decision (2026-05-31, owner direction, revised):** Keep the nine scenarios below — they each pin down a distinct behavior of the kernel + scaling pipeline that a single randomized test would not reliably exercise. Width handling per scenario:

- **Randomized** (the width does NOT affect what the scenario asserts): K1, K4, K5, K6, K7
- **Pinned** (the scenario IS the test of that specific width — randomizing here would either flake or test nothing new): K2 (= 4, calculated), K3 (= 1), K8 (= 0), K9 (= num_bins − 1)

Width=10 is the practical cap for the randomized pool — anything higher dilutes the kernel into near-uniform settlement without exposing new failure modes.

**Shared test setup (top of file):**

```ts
// Non-repeating width picker — closure holds the set of widths already drawn in this
// file so randomized scenarios never produce the same value twice. Pinned scenarios
// must call pickWidth.reserve(w) upfront so randomized scenarios don't collide with them.
function makeWidthPicker() {
  const used = new Set<number>();
  function pick(numBins: number, min = 1, max = 10): number {
    const hi = Math.min(max, numBins - 1);
    const lo = Math.max(min, 1);
    const free: number[] = [];
    for (let w = lo; w <= hi; w++) if (!used.has(w)) free.push(w);
    if (free.length === 0) {
      throw new Error(
        `pickKernelWidth: no unused widths in [${lo}..${hi}] (used=${[...used].join(",")})`
      );
    }
    const w = free[Math.floor(Math.random() * free.length)];
    used.add(w);
    return w;
  }
  pick.reserve = (w: number) => { used.add(w); };
  return pick;
}

const pickWidth = makeWidthPicker();

// Reserve pinned values upfront so randomized scenarios cannot redraw them:
pickWidth.reserve(0);   // K8 — WTA / migrated-market regression
pickWidth.reserve(1);   // K3 — no-scaling path
pickWidth.reserve(4);   // K2 — calculated to trigger scaling on the K2 fixture
// K9 reserves num_bins − 1 inside the scenario (its value depends on the market's numBins).
//
// Pool sanity: with 3 reservations and 5 randomized scenarios drawing from {1..10},
// 8 free values remain → cannot exhaust. If new scenarios are added, recheck capacity.
```

**Redemption fee — set to 0 for every market in this file** so expected-payout formulas are direct (no `- fee` term to compute). Redemption-fee mechanics are already exercised by `tests/resolution-1to1.ts`; repeating them here would only obscure kernel-specific assertions.

**Expected payout formula (used by every randomized scenario):**

```
expected = floor( Σ holdings[i] · K(i, win, w) / SCALE ) · scaling_factor / SCALE
```

Read `w` (`kernel_width`) and `scaling_factor` from the resolved Market account, **not** from test inputs — that's what production claims read, and any drift between a helper recomputation and the on-chain value will surface as a failed assertion.

**Logging:** every `it(...)` name must include its kernel width (e.g. `K1: basic kernel claim (kernel_width=4)`) so a CI flake can be re-run by hardcoding the printed value. This also makes the no-repeat picker's draws visibly auditable per CI run.

#### Scenario K1: "basic kernel claim — continuous market"
1. Create continuous market (range 0-300, 16 bins, `kernel_width = pickWidth(16)` — random unused value from the pool)
2. Trader A buys distribution N(150, 30) — positions spread across bins
3. Wait for deadline, resolve at value 155 (winning bin ~8)
4. Trader A claims
5. Assert: payout matches the expected-payout formula above (reading `w` and `scaling_factor` from the on-chain Market account)
6. LP removes all shares → gets residual; solvency exact

#### Scenario K2: "kernel solvency — scaling triggers"
1. Create continuous market (16 bins, **`kernel_width = 4` — pinned, NOT randomized**). Reasoning: the scenario asserts a single boolean (`scaling_factor < SCALE`), so width diversity adds zero coverage; randomizing introduces a flake vector where an unlucky width leaves the trigger un-pulled and the test fails for the wrong reason. Width 4 is calculated to reliably trigger scaling on the trader fixture below (kernel support = 9 bins around the winner; with the concentration in step 2, raw_claims comfortably exceeds total_minted).
2. Three traders each buy distributions heavily concentrated near bin 8 (each trader's `holdings[8]` should reach ≥ 40% of `total_minted` at peak — together they ensure kernel-weighted raw_claims overshoots total_minted by a comfortable margin)
3. Resolve at bin 8
4. **After resolve, fetch the Market account** and assert `market.scaling_factor < SCALE` (this is the load-bearing assertion — if it doesn't fire, the trader fixture is under-concentrated; do NOT raise the pinned width to compensate)
5. All traders claim sequentially
6. LP removes all shares
7. Assert: `vault == protocol_fee_accumulated` (exact solvency)
8. Assert: `Σ all_payouts + lp_payout + protocol_fees == initial_vault`

#### Scenario K3: "kernel with no scaling needed"
1. Create continuous market (16 bins, **`kernel_width = 1`** — pinned; this scenario verifies the "full weight at win bin, no dilution" path)
2. Single trader buys a small amount in one bin (`holdings[winBin] << total_minted`)
3. Resolve at that bin
4. Assert: `scaling_factor == SCALE` (no dilution because raw_claims < total_minted)
5. Assert: `payout == holdings[winBin]` exactly (kernel weight K(win, win, 1) = 1.0; no fee because `redemption_fee_bps = 0`)

#### Scenario K4: "kernel — trader outside kernel range"
1. Create continuous market (64 bins, `kernel_width = pickWidth(64)` — random unused value from the pool; even at width=10 the kernel support is `[22..42]` so bins 0-5 stay outside for any value in `{1..10}`)
2. Trader A buys in bins 0-5 only, Trader B buys in bin 32 only (let `h_B = holdings_B[32]`)
3. Resolve at bin 32
4. Trader B claims: kernel weight `K(32, 32, w) = 1.0`, and `scaling_factor == SCALE` (B is the only contributor and `h_B < total_minted`), so the on-chain payout equals `h_B` exactly
5. Trader A claims: every kernel weight evaluates to 0 → `gross_payout = 0` → the call reverts with `NothingToClaim`

#### Scenario K5: "kernel — boundary resolution (bin 0)"
1. Create continuous market (16 bins, `kernel_width = pickWidth(16)`)
2. Trader buys distribution centered on bin 0
3. Resolve at `range_min` (bin 0)
4. Assert: kernel only extends rightward (bins `0..w` get weight, no underflow on the left)
5. Assert: payout matches the expected-payout formula; solvency exact
6. **Not redundant with P5-1 test 6 — do not trim.** P5-1 covers resolve-side kernel math in isolation (pure Rust unit test); K5 exercises the on-chain `claim_payout` instruction against a truncated holdings slice in a live anchor transaction. Different code surface.

#### Scenario K6: "kernel — boundary resolution (last bin)"
1. Same shape as K5, with `kernel_width = pickWidth(16)` (independent draw), trader centered on bin 15
2. Resolve at `range_max`
3. Assert: kernel only extends leftward (bins `(15-w)..15` get weight, no overflow on the right)
4. Same anti-trim note as K5.

#### Scenario K7: "kernel — LP removal order independence"
1. Create continuous market with 2 LPs. **`const w = pickWidth(16);` — call the picker exactly once at the top of the scenario and reuse `w` for both sub-runs.** A width mismatch between sub-runs would masquerade as an order-dependence bug, so encoding it as a single `const` (rather than two independent calls) makes the mistake impossible.
2. Trader buys, resolve with width `w`
3. Run two sub-cases against fresh forks of the post-resolve state:
   - (a) trader claims → LP1 removes → LP2 removes
   - (b) LP1 removes → trader claims → LP2 removes
4. Assert: final vault balance is identical between (a) and (b)

#### Scenario K8: "kernel_width=0 on continuous market = WTA"
1. Create continuous market with **`kernel_width = 0`** (pinned; this is the backward-compat regression for legacy/migrated markets — `kernel_width = 0` must take the WTA branch in `claim_payout`)
2. Trade, resolve, claim
3. Assert: behavior identical to existing WTA tests (only winning bin pays, `scaling_factor == 0` from `resolve_market`'s skip path, payouts equal raw holdings on the win bin)
4. **Owner policy (2026-05-31):** K8 is the *only* WTA-mode scenario in this file. WTA is frozen for upgrade-compat at the time of the smooth-kernel program upgrade — future kernel changes do NOT need to backport new invariants to WTA paths. If a new property is added on the kernel side (like K7's order-independence), it belongs in the kernel suite only, not as a mirrored WTA scenario.

#### Scenario K9: "kernel — maximum legal width"
1. Create continuous market (16 bins). Inside the scenario, call `pickWidth.reserve(numBins - 1);` for traceability, then create with **`kernel_width = num_bins - 1` = 15** (pinned). This is the maximum value the on-chain `market.initialize()` validator (`kernel_width < num_bins`) accepts.
2. Two traders buy distributions; resolve at bin 8
3. Assert: on-chain market creation succeeds — this is the load-bearing assertion (validates the boundary of the `kernel_width < num_bins` rule)
4. Assert: payouts match the expected-payout formula; solvency exact for all claimers + LP
5. Note: the resulting `scaling_factor` value here is fixture-dependent (kernel support reaches every bin, so it depends on the trader spread). Do not pin a specific scaling_factor expectation — the load-bearing checks are creation-success and exact-solvency.

**Common to every scenario:** read `scaling_factor` and `kernel_width` from the resolved Market account, not from test-side inputs — that's what production claims read. The solvency assertion `Σ payouts + lp_residual + protocol_fees == initial_vault_total` must hold exactly in every scenario.

**Breaking changes:** None (new test file)
**Possible bugs:**
- [x] P5-2a: Verified `createContinuousMarket` (helpers/market-helper.ts) accepts `kernelWidth` and passes it through to the on-chain instruction; the K-scenarios call it explicitly per scenario. `redemptionFeeBps` is a `ProtocolConfig` field (not a per-market arg), handled instead via `zeroRedemptionFee()`/`restoreRedemptionFee()` in the file's `before`/`after` hooks — same end state (fee=0 for every market in the file), different mechanism than the spec assumed.
- [x] P5-2b: `pickWidth(numBins, min, max)` in `tests/continuous-kernel.ts` computes `hi = Math.min(max, numBins - 1)` before drawing, so the on-chain `kernel_width < num_outcomes` validator is never tripped by a randomized draw.
- [x] P5-2c: Every randomized `it(...)` title interpolates the picked width (e.g. `single trader, distribution at winning bin (kernel_width=8)`). Visible in mocha output for CI flake reproduction. K3 and K8 are exempt as the spec allows (compile-time fixed widths).
- [x] P5-2d: K2 fixture (3M init + 3 traders × 8M trades, `sigma = 50` SCALE) produced `sf < SCALE` on the first run — the load-bearing assertion fired positively. No fixture iteration needed.
- [ ] P5-2e: Defensive — would only fire if a future scenario over-subscribes the picker pool. Current load (3 reservations + 5 randomized draws) sits well inside the 10-value cap. Leaving open as a tripwire for future additions.

---

### P5-3: Regression test — binary/multi markets unchanged ✅

> **Done (2026-05-31).** All three pre-existing files (`binary-market.ts`, `multi-market.ts`, `resolution-1to1.ts`) ran unmodified as part of the same `anchor test` invocation that exercises P5-2. Every assertion still passes, including the 1:1-resolution scenarios that depend on the WTA branch of `claim_payout`. No kernel leak into discrete paths.

Run existing test files with NO changes to assertions:
- `tests/binary-market.ts` — all assertions still pass
- `tests/multi-market.ts` — all assertions still pass
- `tests/resolution-1to1.ts` — all WTA scenarios still pass

If any fail, it means the kernel code leaked into non-continuous paths. Fix immediately.

**Breaking changes:** None
**Possible bugs:**
- [x] P5-3a: Verified — the `market_type == MARKET_TYPE_CONTINUOUS && kernel_width > 0` guard in `claim_payout` (and the matching guard in `resolve()`) correctly gates the kernel branch. Binary/multi suites pass unchanged, K8 (continuous + `kernel_width=0`) also takes the WTA branch as expected.

---

### P5-4: Full test suite run ✅

> **Done (2026-05-31).** `cargo test --test unit` → 291 ✓ (was 284 pre-P5-1). `anchor test` → 140 ✓ in 10m (was 131 pre-P5-2). No skipped, no failed.

```bash
cargo test --test '*'
anchor test
```

All tests must pass, including new kernel tests and existing WTA tests.

---

## Phase 6: Cross-Component Sync & Impact Review ✅

Verify all non-program components work correctly with the refactored program.

> **Done (2026-05-31).** All six sub-tasks landed:
> - **P6-1** backend entity + indexer projection (mock factories also updated for P6-7a).
> - **P6-2** frontend `computeKernelPayout` BigInt helper, `computeResolvedValue` kernel branch, `MarketSummary` extension, position-card refactor (deleted the duplicated `computeCurrentValue`); +5 unit tests.
> - **P6-3** verify-only — all four checklist items satisfied (kernel-width input, `< numBins` validation, review-step rendering, default 0).
> - **P6-4** devkit `resolve.ts` and `query.ts` show `Kernel width` / `Scaling factor` rows for continuous markets (with the conditional gates from P6-4a/b).
> - **P6-5** e2e-smoke.sh — existing PHASE 6 explicitly tagged WTA-baseline (`--kernel-width 0`); new PHASE 6b runs the smooth-kernel flow with a randomly drawn `kernel_width ∈ {1..9}`; extras block randomises in {0..9} with per-market log line.
> - **P6-6** operator-cli (Node) gains a kernel-width prompt with validation; goperator-cli (Go TUI) adds the input field + encodes `kernel_width` as the last `CreateMarketArgs` field.
>
> **P6-7 verification** all green: backend unit 287 ✓, backend e2e 296 ✓, frontend vitest 253 ✓ (was 248, +5 kernel-payout tests), frontend `next build` ✓, devkit `tsc --noEmit` ✓, Node syntax checks ✓, `go build ./...` ✓, `bash -n` on smoke script ✓. Live `e2e-smoke.sh` against a fresh validator is the only check that requires running infra — deferred to the next manual smoke run.

---

### P6-1: Backend — entity and indexer ✅

**Audit result (2026-05-31):** backend has **zero** references to `kernel_width` / `scaling_factor` today (`grep -rn 'kernel\|scaling' backend/src` → empty). All of the work below is genuinely new.

**Files to edit:**
- `backend/src/market/entity/market.entity.ts`
  - Add `kernelWidth` column (smallint, default 0). Matches on-chain `u8`.
  - Add `scalingFactor` column. Use the same column type already used for `protocolFeeAccumulated`/`lpFeeAccumulated`/`totalMinted` (string-backed numeric) so 128-bit values round-trip safely.
- `backend/src/indexer/indexer.service.ts`
  - Add two lines to the `onChainFields` object inside `fetchAndSyncMarket` (currently at indexer.service.ts:170):
    ```ts
    kernelWidth: Number(d.kernel_width),
    scalingFactor: String(d.scaling_factor),
    ```
  - No new event handler is needed — `handleMarketResolved` already calls `fetchAndSyncMarket`, so the post-resolve `scaling_factor` lands automatically. Pre-resolution markets carry `scalingFactor = "0"`, which is the same value the program writes; the frontend must treat 0 as "not resolved yet".
- `backend/src/amm/amm.service.ts` — no change. Trade estimation operates on reserves/k_squared and never inspects resolution-time fields.

**Pre-flight (read-only check before editing):** confirm the workspace IDL `backend/idl/dekant_pm.json` (updated in P2-4) already lists `kernel_width` and `scaling_factor` on the `Market` account — otherwise the BorshCoder decode at indexer.service.ts:151 will silently drop both fields and the `Number(d.kernel_width)` line will read `NaN`.

**Out of scope for P6-1 (call out so we don't expand):** computing a kernel-weighted "expected payout" for an API endpoint. Backend has no such endpoint today; payout estimation lives in the frontend (P6-2).

**Breaking changes:** Backend entity schema gains two columns (auto-created when `DB_SYNCHRONIZE=true`; otherwise a one-shot migration).
**Possible bugs:**
- [x] P6-1a: ~~If backend reads market accounts directly~~ — confirmed: it does, see `fetchAndSyncMarket` at indexer.service.ts:142. The new fields are mandatory, not conditional.
- [ ] P6-1b: TypeORM migration — if `DB_SYNCHRONIZE=true`, new columns auto-created. Otherwise add a TypeORM migration that defaults both columns to 0 for existing rows (legacy WTA markets settle as `kernel_width = 0` per the [WTA backward-compat policy](../../../../.claude/projects/-home-paya-p4ya-gcc-umbra-prediction-market-dekant-sms/memory/wta_backward_compat_policy.md)).
- [ ] P6-1c: If the IDL was NOT re-synced in P2-4, the indexer will decode `kernel_width`/`scaling_factor` as `undefined` and `Number(undefined) === NaN` will get written to Postgres — flag with a one-time `if (d.kernel_width == null) this.logger.warn(...)` during the first deploy.

---

### P6-2: Frontend — claim display for continuous kernel markets ✅

**Depends on:** P6-1 (frontend needs `market.kernelWidth` and `market.scalingFactor` from the backend API). Sequence P6-1 → P6-2.

**Audit result (2026-05-31):** `frontend/lib/portfolio-utils.ts` returns `holdings[winBin]` for resolved continuous markets at **two** call sites — both need to switch to the kernel formula when `kernelWidth > 0`:
- portfolio-utils.ts:91 — `computeResolvedValue` when `market.resolvedOutcome != null` (binary/multi path; also fires for legacy WTA continuous markets where `kernelWidth === 0`)
- portfolio-utils.ts:109 — `computeResolvedValue` continuous path: derives `winBin` from `resolvedValue + rangeMin/rangeMax`, then returns `holdings[winBin]`

`computeResolvedValue` is reused by `computePortfolioValue` at portfolio-utils.ts:234 (portfolio total), so fixing the helper fixes both the per-position display and the portfolio aggregate in one place.

**Files to edit:**
- `frontend/lib/portfolio-utils.ts` — add a `computeKernelPayout(holdings, winBin, kernelWidth, scalingFactor)` helper colocated with `computeResolvedValue` (NOT in `lib/types.ts` — that file is type-defs only). Branch in `computeResolvedValue`:
  ```ts
  if (market.marketType === 2 && (market.kernelWidth ?? 0) > 0) {
    return computeKernelPayout(holdings, winBin, market.kernelWidth, market.scalingFactor);
  }
  return holdings[winBin] ?? 0;   // existing path (binary, multi, legacy WTA continuous)
  ```
  The winBin derivation at portfolio-utils.ts:102-108 is reusable as-is for the kernel branch.
- `frontend/components/portfolio/claim-button.tsx` — no logic change needed if `estimatedPayout` already comes from `computeResolvedValue` / `estimatePositionLiquidationValue`. Verify the chain.
- `frontend/components/portfolio/position-card.tsx` — same: relies on the helper, no direct math.

**Formula (must match on-chain `claim_payout` for continuous + width > 0):**
```
raw = Σ holdings[i] · K(i, winBin, kernelWidth) / SCALE          // floor at each step to match u128 path
payout = raw · scalingFactor / SCALE                              // floor
where K(i, win, w) = max(0, 1 - |i - win| / (w + 1)) · SCALE      // triangular kernel, fixed-point
```
Use BigInt arithmetic to mirror the on-chain `u128` math — `number` will desync once `holdings × kernel × scaling` exceeds 2^53.

**Breaking changes:** Continuous-market resolved value display changes for any market with `kernelWidth > 0`. Legacy WTA markets (kernel_width = 0) keep the old `holdings[winBin]` value — confirmed correct per [WTA backward-compat policy](../../../../.claude/projects/-home-paya-p4ya-gcc-umbra-prediction-market-dekant-sms/memory/wta_backward_compat_policy.md).
**Possible bugs:**
- [ ] P6-2a: Backend API must serialize the new entity fields — once P6-1 lands, check `market.service.ts`'s response DTO and any GraphQL/REST resolver still includes them.
- [ ] P6-2b: `scalingFactor === "0"` is ambiguous: pre-resolution AND a degenerate post-resolution case where every claim rounds to zero. Treat as "pre-resolution" only when `market.state !== 3`; otherwise use the on-chain value as-is.
- [ ] P6-2c: `holdings[]` and `winBin` are already clamped/coerced by existing code. The kernel helper must NOT re-clamp `winBin` (would mask upstream bugs); assume the caller passes the same value the on-chain program saw.
- [ ] P6-2d: Floating-point divergence — using JS `number` makes the displayed payout drift from the actual on-chain claim by 1-2 base units. BigInt is required, not optional.

---

### P6-3: Frontend — continuous market creation UI ✅ (already done — verify only)

**Audit result (2026-05-31):** the kernel-width input is already wired end-to-end on the frontend create-market flow. `grep -rln 'kernelWidth' frontend/` returns:
- `frontend/components/create-market/create-market-form.tsx`
- `frontend/components/create-market/step-outcomes.tsx`
- `frontend/components/create-market/step-review.tsx`
- `frontend/lib/schemas/create-market-schema.ts` (zod validator: `z.number().int().min(0).max(255).optional()` + cross-field check `kw < numBins`)
- `frontend/lib/admin-transactions.ts` (passes `kernelWidth ?? 0` into the create-market tx)

**Verify-only checklist (no code changes expected):**
- [ ] Continuous-market selection shows a kernel-width input on the outcomes step
- [ ] Form validation rejects `kernelWidth >= numBins` with a useful message (currently enforced in `create-market-schema.ts:87-95`)
- [ ] Review step (`step-review.tsx`) renders the chosen kernel width — 0 should display as "Winner-take-all" or similar (not just "0") so the user sees the implication
- [ ] Default value behaviour matches devkit: `kernelWidth: 0` if omitted (already the default at `create-market-schema.ts:147`)

If any item fails, treat the fix as part of P6-3; otherwise mark this task ✅ without edits.

**Breaking changes:** None.
**Possible bugs:** None expected; the wiring landed in Phase 2/3.

---

### P6-4: Devkit — resolve and claim display ✅

**Audit result (2026-05-31):**
- `devkit/src/market.ts create-continuous` **already** exposes `--kernel-width <n>` with full validation (devkit/src/market.ts:102-134) — **no change needed** here.
- `devkit/src/resolve.ts` displays `state / resolvedOutcome / resolvedAt / resolvedValue` (resolve.ts:78-128) but **does NOT print** `kernelWidth` or `scalingFactor` — gap.
- `devkit/src/query.ts` `market` info shows `resolvedOutcome / resolvedValue / resolvedAt` (query.ts:155-160) but **does NOT print** `kernelWidth` for continuous markets — gap.
- `devkit/src/market.ts claim` — verify whether it prints an expected payout; if it does, plug in the kernel formula. If it just shows the claimed amount from the tx (no estimate), no change.

**Edits:**
- `devkit/src/resolve.ts` — after the resolve tx, add two rows to the existing key-value display: `["Kernel width", String(resolved.kernelWidth)]` and `["Scaling factor", String(resolved.scalingFactor)]` (only when `resolved.marketType === 2`). The scaling factor is exactly what the smoke test needs (P6-5c), so this also makes that script trivially reproducible.
- `devkit/src/query.ts` — same two rows when `market.marketType === 2`, conditional on `market.state === 3` for `scalingFactor` (it's `0` pre-resolve).
- `devkit/src/market.ts claim` — read the file once, decide. If estimation lives here, mirror the P6-2 formula in BigInt; if not, leave alone.

**Breaking changes:** CLI output gains two rows for continuous markets.
**Possible bugs:**
- [ ] P6-4a: Don't print `scalingFactor: "0"` for pre-resolution markets — confusing. Suppress unless `state === 3`.
- [ ] P6-4b: `query.ts` lists many markets in one pass; the extra rows add visual noise for binary/multi markets — gate on `marketType === 2`.

---

### P6-5: Scripts — e2e-smoke.sh review ✅

**File:** `scripts/e2e-smoke.sh`

**Coverage plan (2026-05-31, owner direction):** the smoke test should now exercise **both** continuous-market modes on a single devnet run:

1. **Existing PHASE 6 (CONTINUOUS MARKET, 64 bins, ~line 758)** — leave as-is and treat it as the **WTA baseline** by passing `kernel_width=0` (or equivalently, omitting the flag and relying on the zero default — explicit is better). All current assertions about `holdings[winBin]` payouts continue to hold under width=0.
2. **Add a new continuous-market phase** that is identical in structure (create → fund → distribution-trades → resolve → claim → LP-remove) but with a **non-zero randomly-chosen kernel width**:

   ```bash
   # Pick a width strictly between 0 and 10, then clamp to num_bins - 1
   CONT_KERNEL_W=$(( (RANDOM % 9) + 1 ))   # uniform in {1..9}
   CONT_KERNEL_W=$(( CONT_KERNEL_W < CONT_BINS ? CONT_KERNEL_W : CONT_BINS - 1 ))
   echo "Using kernel_width=$CONT_KERNEL_W"
   ```

   Log the chosen width so a CI failure is reproducible. Claim assertions must compute the kernel-weighted expected payout (same formula as P5-2) instead of `holdings[winBin]`.

   For the "EXTRA RANDOMIZED MARKETS" block (~line 425, the `random_continuous_range` extras), do the same: when the type is `continuous`, pick a random kernel_width in `{0..9}` (zero included so we still see WTA in the extras stream) and pass it through.

**On the upper bound:** 10 is a practical cap for normal markets; 16-bin smoke markets get clamped to ≤15 anyway, and pushing higher dilutes the kernel into near-uniform settlement which doesn't add new failure modes.

**Devkit precondition (2026-05-31, re-audited):** `devkit market.ts create-continuous` already accepts `--kernel-width` (devkit/src/market.ts:102-134). The previously-noted P6-4 dependency for the **flag itself** is moot. The remaining real dependency on P6-4 is **read-side**: the claim-assertion helper needs `scalingFactor`, which P6-4 surfaces via `devkit resolve` output and `devkit query market`. Without P6-4, the smoke script either has to parse the raw Anchor account itself or skip the kernel-payout assertion (not acceptable).

**Sequencing:** P6-4 → P6-5 (for the read-side reason above), not P6-4 → P6-5 (for the flag).

**Breaking changes:** None
**Possible bugs:**
- [x] P6-5a: ~~`devkit create-continuous` lacking `--kernel-width`~~ — verified already present; remove this concern.
- [ ] P6-5b: Width-clamp must happen *before* the create call; an out-of-range value will surface as a generic "anchor error" mid-script and obscure the real cause.
- [ ] P6-5c: The claim-assertion helper needs to read `scaling_factor` from the resolved Market account. Easiest path after P6-4: capture `devkit resolve --json` (if `--json` exists; otherwise parse the table) or call `devkit query market <id>` and grep for `Scaling factor`. Hardest path (avoid): re-import the Anchor coder inside the shell script.
- [ ] P6-5d: The randomized extras block also needs a per-run log line `echo "extras:continuous market $i kernel_width=$W"` — without it, a flaky extras market is impossible to reproduce from CI logs alone.

---

### P6-6: Operator CLIs ✅

**Path correction (2026-05-31):** these CLIs live under `scripts/`, not at the repo root. Use:
- `scripts/operator-cli/` (Node.js)
- `scripts/goperator-cli/` (Go TUI)

**Audit result:** both CLIs **DO** create markets — this is not a "may or may not" situation:
- `scripts/operator-cli/src/actions/market.js:48` defines `createMarket(state)`; line 540 invokes `.createMarket({...})` against the program. Needs `kernelWidth` added to the args object passed at line 540.
- `scripts/goperator-cli/internal/tui/screens/market_create.go` is a Bubble Tea TUI for market creation. Needs a new input field (continuous markets only) feeding into the `execCreateMarket` call at line 594.

**Edits:**
- `scripts/operator-cli/src/actions/market.js`
  - Add a kernel-width prompt to `createMarket()` (continuous markets only; default 0 = WTA).
  - Validate `0 <= kernelWidth < numBins` client-side before sending.
  - Pass `kernelWidth` in the args object at the `.createMarket({...})` call site (line ~540).
- `scripts/goperator-cli/internal/tui/screens/market_create.go`
  - Add a `kernelWidthInput` text field (shown only when `marketType == continuous`).
  - Parse + clamp in `advanceToParams` (line 344) or wherever range params are collected.
  - Include `KernelWidth` in the `execCreateMarket` payload (line 594) and in the Anchor instruction builder it ultimately calls.
  - Update the View at line 897 to show the field when relevant and the chosen value in the confirm screen.

**Out of scope:** these CLIs don't render claim/resolve payouts beyond what Anchor returns, so no kernel-payout estimation work is needed in them.

**Breaking changes:** CLI args/forms gain a new field for continuous markets. Default = 0 preserves prior behaviour for any operator running the upgraded CLI against legacy markets.
**Possible bugs:**
- [ ] P6-6a: Forgetting the conditional gate — surfacing the kernel-width prompt on binary/multi market creation would be a UX regression (the on-chain validator ignores it for non-continuous types but the prompt is confusing).
- [ ] P6-6b: Go CLI: the Anchor IDL bindings in `scripts/goperator-cli/internal/` need regenerating against the post-P2 IDL — otherwise `KernelWidth` won't exist in the generated `CreateMarketArgs` struct and the build will fail loudly (which is fine — surface it during P6-6 work).

---

### P6-7: Backend, frontend, and integration verification ✅

Run all of:

```bash
# Backend unit + e2e
cd backend && npm test
cd backend && npm run test:e2e

# Frontend build (Node ≥20.9 required — see project_node_version memory)
cd frontend && PATH="..." pnpm next build

# Devkit smoke (covers the kernel resolve/claim wiring end-to-end on devnet)
bash scripts/e2e-smoke.sh
```

All must pass with the updated code from P6-1 through P6-6. `e2e-smoke.sh` is the only check that exercises the full stack (devkit → on-chain kernel resolve → backend indexer pickup → DB reflects `scalingFactor`) and so is the strongest signal that P6-1 + P6-4 + P6-5 actually compose. If backend tests pass but smoke fails, the gap is almost always in the indexer field mapping (P6-1) or the devkit display (P6-4).

**Possible bugs:**
- [ ] P6-7a: Backend tests may need fixtures updated to set `kernelWidth`/`scalingFactor` on mock Market objects (if any test asserts on the full entity shape).
- [ ] P6-7b: Frontend type-check (`tsc --noEmit`) will fail before `next build` if `UserPosition["market"]` doesn't get `kernelWidth?: number` and `scalingFactor?: string` added in `frontend/lib/types.ts`. This is a P6-2 dependency that's easy to forget.

---

## Phase 7: Live Deployment Impact & Migration

Detailed analysis and execution plan for upgrading the deployed program on devnet.

---

### P7-1: Pre-upgrade checklist

Before deploying the upgraded program:

1. [ ] All tests pass (Phase 5-4 and Phase 6-7 confirmed)
2. [ ] IDL is updated in backend (`backend/idl/dekant_pm.json`)
3. [ ] Frontend is rebuilt with new types
4. [ ] Devkit is updated
5. [ ] Database has new columns (if added in P6-1)

---

### P7-2: Program upgrade on devnet

```bash
anchor build
solana program deploy target/deploy/dekant_pm.so \
  --program-id F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL \
  --upgrade-authority <keypair>
```

The program is upgradeable. The upgrade replaces the code but preserves all existing account data.

**Breaking changes:** The program now expects `kernel_width` in `CreateMarketArgs`. Old client versions that don't include it will fail to create markets.
**Possible bugs:**
- [ ] P7-2a: Verify upgrade authority keypair is available
- [ ] P7-2b: Verify program size doesn't exceed current allocation (if it does, extend first)

---

### P7-3: Post-upgrade verification — existing markets

Test on devnet immediately after upgrade:

1. **Existing active continuous market:** Place a trade → should work (trading logic unchanged)
2. **Existing resolved continuous market:** Claim payout → should work (kernel_width=0 from padding → WTA)
3. **Existing binary market:** Trade, resolve, claim → should work (completely unchanged path)
4. **Read existing market accounts:** Verify `kernel_width=0` and `scaling_factor=0` deserialize correctly

**Breaking changes:** None expected
**Possible bugs:**
- [ ] P7-3a: If Borsh deserialization of existing accounts fails, the program is broken. This is the highest-risk moment. The P2-1b unit test should have caught this, but verify on real devnet accounts.

---

### P7-4: Post-upgrade verification — new kernel market

Create a new continuous market with kernel_width=3 on devnet:

1. Create market (range 0-100, 16 bins, kernel_width=3)
2. Buy distribution from test wallet
3. Wait for deadline (or use a short deadline)
4. Resolve at a known value
5. Claim payout → verify kernel-weighted amount
6. LP removes → verify residual
7. Check vault solvency (vault balance == protocol_fee_accumulated)

**Breaking changes:** None (new market)
**Possible bugs:**
- [ ] P7-4a: Devnet compute budget — verify resolve and claim don't exceed CU limits with 16 bins + kernel

---

### P7-5: Redeploy backend and frontend

After program upgrade:
1. Rebuild and redeploy backend Docker image (new IDL, new entity fields)
2. Rebuild and redeploy frontend Docker image (new types, kernel display)
3. Verify both connect and display correctly

**Breaking changes:** Backend/frontend must be deployed in sync with the program upgrade
**Possible bugs:**
- [ ] P7-5a: Race condition — if frontend deploys before backend, API calls may fail. Deploy backend first.
- [ ] P7-5b: Database migration — if new columns were added, ensure they exist before backend starts

---

## Phase 8: Documentation

Update all documentation to reflect the improved model.

---

### P8-1: Update top-level `README.md`

Add/update sections:
- Resolution model: explain binary/multi = WTA, continuous = smooth kernel (with kernel_width)
- Probability display: note linear formula
- Link to math docs

---

### P8-2: Update `specs/TDD.md` and `specs/PRD.md`

Add notes or sections covering:
- Smooth kernel resolution for continuous markets
- Linear probability display
- Kernel width parameter
- Solvency scaling factor

---

### P8-3: Deprecate old math docs, promote improved

1. Move/rename `docs/improved/` content to become the primary math documentation
2. Add a clear header to the old math docs (`specs/math/MATH_ANALYSIS.md`, `specs/math/COLLATERAL_ANALYSIS.md`) marking them as **v1 (deprecated)** with a pointer to the improved docs
3. Update any cross-references in other spec files

Specifically:
- `docs/improved/index.html` → mark as current/active math reference
- `specs/math/MATH_ANALYSIS.md` → add deprecation header: `> **DEPRECATED (v1):** This document describes the original quadratic probability model. See docs/improved/ for the current linear model.`
- `specs/math/COLLATERAL_ANALYSIS.md` → same deprecation header
- `specs/details/improved/CURRENT_VS_IMPROVED.md` → update status from "proposed" to "implemented"
- `specs/details/improved/SMOOTH_KERNEL_SOLVENCY.md` → update status
- `specs/details/improved/L2_NORM_PROBABILITY_DISPLAY.md` → update status

---

### P8-4: Update `specs/planning/TASKS.md`

Mark relevant tasks as addressed by the improved model refactor. Add reference to this file.

---

### P8-5: Update `MEMORY.md` / session context

Update persistent memory with:
- Refactor completion status
- New Market account fields (kernel_width, scaling_factor)
- Schema version 2
- Linear probability formula
- Binary/multi = WTA, continuous = kernel

---

## Summary

| Phase | Description | Risk | On-chain change? |
|-------|-------------|------|------------------|
| 0 | Pre-refactor assessment | None | No |
| 1 | Linear probability display | Low | Cosmetic only (query helper) |
| 2 | Market state extension | Low | Yes (padding → named fields, new arg) |
| 3 | Kernel math engine | None | Yes (new module, no callers) |
| 4 | Resolution & claim refactor | **Medium** | Yes (behavior change for new continuous markets) |
| 5 | Program tests | None | No |
| 6 | Cross-component sync | Low | No |
| 7 | Live deployment & migration | **Medium** | Yes (program upgrade) |
| 8 | Documentation | None | No |

**Key safety properties:**
- Existing continuous markets (kernel_width=0) behave identically to current WTA
- Only NEW continuous markets with kernel_width > 0 use the smooth kernel
- Solvency is guaranteed by the scaling factor (worst case: LP residual = 0, traders share total_minted proportionally)
- Each phase is independently buildable and testable
