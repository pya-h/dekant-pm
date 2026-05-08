# Dekant — Conviction Market Documentation

> A prediction market on Solana where you don't pick a side — you draw a curve.

---

## Overview

### Welcome

A bet on Dekant is a Gaussian curve over a number-line outcome. The peak is what you think the answer is; the width is how sure you are.

Most prediction markets give you two boxes: Yes or No. Real beliefs don't fit.

A doctor doesn't say "this patient will recover." She says "70 to 90 percent chance of recovery, depending on response to treatment." A trader doesn't say "ETH goes up." He says "probably $3,600–$4,200 by month-end, with a tilt toward $3,800."

Dekant lets you trade exactly that way. Set a center (where you think the answer lands) and a conviction (how sure you are), and the market routes your stake across a continuous range of outcomes weighted by a Gaussian curve.

#### Why This Exists

Traditional prediction markets fragment one question into many. To ask "What will SOL be on July 1?" on a binary platform, you'd need 35+ separate Yes/No markets — one per price bracket. Each one has its own liquidity pool, its own orderbook, and its own spread. The result: thin books, wide spreads, and a distorted picture of collective belief.

Dekant collapses all of those into one market. One liquidity pool. One curve. Full belief resolution.

#### Why People Should Use This

- **Express full beliefs, not binary guesses.** Your prediction is a probability distribution, not a coin flip.
- **Better capital efficiency.** One pool serves the entire outcome space. No liquidity fragmentation.
- **Get paid by closeness.** You don't need to be exactly right. The closer the outcome lands to your peak, the more you earn.
- **Transparent, on-chain settlement.** No custodian, no counterparty risk. The Solana program is the source of truth.
- **Sub-second finality.** Solana's ~400ms confirmations make trading feel like a centralized exchange.

#### Three Core Innovations

1. **Conviction Markets** — One market with up to 256 bins covers an entire numeric range. No fragmentation.
2. **L2-Norm CFAMM** — A constant-function AMM with invariant `Sum(x[i]^2) = k^2`. No order book. Instant liquidity. Mathematically guaranteed pricing.
3. **Built on Solana** — Cheap, fast settlement. Fixed-point math (u64/u128) fits within Solana compute budgets. Trades cost fractions of a cent.

---

### How It Works

Two moves and your full belief is on-chain. Here's the flow.

#### Step 1: Pick a Market

Browse open markets. Each one asks a numerical question with a deadline:

- *What will SOL be on July 1, 2026?*
- *What share of the popular vote will candidate X receive?*
- *What will the highest GPT-5 score be on the new benchmark?*

Markets come in three shapes: binary (Yes/No), multi-outcome (categorical), and conviction (continuous range). Conviction markets are the differentiator — the others exist for completeness.

#### Step 2: Draw Your Belief

For a conviction market, you set two numbers and the UI does the rest:

| Parameter | What it means | Effect |
|-----------|---------------|--------|
| **Center** (mu) | Where you think the answer lands | Shifts the peak of your curve along the x-axis |
| **Conviction** (sigma) | How sure you are | Narrow sigma = sharp peak; wide sigma = flat blanket |

Your stake is then split across the range, with more going into bins near your peak and less into the tails. Sharp belief = high reward in a small window. Hedged belief = lower reward but covers more ground.

#### Step 3: Get Paid by Closeness

When the deadline passes, an oracle resolves the market with the actual answer. That answer lands in exactly one bin, and the tokens you hold for that bin redeem for collateral.

Because your stake was distributed across many bins, you get something whenever the answer lands anywhere on your curve. The closer the answer lands to your peak, the more you earn. The further out, the less.

That's the full mental model.

---

### How This Is Different

#### vs. Polymarket / Kalshi (Binary-Only Platforms)

| | Binary Platforms | Dekant |
|---|---|---|
| **Question type** | "Will X happen?" (Yes/No) | "What will X be?" (numeric range) |
| **Belief expression** | Pick a side | Draw a distribution |
| **For numeric questions** | 35+ separate bracket markets | 1 unified market |
| **Liquidity** | Fragmented across brackets | Concentrated in one pool |
| **Payout model** | All-or-nothing per bracket | Proportional to closeness |
| **UX complexity** | Simple but limiting | Richer but still two-input |

