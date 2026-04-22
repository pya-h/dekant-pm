# DekantPM — Mathematical Analysis

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

Given that x ∝ p at equilibrium, there are two natural ways to extract a probability distribution from the AMM state.

**Linear extraction (true probabilities at equilibrium):**

```
p̂ᵢ = xᵢ / ∑ⱼ xⱼ = (k − hᵢ) / ∑ⱼ (k − hⱼ)
```

This recovers the actual probabilities at the Cauchy-Schwarz optimum: if x* = k·p/‖p‖₂, then x*ᵢ/∑x*ⱼ = pᵢ/∑pⱼ = pᵢ. These are the true probabilities, but they do not arise naturally from the invariant.

**Quadratic extraction (used by DekantPM):**

```
p̂ᵢ = xᵢ² / k² = (k − hᵢ)² / k²
```

These values sum to 1 automatically by the invariant (∑xᵢ² = k²), making them computationally convenient. At equilibrium where x*ᵢ = k·pᵢ/‖p‖₂:

```
p̂ᵢ = x*ᵢ² / k² = pᵢ² / ‖p‖₂²
```

The implementation reports probabilities scaled by S = 10⁹:

```
p̂ᵢ_scaled = xᵢ² · S / k²
```

### 2.5 Quadratic Pricing: Interpretation and Distortion

The quadratic formula p̂ᵢ = xᵢ²/k² is **not** the true probability at equilibrium — it is the squared and renormalized probability. This creates a non-linear distortion that compresses values toward the extremes.

**Example (binary market, true probability p₁ = 0.7, p₂ = 0.3):**

```
‖p‖₂ = √(0.49 + 0.09) = √0.58 ≈ 0.7616

Quadratic:  p̂₁ = 0.49/0.58 ≈ 0.845    p̂₂ = 0.09/0.58 ≈ 0.155
Linear:     p₁ = 0.7                     p₂ = 0.3
```

The displayed "84.5%" corresponds to a true equilibrium probability of 70%.

**Distortion table for binary markets:**

| True probability | Quadratic p̂ (displayed) |
|-----------------|------------------------|
| 50%             | 50.0%                  |
| 60%             | 69.2%                  |
| 70%             | 84.5%                  |
| 80%             | 94.1%                  |
| 90%             | 98.8%                  |

**To recover true probabilities from the displayed values:**

```
pᵢ = √p̂ᵢ / ∑ⱼ √p̂ⱼ
```

**Why use the quadratic formula despite the distortion?**

1. **Invariant-derived:** ∑p̂ᵢ = 1 follows directly from ∑xᵢ² = k², requiring no separate normalization step.
2. **Internal consistency:** The buy-to-price function, fee calculations, and all AMM operations use the same quadratic definition. A trader targeting "70% displayed" gets exactly 70% displayed.
3. **Monotonic:** The ordering of outcomes is always preserved — the most likely outcome always has the highest p̂.
4. **Self-consistent equilibrium:** Traders interacting through the UI learn the quadratic scale. The market still converges to an efficient equilibrium; the scale is simply non-linear relative to true frequentist probabilities.

**Important:** Throughout this document, "probability" and p̂ᵢ refer to the **quadratic** extraction xᵢ²/k² unless otherwise noted, since this is what the implementation computes and displays.

---

## 3. Market Initialization

When a market is created with initial liquidity **L** and **N** outcomes:

1. Set k = L (total_minted = initial liquidity).
2. Compute uniform positions: xᵢ = ⌊√(L²/N)⌋ for all i (integer square root).
3. Compute reserves: hᵢ = L − xᵢ for all i.
4. Set k² = L².
5. Initial LP receives L shares.

The initial implied probability for each outcome is:

```
p̂ᵢ = xᵢ² / k² ≈ (L²/N) / L² = 1/N
```

This gives a uniform prior — every outcome starts equally likely.

**Example:** Binary market (N = 2) with L = 1,000,000 (1 USDC):
- x₁ = x₂ = ⌊√(10¹²/2)⌋ = 707,106
- h₁ = h₂ = 1,000,000 − 707,106 = 292,894
- p̂₁ = p̂₂ = 707,106² / 1,000,000² ≈ 0.5 ✓

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

