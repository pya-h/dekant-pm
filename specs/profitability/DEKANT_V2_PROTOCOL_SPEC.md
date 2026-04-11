# DekantPM v2 Protocol Specification

Originally designed on April 7, 2026. Updated 2026-04-11 to reflect partial implementation via the `trader_token_totals` fix.

This document specifies a concrete `DekantPM v2` protocol that:

- keeps the current finite approximation approach
- ~~fixes the LP/accounting errors identified in the prior reports~~ **Partially achieved** — the `trader_token_totals` fix (2026-04-11) eliminates the deterministic LP no-trade loss. The full `u/h/r/t` vector separation proposed here is a further refinement.
- preserves native liquidity provision
- supports both buying and selling
- makes consensus cumulative across all users
- resolves smoothly on a continuous outcome
- remains compatible with a later upgrade toward a more Paradigm-like signed-exposure market

**Implementation status:** The LP accounting fix is **done** (via `trader_token_totals`). The remaining v2 changes — smooth settlement kernel, explicit `u/h/r/t` state separation, signed positions, and linear probability display — are still design proposals.

## Design Goals

The protocol must satisfy:

- continuous-outcome prediction
- cumulative consensus from all users
- native LP support
- user buy and sell actions
- smooth continuous settlement
- solvency by construction
- practical finite-dimensional implementation

## High-Level Design

`DekantPM v2` uses:

- a finite set of bins over a continuous range
- a smooth settlement kernel at resolution
- a pool-backed accounting identity
- an `L2`-style shape geometry for the aggregate non-pool claim vector

The key change from the current implementation is this:

- the protocol explicitly separates pool inventory from non-pool claims (the `trader_token_totals` fix achieves the economic effect; this spec proposes a cleaner structural separation via `u/h/r/t` vectors)
- LP shares represent claims on an LP bundle, not just on one derived reserve number
- the market settles smoothly rather than selecting a single winning bin

## Notation

Let:

- `N` = number of bins
- `a, b` = market range endpoints
- `c_i` = center of bin `i`
- `B` = total backing scalar
- `u in R^N` = total non-pool claim vector
- `h in R^N` = AMM pool inventory vector
- `r in R^N` = pooled LP reference-claim vector
- `t in R^N` = aggregate external-trader claim vector

with:

- `u = r + t`
- `h = B * 1 - u`

where `1` is the all-ones vector.

The protocol maintains:

- `0 <= u_i <= B` for all `i`
- `0 <= h_i <= B` for all `i`
- `||u||_2 = B`

The last condition preserves the `L2`-sphere geometry.

## Economic Interpretation

At every bin `i`:

- non-pool users collectively hold `u_i`
- the AMM pool holds `h_i = B - u_i`

So:

- total claim capacity at every bin is exactly `B`
- the protocol is solvent because every unit payout comes from the backing identity `h + u = B * 1`

The non-pool side is split into:

- `r`: pooled LP reference claims
- `t`: external trader claims

That split is the accounting fix missing in the current implementation.

## State Variables

Each market stores:

- `N`
- `a`
- `b`
- `centers[0..N-1]`
- `B`
- `u[0..N-1]`
- `h[0..N-1]`
- `r[0..N-1]`
- `total_lp_shares`
- `lp_fee_per_share`
- `trade_fee_bps`
- `lp_fee_share_bps`
- `redemption_fee_bps`
- `resolved_value`
- `resolved_kernel[0..N-1]`

Each external trader `m` stores:

- `trader_claims_m[0..N-1]`
- `wallet_balance`

Each LP `l` stores:

- `lp_shares_l`
- `lp_fee_debt_l`

The protocol does not need per-LP reference vectors. LPs own the pooled LP bundle pro rata through `lp_shares`.

## Initialization

For initial backing `B0` and `N` bins, initialize:

- `B = B0`
- `u_i = B / sqrt(N)` for all `i`
- `h_i = B - u_i`
- `r_i = u_i`
- `t_i = 0`
- `total_lp_shares = B0`
- creator receives `B0` LP shares

