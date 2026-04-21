# Outcome Pricing — Range, Summation & Market Type Analysis

---

## TL;DR

| Property | DekantPM (this project) | Gnosis LMSR (for reference) |
|----------|------------------------|-----------------------------|
| Price formula | `p[i] = x[i]² / k²` (quadratic) | `p[i] = e^(q[i]/b) / Σ e^(q[j]/b)` (softmax) |
| Individual price range | **[0, 1]** | **(0, 1)** — never exactly 0 or 1 |
| Sum of all prices | **Exactly 1** (by invariant) | **Exactly 1** (by softmax) |
| Cost curve shape | Quadratic — cheaper to move prices near extremes | Exponential — increasingly expensive near extremes |
| Same formula for all types? | **Yes** — binary, multi, continuous use identical math | N/A |

---

## 1. The Pricing Formula

All three market types use a single pricing function defined in `engine/amm.rs:309-328`:

```
p[i] = (total_minted - reserves[i])² × SCALE / total_minted²
```

**Key terms:**

- **`total_minted`** — total **collateral** deposited into the market as complete sets (in token-native units, e.g. USDC lamports). This is NOT a count of outcome tokens. When collateral is deposited, it mints "complete sets" (one token of every outcome), and `total_minted` tracks that collateral amount.

- **`x[i] = total_minted - reserves[i]`** — the **position** for outcome `i`, measured in **outcome tokens** (not collateral). It represents the total outstanding outcome-`i` tokens held outside the reserve pool (by traders + the implicit pool position from initial minting). Per-user token counts are tracked in `holdings[i]`; pool-held tokens are `reserves[i]`.

In position notation:

```
p[i] = x[i]² / k²     where k = total_minted
```

On-chain, probabilities are returned as integers scaled to `SCALE = 10^9` (so 500_000_000 = 50%).

The frontend and backend replicate this identically:
- **Frontend** (`lib/types.ts:117-134`): `(tm - r)² / kSq` in floating-point
- **Backend** (`amm.service.ts:752-762`): `(totalMinted - r)² / kSq` in floating-point
- **On-chain** (`amm.rs:309-328`): `x² × SCALE / k²` in u128 integer arithmetic

---

## 2. Why Prices Always Sum to Exactly 1

The L2-norm invariant guarantees this algebraically:

```
Invariant:   Σ x[i]² = k² = total_minted²

Therefore:   Σ p[i] = Σ (x[i]² / k²) = (Σ x[i]²) / k² = k² / k² = 1
```

This holds by construction — every AMM operation (buy, sell, add/remove LP) maintains the invariant `Σ x[i]² = total_minted²` within a tolerance of 256 (integer rounding from `isqrt`).

**In practice:** On-chain integer division means `Σ p[i]` equals `SCALE ± N` (where N = number of outcomes). For a binary market, the sum is 1_000_000_000 ± 2. For a 100-bin continuous market, the sum is 1_000_000_000 ± 100. The floating-point frontend/backend computations are even more precise.

This is the same guarantee as Gnosis LMSR (where softmax ensures Σ = 1), but achieved through a different mathematical mechanism.

---

## 3. Individual Price Range: [0, 1]

Each outcome's price `p[i] = x[i]² / k²` is bounded:

- **Lower bound: 0** — achieved when `x[i] = 0`, meaning `reserves[i] = total_minted` (all tokens of this outcome are in the pool; no user holds any)
- **Upper bound: 1** — achieved when all other `x[j] = 0` for `j ≠ i`, meaning this is the only outcome with any outstanding position

### Can prices actually reach 0?

**Yes.** If a trader holds all outstanding tokens of outcome `i` and sells them all back:

1. Sell adds `tokens_in = x[i]` to `reserves[i]`, making `x[i] = 0`
2. `k_new = isqrt(Σ_{j≠i} x[j]²)` — invariant recomputed without outcome i
3. `collateral_out = total_minted - k_new` returned to trader
4. After instruction: `total_minted = k_new`, `reserves[i] = k_new`, so `x[i] = k_new - k_new = 0`
5. **Price = 0²/k_new² = 0**

### Can prices actually reach 1?

