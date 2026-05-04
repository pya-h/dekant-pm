# DekantPM Parameter Reference

This document lists all computed parameters displayed across the application, explains what they mean, and how they are calculated in code.

---

## 1. Portfolio Page

### 1.1 Header Stats

#### Portfolio Value
- **Location:** Portfolio page header (top right)
- **Description:** The total mark-to-market value of all positions in active (ongoing) markets. Represents what the user would receive if they could sell all active positions at current market prices.
- **Calculation:** For each position in markets with state `Active` or `Paused` (not expired, not resolved): `sum(holdings[i] * probability[i])` for all bins. Probabilities are computed from current market reserves using L2-norm AMM formula.
- **Excludes:** Positions in expired markets (deadline passed but not resolved) and resolved markets.
- **Code:** `computePortfolioValue()` in `frontend/lib/portfolio-utils.ts`
- **Unit:** USDC (raw base units, divided by 10^6 for display)

#### Active Positions
- **Location:** Portfolio page header (top right)
- **Description:** Count of positions whose outcome has not yet been decided. Includes both ongoing markets and expired-but-not-resolved markets.
- **Calculation:** `count(open positions) + count(expired positions)`
- **Code:** `computeActivePositionCount()` in `frontend/lib/portfolio-utils.ts`

#### Win Rate
- **Location:** Portfolio page header (top right)
- **Description:** Percentage of settled (resolved) positions where the user made a profit.
- **Calculation:** A position counts as "won" if the resolved payout exceeds the user's net cost. `winRate = wonPositions / totalSettledPositions`. Only considers markets that are `Resolved`.
- **Won condition:** `resolvedPayout > (totalDeposited - totalWithdrawn)`
- **Code:** `computeWinRate()` in `frontend/lib/portfolio-utils.ts`

### 1.2 Position Row Fields

#### Market Title
- **Source:** `market.title`

#### Settlement Date
- **Description:** The market deadline date, displayed as the expected settlement date.
- **Source:** `market.deadline` (ISO 8601 string)

#### Position Range
- **Description:** For continuous markets, shows the value range covered by the user's position (non-zero holdings).
- **Calculation:** Finds the first and last bin indices with non-zero holdings, converts to real-world values using `rangeMin`, `rangeMax`, and `numOutcomes`.
- **Code:** `getPositionRange()` in `frontend/lib/portfolio-utils.ts`

#### Cost
- **Description:** Total amount the user deposited to acquire this position.
- **Source:** `position.totalDeposited` (raw USDC base units)

#### Current Value
- **Description:** Mark-to-market value of the position at current market prices.
- **Calculation:** Same as position value in Portfolio Value, but for a single position. For resolved markets, equals the value of winning tokens.
- **Code:** `computeCurrentValue()` in `frontend/lib/portfolio-utils.ts`

#### Win Probability
- **Description:** Probability that the position will produce a positive return based on current market state.
- **Calculation:** Sum of probabilities for bins where `holdings[i] > netCost`. Represents the market's current estimate of the position being profitable.
- **Code:** `computePositionWinProb()` in `frontend/lib/portfolio-utils.ts`

#### PnL (Profit and Loss)
- **Description:** Unrealized profit or loss on the position.
- **Calculation:** `pnl = currentValue - totalDeposited + totalWithdrawn`
- **PnL %:** `pnlPct = (pnl / totalDeposited) * 100`
- **Code:** `computePnl()` in `frontend/lib/portfolio-utils.ts`

#### Status Badge
- **States:**
  - `Open` (green) - Market is active and trading
  - `Expired` (amber) - Market deadline passed but not yet resolved by oracle
  - `resolved` (gray) - Market has been resolved by oracle

### 1.3 Risk Summary Sidebar

#### Total at Risk
- **Description:** Total amount of money the user has committed to undecided positions.
- **Calculation:** `sum(max(0, totalDeposited - totalWithdrawn))` for all open + expired positions.
- **Code:** `computeTotalAtRisk()` in `frontend/lib/portfolio-utils.ts`

#### Max Potential Gain
- **Description:** Best-case scenario payout across all undecided positions. For each position, assumes the market resolves at the bin where the user holds the most tokens.
- **Calculation:** `sum(max(holdings[0..n]))` for all open + expired positions.
- **Code:** `computeMaxPotentialGain()` in `frontend/lib/portfolio-utils.ts`

#### Max Potential Loss
- **Description:** Worst-case scenario loss. Assumes all positions become worthless (market resolves at a bin where user holds nothing).
- **Calculation:** `sum(max(0, totalDeposited - totalWithdrawn))` for all open + expired positions. Equals Total at Risk in most cases.
- **Note:** Positions with very wide certainty ranges (holdings in every bin) would have a non-zero minimum payout, but this edge case is not computed — the simpler formula is used.
- **Code:** `computeMaxPotentialLoss()` in `frontend/lib/portfolio-utils.ts`

