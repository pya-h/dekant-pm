# Liquidity Provision — Analysis & Answers

---

## 1. Who Can Provide/Remove Liquidity?

**Any wallet can add liquidity.** There is zero role-checking — the `provider` account is just a `Signer<'info>`. No Admin, Oracle, or Creator role required.

**Only the position owner can remove.** The on-chain constraint `lp_position.user == provider.key()` enforces this. The LP position is a PDA seeded with `["lp_position", market, provider]`, so only the original depositor can withdraw.

The market creator automatically gets the first LP position during `create_market` — their initial liquidity deposit mints 1:1 shares.

---

## 2. Is Allowing All Users to Provide Liquidity Wise?

**Short answer: Yes, it's the standard and correct approach for a prediction market AMM.**

**Why it works:**

- **Security:** LP deposits are collateral transfers into a vault controlled by a PDA. The math is deterministic — each LP gets shares proportional to their deposit relative to the pool. There's no attack vector from depositing, because the share formula `shares = lp_shares_total × deposit / total_minted` is manipulation-resistant (you can't get more shares than you put in).

- **Business logic:** Open LP is how prediction markets achieve deep liquidity. If only the creator provides liquidity, the market is limited to their capital. Open LP lets the market grow beyond one actor's resources, which means tighter spreads and better prices for traders.

- **Math safety:** The L2-norm invariant is maintained via `scale_reserves()` on every LP operation. All reserves scale proportionally — no individual LP can distort the probability distribution. Adding liquidity deepens the pool uniformly across all outcomes.

**The one risk:** A large LP deposit right before resolution could dilute existing LPs' fee earnings (they'd share accumulated fees with the new entrant). However, this is self-correcting: the new LP receives fewer shares per USDC as `total_minted` grows, so the dilution is bounded. This is an accepted tradeoff in all AMM designs (Uniswap, Polymarket, etc.).

---

## 3. How Does Remove Liquidity Work?

**Yes — only a user who has provided liquidity before can remove it.** The on-chain constraint:

```rust
constraint = lp_position.user == provider.key() @ DekantPmError::Unauthorized
```

Plus the PDA derivation `[LP_POSITION_SEED, market, provider]` ensures only the depositor can burn their own shares.

**The removal flow:**

1. User specifies `shares_to_burn` (how many LP shares to destroy)
2. Program computes: `collateral_out = total_minted × shares_to_burn / lp_shares_total`
3. Program computes: `fee_share = lp_fee_accumulated × shares_to_burn / lp_shares_total`
4. Total payout = `collateral_out + fee_share`
5. All reserves scale down: `reserves[i] *= (total_minted - collateral_out) / total_minted`
6. `k_squared` updates to `(total_minted - collateral_out)²`
7. Shares are burned, fees deducted from pool, collateral transferred from vault to provider

**State constraints for removal:**
- Allowed in: Active, PendingResolution, Resolved
- Blocked in: Paused only
- Key design decision: **LPs can always exit** (even after deadline/resolution), unlike traders who can only trade during Active state

---

## 4. What If the Market Doesn't Have Enough Liquidity?

> **BUG-003 (Critical):** The analysis below is correct for **active markets** (no claims have occurred). For **resolved markets**, `claim_payout` never decrements `total_minted`, causing vault insolvency. See `MAJOR_BUGS.md → BUG-003` for details.

**During active trading, this cannot happen by construction.** Here's why:

The formula `collateral_out = total_minted × shares / lp_shares_total` is bounded:
- If an LP owns 100% of shares (`shares == lp_shares_total`), they get back `total_minted` — exactly the entire pool
- If they own 50%, they get 50% of `total_minted`
- The sum of all LPs' claims exactly equals `total_minted` — never more

**But what about the vault balance?**

The vault holds: `total_minted + lp_fee_accumulated + protocol_fee_accumulated`

When removing: `total_payout = collateral_out + fee_share`. Both are drawn from their respective pools, so the vault always has enough.

**Edge case — traders have claimed payouts in a resolved market:**

