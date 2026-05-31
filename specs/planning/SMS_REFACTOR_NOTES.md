# Improved-Model Refactor — Review Notes

Running list of items that survived implementation but deserve a second look at the end of the refactor. Scope is intentionally narrow: only points where a future debugging session, code review, or behavioral surprise is reasonably likely. Minor stylistic or local-only concerns are kept out.

Each entry: what it is, why it matters for end-of-refactor review, and a concrete example where useful.

---

## 1. Per-bin flooring in kernel-weighted payouts (Phase 3)

**What.** `compute_kernel_payout` and `compute_scaling_factor` both go through a shared `raw_claims` helper that floors at the per-bin kernel-application step:

```rust
contribution_i = floor(holdings[i] * kernel_weight(i, ...) / SCALE)
```

The `kernel_weight` itself is also floored when `(W+1)` doesn't divide `SCALE` evenly (e.g., `K(d=1, W=2) = floor(SCALE * 2/3) = 666_666_666`, losing 0.333…/SCALE). So **two layers of flooring** happen before the final `sf` scaling:

1. inside `kernel_weight` (when SCALE / (W+1) isn't exact)
2. at each bin's `t * K / SCALE`

Then a third floor at the aggregate `* sf / SCALE`. The function returns slightly less than the mathematical ideal; the difference accumulates as dust in the vault (which is safe — the LP residual is *conservative* by construction).

**Why it matters at review.** Traders may report "I expected payout X based on the chart, but got X − 2". The off-by-a-few-units gap is expected behavior, not a bug. Need to either:
- accept the gap and document it user-facing, or
- if it grows large enough to matter, switch the kernel math to wider intermediates (u256) and floor only at the very end.

**Example.** Trader holds 100, 300, 100 in bins 5, 6, 7 with `win=6`, `W=2`, `sf=666_666_666`:
- mathematical payout: 100·0.6666̄ + 300·1.0 + 100·0.6666̄, then × 0.6666̄ ≈ **288.88**
- Shape A (per-bin sf-scaling, rejected): 43 + 199 + 43 = **285**
- Shape B (what ships — aggregate-then-scale): floor((66+300+66)·666_666_666 / 10⁹) = **287**

The trader receives 287 instead of ~289. Gap stays small for realistic trade sizes; could grow noticeable for tiny positions or large `W`.

**Tested by.** `test_solvency_invariant_aggregate_payout_le_total_minted` proves the LP residual never goes negative across 540+ configs; doesn't characterize the dust gap itself.

---

## 2. Probability display sums to SCALE only approximately (Phase 1)

**What.** `compute_probabilities` (on-chain + frontend + backend) now uses `p_i = x_i / Σ_j x_j`. Each per-outcome probability is floored to a SCALE-denominated integer. The sum is `SCALE ± (n − 1)` in the worst case — never exactly SCALE for non-uniform distributions where `Σ x_j` doesn't divide each `x_i` evenly.

Verified by `test_probabilities_sum_approximately_scale` (Rust) and the equivalent TS test.

**Why it matters at review.** Three downstream consumers might assume exact-equal-to-SCALE and silently break:
- Any UI display that *normalizes by sum* will see jittery totals (e.g., 99.9999998% instead of 100%)
- Any audit script that does `assert(sum(probabilities) == SCALE)` will fail
- Any future logic that uses `1 - p_i` as a probability complement will be off by `(n−1)/SCALE` units

Quadratic display *also* had this issue (per-term flooring), so it's not new — but the linear formula spreads the error across more bins because `x_i / Σ_j x_j` floors at every bin, whereas the quadratic form `x_i² / k²` only floored once per bin via a different path.

**Example.** 3-outcome market with x = [333, 333, 334]. Σ = 1000.
- p_0 = floor(333 · 10⁹ / 1000) = 333_000_000
- p_1 = 333_000_000
- p_2 = floor(334 · 10⁹ / 1000) = 334_000_000
- Σ p = 1_000_000_000 = SCALE (this case happens to be exact)

But x = [1, 1, 1, 7]. Σ = 10.
- p_0..2 = floor(10⁹/10) = 100_000_000
- p_3 = floor(7·10⁹/10) = 700_000_000
- Σ = 10⁹ = SCALE (also exact here, since 10 | 10⁹)

The drift only shows up when Σ_j x_j is *not* a divisor of SCALE = 10⁹. With realistic AMM positions (large u64 reserves), this is the common case. Empirically the gap is ≤ (n−1) ULPs.

---

## 3. `buy_to_price` / `sell_to_price` target semantic flipped (Phase 1, P1-4a)

**What.** Both on-chain (`compute_collateral_for_target_prob`, `compute_tokens_for_target_prob`) and backend (`estimateBuyToPrice`, `estimateSellToPrice`) now interpret `target_prob` as the **linear displayed probability**. Before Phase 1, the on-chain math interpreted it as the *quadratic* probability `x_i² / k²`. The new formula derives `x_i_target = target · S / (SCALE − target)` where `S = Σ_{j≠i} x_j`.

**Why it matters at review.**
- This is a *wire-level* behavioral change with no schema version flag on the instruction. A cached/old frontend bundle submitting "buy to 70%" computed under quadratic semantics will execute under linear semantics on-chain — the trade succeeds but lands at a *different* displayed probability than the user intended.
- At program-upgrade time, frontend and backend must be deployed together. There's no graceful fallback period.
- Any third-party integrator (analytics, bots, alternative UIs) reading historical `target_prob` parameters from transaction history will see a discontinuity at the upgrade slot.

**Example.** Binary market with `x_A = 200, x_B = 100` (so `Σ = 300`):
- linear p_A = 200/300 ≈ 67%
- quadratic p_A = 40000/(40000+10000) = 80%

A trader submitting "buy A to 70%" under the new program math expects to push linear p_A from 67% → 70%. Under the old client's quadratic math, "70%" meant a different `x_i` target. The on-chain instruction has no way to distinguish intent.

**Mitigation already in plan.** Phase 7 requires synchronized deploy of program + backend + frontend. Worth re-confirming this at deploy time and in the release notes.

---

## 4. Borsh padding-to-named-field migration assumes zero defaults (Phase 2)

**What.** Phase 2 consumed 10 of the 30 bytes of `Market._padding` to add `kernel_width: u16` + `scaling_factor: u64`. Existing v1 accounts have all-zero padding bytes; under the v2 layout, those bytes deserialize as `kernel_width = 0` and `scaling_factor = 0`. This is *exactly* the WTA-mode default, so behavior is preserved.

The trick works because **both new fields' meaningful defaults are zero**. Any future Phase that consumes more padding bytes the same way must respect this constraint: the deserialized-from-zero value must equal the intended default for unmigrated accounts.

**Why it matters at review.**
- Future field additions might forget this rule. E.g., adding `pub min_trade_size: u64` consuming 8 more bytes — for unmigrated markets this would deserialize as `0`, which probably *isn't* the intended default for an existing market.
- If `SCHEMA_VERSION` ever becomes load-bearing in logic (e.g., "behave differently for v1 vs v2"), the program needs an explicit migration path; today the version field is informational only.
- Any external indexer/analytics tool that deserializes Market accounts with an old IDL after the upgrade will silently misalign field offsets for everything after `scaling_factor`. The current backend re-syncs via `BorshCoder` so it's safe, but third-party tools are not.

**Example.** Hypothetical future Phase 10 adds `pub creator_share_bps: u16` consuming 2 more padding bytes. For pre-v2 markets this deserializes as 0% creator share — probably fine. But adding `pub min_collateral: u64 = 1_000_000` (1 USDC default) consuming 8 bytes would deserialize as 0 for existing markets, meaning "no minimum" — *not* the documented default. Bug.

**Tested by.** `test_borsh_layout_v1_zero_padding_equals_v2_zero_kernel_fields` and `test_deserialize_v1_account_with_v2_struct` (Phase 2 P2-1a/P2-1b).

---

## 5. Untracked vault dust after full settlement (Phase 4)

**What.** Related to §1 but distinct: after every winning trader has claimed and every LP has burned all their shares on a kernel-mode market, the vault still holds a tiny residue. It comes from two arithmetic sources that §1 also discusses, but the *end-state observation* is what matters here:

1. `resolve()` carves the LP residual from the **aggregate** `raw_claims(trader_token_totals)` — one floor per bin over the sum.
2. `claim_payout` reads each trader's gross via `raw_claims(holdings_trader)` — one floor per bin per trader.

Flooring is sub-additive (`floor(a/k) + floor(b/k) ≤ floor((a+b)/k)`), so the sum of per-trader payouts can be strictly less than what the residual formula reserved for them. The difference plus the `(raw * sf) / SCALE` final-floor loss (up to 1 unit per claiming trader) is stranded in the vault.

**Why it matters at review.** No on-chain instruction can withdraw this residue:
- `claim_payout` requires `!position.claimed` — all flags are true after final claim
- `remove_liquidity` requires `lp_position.shares > 0` and `lp_shares_total > 0` — both zero
- `collect_fees` transfers exactly `market.protocol_fee_accumulated`, *not* `vault_balance - tracked_accounts`

Consequences a future operator might trip over:
- Any "vault is empty after settlement" assumption in dashboards / analytics will be off by a few hundred to a few thousand base units per kernel-mode market.
- Reconciliation scripts that compare `vault_balance` against `protocol_fee_accumulated + lp_fee_accumulated + reserves[win] * shares_remaining / lp_shares_total` will see a positive delta that doesn't fit any tracked bucket — that delta is the dust, not a bug.
- The Market PDA is not closable while the vault token-account is non-empty, so the residue indirectly keeps both accounts paying rent.

WTA-mode markets (binary, multi, continuous with `kernel_width = 0`) have **no** such residue — the WTA payout `holdings[win]` is exact, and `Σ holdings[win] = trader_token_totals[win]` by definition.

**Order of magnitude.** Bounded roughly by `O(num_bins_in_kernel × num_claiming_traders)` base units. For W=3 (7 bins) and 1000 traders, worst case ~7000 base units. At SCALE = 10^9 and USDC's 6 decimals that's ~7 µ-µUSDC — a sub-microcent. Real but negligible.

**Mitigation (not implemented).** If a future change wants to sweep it, the cleanest extension is to add a "post-settlement sweep" branch to `collect_fees` that activates when `state == Resolved && lp_shares_total == 0` and transfers `vault_balance - protocol_fee_accumulated - lp_fee_accumulated` to the treasury. Math is sound (the dust is always conservative-direction by §1's invariant). Skipped during the refactor because (a) the amount is monetarily trivial, (b) it adds an instruction-surface item that needs its own tests, and (c) the residue serves as a small implicit solvency safety margin.

**Tested by.** `test_solvency_invariant_aggregate_payout_le_total_minted` proves the residue is non-negative (the LP residual never goes underwater); it does not characterize the dust magnitude itself. No test currently asserts "vault is empty after final claim + final LP exit" — and intentionally so, since for kernel-mode markets that assertion would be false.

---

## Adding to this file

When working through later phases (4, 6, 7), add an entry here only if:
- The point could surprise a future debugger or auditor, AND
- It isn't already self-documenting from reading the code

Things like local variable choices, internal helper API shape, or test scaffolding tradeoffs do *not* belong here — those are PR-review concerns. This file is for things that matter at the end-of-refactor review.
