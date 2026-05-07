# Bug Tracker

Discovered via systematic review of all commits (2026-03-25).
Updated 2026-04-02 with full project review fixes and new findings.
Updated 2026-05-07 with BUG-001, BUG-002, and verification pass.

---

## Critical

- [x] **C1: `@Roles('admin')` on `POST /markets` blocks Creator-role wallets** *(fixed 2026-04-02)*
  - **File:** `backend/src/market/market.controller.ts:68`
  - **Fix:** Changed `@Roles('admin')` to `@Roles('admin', 'creator')`.

- [x] **C2: `activate()` race condition — non-atomic deactivate/activate** *(fixed 2026-04-02)*
  - **File:** `backend/src/settings/settings.service.ts:99-102`
  - **Fix:** Wrapped both UPDATEs in a TypeORM `queryRunner` transaction.

- [x] **C3 (BUG-001): `compute_distribution_buy` u128 overflow at moderate liquidity** *(fixed 2026-05-01)*
  - **File:** `programs/dekant-pm/src/engine/amm.rs`
  - **Impact:** `xw²` and `w2 * excess` overflow u128 at ~$26K (2 bins) to ~$295K (256 bins). All distribution buys on sufficiently-liquid continuous markets fail with `MathOverflow`.
  - **Fix:** Promoted `xw`, `w2`, and `excess` to U256 before the discriminant computation.
  - **Spec:** `specs/BUG-001-U128-OVERFLOW.md`

- [x] **C4 (BUG-002): Taylor approximation rebound corrupts all continuous market positions** *(fixed 2026-05-07)*
  - **File:** `programs/dekant-pm/src/engine/normal_pdf.rs`
  - **Impact:** Degree-4 Taylor polynomial for `exp(-z²/2)` rebounds past |z| ≈ 1.8, producing "Mexican hat" bin weights instead of Gaussian bell curves. Every `buy_distribution`/`sell_distribution` trade was affected.
  - **Fix:** Replaced with 51-entry lookup table + linear interpolation (~0.78% max error, monotonically decreasing).
  - **Spec:** `specs/BUG-002-EXP-APPROX.md`

---

## High

- [x] **H1: No DB update after on-chain fee collection — causes repeated attempts** *(fixed 2026-04-02)*
  - **File:** `backend/src/fee-collection/fee-collection.service.ts:138-171`
  - **Fix:** Added `marketRepo.update(market.id, { protocolFeeAccumulated: '0' })` after successful on-chain collection.

- [x] **H2: `isActive` column defaults to `true` in settings entity** *(fixed 2026-04-02)*
  - **File:** `backend/src/settings/setting.entity.ts:17`
  - **Fix:** Changed entity column default to `false`.

- [x] **H3: "Collect All" sends transactions to ALL markets, including those with zero fees** *(fixed 2026-04-02)*
  - **File:** `frontend/components/admin/fee-collector.tsx:51`
  - **Fix:** Filter by `protocolFeeAccumulated > 0` before iterating.

- [x] **H4: `showTradeSuccess("")` produces broken toast with dead Solscan link** *(fixed 2026-04-02)*
  - **File:** `frontend/components/admin/fee-collector.tsx:67`
  - **Fix:** Replaced with `toast.success(...)` from sonner.

---

## Medium

- [x] **M1: `estimateBuyToPrice` / `estimateSellToPrice` use `totalMinted^2` instead of on-chain `kSquared`** *(fixed 2026-04-02)*
  - **File:** `backend/src/amm/amm.service.ts:450-451, 530`
  - **Fix:** Used `market.kSquared` (with fallback to `totalMinted * totalMinted`).

- [x] **M2: Sell-to-price has no frontend holdings validation** *(fixed 2026-04-02)*
  - **Fix:** Removed `!isTargetPrice` exclusion from `exceedsHoldings` check.

- [x] **M3: `MoreThan('0')` string comparison with `as any` cast on numeric column** *(fixed 2026-04-02)*
  - **File:** `backend/src/fee-collection/fee-collection.service.ts:110`
  - **Fix:** Replaced with query builder.

- [x] **M4: `estimatedShares` returns null for first LP deposit (totalMinted === 0)** *(fixed 2026-04-02)*
  - **Fix:** Separated `totalMinted === 0` check; now returns `depositBase` (1:1 shares).

