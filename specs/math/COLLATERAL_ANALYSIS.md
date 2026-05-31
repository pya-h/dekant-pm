# Collateral Token Selection in Prediction Markets

> **Scope (2026-05-31):** Stablecoin-collateral analysis. Settlement, payout, and probability formulas described here mirror the current model (linear probability display + opt-in smooth-kernel settlement). For the full math reference see [`MATH_ANALYSIS.md`](./MATH_ANALYSIS.md) or the interactive notebook [`MATH_ANALYSIS_INTERACTIVE.html`](./MATH_ANALYSIS_INTERACTIVE.html).

## The Core Question

Should prediction markets restrict collateral to stablecoins, or allow any SPL token?

**Short answer:** Stablecoins are strongly preferred and practically required for markets that aim to produce meaningful probability signals. Volatile collateral introduces fundamental distortions that undermine the core purpose of a prediction market. This is not merely a convention — it is grounded in mechanism design theory, and every major prediction market platform enforces it.

---

## Why Stablecoins Are Necessary

### 1. Prediction Markets Are Probability Machines

A prediction market's purpose is to aggregate information into prices that reflect the true probability of an event. For the price of an outcome share to be interpretable as a probability, **the value of the underlying collateral must remain constant** (or near-constant) between the time of trade and the time of settlement.

If 1 share of "YES" costs 0.60 USDC, that means the market estimates a 60% probability. If instead 1 share costs 0.60 SOL, the trader must consider:
- "Is the event 60% likely?" AND
- "What will SOL be worth when this market resolves?"

These two considerations become entangled, and the resulting price no longer cleanly represents a probability. This is called the **numeraire problem**.

> **Hanson (2003, 2007)**: The Logarithmic Market Scoring Rule (LMSR) and its derivatives assume a stable unit of account. The theoretical guarantees about truthful information revelation — that traders with private information are incentivized to move prices toward the true probability — hold only when the collateral's value is independent of the event being predicted.
>
> Reference: Hanson, R. (2003). "Combinatorial Information Market Design." *Information Systems Frontiers*, 5(1), 107–119.
> Reference: Hanson, R. (2007). "Logarithmic Market Scoring Rules for Modular Combinatorial Information Aggregation." *Journal of Prediction Markets*, 1(1), 3–15.

### 2. Correlation Risk (The Fatal Problem)

The most dangerous scenario occurs when the collateral token's price is **correlated** with the event being predicted.

**Example:** A market asks "Will Solana TVL exceed $50B by Q4?" denominated in SOL.
- If the answer is YES, Solana's TVL surges → SOL price likely rises too.
- A YES share pays out in SOL, which is now worth more.
- A NO share pays nothing, but the SOL you spent is also worth more (opportunity cost is amplified).
- Traders must now model SOL price × event probability jointly — a much harder problem.
- The resulting market price is **neither** a clean probability **nor** a clean price. It is a convolution of both.

This isn't a theoretical edge case. In crypto prediction markets, *most events of interest* (protocol upgrades, regulatory decisions, ecosystem growth) have some correlation with the prices of the tokens used as collateral. Stablecoins eliminate this correlation by design.

> **Othman & Sandholm (2010)**: Analyzed the impact of budget constraints and numeraire instability on prediction market efficiency. Their results show that when the unit of account fluctuates, the market's ability to aggregate information degrades, and prices can systematically deviate from true probabilities.
>
> Reference: Othman, A. & Sandholm, T. (2010). "Automated Market Makers That Enable New Settings." *Proceedings of the 9th International Conference on Autonomous Agents and Multiagent Systems (AAMAS).*

### 3. Settlement Value Uncertainty

When a market resolves, winning shares pay out collateral. If the collateral is volatile:
- A trader who correctly predicted an outcome might still **lose purchasing power** if the collateral depreciated during the market's lifetime.
- This creates a disincentive to participate in longer-duration markets.
- Rational traders will demand a **risk premium** for bearing collateral volatility, which distorts prices away from true probabilities.

With stablecoins, $1 in = $1 out (approximately). The only variable is whether you predicted correctly. This clean separation is what makes prediction markets useful.

### 4. LP Risk Amplification

Liquidity providers in prediction markets already bear adverse-selection risk (informed traders extract value). Adding collateral volatility on top creates **compounded risk**:
- LP provides 1000 SOL worth of liquidity.
- Informed traders extract value through correct predictions (expected LP loss).
- SOL drops 30% during the market lifetime (additional loss).
- LP's realized loss far exceeds what the prediction market's fee structure was designed to compensate.

This leads to LP withdrawal, thin books, and poor price discovery — defeating the market's purpose.

### 5. AMM Math Assumptions

Our L2-norm AMM (and most prediction market AMMs — LMSR, CPMM, LS-LMSR) compute costs and prices under the assumption that **1 unit of collateral has constant marginal utility**. The cost function:

```
C(q) = b × ln(Σ exp(q_i / b))   // LMSR
||x||² = k²                       // L2-norm (our AMM)
```

These formulas produce prices in collateral units. If collateral value fluctuates, the AMM's loss bound (the maximum subsidy the market maker provides) is no longer denominated in a stable unit, making it impossible to reason about worst-case costs.

---

## What Every Major Platform Does

