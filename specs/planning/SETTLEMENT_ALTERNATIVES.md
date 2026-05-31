# Alternative Settlement Approaches for Continuous Prediction Markets

> Comparison of settlement/resolution strategies for DekantPM's discretized
> continuous markets (N bins, L2-norm AMM). Evaluates the smooth triangular
> kernel (now shipped) against alternatives from academia and industry.
>
> **Status (2026-05-31):** The triangular kernel **shipped** in Phases 2–6 of the
> smooth-kernel refactor and is the active resolution mode for any continuous
> market created with `kernel_width > 0`. The alternatives below are preserved
> for design-history and future-reference value.

---

## Context

DekantPM discretizes continuous outcomes into N bins (2-256) on an L2-norm AMM.
Current resolution is Winner-Take-All (WTA): only the winning bin pays 1:1,
all others pay 0. The proposed improvement is a Smooth Triangular Kernel that
distributes partial payouts to adjacent bins.

**Goal:** Reward traders who are approximately correct, without breaking solvency
or the complete-set minting model.

---

## 1. Winner-Take-All (Current)

```
Payout(i) = 1 if i == win, else 0
```

| Property | Value |
|---|---|
| Solvency | Automatic (x_win <= k) |
| Payout independence | Yes |
| Near-miss reward | None |
| On-chain cost | O(1) per claim |
| Incentive alignment | Pure accuracy (correct bin or nothing) |

**Used by:** Polymarket (per bracket), Kalshi (per bracket)

---

## 2. Triangular Kernel (Proposed)

```
K(i) = max(0, 1 - |i - win| / (W + 1))
```

| Property | Value |
|---|---|
| Solvency | Via scaling factor s = min(1, k/total_claims) |
| Payout independence | No (coordination externality) |
| Near-miss reward | Linear decay over W bins |
| On-chain cost | O(N) per claim (iterate all bins) |
| Max overclaim (W=3) | ~65.8% |
| Shape | Piecewise linear, kink at win |

**Strengths:**
- Compact support (no payout beyond W bins)
- Simple fixed-point arithmetic (no exp/log)
- W=0 degrades to WTA
- Per-market configurable

**Weaknesses:**
- Kink at winning bin (derivative discontinuity)
- Not a proper scoring rule
- Linear decay is arbitrary (why not quadratic? exponential?)

**Used by:** No deployed platform (novel approach)

---

## 3. Epanechnikov (Parabolic) Kernel

```
K(i) = max(0, 1 - (|i - win| / (W + 1))^2)
```

For W=3, winning bin at 5:

| Bin | 2 | 3 | 4 | 5 (win) | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|
| Triangular | 0.25 | 0.50 | 0.75 | 1.00 | 0.75 | 0.50 | 0.25 |
| Epanechnikov | 0.44 | 0.75 | 0.94 | 1.00 | 0.94 | 0.75 | 0.44 |

| Property | Value |
|---|---|
| Solvency | Via scaling factor (same mechanism) |
| Near-miss reward | Quadratic decay (smoother than triangular) |
| On-chain cost | O(N) per claim (one extra multiply per bin) |
| Max overclaim (W=3) | ~87% (||K|| = sqrt(5.3036) ~ 1.873) |
| Shape | Smooth parabola, no kink at win |

**Strengths:**
- Optimal kernel in MSE sense among compact-support kernels
- Smoother transition than triangular (no kink at win)
- Same on-chain cost (one additional multiplication)
- Same W=0 degrades to WTA

**Weaknesses:**
- Higher overclaim potential (more generous to adjacent bins)
- Slightly more complex solvency pressure

**Comparison to Triangular:**
- Mathematically more principled (optimal bias-variance trade-off)
- Rewards near-miss more generously
- Higher scaling factor trigger probability
- Negligible additional implementation cost

---

## 4. Gaussian Kernel

```
K(i) = exp(-(i - win)^2 / (2 * sigma^2))
```

| Property | Value |
|---|---|
| Solvency | Via scaling factor |
| Near-miss reward | Exponential decay |
| On-chain cost | O(N) per claim + exp() computation |
| Support | Infinite (requires truncation) |
| Shape | Smooth bell curve |

**Strengths:**
- Most natural for a platform using Gaussian distribution trading
- Smoothest possible transition
- Well-understood statistical properties

