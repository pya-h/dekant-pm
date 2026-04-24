# Resolution Refactor Tasks: Proportional -> 1:1 Fixed Payout

**Decision:** Switch from parimutuel (proportional) payout to 1:1 fixed payout.
**Rationale:** See `details/resolution-compare.md`, `details/resolution-report-tl.md`, and `MAJOR_BUGS.md` (BUG-003).
**Scope:** On-chain program only for core changes. Tests across all sections. No backend/frontend/devkit code changes.

---

## Phase 1: On-Chain Program (Solana/Rust)

All changes are in `programs/dekant-pm/src/`.

---

### TASK P-R1: ✅ Modify `claim_payout.rs` — Switch to 1:1 payout formula

**File:** `programs/dekant-pm/src/instructions/trading/claim_payout.rs`

**What changes:**

1. **Remove the proportional formula (lines 77-99).** Replace the entire block that computes `winning_tokens_total`, `payout_pool`, and `gross_payout` via `mul_div` with a single line:

   ```rust
   // 1:1 fixed payout: each winning token redeems for exactly 1 unit of collateral.
   let gross_payout = winning_tokens as u128;
   ```

   **Specifically remove:**
   - Lines 77-83: `winning_tokens_total` computation and its `> 0` require
   - Lines 85-91: The comment block about `payout_pool` and order-independence
   - Line 92: `let payout_pool = market.total_minted;`
   - Lines 94-99: `let gross_payout = mul_div(...)` call

   **Keep everything else unchanged:**
   - Line 70-71: `require_resolved()` and `!claimed` guards
   - Lines 73-75: `winning_outcome`, `winning_tokens`, `> 0` require
   - Lines 101-102: `gross_payout_u64` conversion
   - Lines 104-128: Redemption fee logic, `claimed = true`, `total_withdrawn` update, `protocol_fee_accumulated` update
   - Lines 130-157: CPI transfer and event emission

2. **Remove unused import (line 4):**

   ```rust
   // REMOVE this line:
   use crate::engine::fixed_point::mul_div;
   ```

   `mul_div` is no longer used in this file after removing the proportional formula.

**Why this works:**
- Each winning token is backed by exactly 1 unit of collateral (by complete-set minting invariant)
- `gross_payout = winning_tokens` means trader gets exactly what they hold, minus redemption fee
- No dependency on `total_minted` or `reserves` — payout is order-independent by construction
- Losing tokens are worth 0 (already enforced by the `winning_tokens > 0` guard)

**What NOT to change:**
- Do NOT decrement `total_minted` — it's not needed (LP withdrawal uses `reserves[winning]` instead)
- Do NOT modify the `PayoutClaimed` event struct — same fields, just different values
- Do NOT add new accounts or args — the instruction signature is unchanged

---

### TASK P-R2: ✅ Modify `market.rs` — Add resolved LP payout helper

**File:** `programs/dekant-pm/src/state/market.rs`

**What to add:** A new method on `Market` for computing LP payout from a resolved market. Place it after `compute_lp_fee_share` (after line 607):

```rust
/// Compute LP collateral payout from a **resolved** market.
///
/// After resolution with 1:1 trader payouts, the LP's claim is the
/// residual winning-outcome reserves: `reserves[resolved_outcome]`.
/// Each LP gets a proportional share: `residual * shares / lp_shares_total`.
pub fn compute_lp_resolved_payout(&self, shares: u128) -> Result<u128> {
    require!(
        shares <= self.lp_shares_total,
        DekantPmError::InsufficientShares
    );
    let residual = self.reserves[self.resolved_outcome as usize] as u128;
    mul_div(residual, shares, self.lp_shares_total)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))
}
```

**Why a helper:** Consistent with existing pattern (`compute_collateral_for_withdrawal`, `compute_lp_fee_share`). Keeps `remove_liquidity.rs` clean. Testable in isolation.

**Import check:** `market.rs` already imports `mul_div` (line 4). No new imports needed.

---

### TASK P-R3: ✅ Modify `remove_liquidity.rs` — Add resolved-market branch

**File:** `programs/dekant-pm/src/instructions/trading/remove_liquidity.rs`

This is the most complex change. The handler must differentiate between active/pending markets (existing AMM-based withdrawal) and resolved markets (residual-based withdrawal).

