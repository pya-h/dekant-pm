# Future Checks

Important items to investigate and verify in future sessions.

---

## 1. Standard Prediction Market Trade Flow vs DekantPM

In standard prediction markets, when a user trades, the collateral the user puts in gets converted to **all** outcome tokens (the count of each outcome depends on the current market state and that outcome's price) and it goes to the liquidity pool, then the user takes the amount of the outcome they want.

**To check:** Compare this with DekantPM's complete-set minting model where collateral mints equal amounts of every outcome token (reserves increase uniformly), and the AMM then drains from the target outcome's reserve to give the trader tokens. Are these economically equivalent, or are there subtle differences in pricing, slippage, or LP exposure?

---

## 2. Gnosis-Style LP Withdrawal on Resolution

In Gnosis, right after a market resolves, all outcomes remaining in the pool (reserves) are transferred to the LP's account, and then the LP can claim rewards just like any normal trader — by redeeming their winning outcome tokens 1:1.

**To check:** Can we adopt this model for DekantPM? Instead of the current approach (LP withdraws `reserves[winning]` proportionally via `compute_lp_resolved_payout`), LPs would receive their proportional share of **all** reserve tokens and then claim the winning ones through the normal `claim_payout` path. This could simplify the resolution logic and unify the trader/LP claim experience.