**Price impact:** A larger purchase c increases xᵢ relative to other positions, raising p̂ᵢ. The square root creates a **concave** relationship — each additional unit costs more, providing natural slippage protection.

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
p̂₁ = x₁²/k²
```

After trade (buying outcome 1):
```
k' = k + c
x'₁ = √(k'² − x₂²)
p̂'₁ = x'₁²/k'²
```

The price impact increases with c/k (trade size relative to liquidity). For small trades (c ≪ k), the price impact is approximately linear; for large trades, the square root creates diminishing returns — each additional unit of collateral buys fewer tokens.

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

**Step 2 — On-chain approximation.** The exponential is computed using a degree-4 Taylor polynomial of exp(−t/2) where t = z², evaluated in Horner form:

```
exp(−t/2) ≈ 1 − t/2 + t²/8 − t³/48 + t⁴/384
```

All arithmetic uses fixed-point with denominator S = 10⁹. The approximation error profile:

| |z| range | t = z² range | Relative error |
|-----------|-------------|---------------|
| 0 – 1.0   | 0 – 1.0    | < 0.01%      |
| 1.0 – 1.5 | 1.0 – 2.25 | ~ 0.1%       |
| 1.5 – 2.5 | 2.25 – 6.25| ~ 1–5%       |
| 2.5 – 5.0 | 6.25 – 25  | ~ 10–50%     |

For bins near the distribution center (|z| < 1.5), the approximation is excellent. For tail bins (|z| > 2.5), the absolute weight is small, so even large relative errors have negligible effect on the normalized weight vector. The Z_CUTOFF = 5 ensures that bins beyond 5σ from the mean receive zero weight, which excludes less than 6 × 10⁻⁷ of the probability mass.

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

A trader can specify a **target probability** p* for outcome i (in the quadratic sense: xᵢ²/k² = p*/S), and the AMM computes how much collateral is needed.

**Derivation:**

We want p̂'ᵢ = p*/S after the trade, meaning:

```
x'ᵢ² / k'² = p* / S
```

Since non-target positions don't change during a buy (the complete-set minting preserves them):

```
k'² = ∑ⱼ x'ⱼ² = ∑ⱼ≠ᵢ xⱼ² + x'ᵢ²
```

Let Σ₋ᵢ = ∑ⱼ≠ᵢ xⱼ². Substituting x'ᵢ² = p*·k'²/S:

```
k'² = Σ₋ᵢ + p*·k'²/S
k'²(1 − p*/S) = Σ₋ᵢ
k'² = Σ₋ᵢ · S / (S − p*)
```

The required collateral is:

```
c = k' − k = √(Σ₋ᵢ · S / (S − p*)) − k
```

**Sell-to-price** works analogously — compute the target position size x_target and return the difference:

```
x_target² = p* · Σ₋ᵢ / (S − p*)
tokens_in = xᵢ − x_target
```

---

## 6. Liquidity Provision

### 6.1 Adding Liquidity

An LP deposits **d** collateral. The AMM scales all reserves proportionally:

```
h'ⱼ = hⱼ · (k + d) / k    for all j
```

This preserves the probability distribution. To see why: positions scale as x'ⱼ = k' − h'ⱼ = (k+d) − hⱼ(k+d)/k = (k+d)(1 − hⱼ/k) = (k+d)·xⱼ/k. Since all positions scale by the same factor (k+d)/k, ratios xᵢ²/∑xⱼ² are preserved. Liquidity increases without shifting the market's view.

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
bin = ⌊(v − a) · N / (b − a)⌋,   clamped to [0, N−1]
```

Then payout proceeds identically to the discrete case — holders of the winning bin's tokens redeem 1:1 (minus fee). All other bins pay zero.

### 7.3 Solvency Guarantee

The system is always solvent. Here is a proof:

**Claim:** The vault holds at least k collateral at all times, and the maximum possible redemption at resolution is at most k.

**Proof:**

1. **Complete-set minting:** Every token in circulation was created as part of a complete set. For every unit of outcome token i held by traders (xᵢ), there are hᵢ = k − xᵢ units in the AMM reserves. Total tokens per outcome: xᵢ + hᵢ = k.

2. **Vault balance:** Every complete-set mint deposits exactly 1 unit of collateral per token set. After minting k total sets: vault ≥ k (plus accumulated fees, minus LP withdrawals — but LP withdrawals are bounded by their proportional share of k).

3. **Maximum redemption:** At resolution, only the winning outcome redeems. The maximum number of winning tokens held by all traders is x_winning ≤ k (since x_winning² ≤ ∑xⱼ² = k²). Therefore total redemption ≤ k ≤ vault balance. ∎

4. **LP residual:** After all traders claim, the remaining reserves of the winning outcome (h_winning = k − x_winning) belong to LPs.

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

**Initial probabilities:** p̂ᵢ = 447,213² / 1,000,000² ≈ 0.200 for all i (uniform 20% each). ✓

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

**New probabilities:**

```
p̂₂ = 639,798² / 1,099,700² ≈ 0.339   (was 0.200, rose to ~34%)
p̂ⱼ = 447,213² / 1,099,700² ≈ 0.165   for j ≠ 2 (was 0.200, fell to ~16.5%)

Check: 0.339 + 4 × 0.165 = 0.339 + 0.660 = 0.999 ≈ 1 ✓
```

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