#### vs. Metaculus / Good Judgment (Reputation Markets)

| | Reputation Platforms | Dekant |
|---|---|---|
| **Skin in the game** | Points only | Real capital (USDC) |
| **Incentive strength** | Weak (bragging rights) | Strong (financial reward) |
| **Information discovery** | Moderate | High (capital-weighted signals) |
| **Manipulation resistance** | Low (no cost to lie) | High (lying costs money) |

#### vs. Traditional DeFi Prediction (Drift Bet, Hedgehog)

| | DeFi Prediction Markets | Dekant |
|---|---|---|
| **Market shape** | Binary discrete | Continuous distribution |
| **AMM type** | Product invariant or CLOB | L2-norm CFAMM |
| **Distribution trading** | Not supported | Native (Gaussian curve input) |
| **Capital efficiency** | Low for numeric questions | High (single pool) |

#### What Makes It Unique

1. **Distribution-native trading.** No other on-chain market lets you trade a probability distribution as a first-class primitive.
2. **Mathematically rigorous pricing.** The L2-norm invariant guarantees probabilities sum to 1 and prices respond smoothly to volume.
3. **Closeness-based payoff.** Binary markets are brutal: wrong by $1 and you lose everything. Dekant rewards proportional accuracy.
4. **One-pool efficiency.** Where competitors need N separate markets for N brackets, Dekant uses one. Same question, same liquidity, better prices.
5. **Solana-native performance.** All math runs on-chain in fixed-point arithmetic within Solana's compute budget. No L2 bridge delays, no gas spikes.

---

## Trading

### Market Types

Dekant supports three kinds of markets. The first two are familiar from existing platforms; the third is the differentiator.

#### Binary

Two outcomes: Yes or No. Used for crisp factual questions.

> "Will the FOMC cut rates by 50 bps at the next meeting?"

Trading is straightforward: buy Yes or buy No. At resolution, the winning side redeems for $1 per token. Same shape as any binary prediction market.

#### Multi-Outcome

Three to thirty-two discrete outcomes. Used when the question has a small fixed set of possibilities.

> "Which studio wins Best Picture this year?" — A24 / Searchlight / Universal / Warner / Other

Buy tokens for one outcome at a time. At resolution, the winning outcome's tokens redeem for $1 each; the rest go to zero.

#### Conviction (Continuous)

Two to two-hundred-fifty-six bins covering a numerical range. Used when the answer is a number on a line.

> "What will SOL be on July 1, 2026?" Range: $50 to $500, divided into 64 bins of ~$7 each.

Two ways to trade:

1. **Bin-by-bin** — buy a single bin, like betting on one slot.
2. **Distribution buy** — set a center (mu) and conviction (sigma), and your stake is allocated across all bins weighted by the Normal PDF.

Almost all conviction market trading uses distribution buys. That's the "draw a curve" flow Dekant is built around.

#### Comparison

| | Binary | Multi-Outcome | Conviction |
|---|---|---|---|
| **Outcomes** | 2 | 3-32 | 2-256 bins |
| **Trading style** | Discrete buy/sell | Discrete buy/sell | Distribution buy/sell |
| **Best for** | Crisp factual questions | Categorical choices | Numerical questions |
| **Settlement** | Winning side pays $1/token | Winning outcome pays $1/token | Outcome lands in one bin; that bin pays $1/token |

For most crypto, election-margin, and benchmark-score questions, **conviction** is the natural shape.

---

### Drawing Your Curve

A conviction bet on Dekant is fully described by two numbers. That's the whole user interface.

#### Center (mu)

The point estimate. Where on the number line you think the answer will land.

If the market asks "What will SOL be on July 1?" and you think the answer is $186, your center is $186. The peak of your curve sits exactly there.

There's no rule that says your center has to be a bin boundary. Whatever number you pick, the system computes how much of your stake belongs in each bin based on the Gaussian PDF evaluated over that bin's interval.

#### Conviction (sigma)

The width of your curve. Smaller sigma means a sharper peak; larger sigma means a flatter, broader bet.