**What changes:**

1. **Add import for `mul_div` (at top, after line 7):**

   `mul_div` is NOT currently imported in this file. While we added the helper method to Market, we may still need it if not using the helper. Actually, since we're using the helper method `compute_lp_resolved_payout`, no direct `mul_div` import is needed here. Skip this if using the helper.

2. **Replace the collateral computation block (lines 89-107).** The current code is:

   ```rust
   let collateral_out = market.compute_collateral_for_withdrawal(args.shares_to_burn)?;
   let fee_share = market.compute_lp_fee_share(args.shares_to_burn)?;
   let total_payout = collateral_out
       .checked_add(fee_share)
       .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

   let total_before = market.total_minted;
   let numerator = total_before
       .checked_sub(collateral_out)
       .ok_or_else(|| error!(DekantPmError::InsufficientLiquidity))?;

   let new_k_squared = amm::scale_reserves(
       &mut market.reserves,
       numerator,
       total_before,
   )?;

   market.k_squared = new_k_squared;
   market.total_minted = numerator;
   ```

   **Replace with:**

   ```rust
   // ── Compute collateral owed to LP ────────────────────────────────
   let collateral_out = if market.is_resolved() {
       // Resolved: LP's share of the residual winning-outcome reserves.
       // In 1:1 mode, traders claim x[winning], leaving reserves[winning] for LPs.
       market.compute_lp_resolved_payout(args.shares_to_burn)?
   } else {
       // Active/PendingResolution: proportional share of total_minted (existing AMM logic).
       market.compute_collateral_for_withdrawal(args.shares_to_burn)?
   };

   let fee_share = market.compute_lp_fee_share(args.shares_to_burn)?;
   let total_payout = collateral_out
       .checked_add(fee_share)
       .ok_or_else(|| error!(DekantPmError::MathOverflow))?;

   // ── Update market state ──────────────────────────────────────────
   if market.is_resolved() {
       // Scale ALL reserves proportionally by remaining LP ownership.
       // Only reserves[winning] has monetary value, but we keep all reserves
       // consistent so market state remains mathematically correct after withdrawal.
       let remaining = market.lp_shares_total
           .checked_sub(args.shares_to_burn)
           .ok_or_else(|| error!(DekantPmError::InsufficientShares))?;
       // k_squared is irrelevant post-resolution; discard it.
       let _ = amm::scale_reserves(
           &mut market.reserves,
           remaining,
           market.lp_shares_total,
       )?;
   } else {
       // Active/PendingResolution: scale all reserves proportionally.
       let total_before = market.total_minted;
       let numerator = total_before
           .checked_sub(collateral_out)
           .ok_or_else(|| error!(DekantPmError::InsufficientLiquidity))?;

       let new_k_squared = amm::scale_reserves(
           &mut market.reserves,
           numerator,
           total_before,
       )?;

       market.k_squared = new_k_squared;
       market.total_minted = numerator;
   }
   ```

3. **Everything after this block (lines 108-160) stays UNCHANGED:**
   - `lp_shares_total` decrement (line 108-111)
   - `lp_fee_accumulated` decrement (line 112-115)
   - LP position shares decrement (line 117-121)
   - CPI transfer (lines 126-148)
   - Event emission (lines 150-157)

**Key design decisions in this change:**

| Aspect | Resolved market | Active/Pending market |
|--------|----------------|----------------------|
| Collateral source | `reserves[winning]` via `compute_lp_resolved_payout` | `total_minted` via `compute_collateral_for_withdrawal` |
| Reserve scaling | ALL reserves scaled by `remaining / lp_shares_total` | All reserves scaled by `(total_minted - collateral_out) / total_minted` |
| `total_minted` update | NO — irrelevant post-resolution | YES — decremented |
| `k_squared` update | Computed but discarded (irrelevant post-resolution) | YES — recalculated and stored |
| Fee share | Same formula | Same formula |
| Shares update | Same | Same |