This means:

- the initial consensus is uniform in the `L2` geometry
- the LP bundle is `h + r = B * 1`
- if no external traders ever trade, LPs can still recover the full backing at resolution

That last point is the critical fix over the current implementation.

## Consensus Views Exposed To Users

The protocol should expose at least three user-facing views:

### 1. Consensus Shape

Define a normalized consensus display:

- `p_i = u_i / sum_j u_j`

This is the most intuitive "belief shape" display.

### 2. Marginal Point Quote

The infinitesimal buy price for bin `i` is:

- `m_i = u_i / B`

Reason:

- if only `u_i` changes by `dq`, then differentiating `||u||_2 = B` gives `dB = (u_i / B) dq`

This is the correct small-trade economic quote and should be shown to advanced users.

### 3. Smooth Interpolated Consensus Curve

Interpolate the discrete `u_i` values across bin centers to show a continuous curve in the UI.

This is only a display object, not a separate state variable.

## Trade Interface

The protocol supports two primitive trade types:

- `buy_shape(w, gross_collateral)`
- `sell_claims(q)`

where:

- `w` is a nonnegative target shape vector
- `q` is a nonnegative claim vector being returned

For practical `v2`, require:

- `w_i >= 0`
- `sum_i w_i = 1`
- `q_i >= 0`

The signed-exposure upgrade is specified later as an extension.

## Buy: General Shape Purchase

### Inputs

- trader `m`
- normalized shape vector `w`
- gross collateral `C`

### Fees

- `trade_fee = floor(C * trade_fee_bps / 10,000)`
- `lp_fee = floor(trade_fee * lp_fee_share_bps / 10,000)`
- `protocol_fee = trade_fee - lp_fee`
- `n = C - trade_fee`

### Mint Complete Sets

Increase backing first:

- `B_tmp = B + n`
- `h_tmp = h + n * 1`
- `u_tmp = u`

This is the exact analogue of minting complete sets before the trade.

### Solve For Bought Claims

Choose `q = (lambda / ||w||_2^2) * w` so that:

- `u_new = u + q`
- `||u_new||_2 = B_tmp`

Expanding the second condition:

- `||u + q||_2^2 = ||u||_2^2 + 2 * (lambda / ||w||_2^2) * (u . w) + (lambda^2 / ||w||_2^2) = B_tmp^2`
- `||u||_2^2 = B^2`

Multiplying through by `||w||_2^2` and solving the resulting quadratic in `lambda`:

- `lambda = - (u . w) + sqrt((u . w)^2 + ||w||_2^2 * (B_tmp^2 - B^2))`

and:

- `q_i = lambda * w_i / ||w||_2^2`

(For the special case `||w||_2^2 = 1`, e.g. a single-basis-vector buy, the divisor disappears and `q_i = lambda * w_i`. This matches the JS playground convention in `math_doc_script.js::distributionBuy`, where weights are normalised to sum to 1 but `||w||_2^2 != 1` in general, so the explicit divisor is required.)

Then update:

- `u' = u + q`
- `h' = B_tmp * 1 - u'`
- `t_m' = t_m + q`
- `B' = B_tmp`

Finally update the LP fee accumulator:

- `lp_fee_per_share' = lp_fee_per_share + lp_fee / total_lp_shares`

### Special Case: Single-Bin Buy

For `w = e_i`:

- `u_j' = u_j` for `j != i`
- `u_i' = sqrt(B'^2 - sum_{j != i} u_j^2)`
- `q_i = u_i' - u_i`

This is the exact single-bin formula.

## Sell: Return Claim Vector

### Inputs

- trader `m`
- claim vector `q`

subject to:

- `0 <= q_i <= trader_claims_m[i]`

### Update

Set:

- `u_new = u - q`

Require:

- `u_new_i >= 0` for all `i`

Then the new backing is:

- `B_new = ||u_new||_2`

Gross collateral out:

- `G = B - B_new`

Fees:

- `trade_fee = floor(G * trade_fee_bps / 10,000)`
- `lp_fee = floor(trade_fee * lp_fee_share_bps / 10,000)`
- `protocol_fee = trade_fee - lp_fee`
- `net_out = G - trade_fee`

Then update:

- `u' = u_new`
- `h' = B_new * 1 - u'`
- `t_m' = t_m - q`
- `B' = B_new`
- `lp_fee_per_share' = lp_fee_per_share + lp_fee / total_lp_shares`

### Distribution Sell Convenience API

For convenience, the UI may support:

- `sell_shape(w, Q)`

implemented as:

- `q_i = min(trader_claims_m[i], Q * w_i)`

then calling `sell_claims(q)`.

## LP Add Liquidity

### Inputs

- LP `l`
- collateral deposit `D`

### Define Scale

- `gamma = (B + D) / B`

### Update State

Scale the pool and pooled LP reference bundle:

- `B' = gamma * B`
- `h' = gamma * h`
- `r' = r + (gamma - 1) * u`

External trader claims do not change:

- `t' = t`

Therefore:

- `u' = r' + t' = gamma * u`
- `h' + u' = gamma * (h + u) = B' * 1`
- `||u'||_2 = gamma * ||u||_2 = gamma * B = B'`

So consensus shape is preserved exactly.

### Mint LP Shares

If `total_lp_shares = S`, mint:

- `shares_out = S * D / B`

Then:

- `lp_shares_l' = lp_shares_l + shares_out`
- `total_lp_shares' = S + shares_out`
- `lp_fee_debt_l' = lp_fee_debt_l + shares_out * lp_fee_per_share`

This is the exact dilution-preserving LP mint rule.

## LP Burn / Withdrawal

This is the most important accounting difference from the current implementation.

### Principle

Pre-resolution LP principal withdrawal is harder than LP deposit.

An exact core protocol should preserve all three of these simultaneously:

- componentwise backing identity
- external trader claims
- current consensus shape

In general, a direct pre-resolution collateral burn cannot satisfy all three while also giving the withdrawing LP an exact fair mark-to-market collateral payout. If external trader claims are outstanding, paying LPs out immediately in collateral either:

- changes consensus shape
- changes the economics of trader-held claims
- or transfers value unfairly between exiting and remaining LPs

Therefore the core `v2` protocol should take the conservative exact route:

- LP principal is not directly redeemable for protocol collateral before resolution
- LP shares are transferable
- LPs may withdraw accrued fees at any time
- LP principal is redeemed at resolution

### Core v2 LP Exit Rule

Before resolution:

- LPs may transfer or sell LP shares to another user
- LPs may claim pending fees
- LPs may not redeem principal directly from the protocol

At resolution:

- LP shares redeem pro rata against the pooled LP bundle plus accrued fees

This rule is exact, solvent, and consensus-preserving.

### Why The Core Rule Is Conservative

If trader claims are already outstanding, LP shares are claims on a risky pooled bundle, not on a fixed amount of free collateral. So the economically correct ways to exit before resolution are:

- secondary transfer of LP shares
- protocol buyback module with its own valuation rule
- waiting until resolution

The core protocol should not pretend this is simpler than it is.

### Optional Future Extension

A later version may add a protocol-mediated LP exit module, such as:

- an auction for LP shares
- a bounded buyback curve
- a state-dependent partial principal redemption rule

But that is a separate design problem and should not be bundled into the exact `v2` core.

### Fee Withdrawal

LP fees are tracked with a standard accumulator.

Pending fees for LP `l` are:

- `pending_fee_l = lp_shares_l * lp_fee_per_share - lp_fee_debt_l`

When fees are claimed:

- transfer `pending_fee_l`
- set `lp_fee_debt_l' = lp_shares_l * lp_fee_per_share`

This does not affect `B`, `u`, `h`, or `r`.

### LP Share Transfer

LP shares are transferable.

If LP `A` transfers `s` shares to LP `B`, market state does not change:

- `B' = B`
- `u' = u`
- `h' = h`
- `r' = r`

Only LP share and fee-debt records change:

- `lp_shares_A' = lp_shares_A - s`
- `lp_shares_B' = lp_shares_B + s`
- `lp_fee_debt_A' = lp_fee_debt_A - s * lp_fee_per_share`
- `lp_fee_debt_B' = lp_fee_debt_B + s * lp_fee_per_share`

This means:

- accrued fees stay with the sender
- future fees follow the transferred shares

## Resolution

The market resolves to a real value `v`.

The protocol does not choose one winning bin.

Instead it computes a settlement kernel `K(v)` with:

- `K_i(v) >= 0`
- `sum_i K_i(v) = 1`

## Default Settlement Kernel: Linear Interpolation

Let bin centers be:

- `c_0 < c_1 < ... < c_{N-1}`

Then:

- if `v <= c_0`, set `K_0(v) = 1`
- if `v >= c_{N-1}`, set `K_{N-1}(v) = 1`
- if `c_i <= v <= c_{i+1}`, set:
  - `K_i(v) = (c_{i+1} - v) / (c_{i+1} - c_i)`
  - `K_{i+1}(v) = (v - c_i) / (c_{i+1} - c_i)`
  - all others `0`

This gives:

- local support
- continuity in `v`
- exact partition of unity

## Payout Formulas

For any claim vector `q`, payout is:

- `payout(q, v) = q . K(v)`

### Trader Payout

For trader `m`:

- `gross_payout_m = trader_claims_m . K(v)`
- `redemption_fee_m = gross_payout_m * redemption_fee_bps / 10,000`
- `net_payout_m = gross_payout_m - redemption_fee_m`

### LP Payout

LP shares own the pooled LP bundle `h + r`.

If LP `l` owns share fraction:

- `omega_l = lp_shares_l / total_lp_shares`

then:

- `gross_lp_payout_l = omega_l * ((h + r) . K(v))`
- `fee_share_l = lp_shares_l * lp_fee_per_share - lp_fee_debt_l`
- `net_lp_payout_l = gross_lp_payout_l + fee_share_l`

Since:

- `(h + r) . K(v) + t . K(v) = B`

the market remains solvent.

## Why The No-Trader LP Loss Is Fixed

If there are no external traders:

- `t = 0`
- `u = r`

Then LPs own:

- pooled bundle `h + r = B * 1`

At resolution:

- `(h + r) . K(v) = B * sum_i K_i(v) = B`

So with no traders and no fees:

- LPs recover the full backing

**Implementation note (2026-04-11):** This property is now achieved in the current codebase via the `trader_token_totals` fix. With zero traders, `trader_token_totals[win] = 0`, so `reserves[win] = total_minted`, and the LP receives full backing. The v2 `u/h/r/t` formulation achieves the same result more explicitly.

## Fees

Recommended defaults:

- `trade_fee_bps = 30`
- `lp_fee_share_bps = 5000`
- `redemption_fee_bps = 0` or at most `10`

Reason:

- LPs need real fee flow
- a large redemption fee distorts the clean economics of continuous settlement

## User-Facing Trade Quotes

The protocol should expose:

### 1. Consensus Shape

- `p_i = u_i / sum_j u_j`

### 2. Marginal Buy Quote

- `m_i = u_i / B`

### 3. Marginal Sell Quote

For small sales in bin `i`, the gross collateral recovered per unit is approximately:

- `m_i = u_i / B`

minus fees.

### 4. Shape Trade Quote

For normalized shape `w`, the infinitesimal cost per unit scale is:

- `m(w) = (u . w) / B`

This is the quantity the UI should use for "expected cost of shifting the distribution this way."

## Invariants To Enforce Onchain

The protocol should verify after each state transition:

- `u = r + t_agg`
- `h = B * 1 - u`
- `0 <= u_i <= B`
- `0 <= h_i <= B`
- `abs(||u||_2 - B) <= epsilon`
- `sum_lp_shares = total_lp_shares`
- `lp_fee_per_share >= 0`

