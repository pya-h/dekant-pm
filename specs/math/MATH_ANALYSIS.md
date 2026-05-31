# DekantPM — Mathematical Analysis

> **Status:** Canonical math reference for the L₂-norm AMM with linear probability display and opt-in smooth-kernel settlement (kernel_width > 0). Last updated 2026-05-31. For the interactive notebook see [`MATH_ANALYSIS_INTERACTIVE.html`](./MATH_ANALYSIS_INTERACTIVE.html) (or the offline bundle in [`math_offline/`](./math_offline/)).

## 1. Introduction: Continuous Prediction Markets

### 1.1 What Are Prediction Markets?

A prediction market is a speculative market where participants trade contracts whose payoffs depend on the outcome of future events. In a **binary** prediction market, a contract pays $1 if event *E* occurs and $0 otherwise. The market price of such a contract reflects the crowd's aggregate belief about the probability of *E*.

### 1.2 From Discrete to Continuous

Traditional prediction markets handle **discrete** outcomes: "Will candidate A win?" (Yes/No) or "Which team wins the championship?" (Team 1 / Team 2 / ... / Team N). But many real-world quantities are **continuous**: "What will the temperature be on July 1st?" "When will GPT-5 be released?" "What will the price of ETH be on December 31st?"

A **continuous prediction market** elicits a full probability distribution over a continuous outcome space. Rather than asking "Is the answer X?" it asks "What does the crowd believe the probability density function over all possible answers looks like?"

### 1.3 The Goal

The goal of a continuous prediction market is to:

1. **Aggregate beliefs** — Allow many participants to express nuanced probabilistic views about a continuous variable.
2. **Maintain a consensus distribution** — The market's state at any time encodes the crowd's aggregate probability distribution.
3. **Incentivize accuracy** — Traders who move the distribution toward the truth profit; those who move it away lose.
4. **Provide liquidity** — An automated market maker (AMM) ensures that trades can always be executed without requiring a counterparty.

---

## 2. Mathematical Framework: The L₂-Norm AMM

### 2.1 Core Setup

Consider a market with **N** outcomes (or bins, in the continuous case). We define:

- **k** (= `total_minted`): Total collateral deposited into the AMM as complete sets.
- **h = (h₁, h₂, ..., hₙ)** (= `reserves`): The AMM's reserve of outcome tokens for each outcome.
- **x = (x₁, x₂, ..., xₙ)**: Positions held collectively by all traders, where:

```
xᵢ = k − hᵢ
```

The vector **x** represents how many tokens of each outcome have been sold by the AMM to traders.

### 2.2 The Invariant

The AMM enforces a **constant L₂-norm** on the position vector:

```
‖x‖₂ = √(∑ᵢ xᵢ²) = k
```

Equivalently, squaring both sides:

```
∑ᵢ₌₁ᴺ xᵢ² = k²
```

Or in terms of reserves:

```
∑ᵢ₌₁ᴺ (k − hᵢ)² = k²
```

This defines a **hypersphere** of radius k centered at the origin in position space. All valid AMM states lie on this hypersphere.

### 2.3 Why L₂-Norm? — The Market Scoring Rule Property

Suppose the true probability distribution over outcomes is **p** = (p₁, ..., pₙ) with ∑pᵢ = 1. A rational trader maximizes the expected value of their holdings on the invariant surface:

```
max_x  p · x    subject to  ‖x‖₂ = k
```

By the **Cauchy-Schwarz inequality**, the dot product p·x is maximized when x is proportional to p:

```
x* = k · p / ‖p‖₂
```

where ‖p‖₂ = √(∑pᵢ²). This means **the optimal position vector is directly proportional to the true probability distribution**. A market populated by rational traders will converge to a state where:

```
xᵢ ∝ pᵢ
```

This makes the L₂-norm AMM a **market scoring rule** — the relative sizes of positions encode the market's aggregate belief about outcome probabilities.

### 2.4 Probability Extraction

Given that x ∝ p at equilibrium, the displayed probability is the **linear** normalization:

```
p̂ᵢ = xᵢ / ∑ⱼ xⱼ = (k − hᵢ) / ∑ⱼ (k − hⱼ)
```

This recovers the true probabilities at the Cauchy-Schwarz optimum: if x* = k·p/‖p‖₂, then x*ᵢ/∑x*ⱼ = pᵢ/∑pⱼ = pᵢ. The implementation scales probabilities by S = 10⁹:

```
p̂ᵢ_scaled = xᵢ · S / ∑ⱼ xⱼ
```

The sum normalization ∑p̂ᵢ = 1 is enforced explicitly rather than falling out of the invariant.

### 2.5 Linear Display: Why Not the Quadratic Form

An alternative "quadratic" extraction p̂ᵢ = xᵢ²/k² is invariant-derived (∑p̂ᵢ = 1 follows from ∑xᵢ² = k² without renormalization) and was the original DekantPM display. It was retired because the squaring step introduces a systematic non-linear distortion: traders saw probabilities compressed toward the extremes and could not read the market state at face value.

**Example (binary market, true probability p₁ = 0.7, p₂ = 0.3):**

```
‖p‖₂ = √(0.49 + 0.09) = √0.58 ≈ 0.7616

Quadratic:  p̂₁ = 0.49/0.58 ≈ 0.845    p̂₂ = 0.09/0.58 ≈ 0.155
Linear:     p̂₁ = 0.7                   p̂₂ = 0.3
```

A "70% true" outcome rendered as "84.5%" with the quadratic display.

**Distortion table the legacy quadratic display would have produced:**

| True probability | Quadratic p̂ (legacy) | Linear p̂ (current) |
|-----------------|----------------------|--------------------|
| 50%             | 50.0%                | 50.0%              |
| 60%             | 69.2%                | 60.0%              |
| 70%             | 84.5%                | 70.0%              |
| 80%             | 94.1%                | 80.0%              |
| 90%             | 98.8%                | 90.0%              |

The linear display is exact at equilibrium: a "70% displayed" outcome corresponds to a 70% true equilibrium probability. The trade-off is that the renormalization ∑xⱼ must be computed and tracked, rather than being implied by the invariant. The buy-to-price function, fee calculations, and AMM core all target the **linear** probability — a trader who targets "70%" reaches a state where xᵢ/∑xⱼ = 0.70.

**Important:** Throughout this document, "probability" and p̂ᵢ refer to the **linear** extraction xᵢ/∑xⱼ. The quadratic form is mentioned only when contrasting with the prior version.

---

## 3. Market Initialization

When a market is created with initial liquidity **L** and **N** outcomes:

1. Set k = L (total_minted = initial liquidity).
2. Compute uniform positions: xᵢ = ⌊√(L²/N)⌋ for all i (integer square root).
3. Compute reserves: hᵢ = L − xᵢ for all i.
4. Set k² = L².
5. Initial LP receives L shares.