**Weaknesses:**
- Infinite support means every bin gets nonzero payout (or needs explicit cutoff)
- exp() is expensive on-chain (though DekantPM already has a lookup table)
- Overclaim potential is theoretically unbounded without truncation
- sigma parameter adds another knob to configure (on top of bin width)

**Verdict:** More theoretically natural but the implementation cost and infinite
support issue make it less practical than triangular/Epanechnikov for on-chain use.

---

## 5. Two-Endpoint Linear Interpolation (Augur/Gnosis Style)

```
Payout_long  = (outcome - lower) / (upper - lower)
Payout_short = 1 - Payout_long
```

| Property | Value |
|---|---|
| Solvency | Automatic (long + short = 1 always) |
| Payout independence | Yes |
| Near-miss reward | Proportional to proximity |
| On-chain cost | O(1) |
| Outcomes | 2 (Long/Short only) |

**Used by:** Augur v1/v2, Gnosis CTF, Zeitgeist

**Strengths:**
- Simplest smooth resolution — trivially solvent
- No scaling factor needed
- No coordination externality
- Battle-tested (deployed on Augur, Gnosis)

**Weaknesses:**
- Only works with 2 outcome slots (Long/Short)
- Cannot support N-bin discretization or distribution trading
- Loses the rich multi-bin position structure that makes DekantPM unique
- Cannot express multimodal or complex distribution beliefs

**Verdict:** Incompatible with DekantPM's N-bin architecture. Would require
abandoning the discretized model entirely. The "right" approach for simple
scalar markets but not for DekantPM's distribution-trading model.

---

## 6. CRPS (Continuous Ranked Probability Score)

```
CRPS(F, x) = integral [F(y) - 1(y >= x)]^2 dy
```

Each trader's bin holdings define an empirical CDF. CRPS measures how close
that CDF is to the realized outcome. Lower CRPS = better prediction.

| Property | Value |
|---|---|
| Scoring rule | Proper (incentive-compatible) |
| Near-miss reward | Yes (rewards full distribution shape) |
| On-chain cost | O(N) per claim |
| Solvency | Requires separate collateral model |

**Strengths:**
- Proper scoring rule: truthful reporting is the dominant strategy
- Rewards calibrated probability estimates, not just point predictions
- Well-studied in forecasting literature

**Weaknesses:**
- Fundamentally incompatible with 1:1 fixed-payout model
- Payout is not a function of token holdings * kernel — it depends on the
  *shape* of the trader's distribution relative to the outcome
- Requires a separate budget/subsidy model (market maker pays for information)
- Would require complete redesign of the settlement system
- No DeFi implementation exists

**Verdict:** Theoretically superior for information aggregation but
impractical without a complete protocol redesign. The 1:1 complete-set
model cannot accommodate CRPS payouts.

---

## 7. Logarithmic Scoring / LMSR-Based Resolution

```
Payout proportional to log(p_assigned_to_winner)
```

| Property | Value |
|---|---|
| Scoring rule | Proper (strictly) |
| Near-miss reward | Via probability assignment |
| Solvency | Bounded market maker loss (= b * ln(N)) |

**Used by:** Underlying LMSR AMMs (Augur v1, academic implementations)

**Strengths:**
- Proper scoring rule
- Well-studied, strong theoretical foundations
- Market maker loss is bounded and known in advance