**KNOWN BUG (BUG-003):** `claim_payout` transfers collateral from the vault but **never decrements `market.total_minted`**. This means:
- After trader claims, `total_minted` remains stale (its original value)
- `remove_liquidity` computes `collateral_out` from this stale value
- The vault no longer holds enough to cover the computed `collateral_out`
- **Result:** Either LP withdrawal fails (SPL transfer error) or, if LPs withdraw first, traders receive nothing

**The math guarantees (active markets only):**
- `Σ(all LP shares) = lp_shares_total` (invariant) — correct
- `Σ(all LP collateral claims) = total_minted` (exact) — correct during active trading
- `Σ(all LP fee claims) = lp_fee_accumulated` (exact) — correct
- ~~No LP can withdraw more than their proportional share~~ — **false post-resolution** (BUG-003)
- ~~No case where vault runs out before all LPs withdraw~~ — **false post-resolution** (BUG-003)

---

## 5. Does LP Interfere With Trading?

**No — LP and trading are designed to be orthogonal.** Here's the mechanism:

**Adding LP does NOT change probabilities:**

When LP is added, `scale_reserves()` scales ALL reserves proportionally:
```
reserves[i]_new = reserves[i]_old × (total_minted + deposit) / total_minted
```

Since probabilities are computed as `p[i] = (total_minted - reserves[i])² / k_squared`, and both the numerator and denominator scale by the same factor, **probabilities remain identical** after an LP operation.

**What LP changes:**
- **Pool depth**: More liquidity = less price impact per trade = tighter spreads
- **k_squared**: The invariant grows, so larger trades are needed to move the price the same amount
- This is purely beneficial for traders — deeper markets mean better execution

**Removing LP shrinks the pool** (reverse scaling), which means:
- Same probabilities, but higher price impact per trade
- If too much liquidity is removed, trades become more expensive (worse slippage)
- In extreme case: if nearly all LP is withdrawn, the market becomes very thin and impractical

**Interaction during active trading:**
- LP operations and trades can interleave freely
- Each operation independently maintains the L2-norm invariant
- No race condition concerns (Solana serializes transactions per account)

---

## 6. Is Allowing LP (and LP Removal) a Wise Move?

**Allowing LP: Unambiguously yes.**

Without open LP, markets die from low liquidity. The creator's initial deposit sets a floor, but real markets need depth. Every serious prediction market platform (Polymarket, Manifold, Kalshi's market makers) relies on LP-style liquidity. Without it, you'd have wide spreads, high slippage, and poor user experience.

**Allowing LP removal: Yes, but it's the riskier side.** Here's the nuance:

**Pros:**
- LPs won't deposit if they can't withdraw — blocking removal kills LP incentive entirely
- LPs need exit liquidity for risk management
- Resolved markets need withdrawal for LPs to realize their fee earnings

**Cons / Risks:**
- **Liquidity rug**: An LP with a large position could withdraw right before major news, leaving the market thin at the worst moment. Traders then face massive slippage.
- **Strategic withdrawal**: An LP who also trades could remove liquidity, make a trade on the thin market (moving the price cheaply), then re-add liquidity. This is a form of market manipulation.

**Mitigations this protocol has:**
- None specific to the above attacks currently. Most real-world platforms add:
  - **Time-locked LP** (e.g., minimum lock period before withdrawal)
  - **Withdrawal fees** (discourage in-and-out)
  - **Gradual withdrawal** (cap % withdrawable per epoch)

**Bottom line:** LP removal is necessary but is the design surface where abuse can happen. The current implementation is mathematically sound **during active trading** but has a critical post-resolution accounting bug (BUG-003) and lacks economic guardrails against strategic withdrawals. For a v1, the strategic withdrawal risks are acceptable — these mitigations are typically added after observing actual market behavior. BUG-003 must be fixed before production.

---

## 7. What Happens to LP When a Market Resolves?

**The resolution flow from the LP perspective:**