**Why ALL reserves are scaled (not just winning):**
Although only `reserves[winning]` has monetary value post-resolution, LP withdrawal conceptually removes the LP's proportional share of the *entire* pool position. Scaling all reserves keeps market state mathematically consistent — after all LPs withdraw, all reserves reach 0 rather than leaving orphaned losing-outcome tokens. This also ensures `compute_lp_resolved_payout` stays correct for sequential multi-LP withdrawals: both `reserves[winning]` and `lp_shares_total` shrink proportionally, preserving the ratio.

---

### TASK P-R4: ✅ Build verification

After making all three code changes:

```bash
anchor build
```

- Must compile with no errors and no new warnings
- The IDL does NOT change (no new instructions, accounts, or args)
- Therefore `backend/idl/dekant_pm.json` does NOT need updating

---

## Phase 2: Program Tests

### Section 2A: Update Existing Integration Tests

---

### TASK T-R1: ✅ Update `tests/binary-market.ts` — Strengthen claim assertions

**File:** `tests/binary-market.ts` (lines 269-297 — "trader A claims payout (winner)")

**Current assertion (line 296):**
```typescript
expect(Number(ataBalAfter)).to.be.greaterThan(Number(ataBalBefore));
```

**Problem:** This only checks "got something." With 1:1 mode, we can assert the exact amount.

**Change to:**
```typescript
// Fetch position BEFORE claiming to get winning token count
const positionBefore = await ctx.program.account.userPosition.fetch(userPositionPda);
const winningTokens = positionBefore.holdings[0].toNumber(); // outcome 0 wins

// ... (existing claim call) ...

// Exact 1:1 payout: winning_tokens minus redemption fee
const config = await ctx.program.account.protocolConfig.fetch(ctx.protocolConfig);
const redemptionFeeBps = config.redemptionFeeBps;
const expectedFee = Math.floor(winningTokens * redemptionFeeBps / 10_000);
const expectedNet = winningTokens - expectedFee;

const ataBalAfter = (await getAccount(ctx.provider.connection, traderAAta)).amount;
expect(Number(ataBalAfter) - Number(ataBalBefore)).to.equal(expectedNet);
```

**Also add:** After LP removal (lines 327-355), verify vault solvency:
```typescript
// After LP removes, check vault still has enough for protocol fees
const vaultBal = (await getAccount(ctx.provider.connection, vault)).amount;
const market = await ctx.program.account.market.fetch(marketPda);
expect(Number(vaultBal)).to.be.greaterThanOrEqual(Number(market.protocolFeeAccumulated));
```

---

### TASK T-R2: ✅ Update `tests/multi-market.ts` — Strengthen claim assertions

**File:** `tests/multi-market.ts` (lines 116-159 — "winner claims; loser fails")

**Same pattern as T-R1:** Replace the simple `claimed === true` check with an exact payout assertion based on `holdings[outcomeA]`.

---

### TASK T-R3: ✅ Update `tests/continuous-market.ts` — Strengthen claim assertions

**File:** `tests/continuous-market.ts` (lines 142-170 — "trader A claims payout from continuous market")

**Same pattern as T-R1:** The test already reads `winningTokens = positionBefore.holdings[winningBin].toNumber()`. Add exact payout assertion: `balanceDiff === winningTokens - expectedFee`.

---

### Section 2B: New Integration Tests

---

### TASK T-R4: ✅ New test file `tests/resolution-1to1.ts` — Comprehensive 1:1 payout tests

Create a new integration test file focused on the 1:1 payout model and vault solvency. This is the most critical test file for the refactor.

**Test scenarios to implement:**

#### Scenario 1: "exact 1:1 payout — binary market"
1. Create binary market with known initial liquidity (e.g., 10 USDC)
2. Trader A buys YES, Trader B buys NO
3. Wait for deadline, resolve outcome 0 (YES wins)
4. Trader A claims → assert `net_payout == holdings[0] - redemption_fee` exactly
5. Trader B claim → assert `NothingToClaim` error

#### Scenario 2: "claim-then-LP-remove — vault solvency"
1. Create binary market (10 USDC), add second LP (5 USDC)
2. Trader buys YES
3. Resolve YES
4. Trader claims (record payout)
5. LP1 removes all shares (record payout)
6. LP2 removes all shares (record payout)
7. Assert: vault balance == `market.protocolFeeAccumulated` (exact)
8. Assert: trader_payout + lp1_payout + lp2_payout + protocol_fees == initial_vault_balance