- [x] **M5: `Number()` precision loss on large u128 LP share values** *(fixed 2026-05-07)*
  - **Files:** `frontend/components/liquidity/liquidity-panel.tsx:61-62`, `frontend/components/portfolio/lp-position-card.tsx:27`
  - **Impact:** LP shares are u128 on-chain. `Number()` loses precision beyond ~2^53 (~9 × 10^15). Very large LP positions could display incorrect values.
  - **Fix:** `lp-position-card.tsx` uses `BigInt` for share display; `liquidity-panel.tsx` uses `BigInt` for on-chain BN construction in remove-liquidity.

- [x] **M6: `lastCheckTime` not updated on error — tight retry loop on persistent failures** *(fixed 2026-04-02)*
  - **Fix:** Moved `lastCheckTime = Date.now()` to `finally` block.

- [x] **M7: TASKS.md B-12 documents wrong role values** *(fixed 2026-05-07)*
  - **File:** `specs/planning/TASKS.md` (B-12 section)
  - **Impact:** Documents `0 = Admin, 1 = Superadmin` but on-chain enum is `Admin = 1, Oracle = 2, Creator = 3`. Superadmin is env-based, not an on-chain role.
  - **Fix:** Corrected role documentation to match on-chain enum.

- [x] **M8: Fee collection interval test asserts correct result for wrong reason** *(fixed 2026-04-02)*
  - **Fix:** Set `program` and `authority` on the service instance before testing.

---

## Low

- [x] **L1: Dead export `DEADLINE_CRON` in settings.service.ts** *(fixed 2026-04-02)*

- [x] **L2: `remove()` silently no-ops if row is active** *(fixed 2026-04-02)*

- [x] **L3: No unique constraint on settings `name` column** *(fixed 2026-04-02)*

- [x] **L4: Frontend settings UI shows form with defaults on fetch error** *(fixed 2026-05-07)*
  - **Impact:** On network error, a toast fires but the form still renders with default values. User could unknowingly overwrite real settings.
  - **Fix:** Added `!settings` guard after loading — shows error state with retry button instead of form.

- [x] **L5: Frontend settings `id` typed as `number`, backend PG column is `bigint`** *(fixed 2026-05-07)*
  - **Impact:** Currently safe (small IDs), but would break if IDs exceed `Number.MAX_SAFE_INTEGER`.
  - **Fix:** Changed `SettingsPreset.id` to `string`; updated `actionId` state and handler params in presets modal.

- [x] **L6: `Content-Type: application/json` header sent on DELETE with no body** *(fixed 2026-05-07)*
  - **File:** `frontend/lib/api.ts:81`
  - **Impact:** Harmless but technically incorrect per HTTP spec.
  - **Fix:** Only set `Content-Type` when `body !== undefined`.

- [x] **L7: Fee collector hard limit of 100 markets, no pagination** *(fixed 2026-05-07)*
  - **File:** `frontend/components/admin/fee-collector.tsx:22`
  - **Impact:** Markets beyond 100 are invisible to the fee collector UI.
  - **Fix:** Added `useAllMarkets` hook that fetches all pages; fee collector uses it instead of `useMarkets({ limit: 100 })`.

- [x] **L8: Admin tab scroll wrapper may clip focus rings on mobile** *(fixed 2026-05-07)*
  - **Impact:** Minor accessibility concern with `overflow-x-auto`.
  - **Fix:** Added `-my-1 py-1` (with `sm:my-0 sm:py-0` reset) to the scroll wrapper, giving focus rings vertical breathing room inside the overflow container.

- [x] **L9: Missing frontend unit tests for `executeSellDistribution`, `executeBuyToPrice`, `executeSellToPrice`** *(fixed 2026-05-07)*
  - **Impact:** These transaction builders involve SCALE multiplication and `toBaseUnits` conversion but have no dedicated tests.
  - **Fix:** Added 6 tests to `frontend/__tests__/lib/transactions.test.ts` covering all three functions with SCALE, base-unit, and fractional-amount assertions.

- [x] **L10: Stray Arabic character in TASKS.md** *(fixed 2026-04-02)*