**Theoretically yes, practically no.** Price = 1 requires all OTHER outcomes to have `x[j] = 0`. This means every other outcome must have been fully sold back to the pool. While mathematically possible, it requires:
- All users who bought other outcomes to sell their entire positions
- The resulting price movements would make this increasingly expensive

### Comparison with Gnosis

In LMSR, prices use `e^(q/b)` which is always > 0, so prices can approach but **never reach** 0 or 1. DekantPM's quadratic formula allows exact 0 and exact 1. This means:

- **Cheaper extreme moves:** Moving a price from 5% → 1% costs relatively less in L2-norm than in LMSR
- **Practical implication:** Markets can more fully express extreme confidence (near-certain outcomes)

---

## 4. Market Type Breakdown

### 4.1 Binary Markets (N = 2)

**Outcomes:** 2 (e.g., Yes / No)

**Initial state:** Both outcomes start at exactly **50% / 50%**
```
x[i] = isqrt(L² / 2) ≈ L / √2    for both outcomes
p[i] = (L/√2)² / L² = 1/2 = 50%
```

**Price range per outcome:** [0%, 100%]

**Sum:** p[Yes] + p[No] = 100% (always, exactly)

**Trading:** Discrete buy/sell — buying Yes simultaneously pushes No down, and vice versa.

**Example trajectory:**
```
Initial:      Yes = 50.0%,  No = 50.0%   (sum = 100%)
After buy Yes: Yes = 63.2%,  No = 36.8%   (sum = 100%)
After buy Yes: Yes = 78.5%,  No = 21.5%   (sum = 100%)
After buy No:  Yes = 71.1%,  No = 28.9%   (sum = 100%)
```

### 4.2 Multi-Outcome Markets (N = 2..32)

**Outcomes:** 2 to 32 (e.g., "Who wins?" with 5 candidates)

**Initial state:** All outcomes start at exactly **1/N** each
```
x[i] = isqrt(L² / N)    for all outcomes
p[i] = 1/N
```

For 5 outcomes: each starts at **20%**

**Price range per outcome:** [0%, 100%]

**Sum:** Σ p[i] = 100% (always, exactly)

**Trading:** Discrete buy/sell — buying one outcome reduces all others proportionally.

**Key property:** Because `Σ p[i] = 1`, buying outcome A doesn't just lower one other outcome — it lowers ALL others. The distribution of the decrease depends on current reserves. If outcomes B through E are equally priced, they each absorb 1/4 of the decrease.

**Example (4 outcomes):**
```
Initial:       A=25.0%  B=25.0%  C=25.0%  D=25.0%  (sum=100%)
After buy A:   A=42.3%  B=19.2%  C=19.2%  D=19.2%  (sum=100%)
After buy B:   A=35.1%  B=33.8%  C=15.6%  D=15.6%  (sum=100%)
```

### 4.3 Continuous Markets (N = 2..256 bins)

**Outcomes:** 2 to 256 bins spanning a continuous range `[range_min, range_max]`

**Bin mapping:**
```
bin_width = (range_max - range_min) / num_bins
bin[i] covers: [range_min + i × bin_width,  range_min + (i+1) × bin_width)
```

Conversion from value to bin (`market.rs:468-491`):
```
bin = (value - range_min) × num_outcomes / (range_max - range_min)
```
Clamped to `[0, num_outcomes - 1]`.

**Initial state:** All bins start at **1/N** (uniform distribution)

For 100 bins: each starts at **1%**

**Price range per bin:** [0%, 100%]

**Sum:** Σ p[bin] = 100% (always, exactly)

**Trading:** Distribution buy/sell — trades use Gaussian weights `Normal(mu, sigma)` to buy/sell across multiple bins simultaneously. This is how users express beliefs like "I think the value will be around 42 ± 3."

**Key difference from discrete markets:** Instead of buying a single outcome, traders specify a mean (mu) and standard deviation (sigma), and the AMM computes per-bin weights from the normal PDF. Bins near mu receive more tokens, bins far from mu receive fewer.

**Example (10 bins, range [0, 100]):**
```
Initial:              each bin = 10%     (sum = 100%)
After buy mu=50 σ=10: bin[4]=8.2% bin[5]=18.4% bin[6]=8.2% ...  (sum = 100%)
After buy mu=30 σ=5:  bin[2]=7.1% bin[3]=22.6% bin[4]=9.8% ...  (sum = 100%)
```