### Step 1: Market resolves (`resolve_market`)
- Oracle calls `resolve_market` with the winning outcome
- Market state transitions to `Resolved`
- **Nothing happens to the LP pool yet** — `total_minted`, `lp_shares_total`, `lp_fee_accumulated` are unchanged
- Reserves freeze (no more trading)

### Step 2: Traders claim payouts (`claim_payout`)
- Each trader with winning tokens calls `claim_payout`
- Payout formula: `gross_payout = winning_tokens × total_minted / winning_tokens_total`
- After fee deductions (redemption fee), net payout is transferred from vault
- **`total_minted` is NOT modified** — it remains at its pre-resolution value (this is BUG-003)
- LP fee pool and protocol fee pool are untouched by claims (redemption fee goes to `protocol_fee_accumulated`)

### Step 3: LPs withdraw (`remove_liquidity`)
- LPs can withdraw at any time (before, during, or after trader claims)
- Their payout: `collateral_out + fee_share`
  - `collateral_out = total_minted × shares / lp_shares_total`
  - `fee_share = lp_fee_accumulated × shares / lp_shares_total`

> **BUG-003:** Because `total_minted` is never decremented by claims, `collateral_out` is computed from a stale value. This causes vault insolvency — see failure scenarios below.

### What ACTUALLY happens (current buggy behavior)

**If an LP withdraws BEFORE any trader claims:**
- `total_minted` is the full pool → LP takes their full proportional share
- Vault has enough → transfer succeeds
- But now the vault is depleted by more than it should be — subsequent trader claims may fail

**If traders claim first, then LP withdraws:**
- Vault has been reduced by trader payouts, but `total_minted` is unchanged
- LP computes `collateral_out` from the original `total_minted` (too large)
- **SPL token transfer fails** — vault doesn't have enough

**If LP removes first (100% shares):**
- LP takes `total_minted` (the entire pool) + fee share
- `total_minted` → 0, all reserves → 0
- Traders then call `claim_payout` → `winning_tokens_total = 0 - 0 = 0` → **TX fails with NothingToClaim**

### What SHOULD happen (after BUG-003 is fixed)

The intended design is:
- Trader payouts come from the collateral pool, reducing the amount available to LPs
- LPs receive the residual: whatever remains after all trader claims, plus their fee share
- The order of claims vs LP withdrawal should not affect total amounts

See `MAJOR_BUGS.md → BUG-003` for the proposed fix approaches.

### Example of the bug:
```
Market: Binary (Yes/No), resolves YES
Pool: total_minted = 1000, lp_fee_accumulated = 50, protocol_fee = 10
Vault balance = 1000 + 50 + 10 = 1060
LP Alice: 100% of shares
Traders collectively hold 600 YES tokens out of 800 total winning position (x_YES)
(Pool implicit position = 200)

CURRENT (BUGGY) — traders claim first:
  Total trader claims: 600 × 1000 / 800 = 750 (gross, ~746 net after redemption fee)
  Vault: 1060 → ~314
  total_minted: still 1000

  Alice removes LP:
    collateral_out = 1000, fee_share = 50, total = 1050
    Vault has ~314 → TX FAILS

CURRENT (BUGGY) — LP removes first:
  Alice: collateral_out = 1000, fee_share = 50, total = 1050
  Vault: 1060 → 10, total_minted → 0, reserves → [0, 0]
  Traders claim: winning_tokens_total = 0 → NothingToClaim error
  TRADERS GET NOTHING
```

---

## Summary Table

| Question | Answer |
|----------|--------|
| Who can LP? | Any wallet (no role check) |
| Is open LP wise? | Yes — standard, necessary for depth |
| Who can remove? | Only the original depositor |
| Can vault run out? | Yes — BUG-003: vault insolvent post-resolution |
| Does LP affect trading? | No — probabilities preserved, only depth changes |
| Is LP removal wise? | Yes but needs future guardrails (lock periods, fees) |
| Resolution + LP? | BROKEN (BUG-003): either LP or trader loses funds depending on order |