| Label | Sigma | Shape | Posture |
|-------|-------|-------|---------|
| Sharp | < 18 | Narrow spike | "I'm pretty sure" |
| Focused | 18-35 | Tight bell | "Probably here, give or take" |
| Wide | 36-59 | Broad bell | "Somewhere in this region" |
| Hedged | >= 60 | Flat blanket | "Spread me across the whole range" |

These labels are nominal. The actual payout shape comes from the math, not the label.

#### The Trade-off

Sharp curves give you **higher peak return per dollar staked** in exchange for a **smaller window of profitability**. Wide curves do the opposite: lower peak return, larger window.

Think of sigma as your "how surprised will I be" knob:

- If you're trading on something you've researched and have a real view on, **go sharp**. Your peak gets the multiplier and the window covers what you actually believe.
- If you only have a vague directional sense, **go wide**. You give up most of the multiplier but make sure you're in the money for a wide range of outcomes.
- If you have no idea, **don't trade this market**.

#### What Gets Shown Before You Submit

Before you confirm a trade, the UI shows:

1. **Stake** — what you're putting in.
2. **Max payout** — the most you can earn if the outcome lands exactly at your peak.
3. **Break-even window** — the range around your center where you'd at least get your stake back.

These are illustrative estimates based on current AMM state. Actual returns depend on other traders' actions between your buy and resolution. Treat the preview as calibration, not a guarantee.

---

### Payouts

Markets resolve through well-defined steps. Here's what happens between "deadline passes" and "your wallet receives USDC."

#### Market Lifecycle

Every market transitions through these states:

```
Create --> Active --> Paused (optional) --> Pending Resolution --> Resolved
```

Key transitions:

- **Active**: Trading is open. Buy and sell freely.
- **Paused**: Trading frozen by admin. Temporary state.
- **Pending Resolution**: Deadline passed. Waiting for oracle to submit the answer.
- **Resolved**: Oracle submitted the outcome. Claims are open.

Deadline enforcement is lazy — the first instruction touching a market post-deadline auto-transitions it to Pending. Only the assigned oracle can call `resolve_market`. Anyone holding winning tokens can claim after resolution.

#### How Winning Is Decided

| Market Type | Winning Condition |
|---|---|
| **Binary** | Side matching resolved outcome (Yes or No) |
| **Multi-outcome** | Single outcome matching oracle's result |
| **Conviction** | Bin whose interval contains the resolved value |

For conviction markets, the resolved value lands in exactly one bin. Tokens in that bin pay $1 each (minus redemption fee). All other bins go to zero.

#### Why Distribution Buys Still Pay Off

When you place a distribution buy, your stake splits across bins weighted by your Gaussian:

- Outcome in your peak bin = most tokens win
- Outcome one bin off = meaningful share still wins
- Outcome in the tail = small fraction wins

Sharper curves concentrate weight near peak (higher reward when right, less forgiving when off). Wider curves spread weight (lower peak reward, but never completely shut out).

#### Payout Formula

```
gross_payout = winning_bin_tokens * $1 * (1 - redemption_fee)
```

Where `winning_bin_tokens` is the number of tokens you accumulated in the resolving bin from your distribution buys.

#### Claiming

After resolution, call `claim_payout` (the UI does this automatically). The protocol burns your winning tokens and transfers USDC to your wallet minus the redemption fee.

No time limit on claims. Forgotten positions don't expire.

---

### Fees

Three fees, all small, all on-chain. Set by the protocol's superadmin and capped at 50%.

#### Fee Table

| Fee | Default | Charged on |
|-----|---------|-----------|
| **Creation fee** | 0.5% (50 bps) | Initial liquidity at market creation |
| **Trade fee** | 0.3% (30 bps) | Every buy or sell |
| **Redemption fee** | 0.5% (50 bps) | Claiming a winning position |
| **LP fee share** | 50% (5000 bps) | Portion of trade fees routed to LPs |

#### How the Trade Fee Splits

Every trade pays 30 bps. Half goes to liquidity providers (rewarding them for warehousing risk); the other half goes to the protocol treasury.

Example: you buy $100 of a position.
- $0.30 in trade fees
- $0.15 to LPs
- $0.15 to the protocol