| Platform | Collateral | Type |
|----------|-----------|------|
| **Polymarket** | USDC | Stablecoin |
| **Kalshi** | USD | Fiat (regulated CFTC exchange) |
| **Augur v2** | DAI | Stablecoin (switched from ETH in v1) |
| **Manifold** | Mana (M$) | Play money (internally pegged) |
| **Gnosis / Omen** | DAI / xDAI | Stablecoin |
| **PredictIt** | USD | Fiat |
| **Metaculus** | Points | Play money (stable unit) |

**Augur's migration is instructive.** Augur v1 used ETH as collateral. This caused exactly the problems described above — prices were hard to interpret, LPs faced amplified risk, and long-duration markets were particularly problematic. Augur v2 explicitly switched to DAI to fix this.

---

## Can Volatile Tokens Ever Work?

In narrow circumstances, with significant caveats:

1. **Very short-duration markets** (hours, not weeks): Collateral volatility over short periods may be small enough to ignore. But even here, a flash crash can distort everything.

2. **Events uncorrelated with the token**: A market on "Will it rain in Tokyo tomorrow?" denominated in SOL has minimal correlation risk. But you still have settlement uncertainty and LP risk.

3. **Hedged participation**: If traders simultaneously hedge their collateral exposure (e.g., short SOL elsewhere), they can isolate the prediction component. But this adds friction, cost, and complexity — reducing participation and thus the market's information aggregation quality.

4. **Meme/entertainment markets**: If the market isn't trying to produce a useful probability signal and is primarily for entertainment (e.g., memecoins betting on meme outcomes), strict numeraire requirements matter less.

None of these are compelling enough to justify volatile collateral as a general-purpose option for a serious prediction market protocol.

---

## Recommendation for DekantPM

### Current State

The program accepts **any SPL token mint** as `collateral_mint` at market creation. There is no on-chain whitelist or restriction. The `MIN_LIQUIDITY` constant (1,000,000 = 1 USDC assuming 6 decimals) implicitly assumes a stablecoin but does not enforce it.

### Recommended Approach

**Enforce stablecoin-only collateral**, either at the program level or the backend/admin level:

#### Option A: On-Chain Whitelist (Strongest)
- Add an `allowed_mints: Vec<Pubkey>` to `ProtocolConfig`.
- Add an admin instruction `add_allowed_mint` / `remove_allowed_mint`.
- `create_market` validates `collateral_mint ∈ allowed_mints`.
- **Pro:** Trustless enforcement. No market can ever use a disallowed mint.
- **Con:** On-chain storage cost, governance overhead for adding new stablecoins.

#### Option B: Backend Validation (Pragmatic)
- Backend's `create_market` endpoint (admin-only) validates the mint against a configured allowlist before submitting the on-chain transaction.
- Frontend's market creation UI only shows allowed mints.
- **Pro:** Simple, no program change needed. Easy to update the list.
- **Con:** Not enforced on-chain — someone calling the program directly could use any mint. However, since market creation requires the Admin role, this is a low-risk gap.

#### Option C: Program-Level Single Mint (Simplest)
- Store a single `collateral_mint` in `ProtocolConfig` (set at `initialize`).
- All markets use this one mint.
- **Pro:** Simplest. No per-market mint ambiguity.
- **Con:** Inflexible. Can't support multiple stablecoins (USDC + USDT) without protocol redeployment.

### Suggested Choice

**Option B** is the pragmatic choice for the current stage. Market creation is already admin-gated (`@Roles('admin')` + on-chain `Admin` role PDA). An admin intentionally choosing a volatile mint would be a governance failure, not a technical one. The backend allowlist catches accidental misuse without requiring a program upgrade.

If the protocol grows to a point where permissionless market creation is considered, **Option A** becomes necessary.

### Specific Mints to Allow

For Solana mainnet:
- **USDC** (Circle): `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **USDT** (Tether): `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

For devnet:
- Use a devnet faucet USDC or a custom mint for testing.

---

## Summary

| Concern | Stablecoin | Volatile Token |
|---------|-----------|---------------|
| Price = probability? | Yes | No (entangled with token price) |
| Correlation risk | None | High (especially in crypto) |
| Settlement clarity | Predictable | Uncertain |
| LP risk | Prediction risk only | Prediction + price risk |
| AMM loss bounds | Stable | Unbounded in real terms |
| Long-duration markets | Viable | Problematic |
| Academic backing | Consistent with theory | Violates assumptions |

**Volatile collateral fundamentally undermines the purpose of a prediction market.** The claim you heard is correct — it is not just a preference, but a requirement for any market that aims to produce useful probability signals.

---

## References

1. Hanson, R. (2003). "Combinatorial Information Market Design." *Information Systems Frontiers*, 5(1), 107–119.
2. Hanson, R. (2007). "Logarithmic Market Scoring Rules for Modular Combinatorial Information Aggregation." *Journal of Prediction Markets*, 1(1), 3–15.
3. Othman, A. & Sandholm, T. (2010). "Automated Market Makers That Enable New Settings." *AAMAS 2010*.
4. Chen, Y. & Pennock, D.M. (2007). "A Utility Framework for Bounded-Loss Market Makers." *UAI 2007*.
5. Augur v2 Whitepaper (2020). Section on DAI denomination rationale. https://augur.net
6. Polymarket Documentation. Collateral: USDC on Polygon. https://docs.polymarket.com
7. Arrow, K.J. et al. (2008). "The Promise of Prediction Markets." *Science*, 320(5878), 877–878.