#### Overlapping Positions
- **Description:** Number of position pairs that have correlated risk due to overlapping price ranges.
- **Calculation:** Counts pairs where either: (a) two positions are in the same market, or (b) two continuous market positions have overlapping value ranges.
- **Code:** `computeOverlappingPositions()` in `frontend/lib/portfolio-utils.ts`

#### Avg Win Probability
- **Description:** Average probability of profit across all undecided positions, based on current market consensus.
- **Calculation:** For each undecided position, compute win probability (sum of probabilities for profitable bins). Average across all positions. Positions already in profit (net cost <= 0) count as 100%.
- **Code:** `computeAvgWinProbability()` in `frontend/lib/portfolio-utils.ts`

### 1.4 Portfolio Tabs

#### All
- **Description:** All positions with non-zero holdings.

#### Open
- **Description:** Positions in markets that are Active or Paused and have not passed their deadline.

#### Settled
- **Description:** Positions in markets that have been resolved by the oracle (`state === Resolved`).

#### Expired
- **Description:** Positions in markets that have passed their deadline but have NOT been resolved yet. These are awaiting oracle resolution.

---

## 2. Market Detail Page

### 2.1 Market Header Stats

#### Distribution Peak
- **Description:** The most likely value based on current market probabilities.
- **Source:** Computed from oracle/AMM data via `useOracleData` hook.
- **Code:** `MarketStatsBar` in `frontend/components/market/market-stats-bar.tsx`

#### Most Likely Range
- **Description:** The range of values with highest probability density.
- **Source:** Oracle data.

#### 95% Confidence
- **Description:** The range within which the resolved value is expected to fall with 95% probability.
- **Source:** Oracle data.

#### Liquidity
- **Description:** Total reserves in the AMM pool.
- **Calculation:** `sum(reserves[0..n])`
- **Unit:** USDC

#### Volume (24h)
- **Description:** Total trading volume.
- **Source:** `market.totalVolume`
- **Unit:** USDC

#### $TOKEN Price (live)
- **Description:** Current estimated live price of the underlying asset.
- **Calculation:** Uses distribution peak if available from oracle data; otherwise falls back to midpoint estimate.

### 2.2 Trading Panel

#### Trade Fee
- **Description:** Protocol fee charged on the trade.
- **Source:** AMM estimation API response (`estimate.fee`)
- **Unit:** USDC (raw base units)

#### Shares Received (Buy)
- **Description:** Number of outcome tokens the user receives for their collateral.
- **Source:** `estimate.tokensOut` from `/amm/estimate-buy`

#### Peak Payout (Distribution Buy)
- **Description:** Maximum payout across all bins in a distribution trade. The payout if the market resolves at the position's peak.
- **Calculation:** `max(tokensPerBin[0..n])` from distribution buy estimate.

#### Max Payout (Discrete Buy)
- **Description:** Maximum possible payout for a discrete (single-outcome) buy.
- **Equals:** `tokensOut` (each token pays 1:1 if winning)

#### USDC Received (Sell)
- **Description:** Collateral returned to the user when selling tokens.
- **Source:** `estimate.collateralOut` from `/amm/estimate-sell`

#### Estimated Cost (Buy-to-Price)
- **Description:** Collateral needed to move a specific outcome's probability to a target level.
- **Source:** `estimate.collateralNeeded` from `/amm/estimate-buy-to-price`

#### Shares to Sell (Sell-to-Price)
- **Description:** Number of tokens that must be sold to move probability to a target level.
- **Source:** `estimate.tokensToSell` from `/amm/estimate-sell-to-price`

### 2.3 Market Info Section

#### Market Context
- **Source:** `market.description`

#### Timeline Stages
- **Market Created** - `market.createdAt`
- **Trading Active** - Active when market state is Active and not past deadline
- **Deadline Reached** - `market.deadline`
- **Resolution** - `market.resolvedAt` (if resolved)
- **Payout & Claims** - Active when market is resolved

### 2.4 Recent Trades Panel

#### Direction
- **Description:** For continuous markets, shows the peak (mu) of the trader's distribution. For discrete markets, shows the outcome index.
- **Source:** `trade.mu` (continuous) or `trade.outcomeIndex` (discrete)

#### Amount
- **Description:** Collateral paid (buy) or received (sell).
- **Source:** `trade.collateralAmount`
- **Unit:** USDC

#### Time
- **Source:** `trade.timestamp`
- **Format:** HH:MM (24h)

---

## 3. Common Calculations

### Probability Computation (L2-Norm AMM)
- **Formula:** For each outcome i: `probability[i] = (totalMinted - reserves[i])^2 / kSquared`
- **Constants:** `SCALE = 10^9`, `USDC_DECIMALS = 6`
- **Code:** `computeProbabilities()` in `frontend/lib/types.ts`

### USDC Formatting
- Raw values are in base units (multiply by 10^USDC_DECIMALS)
- Display: `$X.XX` for < $1K, `$X.XXK` for < $1M, `$X.XM` for >= $1M