The distribution of bin probabilities can be interpreted as the market's implied probability density function (PDF) over the continuous range.

---

## 5. What "Price" Means for Each Market Type

| Market Type | What p[i] represents | How to interpret |
|-------------|---------------------|------------------|
| Binary | Probability outcome i occurs | "The market thinks there's a 63% chance of Yes" |
| Multi | Probability outcome i wins | "Candidate A has a 42% chance of winning" |
| Continuous | Probability the realized value falls in bin i | "There's an 18% chance the value lands in [45, 50)" |

For **continuous markets**, the per-bin probability is analogous to a discretized PDF. To get the probability of a range [a, b], sum the probabilities of all bins overlapping that range.

---

## 6. Price Dynamics Under Trading

### Buy: increases target price, decreases others

```
Buy outcome i:
  1. Deposit collateral → mint complete sets (all reserves increase)
  2. total_minted increases by effective_collateral
  3. Remove tokens of outcome i from reserves (reserves[i] decreases)
  4. x[i] grows → p[i] increases
  5. k grows → all other p[j] = x[j]²/k² decrease (denominator grew, numerators unchanged)
```

### Sell: decreases target price, increases others

```
Sell outcome i:
  1. Return tokens → reserves[i] increases → x[i] shrinks
  2. k_new = isqrt(Σ x[j]²) < total_minted
  3. collateral_out = total_minted - k_new returned to trader
  4. All reserves decrease by collateral_out
  5. total_minted decreases to k_new
  6. p[i] = x[i]²/k² decreases, others increase
```

### LP operations: NO price change

Adding or removing liquidity scales ALL reserves proportionally:
```
reserves[i]_new = reserves[i] × (total_minted ± deposit) / total_minted
```

Since `x[i] = total_minted - reserves[i]` also scales proportionally, and `k` scales by the same factor, all ratios `x[i]²/k²` remain unchanged. **LP operations change pool depth, not prices.**

---

## 7. Comparison with Gnosis Conditional Tokens

| Aspect | DekantPM (L2-norm) | Gnosis (LMSR) |
|--------|-------------------|---------------|
| **Formula** | `p[i] = x[i]²/k²` | `p[i] = e^(q[i]/b) / Σ e^(q[j]/b)` |
| **Sum = 1?** | Yes (by L2-norm invariant) | Yes (by softmax) |
| **Price range** | [0, 1] — can reach exact endpoints | (0, 1) — asymptotically approaches but never reaches |
| **Cost near extremes** | Quadratic — moderate cost | Exponential — very expensive |
| **Bounded loss for MM?** | Yes — LP loss bounded by `total_minted` | Yes — market maker loss bounded by `b × ln(N)` |
| **Market types** | Binary, multi, continuous (same math) | Typically binary/multi (continuous via combinatorial) |
| **Rounding sum** | `1 ± N/SCALE` (integer arithmetic) | Exact in floating-point, ~1.00-1.02 in practice with fixed-point |
| **Implementation** | Integer-only (u128 + isqrt) | Requires exp/log (harder on-chain) |

**Why L2-norm was chosen over LMSR for Solana:** The L2-norm invariant requires only addition, multiplication, and integer square root — all cheap on-chain operations. LMSR requires exponentiation and logarithm, which are expensive to implement in integer arithmetic on Solana's BPF VM. The tradeoff is that L2-norm has cheaper extreme-price movements, which is arguably better for prediction markets where strong convictions should be expressible without extreme cost.

---

## Summary

- **All three market types** (binary, multi, continuous) use the **identical** pricing formula: `p[i] = x[i]² / k²`
- **Individual prices** range from **0 to 1** (inclusive on both ends, unlike Gnosis which excludes endpoints)
- **Prices always sum to exactly 1** (within integer rounding of ±N/10^9)
- The **invariant** `Σ x[i]² = total_minted²` is what guarantees the sum property
- **Initial prices** are always **uniform**: `1/N` per outcome
- Trading changes prices while maintaining the sum = 1 constraint
- LP operations change pool depth without affecting prices