Same split applies on sells.

#### When the Redemption Fee Hits

When you claim a winning position, the protocol takes 50 bps off the gross redemption. A position worth $100 at resolution returns $99.50 to your wallet.

This fee exists so the protocol earns from successful predictions, not just from churn.

#### Constants

| Constant | Value | What it means |
|----------|-------|---------------|
| `MIN_LIQUIDITY` | 1 USDC | Minimum initial liquidity at market creation |
| `MIN_TRADE_AMOUNT` | 0.001 USDC | Minimum size for any single trade |
| `SCALE` | 10^9 | Fixed-point precision (no floats anywhere on-chain) |
| `MAX_FEE_BPS` | 5000 (50%) | Hard cap on any fee parameter |

---

## The Math (How It Actually Works)

You don't need to derive anything, but understanding the mechanism makes you a better trader. Here's the math at the level that matters.

### The Invariant

Dekant uses an **L2-norm constant-function AMM**. The core rule:

```
Sum(reserves[i]^2) = k^2
```

Every trade must leave this equation true. The AMM adjusts prices and token quantities to maintain it — that's what makes it "constant-function."

This is different from Uniswap's `x * y = k` (product invariant). The L2-norm gives **quadratic price sensitivity**, meaning prices respond proportionally to the *square* of reserve changes. This produces cleaner probability curves than a product AMM.

### Implied Probabilities

From the invariant, the market's implied probability for each bin:

```
probability[i] = (totalMinted - reserves[i])^2 / k^2
```

Where `totalMinted - reserves[i]` represents total tokens sold into that bin. More buying of bin `i` = lower reserves = higher probability.

Probabilities always sum to 1. This is guaranteed by the invariant — not an approximation.

### How a Distribution Buy Works

When you submit (mu, sigma, amount):

1. **Compute weights**: The system evaluates the Normal PDF over each bin's center. Bins near your mu get high weights; tails get low weights. Weights are normalized to sum to 1.

2. **Charge fee**: Trade fee deducted from your collateral.

3. **Mint complete sets**: Your effective collateral mints tokens across all bins uniformly (adding to reserves).

4. **Solve for allocation**: The system solves a quadratic equation to find how many tokens to give you from each bin while maintaining the invariant:

```
lambda = (RW - sqrt(RW^2 - W2 * (R2 - k^2))) / W2
tokens_per_bin[i] = lambda * weight[i]
```

Where:
- `R2 = Sum(reserves[i]^2)` (sum of squares after minting)
- `RW = Sum(reserves[i] * weight[i])` (weighted reserve sum)
- `W2 = Sum(weight[i]^2)` (sum of squared weights)

5. **Distribute**: You receive tokens proportional to your belief distribution. More tokens near your peak, fewer in the tails.

6. **Verify**: Invariant check confirms the AMM is still balanced.

### Position Valuation

Your open position's mark-to-market value:

```
position_value = Sum(holdings[i] * probability[i])
```

This approximates what you'd receive if you could instantly sell everything at current prices. Useful for tracking PnL before resolution.

### Why L2-Norm?

The choice of L2-norm (sum of squares) over other CFAMM invariants is deliberate:

- **Prices are probabilities.** The math directly produces numbers that sum to 1 and behave like probabilities.
- **Smooth response.** Quadratic curvature means no cliff edges — prices move smoothly with volume.
- **Distribution compatibility.** The quadratic solver for weighted allocation has a closed-form solution. No iterative approximation needed on-chain.
- **Research backing.** Based on Paradigm's *Distribution Markets* paper — peer-reviewed mechanism design.

---

## Liquidity

### For Liquidity Providers

Dekant's CFAMM doesn't need an order book; it needs liquidity. LPs deposit collateral, earn a share of trade fees, and can withdraw any time before resolution.

#### The Deal

1. **Deposit USDC** into a market. The protocol scales all reserves up proportionally and mints you LP shares.
2. **Earn 50%** of every trade fee paid into that market for as long as you hold the shares.
3. **Withdraw any time** before the market resolves by burning your LP shares. You get your share of the current reserves plus accumulated fees.

#### What You're Warehousing