**Post-trade probability distribution (approximate):**

| Bin | Before Trade 2 | After Trade 2 |
|-----|---------------|---------------|
| 0   | 16.5%         | ~9%           |
| 1   | 16.5%         | ~18%          |
| 2   | 33.9%         | ~40%          |
| 3   | 16.5%         | ~18%          |
| 4   | 16.5%         | ~9%           |

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

**Key observation:** The resolution maps a continuous value ($3,150) to a discrete bin (bin 2). Any value in [$2,800, $3,200) would have resolved identically. This is the fundamental discretization trade-off — see Section 10.1.

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

### 11.1 Limitation: Single-Bin Resolution

**The Problem:** When a continuous market resolves, the oracle provides a single value v, which maps to exactly one winning bin. All bins except the winner pay zero. This creates a discontinuity: two values very close to a bin boundary produce completely different payouts for a trader.

**Example:** Range [0, 100], 10 bins (each width 10). A trader is long bin 3 (covers [30, 40)). If the outcome is 39.99, they win everything. If it's 40.01, they win nothing.

**Alternative — Pro-rata resolution:** Distribute payouts to nearby bins proportionally to how close the resolved value is to each bin's center:

```
payout_weight(bin j) ∝ max(0, bin_width − |centerⱼ − v|)
```

This smooths the payout function and reduces boundary effects. However, it complicates the solvency model (payouts are no longer 1:1 for a single outcome) and would require careful redesign of the complete-set accounting.

### 11.2 Limitation: Fixed Number of Bins

**The Problem:** N is set at market creation and cannot change. If a market starts broad (e.g., "ETH price in 2025: $0–$100,000" with 100 bins → $1,000/bin) and consensus narrows to a range of $2,000–$3,000, most bins are wasted while the interesting range has only 1 bin.

**Alternative — Adaptive binning / hierarchical markets.** Markets could dynamically refine bins in high-density regions. This is complex on-chain but could be implemented via linked child markets that subdivide a parent bin into finer resolution.

**Alternative — The true continuous approach** (see Section 12) eliminates bins entirely.

### 11.3 Limitation: Normal-Only Distributions

**The Problem:** Traders can only express Normal(μ, σ) beliefs. Real-world distributions are often skewed (log-normal for prices), heavy-tailed, or multimodal.

**Alternative — Support additional distribution families.** The bin-weight computation could be extended to log-normal, uniform, or mixture distributions. Each would require its own on-chain weight computation function, increasing program complexity but broadening expressiveness.

**Alternative — Allow arbitrary weight vectors.** Let traders submit custom weight vectors directly (subject to normalization ∑Wⱼ = S). This is maximally flexible but makes the UI much harder — users would need to specify N-dimensional vectors.

### 11.4 Limitation: Taylor Polynomial Precision

**The Problem:** The degree-4 Taylor approximation of exp(−t/2) has significant error for |z| > 2 (see error table in Section 5.2). For broad distributions where bins at |z| ≈ 2–3 carry meaningful weight, the errors propagate into the weight vector.

**Alternative — Higher-degree polynomial.** A degree-8 polynomial would reduce relative error to <0.01% for |z| ≤ 3. A degree-12 polynomial covers |z| ≤ 4 with high accuracy. The trade-off is more multiplications per bin.

**Alternative — Piecewise approximation.** Different polynomials for different |z| ranges could achieve near-machine-precision at moderate compute cost. For example, one polynomial for |z| ≤ 1, another for 1 < |z| ≤ 3, and a third for 3 < |z| ≤ 5.

### 11.5 Limitation: Compute Budget with Many Bins

**The Problem:** Distribution buy/sell iterates over all N bins to compute XW, W², and update reserves. For N = 256, this is ~768 arithmetic operations, which approaches Solana's compute unit limits for a single instruction.

**Alternative — Batch processing across multiple transactions.** Or use a more efficient AMM that operates on distribution parameters directly (see Section 12).

### 11.6 Limitation: Quadratic Probability Distortion

**The Problem:** As analyzed in Section 2.5, the quadratic pricing formula p̂ᵢ = xᵢ²/k² creates a non-linear distortion between displayed probabilities and the true equilibrium probabilities. This may confuse users who expect the displayed probability to match frequentist intuition.

**Alternative — Linear probability display.** The frontend could compute and display p_linear = xᵢ/∑xⱼ instead of xᵢ²/k². The AMM internals would remain unchanged, but the buy-to-price interface would need to be adapted to target the linear probability.