The initial linear probability for each outcome is:

```
p̂ᵢ = xᵢ / ∑ⱼ xⱼ = (L/√N) / (N · L/√N) = 1/N
```

This gives a uniform prior — every outcome starts equally likely.

**Example:** Binary market (N = 2) with L = 1,000,000 (1 USDC):
- x₁ = x₂ = ⌊√(10¹²/2)⌋ = 707,106
- h₁ = h₂ = 1,000,000 − 707,106 = 292,894
- p̂₁ = p̂₂ = 707,106 / (2 · 707,106) = 0.5 ✓

---

## 4. Discrete Trading

### 4.1 Buy (Single Outcome)

A trader spends **c** collateral (after fees) to buy tokens of outcome **i**.

**Algorithm:**

1. Record current positions: xⱼ = k − hⱼ for all j.
2. Mint complete sets: hⱼ ← hⱼ + c for all j. New total: k' = k + c.
3. After minting, positions are unchanged: x'ⱼ = k' − h'ⱼ = (k+c) − (hⱼ+c) = k − hⱼ = xⱼ.
4. The invariant now requires ∑x'ⱼ² = k'² but we have ∑xⱼ² = k² < k'².
5. The "gap" k'² − k² is filled by increasing x'ᵢ (reducing hᵢ) for the target outcome:

```
x'ᵢ = √(k'² − ∑ⱼ≠ᵢ xⱼ²)
```

6. Tokens received by trader: Δx = x'ᵢ − xᵢ.
7. Update reserve: hᵢ = k' − x'ᵢ.

**Price impact:** A larger purchase c increases xᵢ relative to other positions, raising p̂ᵢ = xᵢ/∑xⱼ. The square root in step 5 creates a **concave** relationship between position size and collateral — each additional unit costs more, providing natural slippage protection.

### 4.2 Sell (Single Outcome)

A trader returns **t** tokens of outcome **i** to the AMM and receives collateral.

**Algorithm:**

