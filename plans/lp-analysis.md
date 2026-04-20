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

**This cannot happen by construction.** Here's why:

The formula `collateral_out = total_minted × shares / lp_shares_total` is bounded:
- If an LP owns 100% of shares (`shares == lp_shares_total`), they get back `total_minted` — exactly the entire pool
- If they own 50%, they get 50% of `total_minted`
- The sum of all LPs' claims exactly equals `total_minted` — never more

**But what about the vault balance?**

The vault holds: `total_minted + lp_fee_accumulated + protocol_fee_accumulated`

When removing: `total_payout = collateral_out + fee_share`. Both are drawn from their respective pools, so the vault always has enough.

**Edge case — traders have claimed payouts in a resolved market:**

The claim_payout instruction draws from `total_minted` too. After claims, `total_minted` is reduced. So if traders claim first, LPs get less collateral back (but they still get their proportional fee share). This is correct behavior: the LP's share of the pool is now smaller because collateral was paid out to winning traders.

**The math guarantees:**
- `Σ(all LP shares) = lp_shares_total` (invariant)
- `Σ(all LP collateral claims) = total_minted` (exact)
- `Σ(all LP fee claims) = lp_fee_accumulated` (exact)
- No LP can withdraw more than their proportional share
- No case where vault runs out before all LPs withdraw

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

**Bottom line:** LP removal is necessary but is the design surface where abuse can happen. The current implementation is mathematically sound but lacks economic guardrails against strategic withdrawals. For a v1, this is acceptable — these mitigations are typically added after observing actual market behavior.

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
- After fee deductions, net payout is transferred from vault
- **`total_minted` is reduced** by the collateral portion of each claim
- LP fee pool and protocol fee pool are untouched by claims

### Step 3: LPs withdraw (`remove_liquidity`)
- LPs can withdraw at any time (before, during, or after trader claims)
- Their payout: `collateral_out + fee_share`
  - `collateral_out = total_minted × shares / lp_shares_total`
  - `fee_share = lp_fee_accumulated × shares / lp_shares_total`

### What does this mean concretely?

**If an LP withdraws BEFORE any trader claims:**
- `total_minted` is still the full pool
- LP gets their full proportional share of collateral + fees
- The pool shrinks, and remaining traders/LPs split what's left

**If an LP withdraws AFTER all traders have claimed:**
- `total_minted` has been reduced by all trader payouts
- LP gets their proportional share of what remains + fees
- This is typically smaller than pre-claim withdrawal

**Key insight:** The order of LP withdrawal vs trader claims DOES matter for LPs. Early-withdrawing LPs get a larger collateral share. However, `total_minted` is updated atomically with each claim, so the math is always consistent — no one gets more than the vault holds.

### Example scenario:
```
Market: Binary (Yes/No), resolves YES
Pool: total_minted = 1000 USDC, lp_fee_accumulated = 50 USDC
LP Alice: 60% of shares, LP Bob: 40% of shares
Traders hold 800 USDC worth of YES tokens

Trader claims happen first:
  total_minted: 1000 → 200 (after 800 USDC paid to YES holders)

Then LPs withdraw:
  Alice: collateral = 200 × 0.6 = 120 USDC, fees = 50 × 0.6 = 30 USDC → total 150
  Bob:   collateral = 200 × 0.4 = 80 USDC,  fees = 50 × 0.4 = 20 USDC → total 100
```

LPs effectively absorb the "loss" from paying out winning traders, but earn it back through accumulated trading fees. **This is the fundamental LP tradeoff:** you earn fees during trading but bear the risk that the pool shrinks when winners claim.

---

## Summary Table

| Question | Answer |
|----------|--------|
| Who can LP? | Any wallet (no role check) |
| Is open LP wise? | Yes — standard, necessary for depth |
| Who can remove? | Only the original depositor |
| Can vault run out? | No — math guarantees solvency |
| Does LP affect trading? | No — probabilities preserved, only depth changes |
| Is LP removal wise? | Yes but needs future guardrails (lock periods, fees) |
| Resolution + LP? | LPs withdraw remaining pool + fees; order vs trader claims matters |