**Weaknesses:**
- DekantPM uses L2-norm, not LMSR. Switching AMM invariant is a full rewrite.
- Marginal prices in LMSR naturally sum to 1 (unlike L2-norm)
- Different LP economics (guaranteed bounded loss vs. DekantPM's model)

**Verdict:** Would require switching the entire AMM, not just the resolution.
Not a practical alternative for a settlement-only change.

---

## 8. Parimutuel / Pool-Based Redistribution

```
Payout(i) = stake(i) * total_pool / total_stake_in_kernel
```

All collateral is redistributed to kernel-weighted winners. No fixed 1:1 payout.

| Property | Value |
|---|---|
| Solvency | Automatic (redistribute fixed pool) |
| Payout independence | No (depends on others' stakes) |
| Near-miss reward | Yes (via kernel weighting) |

**Strengths:**
- Always exactly solvent (no scaling factor needed)
- No overclaim problem
- Well-understood from horse racing / sports betting

**Weaknesses:**
- Breaks the 1:1 fixed-payout model entirely
- Payout per token depends on total pool and distribution of bets
- Token price has no clean interpretation as probability
- Not compatible with AMM-based pricing

**Verdict:** Incompatible with the AMM model and fixed-payout invariant.

---

## 9. Paradigm Distribution Markets (Continuous Limit)

```
Payout = f(v) where f: R -> R+ is the trader's outcome function
Invariant: ||f||_2 = k, Constraint: max(f) <= b
```

| Property | Value |
|---|---|
| Solvency | Via backing constraint max(f) <= b |
| Near-miss reward | Natural (f is continuous) |
| Resolution | Smooth by construction |
| On-chain cost | O(1) for Gaussian-specialized trades |

**Strengths:**
- Theoretically the most elegant solution
- Natural L2-norm generalization (DekantPM's invariant in the limit)
- No discretization artifacts
- Naturally smooth payout

**Weaknesses:**
- Requires solving max-loss collateral (numerical optimization, no closed form)
- Backing constraint max(f) <= b is separate from L2-norm
- Minimum spread sigma required for solvency
- No deployed implementation exists
- DekantPM deliberately chose discretization to avoid these complexities

**Verdict:** The "correct" theoretical end-state but impractical for current
on-chain constraints. DekantPM's discretized approach with smooth kernel is a
pragmatic approximation that converges to Distribution Markets as N -> infinity.

---

## 10. Cboe Payout Zones (Emerging, 2026)

Cboe announced a "partial payout framework" for prediction contracts with
three states: $0, partial payout within a "payout zone," or full $100.
Details are scarce but it validates commercial interest in smooth resolution.

**Verdict:** Validates the direction. Details pending.

---

## Comparison Matrix

| Approach | Solvency | Near-miss | Independence | On-chain | Compatible? | Deployed? |
|---|---|---|---|---|---|---|
| WTA (current) | Auto | No | Yes | O(1) | Yes | Yes |
| **Triangular kernel** | Scaling | Linear | No | O(N) | **Yes** | No |
| **Epanechnikov kernel** | Scaling | Quadratic | No | O(N) | **Yes** | No |
| Gaussian kernel | Scaling | Exponential | No | O(N) | Yes | No |
| Two-endpoint linear | Auto | Linear | Yes | O(1) | No (2 slots) | Yes |
| CRPS | Redesign | Full dist | N/A | O(N) | No | No |
| LMSR | Bounded | Via prob | N/A | O(N) | No (wrong AMM) | Yes |
| Parimutuel | Auto | Via kernel | No | O(N) | No (no 1:1) | Yes |
| Paradigm | Backing | Natural | Yes | O(1) | No (too complex) | No |

---

## Recommendation

**Triangular kernel is the right pragmatic choice** for DekantPM's constraints:

1. Compatible with existing L2-norm AMM and complete-set model
2. Simple on-chain arithmetic (no exp/log)
3. Compact support (bounded kernel width)
4. Backward-compatible (W=0 = WTA)
5. Per-market configurable

**If seeking a marginal improvement:** The Epanechnikov (parabolic) kernel
(`1 - d^2` instead of `1 - d`) provides smoother transitions at essentially
zero additional cost. It is the optimal compact-support kernel in terms of
mean squared error. The trade-off is slightly higher overclaim potential
(~87% vs ~66% for W=3), meaning the scaling factor triggers more often.

**Approaches that are NOT worth pursuing:**
- CRPS/Brier/Log scoring: Incompatible with the 1:1 fixed-payout model
- Two-endpoint linear: Loses the N-bin distribution trading feature
- Paradigm continuous: Too complex for current on-chain constraints
- Parimutuel: Breaks the AMM pricing model

---

## References

1. Hanson, R. (2003/2007). "Logarithmic Market Scoring Rules." *J. Prediction Markets*
2. White, D. (2024). "Distribution Markets." Paradigm Research
3. Dudik, M. et al. (2021). "Log-time Prediction Markets for Interval Securities." arXiv:2102.07308
4. Nueve (2025). "Smooth Quadratic Prediction Markets." arXiv:2505.02959 (NeurIPS 2025)
5. Gnosis Conditional Token Framework. Developer Guide
6. Augur Whitepaper. "Decentralized Oracle and Prediction Market Platform"
7. Cboe (2026). "Prediction Markets Framework" Press Release
8. Epanechnikov, V.A. (1969). "Non-parametric estimation of a multidimensional probability density." *Theory Probab. Appl.*
