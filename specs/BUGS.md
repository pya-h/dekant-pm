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

- [ ] **M5: `Number()` precision loss on large u128 LP share values**
  - **Files:** `frontend/components/liquidity/liquidity-panel.tsx:61-62`, `frontend/components/portfolio/lp-position-card.tsx:27`
  - **Impact:** LP shares are u128 on-chain. `Number()` loses precision beyond ~2^53 (~9 × 10^15). Very large LP positions could display incorrect values.

- [x] **M6: `lastCheckTime` not updated on error — tight retry loop on persistent failures** *(fixed 2026-04-02)*
  - **Fix:** Moved `lastCheckTime = Date.now()` to `finally` block.

- [ ] **M7: TASKS.md B-12 documents wrong role values**
  - **File:** `specs/planning/TASKS.md` (B-12 section)
  - **Impact:** Documents `0 = Admin, 1 = Superadmin` but on-chain enum is `Admin = 1, Oracle = 2, Creator = 3`. Superadmin is env-based, not an on-chain role.

- [x] **M8: Fee collection interval test asserts correct result for wrong reason** *(fixed 2026-04-02)*
  - **Fix:** Set `program` and `authority` on the service instance before testing.

---

## Low

- [x] **L1: Dead export `DEADLINE_CRON` in settings.service.ts** *(fixed 2026-04-02)*

- [x] **L2: `remove()` silently no-ops if row is active** *(fixed 2026-04-02)*

- [x] **L3: No unique constraint on settings `name` column** *(fixed 2026-04-02)*

- [ ] **L4: Frontend settings UI shows form with defaults on fetch error**
  - **Impact:** On network error, a toast fires but the form still renders with default values. User could unknowingly overwrite real settings.

- [ ] **L5: Frontend settings `id` typed as `number`, backend PG column is `bigint`**
  - **Impact:** Currently safe (small IDs), but would break if IDs exceed `Number.MAX_SAFE_INTEGER`.

- [ ] **L6: `Content-Type: application/json` header sent on DELETE with no body**
  - **File:** `frontend/lib/api.ts:81`
  - **Impact:** Harmless but technically incorrect per HTTP spec.

- [ ] **L7: Fee collector hard limit of 100 markets, no pagination**
  - **File:** `frontend/components/admin/fee-collector.tsx:22`
  - **Impact:** Markets beyond 100 are invisible to the fee collector UI.

- [ ] **L8: Admin tab scroll wrapper may clip focus rings on mobile**
  - **Impact:** Minor accessibility concern with `overflow-x-auto`.

- [ ] **L9: Missing frontend unit tests for `executeSellDistribution`, `executeBuyToPrice`, `executeSellToPrice`**
  - **Impact:** These transaction builders involve SCALE multiplication and `toBaseUnits` conversion but have no dedicated tests.

- [x] **L10: Stray Arabic character in TASKS.md** *(fixed 2026-04-02)*

- [ ] **L11: E2e tests all run as superadmin — no test verifies 403 for non-superadmin on settings**
  - **Impact:** Settings endpoints are guarded by `@Roles('superadmin')` but no e2e test verifies rejection.

- [x] **L12: Expired markets closed one-by-one (no batch UPDATE)** *(fixed 2026-04-02)*

- [x] **L13: No `@Max` validator on buy/sell-to-price DTO `targetProbability`** *(fixed)*
  - **File:** `backend/src/amm/dto/amm.dto.ts:127,150`
  - **Fix:** Both `EstimateBuyToPriceDto` and `EstimateSellToPriceDto` now have `@Max(999_999_999)`.

---

## New Findings (2026-04-02 Full Review)

- [x] **N1: `__sonnerToast` never defined — clipboard copy toast silently fails** *(fixed 2026-04-02)*

- [x] **N2: Continuous market negative bin index when `resolved < rangeMin`** *(fixed 2026-04-02)*

- [x] **N3: Dark mode select/combobox elements invisible due to missing `color-scheme`** *(fixed 2026-04-02)*