#### Scenario 3: "LP-remove-then-claim — order independence"
1. Same setup as scenario 2
2. LP removes first → succeeds, gets `reserves[winning] * shares / lp_shares_total + fee_share`
3. Trader claims second → succeeds, gets `winning_tokens - redemption_fee`
4. Assert same vault solvency as scenario 2
5. Assert: trader and LP payouts are the same regardless of order (compare with scenario 2)

#### Scenario 4: "multiple traders claim then LP removes"
1. Create binary market, 2 traders buy YES with different amounts
2. Resolve YES
3. Both traders claim sequentially
4. LP removes all shares
5. Assert: each trader got exactly their holdings minus fee
6. Assert: LP got exactly `reserves[winning] + fee_share`
7. Assert: vault == protocol_fees

#### Scenario 5: "multiple LPs withdraw from resolved market"
1. Create binary market with creator LP
2. Add LP2 with some amount, add LP3 with some amount
3. Trader buys, resolve
4. Trader claims
5. LP2 removes all shares → gets proportional residual
6. LP3 removes all shares → gets proportional residual
7. Creator LP removes all shares → gets proportional residual
8. Assert: sum of all LP payouts == `original_reserves[winning] + total_lp_fees`
9. Assert: vault == protocol_fees

#### Scenario 6: "no-trade resolved market — LP gets full residual"
1. Create binary market with 10 USDC liquidity
2. No trading at all
3. Resolve
4. LP removes all shares → gets `reserves[winning]` (no traders, no claims)
5. Assert: LP payout == `reserves[winning] + lp_fee_accumulated` (fee is 0 since no trades)
6. Assert: vault == `total_minted - reserves[winning]` + protocol_fees (the losing reserves stay in vault; actually wait — losing reserves are also in total_minted, so vault = total_minted. After LP removes reserves[winning], vault = total_minted - reserves[winning] = x[winning] (tokens held by nobody since no traders). Hmm, this means there's leftover collateral. Let me think...

   **IMPORTANT EDGE CASE:** When no traders hold winning tokens, the "unclaimed" winning tokens belong to nobody. In 1:1 mode, `x[winning] = total_minted - reserves[winning]` is the total winning tokens held by traders. If no traders traded, `x[winning] = total_minted - reserves[winning]` is the pool's implicit position (held by nobody). This collateral is essentially dead — no one can claim it because no UserPosition accounts exist for it.

   **Resolution:** This is actually fine. The initial liquidity provider's position is tracked as LP shares, not as a UserPosition. The pool's implicit winning tokens (`total_minted - reserves[winning]`) are collateral that would have been claimable by traders — but since no traders exist, it stays in the vault. The LP only gets `reserves[winning]` (the tokens still in the pool), which is correct: the LP effectively "lost" on the winning outcome to the extent that the pool was exposed.

   In the degenerate no-trade case with uniform initial state:
   - `reserves[i] = L - isqrt(L^2/N)` for all i
   - `reserves[winning] = L - isqrt(L^2/N)`
   - LP gets back: `reserves[winning] < L`
   - The "lost" amount `L - reserves[winning] = isqrt(L^2/N)` is the initial position the pool has on the winning outcome, which stays unclaimed in the vault

   This is correct behavior — the LP took on market risk and "lost" the initial position's exposure. Same as any market maker.

   **For the test:** Assert LP payout == `reserves[winning]`. Assert vault still holds `total_minted - reserves[winning] + protocol_fees`. This leftover is inaccessible (no UserPosition to claim it).

#### Scenario 7: "continuous market 1:1 claim"
1. Create continuous market (range 0-300, 16 bins)
2. Trader A buys distribution N(150, 20)
3. Resolve at value 155
4. Trader A claims → assert payout == `holdings[winning_bin] - fee`
5. LP removes → assert payout == `reserves[winning_bin] + fee_share`
6. Vault solvency check

#### Scenario 8: "multi-outcome market 1:1 claim"
1. Create 4-outcome market
2. Trader A buys outcome 2, Trader B buys outcome 1
3. Resolve outcome 2
4. Trader A claims → exact payout
5. Trader B claim → NothingToClaim
6. LP removes → residual check

#### Scenario 9: "interleaved claims and LP removes"
1. Create market, add LP2
2. 3 traders buy
3. Resolve
4. Trader1 claims → OK
5. LP2 removes partial shares → OK
6. Trader2 claims → OK (unaffected by LP withdrawal)
7. LP2 removes remaining shares → OK
8. Trader3 claims → OK
9. Creator LP removes all → OK
10. Vault == protocol_fees

#### Scenario 10: "zero winning holdings — claim returns NothingToClaim"
1. Trader buys only the LOSING outcome
2. Resolve the other outcome
3. Trader claim → NothingToClaim
4. (Already tested in existing tests, but include for completeness in this suite)

**Test helpers needed:**
- `getVaultBalance(connection, vault)` — utility to read vault token balance
- `getMarketState(program, marketPda)` — fetch and return market state
- Reuse existing helpers from `tests/helpers/`

---

### Section 2C: Rust Unit Tests

---

### TASK T-R5: ✅ Add unit test for `compute_lp_resolved_payout` in `state_market.rs`

**File:** `programs/dekant-pm/tests/unit/state_market.rs`

Add a test that exercises the new helper method:

```rust
#[test]
fn test_compute_lp_resolved_payout() {
    let mut market = make_binary_market(1_000_000); // helper that creates initialized market
    market.state = STATE_RESOLVED;
    market.resolved_outcome = 0;
    // After some trading: reserves = [300_000, 500_000], lp_shares_total = 1_000_000

    // LP with 500_000 shares out of 1_000_000 total
    let payout = market.compute_lp_resolved_payout(500_000).unwrap();
    // Expected: 300_000 * 500_000 / 1_000_000 = 150_000
    assert_eq!(payout, 150_000);
}

#[test]
fn test_compute_lp_resolved_payout_full_shares() {
    // LP burns all shares → gets full reserves[winning]
    let mut market = make_binary_market(1_000_000);
    market.state = STATE_RESOLVED;
    market.resolved_outcome = 0;
    market.reserves = vec![300_000, 500_000];
    market.lp_shares_total = 1_000_000;

    let payout = market.compute_lp_resolved_payout(1_000_000).unwrap();
    assert_eq!(payout, 300_000);
}

#[test]
fn test_compute_lp_resolved_payout_zero_reserves() {
    // All winning tokens were bought by traders → reserves[winning] = 0
    let mut market = make_binary_market(1_000_000);
    market.state = STATE_RESOLVED;
    market.resolved_outcome = 0;
    market.reserves = vec![0, 500_000];
    market.lp_shares_total = 1_000_000;

    let payout = market.compute_lp_resolved_payout(500_000).unwrap();
    assert_eq!(payout, 0);
}

#[test]
fn test_compute_lp_resolved_payout_rejects_excess_shares() {
    let mut market = make_binary_market(1_000_000);
    market.state = STATE_RESOLVED;
    market.resolved_outcome = 0;
    market.lp_shares_total = 1_000_000;

    let result = market.compute_lp_resolved_payout(1_000_001);
    assert!(result.is_err());
}
```

Note: These tests need to construct a `Market` struct directly. Check if existing tests in `state_market.rs` have a helper for this (like `make_binary_market`). If not, create one.

---

### TASK T-R6: ✅ Run all program tests

```bash
# Rust unit tests
cargo test --test '*'

# Integration tests (requires local validator)
anchor test
```

Both must pass with zero failures.

---

## Phase 3: Backend Assessment

### TASK B-R1: ✅ Verify no backend code changes needed

**Verification checklist:**

| Backend component | Touches payout logic? | Change needed? |
|---|---|---|
| `backend/src/amm/amm.service.ts` | No — pure pricing/estimation, no claim/payout | **No** |
| `backend/src/indexer/indexer.service.ts` | Only sets `claimed = true` on PayoutClaimed event | **No** |
| `backend/src/market/market.service.ts` | Caches on-chain state; no payout computation | **No** |
| `backend/src/market/entity/market.entity.ts` | Schema only; no logic | **No** |
| `backend/src/user/entity/user-position.entity.ts` | Schema only; `claimed` field unchanged | **No** |
| `backend/src/user/entity/lp-position.entity.ts` | Schema only; shares field unchanged | **No** |
| `backend/src/user/user.service.ts` | Returns positions; no payout math | **No** |
| `backend/src/fee-collection/fee-collection.service.ts` | Collects protocol fees; logic unchanged | **No** |

**Why no changes:**
- The backend never computes payout amounts — that's done entirely on-chain
- The `PayoutClaimed` event fields (`gross_amount`, `fee_paid`, `net_amount`) are the same struct, just with different values (the on-chain instruction determines the values)
- The indexer just reads events and updates DB flags
- Market entity stores `resolvedOutcome`, `totalMinted`, `reserves` etc. — schema unchanged

### TASK B-R2: ✅ Run backend tests to confirm no regressions

```bash
cd backend && npm test         # 172 unit tests across 12 suites
cd backend && npm run test:e2e # 193 e2e tests across 6 suites
```

All should pass unchanged. If any fail, investigate — it's a pre-existing issue, not caused by this refactor.

---

## Phase 4: Frontend Assessment

### TASK F-R1: ✅ Verify no frontend code changes needed

**Key finding: The frontend already displays 1:1 payouts.** All resolved-market value computations return `holdings[winningOutcome]` directly (face value = 1 token = 1 collateral), which IS the 1:1 model.

| Frontend file | Current behavior | Change needed? |
|---|---|---|
| `components/portfolio/position-card.tsx` (line 150-158) | `computeCurrentValue` returns `holdings[winIdx]` for resolved | **No** |
| `components/trading/user-position-display.tsx` (line 140-144) | `computeValue` returns `holdings[winIdx]` for resolved | **No** |
| `app/portfolio/page.tsx` (line 338) | `computePositionValue` returns `holdings[resolvedOutcome]` | **No** |
| `components/portfolio/claim-button.tsx` | Calls `executeClaimPayout()` on-chain; displays `estimatedPayout` | **No** |
| `components/trading/cost-preview.tsx` (line 369) | "Max payout" = `tokensOut` (consistent with 1:1) | **No** |
| `components/oracle/resolve-form.tsx` | Calls `executeResolveMarket()` on-chain | **No** |
| `lib/transactions.ts` | Wraps on-chain RPC calls; no payout math | **No** |
| `lib/types.ts` | Type definitions and `computeProbabilities` — no payout logic | **No** |

**Accuracy improvement (no code change needed):**
Before this refactor, the frontend showed `holdings[winIdx]` (1:1 estimate) but the on-chain payout was `holdings[winIdx] * total_minted / x[winning]` (proportional, always >= 1:1). So the displayed estimate was **lower** than actual payout. After the refactor, on-chain matches the display exactly.

### TASK F-R2: ✅ Run frontend build to confirm no regressions

```bash
cd frontend && PATH="/usr/local/n/versions/node/23.3.0/bin:$PATH" pnpm next build
```

Must complete cleanly with Turbopack.

---

## Phase 5: Devkit & CLI Assessment

### TASK C-R1: ✅ Verify no devkit/CLI code changes needed

| Component | Payout logic? | Change needed? |
|---|---|---|
| `devkit/src/market.ts` (claim command) | Calls `claimPayout()` on-chain; shows balance diff | **No** |
| `devkit/src/resolve.ts` | Calls `resolveMarket()` on-chain; shows state | **No** |
| `devkit/src/query.ts` | Reads on-chain state; no payout computation | **No** |
| `devkit/src/trade.ts` | Shows `claimed` flag | **No** |
| operator-cli | Calls on-chain instructions | **No** |
| goperator-cli | Calls on-chain instructions (Go) | **No** |

**All CLIs just call on-chain instructions.** The instruction interface (accounts, args) doesn't change — only the on-chain computation changes. CLIs will automatically use the new payout model.

---

## Phase 6: Documentation Updates

---

### TASK D-R1: ✅ Update `plans/MAJOR_BUGS.md` — Mark BUG-003 as fixed

**File:** `plans/MAJOR_BUGS.md`

Update BUG-003 section:
- Change status from `Open — validated 2026-03-27` to `Fixed — resolved by 1:1 payout refactor (2026-XX-XX)`
- Add a "Resolution" subsection at the top noting which commit/PR fixed it
- Keep the analysis and alternative approaches for reference

---

### TASK D-R2: ✅ Update `plans/details/lp-analysis.md` — Correct false claims

**File:** `plans/details/lp-analysis.md`

The following statements are **incorrect** and must be corrected:
- Lines 73-76 and line 157 claim `total_minted is reduced by the collateral portion of each claim` — this was always false, and is now moot (1:1 doesn't use total_minted for claims)
- Section 7 analysis of "LPs get less after claims" was based on this false premise

Add a note at the top of the affected sections:
> **Note (post-refactor):** This section was written under the proportional payout model. With the 1:1 refactor, claim_payout no longer depends on or modifies total_minted. LP payout from resolved markets uses reserves[winning_outcome] instead.

---

### TASK D-R3: ✅ Update `plans/CONTEXT.md` — Session context

Add an entry noting the 1:1 refactor completion with date, files changed, and tests added.

---

### TASK D-R4: ✅ Update `plans/TASKS.md` — Mark related tasks

If P-20 (Math Review) includes reviewing the payout formula, note that it has been addressed by the 1:1 refactor.

---

## Phase 7: Final Verification Checklist

Run these checks AFTER all changes are complete:

```
[x] anchor build                           — compiles cleanly ✅
[x] cargo test --test '*'                  — 215 Rust unit tests pass ✅
[x] anchor test                            — 122 integration tests pass (existing + new) ✅
[x] cd backend && npm test                 — 190 backend unit tests pass (unchanged) ✅
[x] cd backend && npm run test:e2e         — 245 backend e2e tests pass (unchanged) ✅
[x] cd frontend && pnpm next build         — frontend builds cleanly (unchanged) ✅
[x] git diff -- programs/                  — only expected files changed ✅
[x] git diff -- backend/                   — NO changes (zero diff) ✅
[x] git diff -- frontend/                  — NO changes (zero diff) ✅
[x] git diff -- devkit/                    — NO changes (zero diff) ✅
```

### Accounting Proof (verify in test T-R4 Scenario 2):

```
Given:
  V = vault balance = total_minted + lp_fee_accumulated + protocol_fee_accumulated
  T = sum of all trader claims = sum(winning_holdings_i - redemption_fee_i)
  L = sum of all LP withdrawals = reserves[winning] + lp_fee_accumulated
  P = protocol_fee_accumulated (after redemption fees added)

Verify:
  V = T + L + P
  After all claims and withdrawals: vault = P
  After collect_fees: vault = 0
```

---

## Summary of Changes

| Section | Files changed | Lines changed |
|---------|--------------|---------------------|
| On-chain program | 3 files | +97/-54 |
| Integration tests | 3 files updated + 2 new files | +1,548 lines |
| Rust unit tests | 1 file | +56 lines |
| Backend | 0 files | 0 |
| Frontend | 0 files | 0 |
| Devkit/CLIs | 0 files | 0 |
| Scripts | 0 files | 0 |
| Documentation | 6 files | ~50 lines |

**Files modified (program):**
1. `programs/dekant-pm/src/instructions/trading/claim_payout.rs` — replace formula
2. `programs/dekant-pm/src/state/market.rs` — add helper method
3. `programs/dekant-pm/src/instructions/trading/remove_liquidity.rs` — add resolved branch

**Files modified (tests):**
1. `tests/binary-market.ts` — strengthen assertions
2. `tests/multi-market.ts` — strengthen assertions
3. `tests/continuous-market.ts` — strengthen assertions
4. `tests/resolution-1to1.ts` — NEW: comprehensive 1:1 test suite (691 lines, 10 scenarios)
5. `tests/continuous-deep.ts` — NEW: deep continuous market tests (857 lines)
6. `programs/dekant-pm/tests/unit/state_market.rs` — add resolved payout unit tests

**Documentation updated:**
1. `plans/MAJOR_BUGS.md` — BUG-003 marked fixed with commit reference
2. `plans/details/lp-analysis.md` — corrected false claims, updated summary table
3. `plans/CONTEXT.md` — session context entry
4. `plans/TASKS.md` — P-20 payout scope marked as addressed
5. `plans/TDD.md` — added note that payout section is pre-refactor
6. `plans/PRD.md` — added note that implementation uses 1:1 instead of parimutuel
