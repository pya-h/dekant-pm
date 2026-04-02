# Bug Tracker

Discovered via a systematic review of all commits from the last 24 hours (15 commits, 2026-03-25).
Updated 2026-04-02 with full project review fixes, new findings, and remaining bug fixes.
Organized by severity. Check off items as they are resolved.

---

## Critical

These can cause incorrect behavior, block users, or corrupt state.

- [x] **C1: `@Roles('admin')` on `POST /markets` blocks Creator-role wallets** *(fixed 2026-04-02)*
  - **File:** `backend/src/market/market.controller.ts:68`
  - **Commit:** `cfad417`
  - **Impact:** Any wallet with the on-chain Creator role (3) gets 403 Forbidden when creating markets via the API, despite being authorized on-chain. Only Admin (1) and Superadmin (env) can create markets through the backend.
  - **Fix:** Changed `@Roles('admin')` to `@Roles('admin', 'creator')`.

- [x] **C2: `activate()` race condition — non-atomic deactivate/activate** *(fixed 2026-04-02)*
  - **File:** `backend/src/settings/settings.service.ts:99-102`
  - **Commit:** `9e24d96`
  - **Impact:** Two separate UPDATEs without a transaction. Between them, no row is active — any concurrent read of settings gets fallback defaults. If the second UPDATE fails (e.g., row deleted), all rows stay permanently deactivated.
  - **Fix:** Wrapped both UPDATEs in a TypeORM `queryRunner` transaction.

---

## High

Significant bugs that affect correctness or UX but don't corrupt state.

- [x] **H1: No DB update after on-chain fee collection — causes repeated attempts** *(fixed 2026-04-02)*
  - **File:** `backend/src/fee-collection/fee-collection.service.ts:138-171`
  - **Commit:** `6d492a7`
  - **Impact:** After successfully collecting fees on-chain, `protocolFeeAccumulated` is never zeroed in the DB. The same market is re-selected on every 5-minute sweep until the indexer syncs, causing repeated failed on-chain calls and log spam.
  - **Fix:** Added `marketRepo.update(market.id, { protocolFeeAccumulated: '0' })` after successful on-chain collection.

- [x] **H2: `isActive` column defaults to `true` in settings entity** *(fixed 2026-04-02)*
  - **File:** `backend/src/settings/setting.entity.ts:17`
  - **Commit:** `9e24d96`
  - **Impact:** DB-level default is `true` but business logic demands only one active row. Any raw INSERT or TypeORM sync issue creates an extra active row, breaking the single-active invariant.
  - **Fix:** Changed entity column default to `false`. The service's `onModuleInit` and `create()` already handle activation explicitly.

- [x] **H3: "Collect All" sends transactions to ALL markets, including those with zero fees** *(fixed 2026-04-02)*
  - **File:** `frontend/components/admin/fee-collector.tsx:51`
  - **Commit:** `d291fe3`
  - **Impact:** Iterates every market (up to 100) regardless of accumulated fees. Transactions to markets with no fees fail on-chain, wasting SOL.
  - **Fix:** Filter `data.data` by `protocolFeeAccumulated > 0` before iterating.

- [x] **H4: `showTradeSuccess("")` produces broken toast with dead Solscan link** *(fixed 2026-04-02)*
  - **File:** `frontend/components/admin/fee-collector.tsx:67`
  - **Commit:** `d291fe3`
  - **Impact:** The "Collect All" success toast passes `""` as the signature, producing a garbled description and a dead link to `https://solscan.io/tx/`.
  - **Fix:** Replaced with `toast.success(...)` from sonner.

---

## Medium

Incorrect behavior or missing safeguards that should be addressed.

- [x] **M1: `estimateBuyToPrice` / `estimateSellToPrice` use `totalMinted^2` instead of on-chain `kSquared`** *(fixed 2026-04-02)*
  - **File:** `backend/src/amm/amm.service.ts:450-451, 530`
  - **Commit:** `848859b` (and pre-existing in other estimate methods)
  - **Impact:** After LP add/remove operations, `kSquared != totalMinted^2`. The estimate methods compute wrong current probabilities and wrong collateral requirements for markets that have had LP operations.
  - **Fix:** Used `market.kSquared` (with fallback to `totalMinted * totalMinted`) in both estimate methods.

- [x] **M2: Sell-to-price has no frontend holdings validation** *(fixed 2026-04-02)*
  - **Commit:** `848859b`
  - **Impact:** Users can submit sell-to-price transactions without holding enough tokens. The on-chain tx fails, wasting SOL.
  - **Fix:** Removed `!isTargetPrice` exclusion from `exceedsHoldings` check. For sell-to-price, validates user holds > 0 tokens for the selected outcome.