Because Dekant uses an L2-norm CFAMM with the invariant `Sum(x[i]^2) = k^2`, your liquidity sits across all outcomes simultaneously. You're not picking sides — you're absorbing whatever direction trades come from.

This means:

- **You earn fees regardless of how the market resolves.** Trade volume, not directional outcome, determines your return.
- **You take on impermanent-loss-like exposure** if the implied probabilities at resolution are very different from when you deposited. The CFAMM smooths this, but the underlying exposure is real.
- **Resolved markets close out cleanly.** If you're still in the pool when the market resolves, your remaining LP shares redeem against the final reserves automatically.

#### When to Add vs. Withdraw

| You should add liquidity when | You should withdraw when |
|---|---|
| Market is active with healthy volume | Market is approaching resolution and you'd rather lock in fees |
| You want passive exposure to trade flow | Implied probabilities have moved sharply against your initial entry |
| You understand the fee/IL trade-off | You need the capital elsewhere |

#### What You Don't Get

- **No vote on resolution.** Oracles are role-gated; LPs are not oracles.
- **No fee changes.** The fee schedule is set by the superadmin and the same for everyone.
- **No directional position.** If you want to bet a specific outcome, that's a trade, not LP.

If you want a directional view *and* fee income, you can hold an LP position and a directional trade independently.

---

## Get Started

### Wallet & USDC

To trade on Dekant you need:

1. **A Solana wallet** — Phantom, Solflare, or Backpack. Any Solana-compatible wallet works.
2. **USDC on Solana** — This is the collateral token for all markets. Mint address: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
3. **A small amount of SOL** — For transaction fees (~0.001 SOL per trade).

#### On Devnet (Current)

Dekant is live on Solana devnet. Use devnet USDC from the in-app faucet or any Solana devnet faucet for SOL.

#### On Mainnet (Coming Soon)

Mainnet access is waitlist-gated. Early signups receive priority access.

---

### Practical Tips

- **Start small.** Use small stakes to learn how the probability curve responds to trades.
- **Use wider sigma when uncertain.** Narrow sigma is for high-conviction plays where you've done the research.
- **Watch the preview.** The break-even window and max payout estimate tell you the risk/reward before you confirm.
- **Think in ranges, not points.** The beauty of conviction markets is that you don't need pinpoint accuracy. Being *close* pays.
- **Monitor fees and slippage.** Larger orders move the curve more. The preview shows estimated price impact.
- **LP if you want passive income.** If you don't have a directional view but want exposure to market activity, provide liquidity.

---

### FAQ

**Is this just Polymarket on Solana?**

No. Polymarket operates with binary markets only. To ask "what will SOL price be?" requires 35+ separate markets with fragmented liquidity. Dekant runs conviction markets: one market, up to 256 bins, full distribution trading.

**What's a "conviction" market?**

A market where the answer exists on a number line. Crypto prices, election margins, GDP growth, AI benchmark scores, sports totals — any quantifiable outcome. You trade by expressing how sure you are (conviction) and where you think the answer lands (center).

**Why "conviction" instead of "continuous"?**

Because the sigma parameter literally represents your conviction level. Sharp sigma = high conviction. Wide sigma = low conviction. The name captures what you're actually doing: expressing the strength of your belief.

**Why Solana?**

Three factors: (1) trades cost fractions of a cent, making small distribution purchases economical; (2) ~400ms confirmation feels like real exchange trading; (3) L2-norm CFAMM math fits within Solana compute budgets.

**Does my whole bet go to zero if I'm wrong?**

Not catastrophically. Distribution buys spread your stake across bins. If the outcome lands anywhere on your curve, you get a partial return. Only if the outcome is completely outside your distribution do you lose everything — and even then, wider curves protect against this.

**What's the difference between a sharp and a wide bet?**

Same stake, different profiles. Sharp: higher peak payout (3-5x returns if perfectly accurate), but narrow profitability window (~$25 margin). Wide: lower peak (1.5-2x), but broad profit range. Choose based on confidence level.

**Can I cancel a bet?**

You can sell your tokens back to the AMM at current implied prices, paying the trade fee. No pure cancellation — the AMM already absorbed your buy. You execute an inverse trade.