where `t_agg` is the sum of all external trader claim vectors.

## Suggested Numerical Representation

For onchain implementation:

- use fixed-point arithmetic
- normalize weights and kernel values to a large scale such as `1e9`
- keep `N` bounded
- use checked arithmetic on every state transition

Recommended limits:

- `N <= 128` in the first production version
- upgrade to adaptive bins or basis functions later if compute budget allows

## Optional v2.5 Extension: Signed Shape Trades

The above `v2` spec is long-only on trader claims.

To move toward a more Paradigm-like market, add a signed mode:

- trader chooses target aggregate non-pool claim vector `g`
- current vector is `u`
- trader receives signed position `Delta = g - u`

Collateral requirement:

- `C_signed = max_i (-Delta_i)`

or, with smooth interpolated claims:

- `C_signed = sup_x (-Delta(x))`

Then:

- trader deposits `C_signed` plus trade fee
- market state updates from `u` to `g`
- payout at resolution is `Delta . K(v)` plus returned unused collateral where appropriate

This signed extension gives:

- real buy/sell of shapes
- relative-position trading
- closer alignment with Paradigm

But it should come after the `v2` accounting fixes.

## Migration Path From Current DekantPM

### Step 1 — Partially Done (2026-04-11)

Replace current:

- `positions`
- `reserves`

with:

- `u`
- `h`
- `r`
- external trader claim ledgers

**Current status:** The `trader_token_totals` field achieves the economic effect of tracking `t` (aggregate external trader claims) per outcome. The full structural replacement of `positions`/`reserves` with `u/h/r/t` vectors is a further refinement that would make the state cleaner but is not required for correct LP payouts.

### Step 2

Keep current single-bin and distribution-buy math, but apply it to total non-pool claims `u`, not to an ambiguous `positions` object.

**Current status:** Trading math still operates on `positions`/`reserves`. This works correctly for trade execution — the ambiguity only matters at resolution, which is now handled by `trader_token_totals`.

### Step 3 — Highest Priority Remaining Change

Replace winner-take-all resolution with `K(v)`.

**Current status:** Not implemented. This is the single highest-impact remaining change — it transforms broad distribution trades from structurally unprofitable to viable. See [`COMPARE.md`](COMPARE.md) Model 2 analysis.

### Step 4

Replace LP withdrawal with:

- transferable LP shares
- fee-only withdrawal before resolution
- LP principal redemption at resolution

### Step 5

Expose `p_i`, `m_i`, and `m(w)` in the UI instead of only quadratic `p_hat`.

## Why This Spec Meets Your Requirements

### Continuous Market

Yes:

- the question is continuous
- the settlement rule is continuous in the realized value

### Aggregate Consensus

Yes:

- `u` is cumulative across all trades
- it is not the last trader's view

### Buy And Sell

Yes:

- traders buy claim bundles
- traders sell claim bundles
- LPs mint, transfer, and later redeem shares

### Native LPs

Yes:

- LPs have a first-class pooled bundle and fee claim

### Profitability

Yes, structurally:

- informed concentrated traders can profit
- broad-view traders are no longer punished as harshly as in winner-take-all settlement
- LPs are not mechanically losing in the no-trader case

This does not guarantee profits, but it removes accounting-driven fake losses.

## Final Recommendation

**Updated 2026-04-11:** Step 1 (fix accounting) is done. The current priority is steps 2–3.

Do not jump straight to:

- pure cost-function parametric markets
- or full Paradigm-style signed function-space markets

The correct order is:

1. ~~fix accounting~~ **Done** (`trader_token_totals` fix)
2. **fix settlement** ← current priority (smooth kernel)
3. fix user-facing quotes (linear probability display)
4. then upgrade representation and signed trading

That gives you:

- ~~a credible LP market~~ **Already achieved** post-fix
- a usable trader market (needs smooth settlement for broad trades)
- cumulative consensus
- smooth continuous resolution
- and a clean path toward a stronger long-run continuous architecture