1. Current position: xᵢ = k − hᵢ. Require xᵢ ≥ t.
2. Return tokens: hᵢ ← hᵢ + t (position decreases: x'ᵢ = xᵢ − t).
3. Compute new k from the invariant:

```
k' = √(∑ⱼ x'ⱼ²)    where x'ⱼ = xⱼ for j ≠ i,  x'ᵢ = xᵢ − t
```

4. Collateral out: Δc = k − k'.
5. Burn complete sets: hⱼ ← hⱼ − Δc for all j.

**Key difference from buy:** The sell operation decreases k (total_minted goes down), while buy increases it. No quadratic solving is needed — k' is computed directly via square root.

### 4.3 Price Impact Analysis

For a buy of amount c on outcome i in a binary market (N = 2) with current state (x₁, x₂, k):

Before trade:
```
p̂₁ = x₁ / (x₁ + x₂)
```

After trade (buying outcome 1):
```
k' = k + c
x'₁ = √(k'² − x₂²)
p̂'₁ = x'₁ / (x'₁ + x₂)
```

The price impact increases with c/k (trade size relative to liquidity). For small trades (c ≪ k), the price impact is approximately linear; for large trades, the square root in x'₁ creates diminishing returns — each additional unit of collateral buys fewer tokens.

---

## 5. Distribution Trading (Continuous Markets)

### 5.1 Bin Discretization

DekantPM implements continuous markets by **discretizing** the outcome range [a, b] into N equally-spaced bins. Each bin j covers the interval:

```
[a + j·(b−a)/N,  a + (j+1)·(b−a)/N)
```

with center:

```
centerⱼ = a + (2j + 1)(b − a) / (2N),    j = 0, 1, ..., N−1
```

Traders express beliefs as Normal distributions N(μ, σ²) over this range. The program computes weights for each bin proportional to the Normal PDF evaluated at the bin center.

### 5.2 Normal PDF Bin Weights

Given parameters μ (mean) and σ (standard deviation):

**Step 1 — Compute raw weights.** For each bin j, compute the standardized distance:

```
zⱼ = (centerⱼ − μ) / σ
```

If |zⱼ| > Z_CUTOFF (= 5), set wⱼ = 0 (tail cutoff). Otherwise:

```
wⱼ = exp(−zⱼ²/2)
```

Note: this is the Normal PDF kernel (without the 1/√(2π) normalizing constant, which cancels during normalization anyway).

**Step 2 — On-chain approximation.** The exponential is read from a precomputed lookup table covering |z| ∈ [0, 5] in steps of 0.1, giving 51 entries of exp(−z²/2) at SCALE = 10⁹ precision. For an arbitrary |z|, the on-chain function:

1. Locates the bracketing table indices ⌊10·|z|⌋ and ⌊10·|z|⌋ + 1.
2. Linearly interpolates between the two table values using the fractional part.

This replaces the earlier degree-4 Taylor polynomial, whose error grew to 10–50% in the tails (|z| ∈ [2.5, 5]) and corrupted the kernel weight vector for broad distributions. The table + linear interpolation keeps the relative error below ~0.5% across the entire |z| ∈ [0, 5] range while costing only one table lookup, one subtraction, one multiplication, and one division per bin.

All arithmetic uses fixed-point with denominator S = 10⁹. Z_CUTOFF = 5 ensures that bins beyond 5σ from the mean receive zero weight (excluding less than 6 × 10⁻⁷ of the probability mass).

**Step 3 — Normalize.** Weights are scaled so ∑wⱼ = S (= 10⁹):

```
Wⱼ = wⱼ · S / ∑ₘ wₘ
```

A final correction step adjusts the largest weight to ensure the sum is exactly S, absorbing any rounding remainder.

### 5.3 Distribution Buy

A trader spends c collateral (after fees) to buy a weighted bundle across all bins.

**Algorithm:**

1. Compute dot products before minting:
   - XW = ∑ⱼ xⱼ · Wⱼ  (position-weight correlation)
   - W² = ∑ⱼ Wⱼ²  (sum of squared weights)

2. Mint complete sets: hⱼ ← hⱼ + c for all j, k' = k + c.

3. Solve for λ. We want positions:
```
x'ⱼ = xⱼ + λ · Wⱼ / W²
```
where λ is a scalar controlling the trade size. The invariant requires ∑(x'ⱼ)² = k'². Expanding:

```
∑(xⱼ + λWⱼ/W²)² = k'²
∑xⱼ² + 2(λ/W²)∑xⱼWⱼ + (λ²/W⁴)∑Wⱼ² = k'²
k² + 2λ·XW/W² + λ²/W² = k'²
```

Multiplying by W²:

```
λ² + 2·XW·λ − W²·(k'² − k²) = 0
```

Taking the positive root (see Appendix A for full derivation):

```
λ = √(XW² + W²·excess) − XW     where excess = k'² − k²
```

4. Tokens out per bin:

```
tokens_outⱼ = λ · Wⱼ / W²
```

5. Update reserves: hⱼ ← hⱼ − tokens_outⱼ.

**Interpretation:** The parameter λ controls the magnitude of the position shift. The direction W/W² is the normalized weight vector. The trade moves the market's distribution toward the trader's expressed Normal distribution, with the shift size determined by how much collateral is spent.

### 5.4 Distribution Sell

A trader returns **T** total tokens, distributed across bins proportional to weights W.

**Algorithm:**

1. Distribute tokens: tokens_for_binⱼ = T · Wⱼ / S (since ∑Wⱼ = S, this is proportional).
2. Return to reserves: hⱼ ← hⱼ + tokens_for_binⱼ.
3. Compute new total from the invariant:

```
k' = √(∑ⱼ (k − h'ⱼ)²)
```

4. Collateral out: Δc = k − k'.
5. Burn complete sets: hⱼ ← hⱼ − Δc for all j.

No quadratic is needed because the tokens being returned are known, and k' is computed directly via square root.

### 5.5 Buy-to-Price (Price-Targeted Trading)

A trader can specify a **target probability** p* for outcome i (in the linear sense: xᵢ/∑xⱼ = p*/S), and the AMM computes how much collateral is needed.

**Derivation:**

We want p̂'ᵢ = p*/S after the trade, meaning x'ᵢ = (p*/S) · ∑ⱼ x'ⱼ. Let q = p*/S and Σ₋ᵢ = ∑ⱼ≠ᵢ xⱼ (note: the linear formula uses Σ of positions, not Σ of squares).

Since non-target positions don't change during a buy (the complete-set minting preserves them), x'ⱼ = xⱼ for j ≠ i. The target relation becomes:

```
x'ᵢ = q · (x'ᵢ + Σ₋ᵢ)
x'ᵢ (1 − q) = q · Σ₋ᵢ
x'ᵢ = q · Σ₋ᵢ / (1 − q)
```

The buy mechanics in §4.1 still apply — given the target x'ᵢ we recover k' from the invariant:

```
k'² = x'ᵢ² + ∑ⱼ≠ᵢ xⱼ²    (squared sum of non-target positions, denote Σ²₋ᵢ)
k' = √(x'ᵢ² + Σ²₋ᵢ)
c = k' − k
```

So the algorithm is: (a) compute target x'ᵢ from the linear relation, (b) compute k' from the L₂ invariant, (c) return c = k' − k.

**Sell-to-price** works analogously — compute the target position x_target from the same linear relation, then derive k' = √(x_target² + Σ²₋ᵢ) and return tokens_in = xᵢ − x_target.

---

## 6. Liquidity Provision

### 6.1 Adding Liquidity

An LP deposits **d** collateral. The AMM scales all reserves proportionally:

```
h'ⱼ = hⱼ · (k + d) / k    for all j
```

This preserves the probability distribution. To see why: positions scale as x'ⱼ = k' − h'ⱼ = (k+d) − hⱼ(k+d)/k = (k+d)(1 − hⱼ/k) = (k+d)·xⱼ/k. Since all positions scale by the same factor (k+d)/k, the linear ratio xᵢ/∑xⱼ is invariant. Liquidity increases without shifting the market's view.

**LP shares:**
- First LP (market creator at initialization): shares = L (initial liquidity).
- Subsequent LPs: shares_new = L_total · d / k, where L_total is current total LP shares and k = total_minted.

After scaling: k' = k + d, k'² = (k + d)².

### 6.2 Removing Liquidity

An LP burns **s** shares out of L_total total shares.

**If market is Active or PendingResolution:**

```
collateral_out = k · s / L_total
```

Then scale reserves down proportionally:

```
h'ⱼ = hⱼ · (k − collateral_out) / k    for all j
```

This shrinks the market uniformly, preserving the probability distribution but reducing depth.

**If market is Resolved:**

```
collateral_out = h_winning · s / L_total
```

where h_winning = reserves[resolved_outcome]. After resolution, traders have claimed their winning tokens at 1:1. The remaining reserves of the winning outcome belong to LPs. Each LP gets their proportional share of this residual.

**Fee share** (in both cases):

```
fee_share = lp_fee_accumulated · s / L_total
total_payout = collateral_out + fee_share
```

### 6.3 LP Economics

LPs effectively take the other side of every trade. They profit from:
1. **Fees** — A share of every trade fee (default: 50% of the 0.3% trade fee = 0.15% per trade).
2. **Mean reversion** — If prices move but revert, LPs capture the round-trip spread.

LPs face risk from:
1. **Divergence loss** — If the market moves permanently to a concentrated distribution, the LP's share of the losing outcomes becomes worthless. In a binary market, if p̂₁ goes from 50% to 90%, the LP portfolio is heavily weighted toward the losing outcome. This is analogous to impermanent loss in DEX AMMs.
2. **Informed traders** — Traders with superior information extract value from LPs by buying underpriced outcomes before the market corrects.

**Divergence loss formula (binary market):** If the market moves from uniform (p̂ = 0.5) to a final state p̂₁ = q, the LP's position value relative to the initial deposit is:

```
value_ratio = (1 + √(1−q)/√q) / 2    (for the case where outcome 1 wins)
```

At q = 0.5: ratio = 1 (no loss). At q = 0.9: ratio ≈ 0.67 (33% loss if outcome 1 wins).

---

## 7. Resolution and Payout

### 7.1 Discrete Markets

An oracle provides the winning outcome index. All holders of winning outcome tokens redeem them 1:1 for collateral (minus redemption fee):

```
net_payout = winning_tokens − ⌊winning_tokens · redemption_fee_bps / 10000⌋
```

Losing outcome tokens are worth zero.

### 7.2 Continuous Markets

The oracle provides a realized value **v** ∈ [a, b]. The winning bin is determined by:

```
bin_win = ⌊(v − a) · N / (b − a)⌋,   clamped to [0, N−1]
```

Continuous markets settle in one of two modes, chosen at market creation via the **`kernel_width`** parameter W:

- **Winner-take-all (W = 0):** Same as discrete markets — only bin_win's holders redeem 1:1 (minus fee). All other bins pay zero. Identical to §7.1.
- **Smooth-kernel settlement (W ≥ 1):** Adjacent bins also receive partial payouts, smoothing the discontinuity at bin boundaries.

#### 7.2.1 Smooth-Kernel Payout

For a market with kernel width W > 0 and resolved bin bin_win, each bin i pays a fraction of face value to its holders, weighted by a **triangular kernel** centered at bin_win:

```
K(i, bin_win, W) = max(0, (W + 1 − |i − bin_win|) / (W + 1))
```

- K(bin_win) = 1 (full face value).
- K(bin_win ± 1) = W/(W+1), K(bin_win ± 2) = (W−1)/(W+1), …
- K(bin_win ± d) = 0 for d > W (outside the kernel's support).

A trader holding hᵢ tokens of bin i receives gross payout:

```
gross_payout = ⌊ ∑ᵢ hᵢ · K(i, bin_win, W) · s / S ⌋
```

where **s** is a per-market `scaling_factor` (∈ [0, S]) set at resolution. The scaling factor enforces vault solvency:

```
s = min( S,  k · S / ∑ⱼ Kⱼ · trader_totalsⱼ )
```

where `trader_totals[j]` is the total tokens of bin j held by all traders (LP-excluded), and Kⱼ = K(j, bin_win, W). The scaling factor is computed once at resolution and stored on the Market account, so every claimant applies the same divisor.

**Why scale?** Without it, the sum of kernel-weighted claims can exceed the vault. The scaling factor caps the maximum total payout at exactly k — see the solvency proof in §7.3. When the unscaled claims would already fit (∑Kⱼ · trader_totalsⱼ ≤ k), s = S and the payout is the unscaled kernel sum.

#### 7.2.2 Worked Example (Smooth Kernel)

Market with N = 5 bins, k = 1,000,000, W = 1. Resolved bin = 2.
- K = [0, 0.5, 1.0, 0.5, 0] (only bins 1, 2, 3 inside the kernel's support).
- Suppose trader holdings: h = [0, 200, 1000, 200, 0].
- ∑Kⱼ · hⱼ = 0.5·200 + 1.0·1000 + 0.5·200 = 100 + 1000 + 100 = 1200.
- If trader_totals match h (single trader, no LP residual), s = min(S, k·S/1200) = S (1200 ≤ 10⁶).
- Gross payout = ⌊1200 · S / S⌋ = 1200.

The trader collects 1200 vs. the 1000 they would have received under WTA, because adjacent bins contributed partial credit. Now consider the kernel's support being saturated by aggregate holdings (∑Kⱼ · trader_totalsⱼ = 5,000,000 with k = 1,000,000): s = S/5 = 0.2·S, so every claim is scaled by 0.2 and total payouts equal exactly k.

### 7.3 Solvency Guarantee

The system is always solvent. The proof is by cases on the settlement mode.

**Claim:** The vault holds at least k collateral at all times, and the maximum possible redemption at resolution is at most k.

**Shared setup (both modes):**

1. **Complete-set minting:** Every token in circulation was created as part of a complete set. For every unit of outcome token i held by traders (xᵢ), there are hᵢ = k − xᵢ units in the AMM reserves. Total tokens per outcome: xᵢ + hᵢ = k.

2. **Vault balance:** Every complete-set mint deposits exactly 1 unit of collateral per token set. After minting k total sets: vault ≥ k (plus accumulated fees, minus LP withdrawals — but LP withdrawals are bounded by their proportional share of k).

**Case 1 — WTA (binary, multi-outcome, continuous with W = 0):**

Only the winning outcome redeems. The maximum number of winning tokens held by all traders is x_winning ≤ k (since x_winning² ≤ ∑xⱼ² = k²). Therefore total redemption ≤ k ≤ vault balance. ∎

**Case 2 — Smooth-kernel continuous (W ≥ 1):**

The aggregate claim across all traders is:
```
total_claim = ∑ᵢ trader_totalsᵢ · K(i, bin_win, W) · s / S
            = (s / S) · ∑ᵢ Kᵢ · trader_totalsᵢ
```

By construction s = min(S, k · S / ∑Kⱼ · trader_totalsⱼ). Substituting:
```
total_claim ≤ (S / S) · k = k   when the constraint is active (∑Kⱼ·tᵢ > k)
total_claim = ∑Kᵢ · trader_totalsᵢ ≤ k   when s = S (constraint inactive)
```

Either way, total_claim ≤ k ≤ vault balance. ∎

**LP residual:** After all traders claim:

- WTA: LPs receive h_winning = k − x_winning (the AMM's unclaimed share of the winning outcome).
- Kernel: LPs receive the remaining vault balance, k − total_claim, distributed proportionally to LP shares.

---

## 8. Worked Example: Continuous Market Lifecycle

This section walks through a complete continuous market from creation to resolution with concrete numbers. We use a simplified 5-bin market for clarity.

### 8.1 Market Creation

**Market:** "ETH price on March 31, 2026"
- Range: [2000, 4000] (USDC, scaled by 10⁹ on-chain)
- Bins: N = 5 (bin width = 400 USDC)
- Initial liquidity: L = 1,000,000 (1 USDC in micro-units)

**Bin structure:**

| Bin | Range         | Center |
|-----|--------------|--------|
| 0   | [2000, 2400) | 2200   |
| 1   | [2400, 2800) | 2600   |
| 2   | [2800, 3200) | 3000   |
| 3   | [3200, 3600) | 3400   |
| 4   | [3600, 4000] | 3800   |

**Initialization:**

```
k = 1,000,000
xᵢ = ⌊√(10¹²/5)⌋ = ⌊√(200,000,000,000)⌋ = 447,213   for all i
hᵢ = 1,000,000 − 447,213 = 552,787                      for all i
k² = 10¹²
```

**Initial probabilities:** p̂ᵢ = 447,213 / (5 × 447,213) = 0.200 for all i (uniform 20% each). ✓

### 8.2 Trade 1 — Discrete Buy on Bin 2

Trader Alice believes ETH will be in [2800, 3200). She buys bin 2 with 100,000 collateral (0.1 USDC).

**Fee calculation** (trade_fee = 30 bps, lp_share = 50%):
```
total_fee = ⌊100,000 × 30 / 10,000⌋ = 300
lp_fee = ⌊300 × 5000 / 10,000⌋ = 150
protocol_fee = 300 − 150 = 150
net_collateral = 100,000 − 300 = 99,700
```

**Buy computation:**

```
k' = 1,000,000 + 99,700 = 1,099,700
k'² = 1,209,340,090,000

Σ₋₂ = 4 × 447,213² = 4 × 199,999,387,369 = 799,997,549,476

x'₂ = ⌊√(1,209,340,090,000 − 799,997,549,476)⌋ = ⌊√(409,342,540,524)⌋ = 639,798

tokens_out = 639,798 − 447,213 = 192,585
h₂ = 1,099,700 − 639,798 = 459,902
```

Other reserves (after complete-set mint): hⱼ = 552,787 + 99,700 = 652,487 for j ≠ 2.

**New probabilities** (linear: p̂ᵢ = xᵢ / ∑xⱼ where ∑xⱼ = 639,798 + 4·447,213 = 2,428,650):

```
p̂₂ = 639,798 / 2,428,650 ≈ 0.263   (was 0.200, rose to ~26%)
p̂ⱼ = 447,213 / 2,428,650 ≈ 0.184   for j ≠ 2 (was 0.200, fell to ~18.4%)

Check: 0.263 + 4 × 0.184 = 0.263 + 0.736 = 0.999 ≈ 1 ✓
```

Note: the linear display rises more gently than the legacy quadratic would have. Under the quadratic formula the same trade would have shown p̂₂ ≈ 0.339 — visually exciting but a distortion. Linear is the actual marginal price.

**Alice's portfolio:** 192,585 tokens of bin 2. Cost: 100,000 collateral (including fees).

### 8.3 Trade 2 — Distribution Buy

Trader Bob believes ETH will be around $3,000 with moderate uncertainty. He expresses this as N(μ = 3000, σ = 400) and spends 200,000 collateral (0.2 USDC).

**Step 1: Compute bin weights.**

| Bin j | Center | zⱼ = (center − 3000)/400 | exp(−zⱼ²/2) | Normalized Wⱼ (×10⁹) |
|-------|--------|--------------------------|-------------|----------------------|
| 0     | 2200   | −2.0                     | 0.1353      | 54,511,000           |
| 1     | 2600   | −1.0                     | 0.6065      | 244,262,000          |
| 2     | 3000   |  0.0                     | 1.0000      | 402,619,000          |
| 3     | 3400   | +1.0                     | 0.6065      | 244,262,000          |
| 4     | 3800   | +2.0                     | 0.1353      | 54,346,000           |

(Weights adjusted so ∑Wⱼ = 10⁹ exactly.)

**Step 2: Fee calculation.**
```
total_fee = ⌊200,000 × 30 / 10,000⌋ = 600
net_collateral = 200,000 − 600 = 199,400
```

**Step 3: Pre-mint dot products** (using state after Trade 1).

Current positions: x₀ = x₁ = x₃ = x₄ = 447,213 and x₂ = 639,798.

```
XW = x₀W₀ + x₁W₁ + x₂W₂ + x₃W₃ + x₄W₄
   ≈ 447,213 × 54.5M + 447,213 × 244.3M + 639,798 × 402.6M
     + 447,213 × 244.3M + 447,213 × 54.3M
   ≈ 524,080 × 10⁹  (approximate)

W² = W₀² + W₁² + W₂² + W₃² + W₄²
   ≈ (54.5M)² + (244.3M)² + (402.6M)² + (244.3M)² + (54.3M)²
   ≈ 2.84 × 10¹⁷  (approximate)
```

**Step 4: Mint + solve quadratic.**

```
k' = 1,099,700 + 199,400 = 1,299,100
excess = k'² − k² = 1,299,100² − 1,099,700² ≈ 478,000 × 10⁶

λ = √(XW² + W²·excess) − XW
```

**Step 5: Tokens out per bin** — tokens_outⱼ = λ · Wⱼ / W².

The distribution buy gives more tokens for the central bins (especially bin 2) and fewer for the tails. After the trade, the probability distribution is more concentrated around $3,000.

**Post-trade probability distribution (approximate, linear):**

| Bin | Before Trade 2 | After Trade 2 |
|-----|---------------|---------------|
| 0   | 18.4%         | ~13%          |
| 1   | 18.4%         | ~20%          |
| 2   | 26.3%         | ~34%          |
| 3   | 18.4%         | ~20%          |
| 4   | 18.4%         | ~13%          |

The market now reflects a bell-shaped consensus centered on bin 2 ($2800–$3200).

### 8.4 Adding Liquidity

LP Carol adds 500,000 collateral (0.5 USDC) to deepen the market.

```
k_before = 1,299,100
k_after = 1,299,100 + 500,000 = 1,799,100
scale_factor = 1,799,100 / 1,299,100 ≈ 1.3849

h'ⱼ = hⱼ × 1,799,100 / 1,299,100   for all j

LP shares for Carol = L_total × 500,000 / 1,299,100
```

**Key property:** All probabilities remain unchanged after adding liquidity. The market's view doesn't shift — only the depth increases. Subsequent trades will have lower price impact because k is larger.

### 8.5 Resolution

The market expires. The oracle reports: **ETH price = $3,150** (= 3,150 × 10⁹ on-chain).

**Bin determination:**

```
bin = ⌊(3150 − 2000) × 5 / (4000 − 2000)⌋ = ⌊1150 × 5 / 2000⌋ = ⌊2.875⌋ = 2
```

**Winning bin: 2** (covering [$2800, $3200)).

**Payouts:**

- **Alice** holds 192,585 tokens of bin 2.
  - Gross payout: 192,585 collateral units (1:1 redemption).
  - Redemption fee (50 bps): ⌊192,585 × 50 / 10,000⌋ = 962.
  - Net payout: 191,623.
  - **Profit:** 191,623 − 100,000 = **91,623** (91.6% return).

- **Bob** holds tokens across all bins from his distribution buy. Only bin 2 tokens redeem.
  - His bin 2 tokens (from the distribution buy) redeem 1:1 minus fee.
  - His tokens in bins 0, 1, 3, 4 are worth zero.
  - His profit depends on how many bin 2 tokens he received vs. total cost.

- **Carol** (LP) claims her proportional share of the remaining reserves of bin 2:
  ```
  lp_payout = h₂_final × Carol_shares / L_total + fee_share
  ```

**Key observation:** The resolution maps a continuous value ($3,150) to a discrete bin (bin 2). Any value in [$2,800, $3,200) would have resolved identically. This is the fundamental discretization trade-off — see Section 10.

### 8.6 Lifecycle Summary

```
Creation:    Uniform distribution (20% each bin), k = 1,000,000
     ↓
Trade 1:     Alice buys bin 2 → probability shifts to 34%
     ↓
Trade 2:     Bob buys N(3000, 400) → bell curve centered on bin 2 (~40%)
     ↓
Add LP:      Carol adds liquidity → probabilities unchanged, depth increases
     ↓
Deadline:    Market transitions to PendingResolution
     ↓
Resolution:  Oracle reports $3,150 → bin 2 wins → 1:1 redemption
     ↓
Claims:      Alice profits, Bob partially profits, Carol gets LP residual + fees
```

---

## 9. Fee Structure

### 9.1 Trade Fees

On every trade with gross amount G:

```
total_fee = ⌊G · trade_fee_bps / 10000⌋
lp_fee = ⌊total_fee · lp_fee_share_bps / 10000⌋
protocol_fee = total_fee − lp_fee
net_amount = G − total_fee
```

Default parameters: trade_fee = 30 bps (0.3%), lp_share = 5000 bps (50% of fee).

### 9.2 Redemption Fee

On payout claims:

```
redemption_fee = ⌊gross_payout · redemption_fee_bps / 10000⌋
net_payout = gross_payout − redemption_fee
```

Default: 50 bps (0.5%). The redemption fee accrues to the protocol treasury.

### 9.3 Fee Impact on Trading

Fees reduce the effective collateral entering the AMM. For a buy with gross amount G:

```
effective_collateral = G − ⌊G · fee_bps / 10000⌋
```

The trader pays G but only G − fee enters the AMM engine. This means:
- The actual price impact is slightly less than a fee-free trade of size G.
- The trader receives fewer tokens per unit of gross collateral.
- A round-trip (buy then sell) always costs at least 2 × fee_rate, creating a natural bid-ask spread.

### 9.4 Fee Accounting

Fees are split between two accumulators on the market account:

- **lp_fee_accumulated** (u128): LP share, distributed proportionally when LPs withdraw.
- **protocol_fee_accumulated** (u64): Protocol share, swept to treasury via a separate `collect_fees` instruction.

---

## 10. The Discretization Approach

### 10.1 How It Works

DekantPM approximates continuous outcome spaces by dividing the range [a, b] into N equally-spaced bins (N ∈ [2, 256]). Each bin is treated as a discrete outcome. Traders express continuous beliefs (Normal distributions) that are projected onto bin weights.

This is a **finite-dimensional approximation** of the infinite-dimensional L₂ function space described in theoretical models (see Section 12).

### 10.2 Advantages

1. **Simplicity:** The same L₂-norm AMM engine handles both discrete and continuous markets. No separate continuous math is needed at the AMM level.

2. **On-chain efficiency:** The AMM operates on fixed-length vectors (max 256 elements). All operations are O(N) — computing sums, updating reserves, solving quadratics — feasible within Solana's compute budget.

3. **Composability:** Discrete outcome tokens for each bin can be individually held, transferred, and settled. This enables secondary markets and complex positions.

4. **Exact solvency:** The complete-set minting model guarantees solvency (Section 7.3). Each bin is a separate outcome token with a clear 1:1 redemption path.

5. **No backing constraint complexity:** Unlike the true continuous model, which requires managing a separate backing amount b and solvency constraint max(f) ≤ b, the discrete model's solvency is automatic.

### 10.3 Disadvantages

1. **Resolution granularity:** The market resolves to a single winning bin. Two values in the same bin are treated identically, even if they are different. A market with range [0, 1000] and 100 bins has a resolution of 10 units — outcomes at 105 and 114 both resolve to the same bin.

2. **Distribution approximation error:** The Normal PDF is approximated by a step function (histogram). For small N or large σ relative to the bin width, this is adequate. For narrow σ relative to bin width, significant probability mass may be misallocated between bins.

3. **Fixed bin structure:** Bins are equally spaced. In many applications (e.g., financial prices), a logarithmic or adaptive spacing would better match the distribution of likely outcomes.

4. **Taylor polynomial error:** The degree-4 Taylor approximation of exp(−z²/2) degrades for |z| > 1.5 (see Section 5.2). For distributions centered near the range edges or very narrow distributions, this introduces systematic bias in the weight vector.

5. **Restricted distribution family:** Only Normal distributions can be traded via the distribution trading interface. Traders cannot express skewed, bimodal, or fat-tailed beliefs directly. (They can, however, place discrete bets on individual bins to construct arbitrary distributions manually.)

---

## 11. Limitations and Alternative Approaches

### 11.1 Limitation: Single-Bin Resolution (RESOLVED for continuous markets)

**Historical problem:** When a continuous market resolved with W = 0 (winner-take-all), the oracle provided a single value v that mapped to exactly one winning bin. All bins except the winner paid zero. This created a discontinuity: two values very close to a bin boundary produced completely different payouts.

**Example:** Range [0, 100], 10 bins (each width 10). A trader long bin 3 (covers [30, 40)). If the outcome was 39.99 they won everything; if it was 40.01 they won nothing.

**Resolution: smooth-kernel settlement.** Market creators now opt into smooth-kernel settlement by setting `kernel_width = W ≥ 1` at creation (see §7.2.1). The triangular kernel `K(i, bin_win, W) = max(0, (W+1−|i−bin_win|)/(W+1))` distributes payout to bins within W steps of the winner. The per-market `scaling_factor`, computed at resolution as `s = min(S, k·S / ∑Kⱼ·trader_totalsⱼ)`, guarantees that the sum of kernel-weighted claims never exceeds the vault — preserving the same intrinsic solvency property that WTA enjoys (§7.3, case 2).

Binary and multi-outcome markets still use WTA (W = 0 is enforced); the kernel is only meaningful when adjacent bins represent close-but-not-equal outcomes.

### 11.2 Limitation: Fixed Number of Bins

**The Problem:** N is set at market creation and cannot change. If a market starts broad (e.g., "ETH price in 2025: $0–$100,000" with 100 bins → $1,000/bin) and consensus narrows to a range of $2,000–$3,000, most bins are wasted while the interesting range has only 1 bin.

**Alternative — Adaptive binning / hierarchical markets.** Markets could dynamically refine bins in high-density regions. This is complex on-chain but could be implemented via linked child markets that subdivide a parent bin into finer resolution.

**Alternative — The true continuous approach** (see Section 12) eliminates bins entirely.

### 11.3 Limitation: Normal-Only Distributions

**The Problem:** Traders can only express Normal(μ, σ) beliefs. Real-world distributions are often skewed (log-normal for prices), heavy-tailed, or multimodal.

**Alternative — Support additional distribution families.** The bin-weight computation could be extended to log-normal, uniform, or mixture distributions. Each would require its own on-chain weight computation function, increasing program complexity but broadening expressiveness.

**Alternative — Allow arbitrary weight vectors.** Let traders submit custom weight vectors directly (subject to normalization ∑Wⱼ = S). This is maximally flexible but makes the UI much harder — users would need to specify N-dimensional vectors.

### 11.4 Limitation: Taylor Polynomial Precision (RESOLVED)

**Historical problem:** A degree-4 Taylor approximation of exp(−t/2) had relative error up to ~50% for |z| ∈ [2.5, 5], propagating into the Gaussian bin-weight vector for broad distributions.

**Resolution: lookup table + linear interpolation.** The current implementation precomputes exp(−z²/2) at 51 grid points over |z| ∈ [0, 5] (step 0.1) and linearly interpolates between them at evaluation time. Relative error is bounded by ~0.5% across the entire support, at the cost of one table lookup, one subtraction, one multiplication, and one division per bin — much cheaper than the higher-degree polynomials originally floated as alternatives.

### 11.5 Limitation: Compute Budget with Many Bins

**The Problem:** Distribution buy/sell iterates over all N bins to compute XW, W², and update reserves. For N = 256, this is ~768 arithmetic operations, which approaches Solana's compute unit limits for a single instruction.

**Alternative — Batch processing across multiple transactions.** Or use a more efficient AMM that operates on distribution parameters directly (see Section 12).

### 11.6 Limitation: Quadratic Probability Distortion (RESOLVED)

**Historical problem:** The original pricing formula p̂ᵢ = xᵢ²/k² created a non-linear distortion between displayed probabilities and true equilibrium probabilities (see §2.5). Traders saw values compressed toward the extremes — a 70% true probability was displayed as 84.5%.

**Resolution: linear probability display.** DekantPM now computes and displays p̂ᵢ = xᵢ/∑xⱼ throughout the frontend, backend, and contract. The AMM core (invariant, complete-set minting, distribution math) is unchanged because the quadratic formula was only ever a *display* layer — the underlying L₂ AMM mechanics are independent of the choice of probability normalization. The buy-to-price interface (§5.5) was updated to target the linear probability.

---

## 12. Comparison with Paradigm's Distribution Markets

### 12.1 Overview of Paradigm's Approach

The Paradigm paper ("Distribution Markets," Dave White, December 2024) proposes a continuous prediction market operating in **infinite-dimensional function space (L²)**. The key ideas:

1. **Outcome function tokens:** Instead of discrete outcome tokens, traders hold *functions* f: ℝ → ℝ₊ where f(x) is the payout if outcome x occurs.
2. **Minting:** A constant function f(x) = b can be minted for b dollars (analogous to complete sets in the discrete case).
3. **AMM invariant:** ‖f‖₂ = √(∫f(x)²dx) = k, a constant L² norm.
4. **Solvency:** Requires max(f) ≤ b (the backing amount), which is a separate constraint from the L² norm.
5. **Optimality:** By Cauchy-Schwarz in L², the equilibrium position f* ∝ p (the true PDF).

### 12.2 Structural Comparison

| Aspect | DekantPM (Discretized) | Paradigm (True Continuous) |
|--------|----------------------|--------------------------|
| **Outcome space** | Finite bins: N ∈ [2, 256] | Infinite: ℝ or any continuous space |
| **Position representation** | Vector x ∈ ℝᴺ | Function f: ℝ → ℝ |
| **Invariant** | ∑xᵢ² = k² (finite sum) | ∫f(x)²dx = k² (integral) |
| **Pricing** | p̂ᵢ = xᵢ/∑xⱼ (linear, per bin) | p̂(x) ∝ f(x) (continuous density) |
| **Solvency** | Automatic (WTA) or scaled (kernel); always ≤ k | Requires explicit constraint max(f) ≤ b |
| **Backing vs. norm** | Same (k = b) | Separate (k ≤ b typically) |
| **Distribution trading** | Normal PDF → bin weights → weighted discrete trade | Direct trade in distribution parameters (μ, σ) |
| **Collateral model** | Complete-set minting: cost = k' − k | Max-loss: −min_x{g(x) − f(x)} (can require numerical computation) |
| **Resolution** | WTA (W = 0) or smooth triangular kernel (W ≥ 1) with scaling_factor cap | Payout = f(v) where v is realized value (smooth) |
| **LP provision** | Proportional scaling of reserves vector | Proportional scaling of position function |
| **On-chain feasibility** | Yes (Solana, O(N) per trade) | Requires specialization to specific distribution families |

### 12.3 The Backing Constraint Difference

This is the most fundamental mathematical difference between the two approaches.

**DekantPM:** In finite dimensions, the L₂-norm constraint ‖x‖₂ = k automatically ensures that no single xᵢ exceeds k. Since xᵢ² ≤ ∑xⱼ² = k², we have |xᵢ| ≤ k. Combined with the 1:1 redemption model, the AMM always has enough reserves to pay any single winning outcome.

**Paradigm:** In infinite dimensions, ‖f‖₂ = k does NOT bound max(f). Consider f(x) = M · δ_ε(x) (a very narrow, very tall spike). Its L² norm can be k while its maximum is arbitrarily large. Hence the separate constraint max(f) ≤ b.

This means Paradigm's model needs:
- A backing amount b ≥ max(f) to ensure solvency.
- For Normal distributions: a minimum spread σ ≥ k²/(b²√π) to stay within the backing constraint.
- Numerical computation of max-loss for collateralization.

DekantPM's discretization **sidesteps this entirely** — the finite-dimensional solvency guarantee is intrinsic to the mathematical structure.

### 12.4 Resolution Model Difference

**Paradigm:** At resolution with realized value v, a trader holding function f receives f(v). This is a **smooth payout** — nearby outcomes give similar payoffs. If f is a Gaussian centered near v, the payout degrades smoothly as v moves away from the center.

**DekantPM:** Continuous markets choose one of two modes at creation via `kernel_width`:

- **WTA (W = 0):** Bin j wins if v falls in bin j's range. Payout is 1:1 for winning tokens, 0 elsewhere — a **step function**.
- **Smooth kernel (W ≥ 1):** Bins within W steps of the winning bin pay a triangular-weighted fraction `K(i, bin_win, W) · s / S` per token, with `s = min(S, k·S / ∑Kⱼ·trader_totalsⱼ)` capping aggregate claims at the vault. A trader who bet on "around $3,000" with a tight distribution gets a high payout if the outcome is $3,050 (peak bin or one step off) and a lower (but non-zero) payout if it lands W bins away. The chosen W gives the creator a knob between sharp-incentive WTA (W = 0) and Paradigm-style smoothing (large W approximating the kernel's triangular envelope).

The discrete kernel converges to Paradigm's continuous payout as N → ∞ with W scaled appropriately.

### 12.5 Computational Efficiency

**Paradigm (Normal case):** A trade changes (μ, σ) to (μ', σ'). The AMM needs to:
1. Verify the L² norm constraint (closed-form for Gaussians: ‖f‖₂² = ∫f²dx, which has analytic solutions for Gaussian f).
2. Compute max-loss collateral (requires finding min of difference of two Gaussians — generally requires numerical optimization, no closed form).
3. Verify the solvency constraint max(f) ≤ b.

This is O(1) in the number of "bins" (there are none), but the numerical max-loss computation adds complexity.

**DekantPM:** A distribution trade requires O(N) operations to compute weights, XW, W², and update all N reserves. For N = 256, this is ~1000 arithmetic operations — feasible on Solana within a single transaction.

### 12.6 Where DekantPM Aligns with Paradigm

1. **Same invariant family:** Both use the L₂ norm as the AMM invariant. DekantPM's ∑xᵢ² = k² is exactly the discrete analog of Paradigm's ∫f² = k².

2. **Same optimality result:** Both invoke Cauchy-Schwarz to show that the equilibrium position is proportional to the true probability distribution.

3. **Same LP model:** Both scale positions proportionally for liquidity provision.

4. **Same market scoring rule property:** In both models, the AMM state encodes the crowd's belief about the probability distribution.

5. **DekantPM converges to Paradigm:** As N → ∞ and bin width → 0, DekantPM's discretized model converges to Paradigm's continuous model. The discrete sums become integrals, bin weights become continuous densities, and the step-function payout approaches a smooth payout.

### 12.7 Where DekantPM Diverges from Paradigm

1. **No separate backing constraint:** DekantPM does not need b ≠ k. This simplifies the model but means it cannot represent arbitrarily peaked distributions (the bin resolution limits this naturally).

2. **Discretized smooth payout:** Paradigm's model pays f(v) continuously; DekantPM pays per bin with an opt-in triangular kernel (W ≥ 1) that approximates smoothness up to the bin resolution.

3. **Restricted to Normal distributions:** Paradigm discusses Normal, uniform, and even mixtures. DekantPM's distribution trading only implements Normal.

4. **Collateral model:** Paradigm requires max-loss collateral (the worst-case difference between new and old positions). DekantPM uses complete-set minting — simpler but potentially less capital-efficient (the trader always deposits the full collateral amount, even if their max loss is lower).

---

## 13. Summary of Mathematical Properties

### 13.1 Correctness Properties

1. **Invariant preservation:** Every trade (buy, sell, distribution buy/sell) preserves ∑xᵢ² = k² within tolerance ε = 256. The tolerance accounts for accumulated integer rounding across sqrt and division operations.

2. **Solvency:** The vault always holds ≥ k collateral. Maximum redemption at resolution ≤ k under both WTA and smooth-kernel settlement (proven in Section 7.3). In kernel mode the `scaling_factor` enforces this bound at claim time.

3. **No arbitrage (within fees):** The displayed linear probabilities sum to 1 (within rounding). There is no risk-free profit loop of buying and selling that nets positive collateral after fees.

4. **Market scoring rule:** At equilibrium, the position vector is proportional to the true distribution, so the linear probabilities p̂ᵢ = xᵢ/∑xⱼ recover the true frequentist probabilities exactly (Cauchy-Schwarz optimum).

### 13.2 Numerical Properties

1. **Fixed-point arithmetic:** All probability computations use SCALE = 10⁹ denominator. This provides ~9 decimal digits of precision for probabilities.

2. **Integer square root:** Newton's method converges in ≤ 64 iterations for u128, giving exact ⌊√n⌋.

3. **Invariant tolerance:** ε = 256 accounts for accumulated rounding across operations. For typical market sizes (k ~ 10⁶–10¹²), this is negligible (relative error < 10⁻⁷).

4. **Overflow safety:** All arithmetic uses checked operations on u128. Maximum k² = (2⁶⁴)² = 2¹²⁸ — fits in u128. The probability computation xᵢ² · SCALE can overflow u128 for very large positions; the code handles this gracefully by returning 0 for such overflow cases.

### 13.3 Key Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| SCALE | 10⁹ | Fixed-point denominator for probabilities and scaling_factor |
| INVARIANT_TOLERANCE | 256 | Maximum allowed invariant drift |
| MAX_OUTCOMES | 32 | Maximum discrete outcomes |
| MAX_BINS | 256 | Maximum continuous bins |
| MAX_KERNEL_WIDTH | (per market, ≤ N − 1) | Triangular kernel half-support; 0 = WTA |
| Z_CUTOFF | 5 | Gaussian tail cutoff (5σ) |
| GAUSSIAN_TABLE_SIZE | 51 | exp(−z²/2) lookup entries over \|z\| ∈ [0, 5] |
| MIN_LIQUIDITY | 10⁶ | 1 USDC minimum initial liquidity |
| MIN_TRADE_AMOUNT | 10³ | 0.001 USDC minimum trade |
| DEFAULT_TRADE_FEE | 30 bps | 0.3% per trade |
| DEFAULT_LP_FEE_SHARE | 5000 bps | 50% of trade fee to LPs |
| DEFAULT_REDEMPTION_FEE | 50 bps | 0.5% on payout claims |
| DEFAULT_CREATION_FEE | 50 bps | 0.5% on market creation |

---

## Appendix A: Derivation of the Distribution Buy Quadratic

We seek to allocate collateral c across bins proportional to weights W, while maintaining the invariant.

After minting complete sets, the new total is k' = k + c. We want to find positions:

```
x'ⱼ = xⱼ + λ · Wⱼ / W²
```

where λ is a scalar and W² = ∑Wⱼ². The invariant requires:

```
∑(x'ⱼ)² = k'²
```

Expanding:

```
∑(xⱼ + λWⱼ/W²)² = k'²
∑xⱼ² + 2(λ/W²)∑xⱼWⱼ + (λ²/W⁴)∑Wⱼ² = k'²
k² + 2λ·XW/W² + λ²/W² = k'²
```

Multiplying by W²:

```
λ² + 2·XW·λ + W²(k² − k'²) = 0
λ² + 2·XW·λ − W²·excess = 0     where excess = k'² − k²
```

By the quadratic formula:

```
λ = (−2·XW ± √(4·XW² + 4·W²·excess)) / 2
  = −XW ± √(XW² + W²·excess)
```

Taking the positive root (λ > 0 for a buy):

```
λ = √(XW² + W²·excess) − XW
```

## Appendix B: Integer Square Root via Newton's Method

Given n ∈ ℕ, find ⌊√n⌋.

**Algorithm:**

```
x₀ = n/2 + 1
xₜ₊₁ = ⌊(xₜ + n/xₜ)/2⌋
Stop when xₜ₊₁ ≥ xₜ; return xₜ.
```

**Correctness:** Newton's method for f(x) = x² − n converges quadratically. The sequence {xₜ} is monotonically decreasing (after the first step) and bounded below by ⌊√n⌋. The stopping condition xₜ₊₁ ≥ xₜ detects convergence.

**Complexity:** For u128 inputs, convergence takes at most 64 iterations (one bit of precision per iteration in the worst case).

## Appendix C: Glossary

| Symbol | Meaning |
|--------|---------|
| N | Number of outcomes or bins |
| k | Total minted collateral (= total_minted) |
| hᵢ | AMM reserve for outcome i |
| xᵢ | Position for outcome i: xᵢ = k − hᵢ |
| p̂ᵢ | Displayed probability of outcome i (linear: xᵢ/∑xⱼ) |
| S | Scale factor (10⁹) |
| Wⱼ | Normalized Gaussian bin weight for bin j (∑Wⱼ = S) |
| W (kernel) | Kernel width for smooth-kernel settlement; W = 0 ⇒ WTA |
| K(i, bin_win, W) | Triangular settlement kernel: max(0, (W+1−\|i−bin_win\|)/(W+1)) |
| s | Per-resolution `scaling_factor` ∈ [0, S] enforcing kernel solvency |
| trader_totalsⱼ | Sum of bin j holdings across all traders (LP-excluded) |
| μ | Mean of trader's Normal distribution |
| σ | Standard deviation of trader's Normal distribution |
| XW | ∑xⱼWⱼ (position-weight dot product, for distribution buy) |
| W² | ∑Wⱼ² (sum of squared Gaussian weights — distinct from kernel W) |
| λ | Quadratic solution parameter for distribution buy |
| L | LP shares total |
| b | Backing amount (Paradigm model only) |
| f | Outcome function (Paradigm model only) |