- [x] **L11: E2e tests all run as superadmin — no test verifies 403 for non-superadmin on settings** *(fixed 2026-05-07)*
  - **Impact:** Settings endpoints are guarded by `@Roles('superadmin')` but no e2e test verifies rejection.
  - **Fix:** Added "Non-superadmin rejection (403)" describe block with 6 tests (GET, PATCH, POST, GET /all, POST activate, DELETE) using a non-superadmin wallet token.

- [x] **L12: Expired markets closed one-by-one (no batch UPDATE)** *(fixed 2026-04-02)*

- [x] **L13: No `@Max` validator on buy/sell-to-price DTO `targetProbability`** *(fixed)*
  - **File:** `backend/src/amm/dto/amm.dto.ts:127,150`
  - **Fix:** Both `EstimateBuyToPriceDto` and `EstimateSellToPriceDto` now have `@Max(999_999_999)`.

- [x] **L14: Unchecked u128 arithmetic in discrete `compute_buy` / `compute_sell`** *(fixed 2026-05-07)*
  - **Files:** `programs/dekant-pm/src/engine/amm.rs:78` (`sum_others_x_sq += x * x`), `amm.rs:145` (`k_new_sq += x * x`)
  - **Impact:** Same class as C3 (BUG-001) but for discrete markets. `x * x` and the accumulating sum are unchecked u128 — wraps silently in release mode. Overflow thresholds: ~$18T (2 outcomes, USDC 6-dec), ~$3.3T (32 outcomes, USDC), ~$330M (32 outcomes, 9-dec token). Trivially reachable with 18-decimal collateral tokens.
  - **Fix:** Replaced with `checked_mul` / `checked_add` returning `MathOverflow` in `compute_buy`, `compute_sell`, `compute_buy_to_price`, and `compute_sell_to_price`.

---

## New Findings (2026-04-02 Full Review)

- [x] **N1: `__sonnerToast` never defined — clipboard copy toast silently fails** *(fixed 2026-04-02)*

- [x] **N2: Continuous market negative bin index when `resolved < rangeMin`** *(fixed 2026-04-02)*

- [x] **N3: Dark mode select/combobox elements invisible due to missing `color-scheme`** *(fixed 2026-04-02)*

---

## New Findings (2026-05-07 Full Review)

- [x] **N4: `diff_sq * SCALE` unchecked u128 overflow in `normal_pdf::compute_bin_weights`** *(fixed 2026-05-07)*
  - **File:** `programs/dekant-pm/src/engine/normal_pdf.rs:154`
  - **Impact:** `diff_sq * SCALE` is unchecked. When sigma > ~3.69×10¹⁴ (369K human units), `25 * sigma² * SCALE > u128::MAX`, silently wrapping in release mode and producing wrong bin weights. Realistic for wide-range continuous markets (e.g. range [0, 1M] with sigma ≈ 370K). The on-chain instruction only validates `sigma > 0`, no upper bound.
  - **Fix:** Promoted `diff_sq`, `sigma_sq`, and their product with SCALE to U256 before division.

- [x] **N5: `closeExpiredMarkets` only transitions Active markets — misses Paused markets past deadline** *(fixed 2026-05-07)*
  - **File:** `backend/src/market/market-deadline.service.ts:64`
  - **Impact:** Query filters `state: STATE_ACTIVE` only. Paused markets (state 1) that pass their deadline stay stuck in Paused state in the DB. The on-chain program handles this lazily on next interaction, but the frontend shows incorrect state until then.
  - **Fix:** Changed `state: STATE_ACTIVE` to `state: In([STATE_ACTIVE, STATE_PAUSED])`. Updated test assertions.

- [ ] **N6: `scale_reserves` silently truncates reserves exceeding u64::MAX** *(open)*
  - **File:** `programs/dekant-pm/src/engine/amm.rs:490`
  - **Impact:** `*r = new_r as u64;` performs unchecked truncation. When an LP deposit more than doubles a pool that already has reserves near u64::MAX / 2, the scaled value overflows u64 and wraps silently. Reachable with 18-decimal collateral tokens (e.g., native SOL wrapped as SPL with 9 decimals at ~$18B TVL, or arbitrary 18-decimal tokens at ~$18M TVL). Not reachable with 6-decimal USDC under any realistic scenario.
  - **Fix:** Replace `*r = new_r as u64;` with `*r = u64::try_from(new_r).map_err(|_| error!(DekantPmError::MathOverflow))?;` (requires the closure to return `Result`).