- [x] **M3: `MoreThan('0')` string comparison with `as any` cast on numeric column** *(fixed 2026-04-02)*
  - **File:** `backend/src/fee-collection/fee-collection.service.ts:110`
  - **Commit:** `6d492a7`
  - **Impact:** TypeScript type safety bypassed. Works due to PostgreSQL implicit coercion but is fragile and could break with ORM upgrades.
  - **Fix:** Replaced with query builder: `.createQueryBuilder('market').where('market.protocol_fee_accumulated > :zero', { zero: '0' })`.

- [x] **M4: `estimatedShares` returns null for first LP deposit (totalMinted === 0)** *(fixed 2026-04-02)*
  - **Commit:** `54296f6`
  - **Impact:** First LP depositor sees no share preview. The first deposit should show shares = deposit amount.
  - **Fix:** Separated `totalMinted === 0` check from the early-return guard; now returns `depositBase` (1:1 shares) when `totalMinted === 0`.

- [ ] **M5: `Number()` precision loss on large u128 LP share values**
  - **Commit:** `54296f6`
  - **Impact:** LP shares are u128 on-chain. `Number()` loses precision beyond ~2^53 (~9 * 10^15). Very large LP positions could display incorrect values.
  - **Fix:** Use `BigInt` or keep values as strings for display; only convert to `Number` for UI-scale formatting.

- [x] **M6: `lastCheckTime` not updated on error — tight retry loop on persistent failures** *(fixed 2026-04-02)*
  - **Files:** `backend/src/market/market-deadline.service.ts:43-45`, `backend/src/fee-collection/fee-collection.service.ts:99-102`
  - **Commit:** `9e24d96`, `6d492a7`
  - **Impact:** Both deadline and fee-collection services only update `lastCheckTime` on success. A persistent DB error causes retries every 30s (deadline) or 5m (fees) with error log spam.
  - **Fix:** Moved `lastCheckTime = Date.now()` to `finally` block in both services.

- [ ] **M7: TASKS.md B-12 documents wrong role values**
  - **File:** `plans/TASKS.md` (B-12 section)
  - **Commit:** `07cb9ab`
  - **Impact:** Documents `0 = Admin, 1 = Superadmin` but on-chain enum is `Admin = 1, Oracle = 2, Creator = 3`. Superadmin is env-based, not an on-chain role. Could mislead future developers.
  - **Fix:** Correct the role mapping in the task description.

- [x] **M8: Fee collection interval test asserts correct result for wrong reason** *(fixed 2026-04-02)*
  - **File:** `backend/src/fee-collection/fee-collection.service.spec.ts`
  - **Commit:** `6076469`
  - **Impact:** Test "should skip when not enough time has elapsed" passes because `this.program` is null (early return at line 89), NOT because of the interval check. The interval-gating logic is untested.
  - **Fix:** Set `program` and `authority` on the service instance before testing. Now asserts `getFeeCollectionInterval` was called (reached interval check) while `marketRepo.find` was not.

---

## Low

Minor issues, cleanup, or non-critical improvements.

- [x] **L1: Dead export `DEADLINE_CRON` in settings.service.ts** *(fixed 2026-04-02)*
  - **File:** `backend/src/settings/settings.service.ts:13-19`
  - **Commit:** `9e24d96`
  - **Impact:** Exported but never imported anywhere. Dead code.
  - **Fix:** Removed the dead export.

- [x] **L2: `remove()` silently no-ops if row is active** *(fixed 2026-04-02)*
  - **File:** `backend/src/settings/settings.service.ts:106-108`
  - **Commit:** `9e24d96`
  - **Impact:** The controller guards against this, but `remove()` itself silently deletes nothing if called on an active row from other code paths.
  - **Fix:** Now checks `result.affected` and throws if row wasn't deleted.

- [x] **L3: No unique constraint on settings `name` column** *(fixed 2026-04-02)*
  - **File:** `backend/src/settings/setting.entity.ts`
  - **Commit:** `9e24d96`
  - **Impact:** Multiple presets can share the same name, making the UI confusing.
  - **Fix:** Added `unique: true` to the `name` column definition.

- [ ] **L4: Frontend settings UI has no error state when settings fetch fails**
  - **Commit:** `cec389b`
  - **Impact:** On network error, user sees a form with stale/default values and can unknowingly overwrite real settings.