**Alternative — Hybrid approach.** Display both the "market price" (quadratic, xᵢ²/k²) and the "implied probability" (linear, xᵢ/∑xⱼ). This gives users both the trading-relevant price and the probabilistic interpretation.

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
| **Pricing** | p̂ᵢ = xᵢ²/k² (per bin) | p̂(x) ∝ f(x) (continuous density) |
| **Solvency** | Automatic (complete sets, xᵢ ≤ k) | Requires explicit constraint max(f) ≤ b |
| **Backing vs. norm** | Same (k = b) | Separate (k ≤ b typically) |
| **Distribution trading** | Normal PDF → bin weights → weighted discrete trade | Direct trade in distribution parameters (μ, σ) |
| **Collateral model** | Complete-set minting: cost = k' − k | Max-loss: −min_x{g(x) − f(x)} (can require numerical computation) |
| **Resolution** | Single winning bin, 1:1 payout | Payout = f(v) where v is realized value (smooth) |
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

**DekantPM:** At resolution, bin j wins if v falls in bin j's range. Payout is 1:1 for winning tokens, 0 for all others. This is a **step function payout** — a discontinuous jump at bin boundaries.

This is the most significant practical difference. Paradigm's smooth payout better rewards accurate predictions — a trader who bet on "around $3,000" with a tight distribution gets a high payout if the outcome is $3,050, and a lower (but non-zero) payout if it's $3,500. In DekantPM, a bin boundary between $3,000 and $3,200 could mean the difference between a full payout and zero.

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

2. **No smooth payout:** Paradigm's model pays f(v) continuously; DekantPM pays 1 or 0 per bin.

3. **Restricted to Normal distributions:** Paradigm discusses Normal, uniform, and even mixtures. DekantPM's distribution trading only implements Normal.

4. **Collateral model:** Paradigm requires max-loss collateral (the worst-case difference between new and old positions). DekantPM uses complete-set minting — simpler but potentially less capital-efficient (the trader always deposits the full collateral amount, even if their max loss is lower).

5. **Probability extraction:** Paradigm extracts probabilities linearly (f(x) ∝ p(x)), while DekantPM uses the quadratic formula (xᵢ²/k²), introducing the distortion analyzed in Section 2.5.

---

## 13. Summary of Mathematical Properties

### 13.1 Correctness Properties

1. **Invariant preservation:** Every trade (buy, sell, distribution buy/sell) preserves ∑xᵢ² = k² within tolerance ε = 256. The tolerance accounts for accumulated integer rounding across sqrt and division operations.

2. **Solvency:** The vault always holds ≥ k collateral. Maximum redemption at resolution ≤ k. The system is always solvent (proven in Section 7.3).

3. **No arbitrage (within fees):** The implied probabilities (quadratic) sum to 1 (within rounding). There is no risk-free profit loop of buying and selling that nets positive collateral after fees.

4. **Market scoring rule:** At equilibrium, the position vector is proportional to the true distribution. The quadratic reported probabilities are a monotonic transformation of the true probabilities.

### 13.2 Numerical Properties

1. **Fixed-point arithmetic:** All probability computations use SCALE = 10⁹ denominator. This provides ~9 decimal digits of precision for probabilities.

2. **Integer square root:** Newton's method converges in ≤ 64 iterations for u128, giving exact ⌊√n⌋.

3. **Invariant tolerance:** ε = 256 accounts for accumulated rounding across operations. For typical market sizes (k ~ 10⁶–10¹²), this is negligible (relative error < 10⁻⁷).

4. **Overflow safety:** All arithmetic uses checked operations on u128. Maximum k² = (2⁶⁴)² = 2¹²⁸ — fits in u128. The probability computation xᵢ² · SCALE can overflow u128 for very large positions; the code handles this gracefully by returning 0 for such overflow cases.

### 13.3 Key Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| SCALE | 10⁹ | Fixed-point denominator for probabilities |
| INVARIANT_TOLERANCE | 256 | Maximum allowed invariant drift |
| MAX_OUTCOMES | 32 | Maximum discrete outcomes |
| MAX_BINS | 256 | Maximum continuous bins |
| Z_CUTOFF | 5 | Gaussian tail cutoff (5σ) |
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
| p̂ᵢ | Reported probability of outcome i (quadratic: xᵢ²/k²) |
| pᵢ | True probability at equilibrium (linear: xᵢ/∑xⱼ) |
| S | Scale factor (10⁹) |
| Wⱼ | Normalized bin weight for bin j (∑Wⱼ = S) |
| μ | Mean of trader's Normal distribution |
| σ | Standard deviation of trader's Normal distribution |
| XW | ∑xⱼWⱼ (position-weight dot product) |
| W² | ∑Wⱼ² (sum of squared weights) |
| λ | Quadratic solution parameter for distribution buy |
| L | LP shares total |
| b | Backing amount (Paradigm model only) |
| f | Outcome function (Paradigm model only) |
