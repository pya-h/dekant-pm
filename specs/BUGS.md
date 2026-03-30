# Bug Tracker

Discovered via a systematic review of all commits from the last 24 hours (15 commits, 2026-03-25).
Organized by severity. Check off items as they are resolved.

---

## Critical

These can cause incorrect behavior, block users, or corrupt state.

- [ ] **C1: `@Roles('admin')` on `POST /markets` blocks Creator-role wallets**
  - **File:** `backend/src/market/market.controller.ts:68`
  - **Commit:** `cfad417`
  - **Impact:** Any wallet with the on-chain Creator role (3) gets 403 Forbidden when creating markets via the API, despite being authorized on-chain. Only Admin (1) and Superadmin (env) can create markets through the backend.
  - **Fix:** Change `@Roles('admin')` to `@Roles('admin', 'creator')`.

- [ ] **C2: `activate()` race condition — non-atomic deactivate/activate**
  - **File:** `backend/src/settings/settings.service.ts:99-102`
  - **Commit:** `9e24d96`
  - **Impact:** Two separate UPDATEs without a transaction. Between them, no row is active — any concurrent read of settings gets fallback defaults. If the second UPDATE fails (e.g., row deleted), all rows stay permanently deactivated.
  - **Fix:** Wrap both UPDATEs in a TypeORM `queryRunner` transaction.

---

## High

Significant bugs that affect correctness or UX but don't corrupt state.

- [ ] **H1: No DB update after on-chain fee collection — causes repeated attempts**
  - **File:** `backend/src/fee-collection/fee-collection.service.ts:138-171`
  - **Commit:** `6d492a7`
  - **Impact:** After successfully collecting fees on-chain, `protocolFeeAccumulated` is never zeroed in the DB. The same market is re-selected on every 5-minute sweep until the indexer syncs, causing repeated failed on-chain calls and log spam.
  - **Fix:** After successful `collectFees` RPC, update `market.protocolFeeAccumulated = '0'` in the DB.

- [ ] **H2: `isActive` column defaults to `true` in settings entity**
  - **File:** `backend/src/settings/setting.entity.ts:17`
  - **Commit:** `9e24d96`
  - **Impact:** DB-level default is `true` but business logic demands only one active row. Any raw INSERT or TypeORM sync issue creates an extra active row, breaking the single-active invariant.
  - **Fix:** Change entity column default to `false`. The service's `onModuleInit` and `create()` already handle activation explicitly.

- [ ] **H3: "Collect All" sends transactions to ALL markets, including those with zero fees**
  - **File:** `frontend/components/admin/fee-collector.tsx:51`
  - **Commit:** `d291fe3`
  - **Impact:** Iterates every market (up to 100) regardless of accumulated fees. Transactions to markets with no fees fail on-chain, wasting SOL.
  - **Fix:** Filter `data.data` by `protocolFeeAccumulated > 0` before iterating (or have the backend expose an endpoint that returns only markets with pending fees).

- [ ] **H4: `showTradeSuccess("")` produces broken toast with dead Solscan link**
  - **File:** `frontend/components/admin/fee-collector.tsx:67`
  - **Commit:** `d291fe3`
  - **Impact:** The "Collect All" success toast passes `""` as the signature, producing a garbled description and a dead link to `https://solscan.io/tx/`.
  - **Fix:** Use a plain success toast (e.g., `toast.success(...)`) instead of `showTradeSuccess` when there's no single signature.

---

## Medium

Incorrect behavior or missing safeguards that should be addressed.

- [ ] **M1: `estimateBuyToPrice` / `estimateSellToPrice` use `totalMinted^2` instead of on-chain `kSquared`**
  - **File:** `backend/src/amm/amm.service.ts:450-451, 530`
  - **Commit:** `848859b` (and pre-existing in other estimate methods)
  - **Impact:** After LP add/remove operations, `kSquared != totalMinted^2`. The estimate methods compute wrong current probabilities and wrong collateral requirements for markets that have had LP operations.
  - **Fix:** Use `market.kSquared` (already stored in DB by the indexer) instead of `totalMinted * totalMinted` in all estimate methods.

- [ ] **M2: Sell-to-price has no frontend holdings validation**
  - **Commit:** `848859b`
  - **Impact:** Users can submit sell-to-price transactions without holding enough tokens. The on-chain tx fails, wasting SOL.
  - **Fix:** Check user position balance before enabling the submit button, similar to the regular sell flow.

