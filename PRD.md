# DekantPM Prediction Market — Product Requirements Document

**Version:** 1.0
**Date:** 2026-02-23
**Status:** Draft
**Author:** DekantPM Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Target Users](#3-target-users)
4. [User Roles & Permissions](#4-user-roles--permissions)
5. [Market Types](#5-market-types)
6. [User Stories](#6-user-stories)
7. [Functional Requirements](#7-functional-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Technical Architecture Overview](#9-technical-architecture-overview)
10. [Solana-Specific Constraints](#10-solana-specific-constraints)
11. [Security Assumptions](#11-security-assumptions)
12. [Out of Scope](#12-out-of-scope)
13. [Glossary](#13-glossary)

---

## 1. Executive Summary

DekantPM is a continuous decentralized prediction market protocol built on Solana. Unlike existing platforms (Polymarket, Kalshi) that only support binary yes/no outcomes, DekantPM enables traders to express full probability distributions over continuous ranges of outcomes — powered by the L2-norm constant-function AMM described in Paradigm's *Distribution Markets* research.

Traders can forecast anything from "What will ETH price be on June 1?" to "How many Academy Awards will this film win?" — placing capital behind their beliefs as parameterized probability distributions rather than simple directional bets.

The MVP targets DeFi-native users and existing prediction market participants, launching on Solana devnet with stablecoin collateral, centralized oracle resolution, and a desktop-first web interface.

---

## 2. Problem Statement

### Current Landscape

Existing on-chain prediction markets (Polymarket, Drift Bet, Hedgehog) are overwhelmingly binary: "Will X happen? Yes/No." This forces rich, nuanced beliefs into crude buckets. When a trader believes ETH will be between $3,800–$4,200 with 70% confidence, the only available action is betting "Yes" on a bracket — losing all the information in their distribution.

Metaculus demonstrated that users *can and will* express full probability distributions over continuous outcomes, but Metaculus is reputation-only — no real capital at stake, and therefore weaker information-discovery incentives.

### The Gap

There is no on-chain prediction market that combines:
- **Distribution-based forecasting** (express beliefs as probability curves, not binary bets)
- **Real financial incentives** (collateralized positions with payoffs tied to accuracy)
- **Automated market making** (continuous liquidity without relying on orderbook depth)
- **Open market creation** (any authorized user can pose any question)

### What DekantPM Solves

DekantPM bridges this gap by implementing the Paradigm Distribution Markets AMM on Solana, enabling capital-backed continuous probability forecasting with automated liquidity, fair pricing, and permissioned market creation — accessible through a simple, intuitive web UI.

---

## 3. Target Users

### Primary Personas

| Persona | Description | Motivation |
|---------|-------------|------------|
| **DeFi Trader** | Experienced on-chain user, comfortable with wallets, AMMs, and DeFi mechanics. May come from Polymarket, Drift, or Jupiter. | Profit from superior forecasting; portfolio diversification via prediction exposure. |
| **Quantitative Forecaster** | Metaculus/Good Judgment Project participant who wants financial skin-in-the-game. | Monetize forecasting skill; higher-stakes engagement. |
| **Market Creator** | Domain expert or community figure who wants to pose questions and attract forecasting activity. | Curate information markets; earn creator fees; build reputation. |
| **Casual Predictor** | Crypto-curious user drawn by specific questions (elections, sports, crypto prices). | Entertainment; low-friction participation in topics they care about. |

### User Characteristics
- Global audience, no geographic restrictions
- Wallet-native (Phantom, Solflare, Backpack)
- Expects sub-second transaction confirmation (Solana-grade UX)
- Ranges from "understands probability distributions" to "just wants to bet"

---

## 4. User Roles & Permissions

| Role | Permissions | Assigned By |
|------|-------------|-------------|
| **Superadmin** | All permissions. Manage admins, oracles, creators. Create markets. Pause markets. Set protocol fees. Upgrade program. | Protocol deployer (hardcoded or upgrade authority). |
| **Admin** | Manage oracles and creators. Create markets. Pause markets. Set protocol fees. | Superadmin. |
| **Oracle** | Resolve markets assigned to them. Submit outcome values after market deadline. | Superadmin or Admin. |
| **Market Creator** | Create new markets. Select oracle for their markets. Configure market parameters (range, deadline, collateral token, category). | Superadmin or Admin. |
| **Trader** | Browse markets. Buy/sell positions on any active market. Redeem winnings after resolution. View personal position history. | Default role — any connected wallet. |

### Role Hierarchy
```
Superadmin
  └── Admin
        ├── Oracle
        └── Market Creator

Trader (default, no assignment needed)
```

- Superadmins and Admins implicitly have Market Creator privileges.
- A single wallet can hold multiple roles (e.g., Admin + Oracle).
- Role assignment is on-chain (stored in PDA accounts).

---

## 5. Market Types

DekantPM supports three market types, each mapping to a different AMM configuration:

### 5.1 Binary Market

- **Question format:** "Will X happen?" → Yes / No
- **Outcome space:** Two discrete outcomes
- **AMM:** 2-outcome discrete L2-norm AMM
- **Trader input:** Single probability slider (0%–100% for "Yes")
- **Example:** "Will Bitcoin ETF daily volume exceed $5B before July 2026?"

### 5.2 Multi-Outcome Discrete Market

- **Question format:** "Which of these will happen?" → A, B, C, D, ...
- **Outcome space:** N discrete outcomes (2 < N ≤ 32)
- **AMM:** N-outcome discrete L2-norm AMM
- **Trader input:** Probability allocation across each outcome (must sum to 100%)
- **Example:** "Which studio will win Best Picture at the 2027 Oscars?" → A) Warner Bros, B) A24, C) Disney, D) Universal, E) Other

### 5.3 Continuous Range Market (Distribution Market)

- **Question format:** "What will the value of X be?" → Numeric answer in [min, max]
- **Outcome space:** Continuous range, discretized into B bins on-chain (B = 64–256 configurable per market)
- **AMM:** L2-norm constant-function AMM over discretized bins, with parameterized distribution interface
- **Trader input:** Parameterized distribution (Normal for MVP). User specifies:
  - **Center (μ):** "I think the answer is around..."
  - **Confidence (σ):** "...give or take..."
  - The UI renders the resulting PDF curve for visual confirmation
- **Resolution:** Oracle submits exact numeric value; payoff proportional to trader's PDF density at the realized outcome
- **Example:** "What will SOL price be on 2026-07-01?" → Range: [$50, $500], Trader submits Normal(μ=180, σ=30)

### Distribution Family Roadmap
| Phase | Supported Families |
|-------|--------------------|
| MVP | Normal (Gaussian) |
| V2 | Log-normal, Uniform |
| V3 | Mixture distributions, user-drawn arbitrary PDFs |

---

## 6. User Stories

### Market Creation

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| MC-1 | Market Creator | Create a binary yes/no market with a question, deadline, collateral token, and assigned oracle | Traders can forecast on my question |
| MC-2 | Market Creator | Create a multi-outcome market with 2–32 named outcomes | Traders can forecast on categorical questions |
| MC-3 | Market Creator | Create a continuous-range market with min/max bounds, bin count, and distribution family | Traders can express probability distributions over numeric outcomes |
| MC-4 | Market Creator | Set initial liquidity amount when creating a market | The AMM has enough depth for initial trades |
| MC-5 | Market Creator | Add a description, category, and tags to my market | Traders can discover and understand my market |
| MC-6 | Market Creator | Select which oracle will resolve my market | I choose a trusted resolution authority |

### Trading

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| TR-1 | Trader | See a list of active markets with filters (category, type, deadline) | I can find markets I want to trade on |
| TR-2 | Trader | On a binary market, move a slider to set my probability and see the cost before confirming | I know exactly what I'm paying |
| TR-3 | Trader | On a multi-outcome market, allocate probabilities across outcomes and see the cost | I can express beliefs across multiple possibilities |
| TR-4 | Trader | On a continuous market, set a center value and confidence width, see my distribution curve overlaid on the current market distribution, and see the cost | I can visually understand my position vs. the market |
| TR-5 | Trader | Buy a position (send collateral, receive outcome tokens/shares) | I have financial exposure to my prediction |
| TR-6 | Trader | Sell part or all of my position back to the AMM before market deadline | I can exit or reduce exposure before resolution |
| TR-7 | Trader | See my current positions, unrealized PnL, and cost basis for each market | I can manage my portfolio |
| TR-8 | Trader | See the current market-implied probability distribution for any market | I can identify mispriced beliefs |

### Resolution & Settlement

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| RS-1 | Oracle | See markets assigned to me that have passed their deadline | I know which markets need resolution |
| RS-2 | Oracle | Submit the resolved outcome (Yes/No, outcome index, or exact numeric value) | The market can settle |
| RS-3 | Trader | After resolution, claim my payout if I earned one | I receive my winnings |
| RS-4 | Trader | See a breakdown of how my payout was calculated | I understand my result |

### Liquidity Provision

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| LP-1 | Liquidity Provider | Add liquidity to an existing market proportionally | I earn a share of trading fees |
| LP-2 | Liquidity Provider | Remove my liquidity from a market before deadline | I can exit my LP position |
| LP-3 | Liquidity Provider | See my LP position value and accrued fees | I can evaluate my return |

### Administration

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| AD-1 | Superadmin | Assign/revoke Admin, Oracle, and Creator roles | I control platform access |
| AD-2 | Admin | Assign/revoke Oracle and Creator roles | I can onboard trusted participants |
| AD-3 | Admin | Pause an active market (freeze trading) | I can intervene if something goes wrong |
| AD-4 | Admin | Unpause a paused market | Trading can resume after an issue is resolved |
| AD-5 | Superadmin | Update protocol fee parameters (trade fee, creation fee, redemption fee) | I can adjust protocol economics |
| AD-6 | Superadmin | Update the program (upgrade authority) | I can deploy fixes and improvements |

---

## 7. Functional Requirements

### 7.1 Market Lifecycle

```
                    ┌─────────┐
                    │ Created │
                    └────┬────┘
                         │ (initial liquidity deposited)
                         ▼
                    ┌─────────┐
             ┌─────│ Active  │◄────┐
             │     └────┬────┘     │
             │          │          │
        (admin)    (deadline)  (admin)
             │          │          │
             ▼          │          │
        ┌────────┐      │     ┌────┴────┐
        │ Paused │──────┘     │Unpause  │
        └────────┘            └─────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ Pending      │
                  │ Resolution   │
                  └──────┬───────┘
                         │ (oracle submits outcome)
                         ▼
                  ┌──────────────┐
                  │  Resolved    │
                  └──────┬───────┘
                         │ (traders claim payouts)
                         ▼
                  ┌──────────────┐
                  │  Settled     │
                  └──────────────┘
```

**States:**
- **Created → Active:** Market creator deposits initial liquidity; market becomes tradeable.
- **Active:** Traders can buy/sell positions. LPs can add/remove liquidity.
- **Paused:** Trading and LP operations frozen. Admin can unpause to return to Active.
- **Pending Resolution:** Deadline has passed. No more trading. Oracle can submit outcome.
- **Resolved:** Outcome is recorded on-chain. Traders can claim payouts.
- **Settled:** All payouts claimed or claim window expired. Terminal state.

### 7.2 AMM — Discrete Markets (Binary & Multi-Outcome)

Based on the L2-norm constant-function AMM from the Paradigm paper (discrete case):

**State:**
- `q[i]`: Quantity of outcome token `i` held by the AMM (i = 1..N)
- `k`: L2-norm invariant constant
- Invariant: `||q||₂ = sqrt(Σ q[i]²) = k`

**Operations:**

- **Buy outcome `i`:** Trader sends collateral `c`. AMM sells `Δq[i]` tokens of outcome `i` while maintaining `||q'||₂ = k`. Cost is computed from the state transition.
- **Sell outcome `i`:** Trader returns `Δq[i]` tokens. AMM returns collateral.
- **Price of outcome `i`:** Marginal price `p[i] = q[i] / ||q||₂ = q[i] / k`. Prices naturally sum to 1 when normalized: `Σ p[i]² = 1` (L2 sense). Displayed probabilities are `p[i]² / Σ p[j]²` to give standard probability interpretation.

**Payoff at resolution:**
- If outcome `j` occurs, each token `j` pays $1. All other tokens pay $0.

### 7.3 AMM — Continuous Range Markets

Based on the L2-norm AMM over parameterized distributions, discretized into bins:

**State:**
- Range `[min, max]` divided into `B` equal-width bins
- `q[b]`: AMM holdings in bin `b` (b = 1..B)
- `k`: L2-norm invariant
- `backing`: Maximum collateral backing per unit
- Invariant: `||q||₂ = k` and `max(q[b]) ≤ backing`

**Trader interaction (parameterized):**
- Trader specifies a Normal distribution `N(μ, σ)` and a stake amount
- The system discretizes the distribution into bin weights `w[b] = PDF(bin_center_b; μ, σ)`
- These weights determine the token quantities across bins that the trader buys/sells
- Collateral requirement: `max(0, -min_b(Δq[b]))` (worst-case loss)

**Payoff at resolution:**
- Oracle submits exact value `v`
- The bin `b*` containing `v` is the winning bin
- Traders holding tokens in bin `b*` receive proportional payouts
- Interpolation between adjacent bins can be used for precision

### 7.4 Liquidity Provision

- **Add liquidity:** LP deposits collateral proportional to current AMM state. Receives LP shares.
- **Remove liquidity:** LP burns shares, receives proportional collateral + accumulated fees.
- **Fee accrual:** A portion of each trade fee is directed to LPs.
- LP shares are tracked per-market (not fungible across markets).

### 7.5 Oracle & Resolution

- Market creator selects an oracle (wallet with Oracle role) at market creation time.
- Only the assigned oracle can resolve a given market.
- After market deadline:
  - **Binary:** Oracle submits `Yes` or `No`.
  - **Multi-outcome:** Oracle submits the winning outcome index.
  - **Continuous:** Oracle submits the exact numeric value (must be within `[min, max]`).
- Resolution is a single on-chain transaction. Once submitted, it is final (no dispute mechanism in MVP).
- There is no deadline for the oracle to resolve; markets remain in Pending Resolution until resolved.

### 7.6 Settlement & Payout

- After resolution, traders call a `claim` instruction to receive their payout.
- Payout calculation:
  - **Binary/Multi-outcome:** `trader_tokens_in_winning_outcome * payout_per_token`
  - **Continuous:** `trader_tokens_in_winning_bin * payout_per_token` (with optional adjacent-bin interpolation)
- `payout_per_token = total_collateral_pool / total_winning_tokens`
- Redemption fee is deducted at claim time.
- Unclaimed payouts remain available indefinitely (no expiry in MVP).

### 7.7 Fee Structure

| Fee Type | When Charged | Paid By | Destination |
|----------|-------------|---------|-------------|
| **Market Creation Fee** | At market creation | Creator | Protocol treasury |
| **Trade Fee** | On each buy/sell | Trader | Split: protocol treasury + LP pool |
| **Redemption Fee** | At payout claim | Winner | Protocol treasury |

- Each fee is a separate configurable parameter (basis points).
- Fees are stored in a global protocol config PDA, updatable by Superadmin.
- Default values (adjustable): Creation = 50 bps, Trade = 30 bps, Redemption = 50 bps.

### 7.8 Collateral Management

- Supported collateral tokens at MVP: USDC, USDT (SPL tokens).
- Market creator selects the collateral token at creation time.
- All positions within a single market are denominated in the same collateral token.
- Collateral is held in market-specific token vault PDAs controlled by the program.

---

## 8. Non-Functional Requirements

### 8.1 Performance

| Metric | Target |
|--------|--------|
| Trade execution | < 2 seconds (Solana confirmation) |
| UI load time | < 3 seconds initial, < 1 second navigation |
| Concurrent markets | 100+ supported (MVP: ~10–20 active) |
| Compute budget per trade | < 400,000 CU (ideally < 200,000 CU) |

### 8.2 Reliability

- Program must never lose user funds under any valid state transition.
- All arithmetic must use checked math or fixed-point libraries (no overflow/underflow).
- Frontend gracefully handles RPC failures, wallet disconnects, and transaction errors.

### 8.3 Usability

- First-time user can understand the UI and place a trade within 3 minutes.
- Distribution input must be simpler than Metaculus: center + confidence is the primary input; the curve is a visual confirmation, not the primary input method.
- Responsive desktop layout (1024px+). Mobile is secondary but should not be broken.
- Dark mode by default (DeFi convention).

### 8.4 Maintainability

- Anchor IDL auto-generated and versioned.
- Backend API documented with Swagger/OpenAPI.
- Shared TypeScript types between frontend and backend derived from the Anchor IDL.

---

## 9. Technical Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                     Frontend                         │
│              (Next.js / React, Desktop-first)        │
│                                                      │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ Market     │ │ Trading UI   │ │ Admin Panel    │  │
│  │ Discovery  │ │ (Distribution│ │ (Roles, Fees,  │  │
│  │ & Browse   │ │  Input, AMM  │ │  Pause, etc.)  │  │
│  │            │ │  State View) │ │                │  │
│  └─────┬──────┘ └──────┬───────┘ └───────┬────────┘  │
│        │               │                │            │
└────────┼───────────────┼────────────────┼────────────┘
         │               │                │
         ▼               ▼                ▼
┌──────────────────────────────────────────────────────┐
│                    Backend API                       │
│                (NestJS + Express)                     │
│                                                      │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ Market     │ │ Indexer      │ │ Auth / Role    │  │
│  │ Service    │ │ (On-chain    │ │ Verification   │  │
│  │ (metadata, │ │  event       │ │ (Wallet sig)   │  │
│  │  search)   │ │  listener)   │ │                │  │
│  └────────────┘ └──────────────┘ └────────────────┘  │
│                                                      │
│  Database: PostgreSQL (market metadata, categories,  │
│            cached on-chain state, user profiles)     │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│               Solana Program (Anchor/Rust)            │
│                                                      │
│  ┌──────────┐ ┌───────────┐ ┌───────────────────┐   │
│  │ Protocol │ │ Market    │ │ AMM Engine        │   │
│  │ Config   │ │ Accounts  │ │ (L2-norm CFAMM)   │   │
│  │ (fees,   │ │ (state,   │ │                   │   │
│  │  roles)  │ │  vaults)  │ │ - Discrete (N≤32) │   │
│  └──────────┘ └───────────┘ │ - Binned Cont.    │   │
│                             │   (B=64-256 bins)  │   │
│  ┌──────────┐ ┌───────────┐ └───────────────────┘   │
│  │ User     │ │ LP        │                          │
│  │ Position │ │ Shares    │                          │
│  │ Accounts │ │ Accounts  │                          │
│  └──────────┘ └───────────┘                          │
└──────────────────────────────────────────────────────┘
```

### 9.1 Solana Program (Layer 1)

- **Framework:** Anchor (Rust)
- **Key accounts:**
  - `ProtocolConfig` PDA — fees, treasury address, superadmin
  - `UserRole` PDA — per-wallet role assignments
  - `Market` PDA — market parameters, state, AMM reserves (q[]), k, backing
  - `MarketVault` PDA — SPL token vault holding collateral
  - `UserPosition` PDA — per-user-per-market token holdings
  - `LpPosition` PDA — per-user-per-market LP shares
- **Instructions:** `initialize_protocol`, `assign_role`, `revoke_role`, `create_market`, `buy`, `sell`, `add_liquidity`, `remove_liquidity`, `pause_market`, `unpause_market`, `resolve_market`, `claim_payout`, `update_fees`

### 9.2 Backend (Layer 2)

- **Framework:** NestJS with Express
- **Language:** TypeScript
- **Database:** PostgreSQL
- **Responsibilities:**
  - Index on-chain events (market creation, trades, resolution) via Solana WebSocket / polling
  - Serve market metadata (descriptions, categories, tags) not stored on-chain
  - Provide search, filter, and sort APIs for market discovery
  - Cache AMM state for fast frontend reads (reduce RPC calls)
  - Wallet-signature-based authentication for admin operations
  - Compute distribution discretization off-chain (for frontend preview and cost estimation)
- **Not responsible for:** Custodying funds, executing trades (all on-chain).

### 9.3 Frontend (Layer 3)

- **Framework:** Next.js (React)
- **Styling:** Tailwind CSS
- **Wallet integration:** `@solana/wallet-adapter`
- **Key pages:**
  - Home / Market Discovery (filterable grid/list)
  - Market Detail (AMM state visualization, trading panel, position info)
  - Portfolio (user's open positions, history, claimable payouts)
  - Admin Dashboard (role management, fee config, market pause controls)
  - Oracle Dashboard (pending markets, resolution submission)
- **Distribution input UX (continuous markets):**
  - Two-input approach: "Center" (numeric input or slider) + "Confidence" (slider from "very sure" to "very uncertain")
  - Maps internally to Normal(μ, σ) parameters
  - Live-rendered bell curve showing trader's distribution overlaid on market's current implied distribution
  - Tooltip/helper text: "Where do you think the answer will be? How sure are you?"
  - Cost preview updates in real-time as user adjusts inputs

---

## 10. Solana-Specific Constraints

### 10.1 Compute Budget

- Default CU limit: 200,000 per instruction. Can request up to 1,400,000 via `ComputeBudgetProgram`.
- **Implication:** L2-norm computation across 256 bins requires efficient fixed-point math. Use `u128` intermediate values; avoid floating point entirely. Pre-compute square roots where possible.
- **Mitigation:** If a single trade on a 256-bin market exceeds CU limits, reduce default bin count or split computation across multiple instructions.

### 10.2 Account Size

- Maximum account size: 10 MB (realloc limit: 10 KB per instruction).
- **Market account sizing:** For a 256-bin continuous market, storing `q[b]` as `u64` requires 256 * 8 = 2,048 bytes for reserves alone. With metadata, ~3–4 KB total. Well within limits.
- **User position sizing:** For continuous markets, storing per-bin holdings as `u64` requires up to 256 * 8 = 2,048 bytes per position. Acceptable.

### 10.3 Transaction Size

- Max transaction size: 1,232 bytes.
- **Implication:** All instruction data (parameters) must fit. For continuous market trades, only `μ`, `σ`, and `stake_amount` are sent (not bin-by-bin weights) — the program computes the discretized distribution on-chain.

### 10.4 Math Precision

- No native floating-point support in BPF.
- All math must use integer arithmetic with fixed-point scaling.
- Recommended: Use a decimal scale factor of 10^9 (1 USDC = 1,000,000 micro-USDC; probability weights scaled to 10^9).
- Square root computation: Use integer Newton's method or a lookup table for L2-norm.
- Normal PDF discretization: Pre-compute or use rational polynomial approximation on-chain.

### 10.5 Cross-Program Invocations

- SPL Token transfers via CPI for all collateral movements.
- Associated Token Account creation as needed.

### 10.6 Program Upgrades

- Program deployed with upgrade authority held by a single keypair (Superadmin).
- All account schemas must be designed with versioning in mind (include a `version: u8` field) for future migrations.

---

## 11. Security Assumptions

### 11.1 Trust Model

| Component | Trust Level | Rationale |
|-----------|-------------|-----------|
| **Solana Program** | Trustless (code is law) | All financial operations execute on-chain. Users verify via open-source code and IDL. |
| **Oracle** | Trusted (centralized) | Oracles are human-assigned roles. They can resolve markets incorrectly — there is no on-chain dispute mechanism in MVP. Mitigation: multiple known oracles; reputation is off-chain. |
| **Market Creator** | Semi-trusted | Creators define questions. Ambiguous questions are a social risk, not a protocol risk (MVP assumption: creators act in good faith). |
| **Backend** | Untrusted for funds | Backend never touches funds. It serves metadata and caches. A compromised backend cannot steal funds or alter market outcomes. It could serve incorrect data — frontend should validate critical state against on-chain data. |
| **Upgrade Authority** | Fully trusted | The upgrade authority can change program logic. This is an accepted MVP tradeoff. Future: multisig or governance. |

### 11.2 Invariants the Program Must Enforce

1. **Solvency:** Total collateral in market vault ≥ sum of all potential payouts in the worst case.
2. **L2-norm invariant:** After every trade, `||q||₂ = k` (within fixed-point rounding tolerance).
3. **Backing constraint:** For continuous markets, `max(q[b]) ≤ backing` at all times.
4. **Role enforcement:** Only wallets with the correct role PDA can execute privileged instructions.
5. **Lifecycle enforcement:** Trades only in Active state. Resolution only in Pending Resolution state. Claims only in Resolved state.
6. **No double-claim:** Each position can be claimed exactly once.
7. **Collateral isolation:** Each market's vault is independent. One market's insolvency cannot affect another.

### 11.3 Attack Surfaces

| Attack | Mitigation |
|--------|------------|
| **Oracle manipulation** | Out of scope for MVP. Future: optimistic oracle with bond + dispute. |
| **Arithmetic overflow** | Checked math everywhere. Anchor's default overflow checks. Fixed-point library with bounds. |
| **Reentrancy** | Solana's runtime prevents reentrancy by design (single-threaded per transaction). |
| **Front-running / MEV** | Acknowledged risk. Out of scope for MVP. Future: commit-reveal or batched auctions. |
| **Drain via malformed trade** | Validate all inputs. Verify L2-norm and solvency post-trade. Reject if violated. |
| **Rogue upgrade** | Accepted MVP risk. Mitigated by deployer reputation and open-source code. |

---

## 12. Out of Scope

The following are explicitly **not** included in the MVP and are deferred to future versions:

| Item | Reason |
|------|--------|
| **Decentralized / optimistic oracle** | Complexity. Centralized oracle is sufficient for MVP validation. |
| **Dispute resolution mechanism** | Depends on decentralized oracle. |
| **Market cancellation** | Returning funds to all participants is complex. Only pause is supported. |
| **Governance token** | Premature. Protocol economics should be validated first. |
| **MEV protection** | Requires commit-reveal or batched execution. Deferred. |
| **Mobile-optimized UI** | Desktop-first. Mobile should not be broken but is not a design target. |
| **Leaderboards / analytics** | Requires historical data aggregation. Basic indexer stores data; display is deferred. |
| **Conditional markets** | "If X, what will Y be?" — complex dependency graph. Deferred. |
| **Non-Normal distribution families** | Log-normal, uniform, arbitrary PDFs — deferred to V2. |
| **Multi-collateral per market** | Each market uses one token. Multi-collateral is deferred. |
| **Free (non-financial) participation** | Adds complexity to position tracking without clear MVP value. Deferred. |
| **Orderbook** | Pure AMM for MVP. Orderbook/hybrid deferred. |
| **Cross-chain** | Solana only for MVP. |
| **API rate limiting / DDoS protection** | Basic measures only. Production hardening deferred. |

---

## 13. Glossary

| Term | Definition |
|------|------------|
| **AMM** | Automated Market Maker — algorithm that provides liquidity and prices without a traditional orderbook. |
| **L2-norm** | Euclidean norm. For vector `x`, `\|\|x\|\|₂ = sqrt(Σ x[i]²)`. Used as the invariant in the Paradigm Distribution Markets AMM. |
| **CFAMM** | Constant-Function Automated Market Maker — AMM where a function of reserves is held constant (analogous to `xy = k` in Uniswap). |
| **Bin** | A discrete bucket representing a sub-range of the continuous outcome space. Continuous distributions are discretized into bins for on-chain computation. |
| **PDF** | Probability Density Function — a function describing the relative likelihood of a continuous random variable taking on a given value. |
| **PDA** | Program Derived Address — deterministic Solana account address derived from seeds and the program ID. Used for on-chain data storage and vault authority. |
| **CU** | Compute Units — Solana's measure of on-chain computation cost. Each transaction has a CU budget. |
| **Outcome Token** | A token representing a claim on a specific outcome. Pays out if that outcome occurs; worth nothing otherwise. |
| **Resolution** | The act of an oracle declaring the actual outcome of a market's question after its deadline. |
| **Settlement** | The process of distributing payouts to winning traders after resolution. |
| **Backing** | Maximum collateral the AMM can owe per unit of outcome. Ensures solvency in continuous markets. |
| **Invariant** | A mathematical property that must hold true before and after every state transition (trade). |

---

## Appendix A: Key References

1. **Paradigm — Distribution Markets** (Dec 2024): [paradigm.xyz/2024/12/distribution-markets](https://www.paradigm.xyz/2024/12/distribution-markets) — Core AMM mechanism for continuous outcome forecasting.
2. **Metaculus**: [metaculus.com](https://www.metaculus.com/) — UX reference for distribution input and question types.
3. **Polymarket**: Existing binary prediction market — user base overlap.
4. **Anchor Framework**: Solana smart contract framework used for program development.

---

*End of PRD v1.0*