- [ ] **L5: Frontend settings `id` typed as `number`, backend PG column is `bigint`**
  - **Commit:** `cec389b`
  - **Impact:** Currently safe (small IDs), but would break if IDs exceed `Number.MAX_SAFE_INTEGER`.

- [ ] **L6: `Content-Type: application/json` header sent on DELETE with no body**
  - **Commit:** `cec389b`
  - **Impact:** Harmless but technically incorrect per HTTP spec.

- [ ] **L7: Fee collector hard limit of 100 markets, no pagination**
  - **File:** `frontend/components/admin/fee-collector.tsx:20`
  - **Commit:** `063aa42`
  - **Impact:** Markets beyond 100 are invisible to the fee collector UI.

- [ ] **L8: Admin tab scroll wrapper may clip focus rings on mobile**
  - **File:** `frontend/app/admin/page.tsx:148`
  - **Commit:** `f4593ce`
  - **Impact:** `overflow-x-auto` can clip keyboard focus indicators on tab triggers. Minor accessibility concern.

- [ ] **L9: Missing frontend unit tests for `executeSellDistribution`, `executeBuyToPrice`, `executeSellToPrice`**
  - **File:** `frontend/__tests__/lib/transactions.test.ts`
  - **Commit:** `f4593ce`
  - **Impact:** These transaction builders involve SCALE multiplication and `toBaseUnits` conversion but have no dedicated tests.

- [x] **L10: Stray Arabic character in TASKS.md** *(fixed 2026-04-02)*
  - **File:** `specs/TASKS.md` (line ~1654)
  - **Commit:** `9e24d96`
  - **Impact:** Cosmetic — `ثmarket` should be `market`.
  - **Fix:** Removed the stray character.

- [ ] **L11: E2e tests all run as superadmin — no test verifies 403 for non-superadmin on settings**
  - **Commit:** `6076469`
  - **Impact:** Settings endpoints are guarded by `@Roles('superadmin')` but no e2e test verifies that a non-superadmin gets rejected.

- [x] **L12: Expired markets closed one-by-one (no batch UPDATE)** *(fixed 2026-04-02)*
  - **File:** `backend/src/market/market-deadline.service.ts:72-79`
  - **Commit:** `9d5bbd6`
  - **Impact:** N queries instead of 1 for N expired markets. Fine for small numbers, inefficient at scale.
  - **Fix:** Replaced per-market UPDATE loop with `createQueryBuilder().update().whereInIds(ids).execute()`.

- [ ] **L13: No `@Max` validator on buy/sell-to-price DTO `targetProbability`**
  - **Commit:** `848859b`
  - **Impact:** The service-level check catches invalid values, but the DTO layer doesn't reject them early. Inconsistent with other DTOs that have `@Min`/`@Max`.

---

## New Findings (2026-04-02 Full Review)

- [x] **N1: `__sonnerToast` never defined — clipboard copy toast silently fails** *(fixed 2026-04-02)*
  - **File:** `frontend/app/markets/[id]/page.tsx:335`
  - **Impact:** The "Address copied" toast after clipboard write never fires. `window.__sonnerToast` is never set anywhere in the codebase.
  - **Fix:** Imported `toast` from `sonner` and used it directly.

- [x] **N2: Continuous market negative bin index when `resolved < rangeMin`** *(fixed 2026-04-02)*
  - **Files:** `frontend/app/portfolio/page.tsx:350`, `frontend/components/trading/user-position-display.tsx:133`
  - **Impact:** `Math.floor((resolved - rMin) / binWidth)` can be negative, causing `holdings[-1]` to return `undefined`. Caught by `?? 0` but accidental, not defensive.
  - **Fix:** Added `Math.max(0, ...)` to clamp negative indices.

- [x] **N3: Dark mode select/combobox elements invisible due to missing `color-scheme`** *(fixed 2026-04-02)*
  - **Files:** `frontend/app/globals.css`, `frontend/components/admin/role-manager.tsx`, `frontend/components/admin/protocol-settings.tsx`, `frontend/components/admin/settings-presets-modal.tsx`, `frontend/components/create-market/step-question-details.tsx`
  - **Impact:** Native `<select>` dropdown options use OS-level light-mode rendering in dark mode (black text on white). The select elements themselves used `bg-transparent` or `bg-background` with no explicit text color, making them hard to see in dark mode.
  - **Fix:** Added `color-scheme: dark` to `.dark` CSS block (tells browser to render native controls in dark mode). Changed all `<select>` to use `bg-card text-foreground` for consistent contrast.