- [ ] **M3: `MoreThan('0')` string comparison with `as any` cast on numeric column**
  - **File:** `backend/src/fee-collection/fee-collection.service.ts:110`
  - **Commit:** `6d492a7`
  - **Impact:** TypeScript type safety bypassed. Works due to PostgreSQL implicit coercion but is fragile and could break with ORM upgrades.
  - **Fix:** Use query builder: `qb.where('market.protocol_fee_accumulated > :zero', { zero: 0 })`.

- [ ] **M4: `estimatedShares` returns null for first LP deposit (totalMinted === 0)**
  - **Commit:** `54296f6`
  - **Impact:** First LP depositor sees no share preview. The first deposit should show shares = deposit amount.
  - **Fix:** Handle the `totalMinted === 0` case explicitly: `estimatedShares = depositAmount`.

- [ ] **M5: `Number()` precision loss on large u128 LP share values**
  - **Commit:** `54296f6`
  - **Impact:** LP shares are u128 on-chain. `Number()` loses precision beyond ~2^53 (~9 * 10^15). Very large LP positions could display incorrect values.
  - **Fix:** Use `BigInt` or keep values as strings for display; only convert to `Number` for UI-scale formatting.

- [ ] **M6: `lastCheckTime` not updated on error — tight retry loop on persistent failures**
  - **Files:** `backend/src/market/market-deadline.service.ts:43-45`, `backend/src/fee-collection/fee-collection.service.ts:99-102`
  - **Commit:** `9e24d96`, `6d492a7`
  - **Impact:** Both deadline and fee-collection services only update `lastCheckTime` on success. A persistent DB error causes retries every 30s (deadline) or 5m (fees) with error log spam.
  - **Fix:** Update `lastCheckTime` in `finally` block (or add exponential backoff).

- [ ] **M7: TASKS.md B-12 documents wrong role values**
  - **File:** `plans/TASKS.md` (B-12 section)
  - **Commit:** `07cb9ab`
  - **Impact:** Documents `0 = Admin, 1 = Superadmin` but on-chain enum is `Admin = 1, Oracle = 2, Creator = 3`. Superadmin is env-based, not an on-chain role. Could mislead future developers.
  - **Fix:** Correct the role mapping in the task description.

- [ ] **M8: Fee collection interval test asserts correct result for wrong reason**
  - **File:** `backend/src/fee-collection/fee-collection.service.spec.ts`
  - **Commit:** `6076469`
  - **Impact:** Test "should skip when not enough time has elapsed" passes because `this.program` is null (early return at line 89), NOT because of the interval check. The interval-gating logic is untested.
  - **Fix:** Set `program` and `authority` on the service instance before testing the interval skip path.

---

## Low

Minor issues, cleanup, or non-critical improvements.

- [ ] **L1: Dead export `DEADLINE_CRON` in settings.service.ts**
  - **File:** `backend/src/settings/settings.service.ts:13-19`
  - **Commit:** `9e24d96`
  - **Impact:** Exported but never imported anywhere. Dead code.

- [ ] **L2: `remove()` silently no-ops if row is active**
  - **File:** `backend/src/settings/settings.service.ts:106-108`
  - **Commit:** `9e24d96`
  - **Impact:** The controller guards against this, but `remove()` itself silently deletes nothing if called on an active row from other code paths.

- [ ] **L3: No unique constraint on settings `name` column**
  - **File:** `backend/src/settings/setting.entity.ts`
  - **Commit:** `9e24d96`
  - **Impact:** Multiple presets can share the same name, making the UI confusing.

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

- [ ] **L10: Stray Arabic character in TASKS.md**
  - **File:** `plans/TASKS.md` (line ~1053)
  - **Commit:** `9e24d96`
  - **Impact:** Cosmetic — `ثmarket` should be `market`.

- [ ] **L11: E2e tests all run as superadmin — no test verifies 403 for non-superadmin on settings**
  - **Commit:** `6076469`
  - **Impact:** Settings endpoints are guarded by `@Roles('superadmin')` but no e2e test verifies that a non-superadmin gets rejected.

- [ ] **L12: Expired markets closed one-by-one (no batch UPDATE)**
  - **File:** `backend/src/market/market-deadline.service.ts:72-79`
  - **Commit:** `9d5bbd6`
  - **Impact:** N queries instead of 1 for N expired markets. Fine for small numbers, inefficient at scale.

- [ ] **L13: No `@Max` validator on buy/sell-to-price DTO `targetProbability`**
  - **Commit:** `848859b`
  - **Impact:** The service-level check catches invalid values, but the DTO layer doesn't reject them early. Inconsistent with other DTOs that have `@Min`/`@Max`.