**Are LPs taking the other side of my bet?**

No. LPs warehouse all sides simultaneously via the CFAMM invariant. Their returns depend on trade fees and impermanent-loss exposure, not outcome direction.

**What happens if no one resolves my market?**

Markets auto-transition to Pending Resolution after deadline (triggered by next interaction). Oracles have unlimited time to resolve. Claims never expire once resolved.

**What collateral does the protocol use?**

USDC on Solana. Mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.

**Is the code open source?**

Yes. The Solana program (Anchor/Rust), backend indexer (NestJS), and frontend (Next.js) are all in one monorepo.

---

### Architecture (User-Level)

You interact with three layers, but only touch one directly:

| Layer | What it does | You interact with it? |
|-------|-------------|----------------------|
| **Frontend** | Wallet connection, chart controls, order entry, previews, portfolio | Yes — this is the app |
| **Backend** | Market data API, cost estimation, indexing, search | Indirectly (frontend calls it) |
| **On-chain program** | Source of truth: balances, AMM state, market lifecycle, settlement | Your wallet signs transactions to it |

All financial state lives on-chain. The backend is a read cache — a compromised backend cannot affect your funds. Transactions are built client-side, signed by your wallet, and submitted directly to Solana.

---

### Resources

#### Project

- **App** — dekant.xyz
- **Source code** — github.com/umbra-labs-llc/dekant
- **Math model** — pa-ya.github.io/dekantpm

#### Background Reading

- **Paradigm — Distribution Markets** — The research that introduced the L2-norm CFAMM design Dekant is built on.
- **The Drawdown of Binary Prediction Markets** — Argues that binary-only constraints force traders into bracket games that don't reflect actual beliefs.
- **CFAMM literature** — Anything on constant-function AMMs (Adams, Zhang, Lambert) is relevant; Dekant is a member of that family with an L2-norm invariant instead of the common product invariant.

#### Networks

| Network | Chain | Program ID |
|---------|-------|-----------|
| **Devnet** (live) | Solana devnet | `4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P` |
| **Mainnet** | Solana mainnet-beta | Coming soon — gated by waitlist |

---

## Power Points (Why Judges Should Care)

### The Problem Is Real

Every existing prediction market forces numeric beliefs into binary buckets. "Will ETH be above $4,000?" is not the same question as "What will ETH be?" — the first loses all the information in your distribution. Metaculus proved people *can* express distributions; Dekant proves they *will* when there's money on the line.

### The Math Is Novel

The L2-norm CFAMM is not a toy. It's a mathematically rigorous market maker that:
- Guarantees probabilities sum to 1
- Has closed-form solutions for distribution trades (no iteration, no approximation)
- Produces smooth price curves with quadratic sensitivity
- Fits entirely within Solana's compute budget (~200K CU per distribution trade)

### The Implementation Is Complete

This is not a whitepaper. The system is deployed and functional:
- 17 on-chain instructions (Anchor/Rust)
- 205 Rust unit tests + 70 integration tests passing
- Full NestJS backend with indexer, AMM estimator, and REST API
- Next.js frontend with interactive curve drawing and real-time trading
- Live on Solana devnet with working buy/sell/resolve/claim flow

### The UX Is Two Inputs

Despite the mathematical complexity underneath, the user experience reduces to:
1. Pick a center (where do you think the answer is?)
2. Pick a conviction (how sure are you?)

Everything else — bin allocation, quadratic solving, invariant maintenance — happens silently on-chain.

### The Market Opportunity Is Massive

Prediction markets are the fastest-growing category in crypto ($1B+ in 2024 volume on Polymarket alone). But they're stuck in binary mode. The first protocol to make distribution trading accessible captures the entire numeric-question category: asset prices, election margins, economic indicators, AI benchmarks, sports totals, weather, and more.

### Capital Efficiency Is 35x Better

A binary platform needs 35 separate markets (with 35 separate liquidity pools) to cover "What will SOL be?" with $10 brackets from $50-$400. Dekant does it with one market and one pool. Same capital, 35x tighter spreads, better price discovery.

---

*Built by Umbra Labs on Solana. Protocol code is open source.*
