# DekantPM — Frontend Developer Guide

**Version:** 1.0
**Date:** 2026-02-24
**Status:** Frontend feature-complete (F-1 through F-17 done; F-18→F-21 remaining)
**Audience:** Frontend developer(s) building the Next.js web application

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Data Flow & Trust Model](#2-data-flow--trust-model)
3. [On-Chain Program — What the Frontend Needs to Know](#3-on-chain-program--what-the-frontend-needs-to-know)
4. [Backend REST API Reference](#4-backend-rest-api-reference)
5. [Authentication Flow](#5-authentication-flow)
6. [Market Types & Trading Operations](#6-market-types--trading-operations)
7. [Transaction Building Guide](#7-transaction-building-guide)
8. [PDA Derivation Reference](#8-pda-derivation-reference)
9. [AMM Math for UI Display](#9-amm-math-for-ui-display)
10. [Market Lifecycle State Machine](#10-market-lifecycle-state-machine)
11. [User Roles & Permissions](#11-user-roles--permissions)
12. [Shared Types & Constants](#12-shared-types--constants)
13. [Error Handling](#13-error-handling)
14. [Known Backend Limitations](#14-known-backend-limitations)
15. [Frontend Task Checklist (F-1 → F-13)](#15-frontend-task-checklist)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (Next.js)                             │
│                                                                         │
│  ┌────────────────┐  ┌───────────────┐  ┌────────────────────────────┐  │
│  │ Market         │  │ Trading       │  │ Admin / Oracle             │  │
│  │ Discovery      │  │ Panel         │  │ Dashboard                  │  │
│  │ (list, search, │  │ (buy, sell,   │  │ (roles, fees, pause,       │  │
│  │  filter, sort) │  │  LP, claim)   │  │  resolve)                  │  │
│  └───────┬────────┘  └──────┬────────┘  └─────────────┬──────────────┘  │
│          │                  │                          │                 │
│          │ READ             │ READ + WRITE             │ READ + WRITE    │
│          │                  │                          │                 │
└──────────┼──────────────────┼──────────────────────────┼─────────────────┘
           │                  │                          │
           ▼                  ▼                          ▼
   ┌───────────────┐   ┌───────────┐            ┌───────────────┐
   │ Backend API   │   │ Solana    │            │ Solana        │
   │ (NestJS)      │   │ RPC       │            │ RPC           │
   │               │   │           │            │               │
   │ • Discovery   │   │ • Fetch   │            │ • Send tx     │
   │ • Search      │   │   account │            │ • Fetch       │
   │ • Metadata    │   │ • Send tx │            │   account     │
   │ • Estimation  │   │           │            │               │
   │ • Auth        │   │           │            │               │
   └───────┬───────┘   └─────┬─────┘            └───────┬───────┘
           │                  │                          │
           │                  ▼                          ▼
           │          ┌───────────────────────────────────────┐
           │          │      Solana Program (Anchor/Rust)      │
           │          │                                        │
           │          │  ProtocolConfig  Market  UserPosition  │
           │          │  UserRole        Vault   LpPosition    │
           └─────────►│                                        │
                      │  17 Instructions  •  L2-norm AMM       │
                      └───────────────────────────────────────┘
```

### Key Principle: On-chain is truth, backend is a cache

| Source | Use For | Trust Level |
|--------|---------|-------------|
| **Backend API** | Market discovery, search, metadata, trade history, cost estimation | **Untrusted for funds**. Can serve stale/incorrect cached data. |
| **Solana RPC** | Account state, transaction submission, balance checks | **Trusted** (on-chain state is the source of truth) |
| **Solana Program** | All financial operations (trade, LP, claim, create market) | **Trustless** (code enforces all invariants) |

**Rule of thumb:**
- **Read from backend** for discovery and previews (fast, paginated, searchable)
- **Read from RPC** for critical state before trading (reserves, balances, deadlines)
- **Write always goes to the program** via wallet-signed transactions

---

## 2. Data Flow & Trust Model

### How a Trade Works (End-to-End)

```
                  FRONTEND                         BACKEND              SOLANA
                  ────────                         ───────              ──────

  1. User selects market                              │                    │
     │                                                │                    │
  2. GET /markets/:id  ──────────────────────────────►│                    │
     │◄─── MarketDetail (cached reserves, metadata)───│                    │
     │                                                │                    │
  3. POST /amm/estimate-buy ─────────────────────────►│                    │
     │◄─── cost estimate, price impact, new probs ────│                    │
     │                                                │                    │
  4. User confirms trade                              │                    │
     │                                                │                    │
  5. Fetch on-chain Market account ───────────────────────────────────────►│
     │◄─── Live reserves, k_squared, total_minted ───────────────────────│
     │                                                │                    │
  6. Build transaction (Anchor client)                │                    │
     │                                                │                    │
  7. Wallet signs + submit tx ────────────────────────────────────────────►│
     │◄─── tx confirmed ─────────────────────────────────────────────────│
     │                                                │                    │
  8. (Backend indexer picks up event)                  │◄────── event ─────│
     │                                                │                    │
  9. Refetch market state (from RPC or backend)       │                    │
```

### How Market Creation Works (Two-Phase)

```
  1. Frontend builds + submits create_market tx ──────────────────────────►│
     │◄─── tx confirmed (market PDA created on-chain) ───────────────────│
     │                                                │                    │
  2. POST /markets (off-chain metadata) ─────────────►│                    │
     │  { marketId, pubkey, title, description,       │                    │
     │    category, tags, outcomeLabels }              │                    │
     │◄─── 201 Created ──────────────────────────────│                    │
```

The on-chain transaction creates the market with its AMM state. The backend POST adds human-readable metadata (title, description, etc.) that cannot be stored on-chain.

---

## 3. On-Chain Program — What the Frontend Needs to Know

### Program ID

```
F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL
```

### IDL Location

```
target/idl/dekant_pm.json
```

The IDL is auto-generated by `anchor build`. Use it with `@coral-xyz/anchor` to get type-safe instruction builders and account deserializers.

### 17 Instructions

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INSTRUCTIONS                                  │
├──────────────┬──────────────────────────────────────────────────────┤
│  ADMIN       │  initialize         (superadmin only, once)          │
│              │  assign_role         (superadmin/admin)               │
│              │  revoke_role         (superadmin/admin)               │
│              │  update_fees         (superadmin only)                │
│              │  collect_fees        (superadmin only)                │
├──────────────┼──────────────────────────────────────────────────────┤
│  MARKET      │  create_market       (creator+ role)                 │
│              │  pause_market        (admin+ role)                   │
│              │  unpause_market      (admin+ role)                   │
│              │  resolve_market      (assigned oracle only)          │
├──────────────┼──────────────────────────────────────────────────────┤
│  TRADING     │  buy                 (any wallet, active market)     │
│              │  sell                (any wallet, has position)      │
│              │  buy_to_price        (any wallet, active market)     │
│              │  sell_to_price       (any wallet, has position)      │
│              │  buy_distribution    (continuous markets only)       │
│              │  sell_distribution   (continuous markets only)       │
├──────────────┼──────────────────────────────────────────────────────┤
│  LIQUIDITY   │  add_liquidity       (any wallet, active market)    │
│              │  remove_liquidity    (any wallet, has LP position)   │
├──────────────┼──────────────────────────────────────────────────────┤
│  SETTLEMENT  │  claim_payout        (resolved market, has winning  │
│              │                       tokens, not yet claimed)       │
└──────────────┴──────────────────────────────────────────────────────┘
```

### On-Chain Account Types

```
┌─────────────────────────────────────────────────────────────┐
│ ProtocolConfig (singleton)                                   │
│  • superadmin, treasury, market_count                        │
│  • creation_fee_bps, trade_fee_bps, redemption_fee_bps       │
│  • lp_fee_share_bps                                          │
│  Seeds: ["protocol_config"]                                  │
├─────────────────────────────────────────────────────────────┤
│ UserRole (per user+role)                                     │
│  • user, role (1=Admin, 2=Oracle, 3=Creator)                 │
│  • assigned_by, assigned_at                                  │
│  Seeds: ["user_role", user_pubkey, role_u8]                  │
├─────────────────────────────────────────────────────────────┤
│ Market (per market)                                          │
│  • market_id, market_type, state, creator, oracle            │
│  • deadline, num_outcomes, reserves[], k_squared             │
│  • total_minted, lp_shares_total, lp_fee_accumulated         │
│  • protocol_fee_accumulated, range_min, range_max            │
│  • resolved_outcome, resolved_value                          │
│  Seeds: ["market", market_count.to_le_bytes()]               │
├─────────────────────────────────────────────────────────────┤
│ UserPosition (per user+market)                               │
│  • market, user, holdings[], total_deposited                 │
│  • total_withdrawn, claimed                                  │
│  Seeds: ["user_position", market_pubkey, user_pubkey]        │
├─────────────────────────────────────────────────────────────┤
│ LpPosition (per user+market)                                 │
│  • market, user, shares, deposited_collateral                │
│  Seeds: ["lp_position", market_pubkey, user_pubkey]          │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Backend REST API Reference

**Base URL:** `http://localhost:3000` (dev) — configured in backend `.env`
**Swagger UI:** `GET /api/docs`

### 4.1 Markets

#### `GET /markets` — List markets (paginated, filterable)

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `category` | string | — | Filter by category |
| `marketType` | number | — | `0`=binary, `1`=multi, `2`=continuous |
| `state` | number | — | `0`=active, `1`=paused, `2`=pending, `3`=resolved |
| `search` | string | — | Text search on title (ILIKE) |
| `sortBy` | string | `"newest"` | `"newest"` \| `"deadline"` \| `"volume"` |
| `page` | number | `1` | Page number (1-based) |
| `limit` | number | `20` | Items per page (max 100) |

**Response:** `PaginatedResponse<MarketEntity>`

```json
{
  "data": [
    {
      "id": "0",
      "pubkey": "3xK9...",
      "marketType": 0,
      "state": 0,
      "creator": "ABc1...",
      "oracle": "DEf2...",
      "collateralMint": "EPjF...",
      "deadline": "2026-03-01T00:00:00.000Z",
      "numOutcomes": 2,
      "title": "Will SOL reach $500?",
      "description": "...",
      "category": "crypto",
      "tags": ["solana", "price"],
      "outcomeLabels": ["Yes", "No"],
      "reserves": ["1000000000", "1000000000"],
      "kSquared": "2000000000000000000",
      "totalMinted": "1000000000",
      "totalVolume": "5000000",
      "totalTraders": 0,
      "lastTradeAt": "2026-02-24T12:00:00.000Z",
      "rangeMin": null,
      "rangeMax": null,
      "resolvedOutcome": null,
      "resolvedValue": null
    }
  ],
  "total": 15,
  "page": 1,
  "limit": 20,
  "hasMore": false
}
```

#### `GET /markets/:id` — Market detail

**Response:** Full `MarketEntity` object (same as list item but fetched by ID)

#### `GET /markets/:id/prices` — Current implied probabilities

**Response:**
```json
{
  "probabilities": [0.65, 0.35]
}
```

> **Note:** These probabilities are computed from cached reserves. For trading, always fetch fresh on-chain state.

#### `GET /markets/:id/history` — Trade history

**Query:** `page` (default 1), `limit` (default 50, max 100)

**Response:** `PaginatedResponse<TradeEntity>`

```json
{
  "data": [
    {
      "id": "1",
      "marketId": "0",
      "trader": "ABc1...",
      "isBuy": true,
      "collateralAmount": "1000000",
      "outcomeIndex": 0,
      "mu": null,
      "sigma": null,
      "tokensTransacted": "950000",
      "feePaid": "3000",
      "txSignature": "5xYz...",
      "slot": "12345",
      "timestamp": "2026-02-24T12:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 50,
  "hasMore": false
}
```

#### `POST /markets` — Create market metadata (requires JWT)

**Headers:** `Authorization: Bearer <jwt>`

**Body:**
```json
{
  "marketId": 0,
  "pubkey": "3xK9...",
  "marketType": 0,
  "numOutcomes": 2,
  "creator": "ABc1...",
  "oracle": "DEf2...",
  "collateralMint": "EPjF...",
  "deadline": "2026-03-01T00:00:00.000Z",
  "title": "Will SOL reach $500?",
  "description": "Resolution based on CoinGecko price",
  "category": "crypto",
  "tags": ["solana", "price"],
  "outcomeLabels": ["Yes", "No"]
}
```

**Response:** `201 Created` with the created market entity.

### 4.2 Users

#### `GET /users/:address/positions` — User positions across all markets

**Response:**
```json
[
  {
    "id": "1",
    "marketId": "0",
    "userAddress": "ABc1...",
    "holdings": ["500000", "0"],
    "totalDeposited": "1000000",
    "totalWithdrawn": "0",
    "claimed": false
  }
]
```

#### `GET /users/:address/history` — User trade history

**Query:** `page`, `limit`

**Response:** `PaginatedResponse<TradeEntity>`

#### `GET /users/:address/lp-positions` — User LP positions

**Response:**
```json
[
  {
    "id": "1",
    "marketId": "0",
    "userAddress": "ABc1...",
    "shares": "1000000000",
    "depositedCollateral": "1000000"
  }
]
```

### 4.3 AMM Estimation

These endpoints mirror the on-chain AMM math for previewing trade costs. Use them to show estimated costs before the user submits a transaction.

#### `POST /amm/estimate-buy` — Estimate buy cost

**Body (discrete market — binary/multi):**
```json
{
  "marketId": 0,
  "outcome": 0,
  "amount": 1000000
}
```

**Body (continuous market — distribution):**
```json
{
  "marketId": 5,
  "mu": 180,
  "sigma": 30,
  "amount": 1000000
}
```

**Response:**
```json
{
  "tokensReceived": "985000",
  "fee": "3000",
  "effectiveCollateral": "997000",
  "newProbabilities": [0.72, 0.28]
}
```

#### `POST /amm/estimate-sell` — Estimate sell return

**Body:**
```json
{
  "marketId": 0,
  "outcome": 0,
  "amount": 500000
}
```

> **Note:** Distribution sell estimation (`mu`/`sigma` params) is NOT yet implemented on the backend. For continuous sell estimation, compute client-side or fall back to discrete per-bin estimation.

### 4.4 Auth

#### `POST /auth/challenge` — Request sign-in nonce

**Body:**
```json
{
  "walletAddress": "ABc1..."
}
```

**Response:**
```json
{
  "nonce": "abc123def456",
  "message": "Sign this message to authenticate with DekantPM: abc123def456"
}
```

#### `POST /auth/verify` — Submit signed challenge, receive JWT

**Body:**
```json
{
  "walletAddress": "ABc1...",
  "signature": "<base64-encoded ed25519 signature>",
  "nonce": "abc123def456"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGc...",
  "expiresIn": 86400
}
```

### 4.5 Admin

#### `GET /admin/roles` — List role assignments (requires JWT)

**Response:** Array of `UserRoleEntity`

#### `GET /admin/markets/stale` — Markets pending resolution > N days (requires JWT)

**Query:** `days` (default 7)

### 4.6 Health

#### `GET /health` — Health check

**Response:**
```json
{
  "status": "ok"
}
```

---

## 5. Authentication Flow

```
┌──────────┐                  ┌──────────┐                 ┌──────────┐
│ Frontend │                  │ Backend  │                 │  Wallet  │
└────┬─────┘                  └────┬─────┘                 └────┬─────┘
     │                             │                            │
     │  1. POST /auth/challenge    │                            │
     │  { walletAddress }          │                            │
     │────────────────────────────►│                            │
     │                             │                            │
     │  { nonce, message }         │                            │
     │◄────────────────────────────│                            │
     │                             │                            │
     │  2. wallet.signMessage(message)                          │
     │─────────────────────────────────────────────────────────►│
     │                             │                            │
     │  signature (base64)         │                            │
     │◄─────────────────────────────────────────────────────────│
     │                             │                            │
     │  3. POST /auth/verify       │                            │
     │  { walletAddress,           │                            │
     │    signature, nonce }       │                            │
     │────────────────────────────►│                            │
     │                             │  verify ed25519 sig        │
     │                             │  against publicKey         │
     │  { accessToken, expiresIn } │                            │
     │◄────────────────────────────│                            │
     │                             │                            │
     │  4. Store JWT, attach to    │                            │
     │     subsequent requests     │                            │
     │  Authorization: Bearer xxx  │                            │
```

### When Is Auth Required?

| Endpoint | Auth Required? |
|----------|---------------|
| `GET /markets`, `GET /markets/:id`, `GET /markets/:id/prices` | No |
| `GET /markets/:id/history` | No |
| `POST /markets` (create metadata) | **Yes** |
| `GET /users/:address/*` | No |
| `POST /amm/estimate-*` | No |
| `GET /admin/roles`, `GET /admin/markets/stale` | **Yes** |

### JWT Details

- **Algorithm:** HS256
- **Expiry:** 24 hours (86400 seconds)
- **Payload:** `{ walletAddress, iat, exp }`
- **Header:** `Authorization: Bearer <token>`

### Wallet Message Signing (Phantom/Solflare)

```typescript
// Using @solana/wallet-adapter-react
const { signMessage } = useWallet();

const messageBytes = new TextEncoder().encode(message);
const signature = await signMessage(messageBytes);
const signatureBase64 = Buffer.from(signature).toString('base64');
```

---

## 6. Market Types & Trading Operations

### 6.1 Market Type Decision Tree

```
                      What type of market?
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
           Binary       Multi-Outcome   Continuous
         (type=0)        (type=1)       (type=2)
              │              │              │
         2 outcomes     3-32 outcomes   2-256 bins
              │              │              │
         ┌────┘          ┌───┘           ┌──┘
         ▼               ▼               ▼
    Use buy/sell     Use buy/sell     Use buy_distribution/
    instructions     instructions     sell_distribution
         │               │               │
         ▼               ▼               ▼
    UI: Slider       UI: Allocate    UI: Center (μ) +
    (Yes/No prob)    probs across    Confidence (σ)
                     outcomes         → bell curve
```

### 6.2 Trading Operations by Market Type

| Market Type | Buy | Sell | Buy to Price | Sell to Price |
|-------------|-----|------|-------------|--------------|
| **Binary** (0) | `buy(outcome, collateral)` | `sell(outcome, tokens)` | `buy_to_price(outcome, target_prob, max_collateral)` | `sell_to_price(outcome, target_prob, min_collateral)` |
| **Multi** (1) | `buy(outcome, collateral)` | `sell(outcome, tokens)` | `buy_to_price(outcome, target_prob, max_collateral)` | `sell_to_price(outcome, target_prob, min_collateral)` |
| **Continuous** (2) | `buy_distribution(mu, sigma, collateral)` | `sell_distribution(mu, sigma, tokens)` | N/A | N/A |

### 6.3 Binary Market UI Flow

```
  ┌──────────────────────────────────────────────────────┐
  │  "Will SOL reach $500?"                              │
  │                                                      │
  │  Current Price:  YES 65%  ████████████░░░░  NO 35%   │
  │                                                      │
  │  Your Prediction:                                    │
  │  ◄────────────────●──────────►                       │
  │  0%               72%        100%                    │
  │                                                      │
  │  Amount: [___1.00___] USDC                           │
  │                                                      │
  │  ┌────────────────────────────────────────────┐      │
  │  │  Estimated tokens:  0.985 YES              │      │
  │  │  Fee:               0.003 USDC (0.3%)      │      │
  │  │  Price impact:      +2.1%                  │      │
  │  │  New YES prob:      72%                    │      │
  │  └────────────────────────────────────────────┘      │
  │                                                      │
  │  [ BUY YES ]                                         │
  └──────────────────────────────────────────────────────┘
```

For binary: if user bets on "Yes" (outcome 0), call `buy(outcome=0, collateral)`.
If they want to target a specific probability, use `buy_to_price(outcome=0, target_prob, max_collateral)`.

### 6.4 Continuous Market UI Flow

```
  ┌──────────────────────────────────────────────────────┐
  │  "What will SOL price be on 2026-07-01?"             │
  │  Range: $50 — $500                                   │
  │                                                      │
  │  Market Distribution (current):                      │
  │       ╭──╮                                           │
  │      ╱    ╲                                          │
  │     ╱      ╲                                         │
  │    ╱        ╲___                                     │
  │  ─╱─────────────╲───────────────────────             │
  │  $50    $150   $250   $350   $450   $500             │
  │                                                      │
  │  Your Prediction:                                    │
  │                                                      │
  │  Center (μ):     [___$180___]                        │
  │  ◄────────────────────●────────────────────►         │
  │  $50                                    $500         │
  │                                                      │
  │  Confidence (σ):  [___30___]                         │
  │  Very Sure ◄───●──────────────────► Very Uncertain   │
  │                                                      │
  │  Your Bell Curve:                                    │
  │       ╭─╮     (overlaid on market dist)              │
  │      ╱   ╲                                           │
  │  ───╱─────╲─────────────────────────                 │
  │                                                      │
  │  Amount: [___5.00___] USDC                           │
  │                                                      │
  │  [ BUY DISTRIBUTION ]                                │
  └──────────────────────────────────────────────────────┘
```

The frontend sends `buy_distribution(mu, sigma, collateral)` to the program. The program internally discretizes the Normal(μ, σ) into bin weights and executes the multi-bin trade.

**Important:** `mu` and `sigma` are sent as **scaled integers** (multiplied by SCALE = 10^9). The program converts them back to compute the Normal PDF. For the UI, map the user's human-readable inputs to on-chain representation:

```typescript
const SCALE = 1_000_000_000;

// User enters: center = 180 (dollars), sigma = 30 (dollars)
// Market range: [50, 500]
// On-chain range: [50 * SCALE, 500 * SCALE]
// So mu_on_chain = 180 * SCALE, sigma_on_chain = 30 * SCALE

const mu = new BN(180).mul(new BN(SCALE));
const sigma = new BN(30).mul(new BN(SCALE));
```

> **Caveat:** The exact mu/sigma scaling depends on how `range_min` and `range_max` are stored on-chain. Check the market's `rangeMin` and `rangeMax` fields — they are already in SCALE units. Your mu/sigma should be in the same units.

---

## 7. Transaction Building Guide

All financial operations require building and submitting Solana transactions. The frontend NEVER sends money to the backend.

### 7.1 Setup

```typescript
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import idl from "../target/idl/dekant_pm.json";
import { DekantPm } from "../target/types/dekant_pm";

const PROGRAM_ID = new PublicKey("F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL");

// In a React component/hook:
const wallet = useAnchorWallet();
const { connection } = useConnection();
const provider = new AnchorProvider(connection, wallet, {});
const program = new Program<DekantPm>(idl as any, provider);
```

### 7.2 Buy (Binary/Multi-Outcome)

```typescript
async function buyOutcome(
  marketPubkey: PublicKey,
  outcome: number,
  collateralAmount: BN,
  userWallet: PublicKey,
  collateralMint: PublicKey,
) {
  // 1. Derive PDAs
  const [protocolConfig] = deriveProtocolConfig(PROGRAM_ID);
  const [vaultAuthority] = deriveVaultAuthority(PROGRAM_ID, marketPubkey);
  const [userPosition] = deriveUserPosition(PROGRAM_ID, marketPubkey, userWallet);

  // 2. Get associated token accounts
  const userAta = getAssociatedTokenAddressSync(collateralMint, userWallet);
  const vault = /* market.vault from on-chain account */;

  // 3. Build and send transaction
  const tx = await program.methods
    .buy(outcome, collateralAmount)
    .accounts({
      protocolConfig,
      market: marketPubkey,
      vault,
      vaultAuthority,
      userPosition,
      userTokenAccount: userAta,
      user: userWallet,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}
```

### 7.3 Sell (Binary/Multi-Outcome)

```typescript
const tx = await program.methods
  .sell(outcome, tokenAmount)
  .accounts({
    protocolConfig,
    market: marketPubkey,
    vault,
    vaultAuthority,
    userPosition,
    userTokenAccount: userAta,
    user: userWallet,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### 7.4 Buy to Price

```typescript
// Buy enough of outcome to move its probability to targetProb
const tx = await program.methods
  .buyToPrice(
    outcome,                    // outcome index
    new BN(targetProb),         // target probability (in SCALE units, e.g., 0.72 = 720_000_000)
    new BN(maxCollateral),      // max collateral willing to spend (slippage protection)
  )
  .accounts({ /* same as buy */ })
  .rpc();
```

### 7.5 Buy Distribution (Continuous Markets)

```typescript
const tx = await program.methods
  .buyDistribution(
    new BN(mu),                 // center, in same units as range_min/range_max
    new BN(sigma),              // width, in same units
    new BN(collateralAmount),   // collateral to spend
  )
  .accounts({ /* same as buy */ })
  .rpc();
```

### 7.6 Create Market

```typescript
const tx = await program.methods
  .createMarket(
    marketType,                 // 0=binary, 1=multi, 2=continuous
    numOutcomes,                // 2 for binary, N for multi, bins for continuous
    new BN(deadline),           // unix timestamp
    oraclePublicKey,            // assigned oracle
    new BN(initialLiquidity),   // amount of collateral for initial liquidity
    new BN(rangeMin),           // 0 for discrete markets
    new BN(rangeMax),           // 0 for discrete markets
  )
  .accounts({
    protocolConfig,
    market: marketPda,          // derive from market_count
    vault: vaultKeypair.publicKey,
    vaultAuthority,
    creatorRole,                // UserRole PDA for creator
    creatorTokenAccount: creatorAta,
    creator: userWallet,
    collateralMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([vaultKeypair])
  .rpc();
```

> **Note:** The vault is a keypair-based token account (not a PDA). The creator must generate a new keypair for the vault and pass it as a signer.

### 7.7 Add Liquidity

```typescript
const tx = await program.methods
  .addLiquidity(new BN(amount))
  .accounts({
    market: marketPubkey,
    vault,
    vaultAuthority,
    lpPosition,                 // derive: ["lp_position", market, user]
    userTokenAccount: userAta,
    user: userWallet,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### 7.8 Claim Payout

```typescript
const tx = await program.methods
  .claimPayout()
  .accounts({
    protocolConfig,
    market: marketPubkey,
    vault,
    vaultAuthority,
    userPosition,
    userTokenAccount: userAta,
    user: userWallet,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### 7.9 Resolve Market (Oracle Only)

```typescript
const tx = await program.methods
  .resolveMarket(
    outcomeIndex,               // winning outcome (0-indexed)
    new BN(value),              // exact value for continuous markets (0 for binary/multi)
  )
  .accounts({
    market: marketPubkey,
    oracle: oracleWallet,
  })
  .rpc();
```

---

## 8. PDA Derivation Reference

All PDA derivation uses `PublicKey.findProgramAddressSync()`:

```typescript
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL");

// Protocol Config (singleton)
const [protocolConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol_config")],
  PROGRAM_ID,
);

// User Role
const [userRole] = PublicKey.findProgramAddressSync(
  [Buffer.from("user_role"), userPubkey.toBuffer(), Buffer.from([roleNumber])],
  PROGRAM_ID,
);

// Market (by sequential ID)
const marketIdBuf = Buffer.alloc(8);
marketIdBuf.writeBigUInt64LE(BigInt(marketId));
const [market] = PublicKey.findProgramAddressSync(
  [Buffer.from("market"), marketIdBuf],
  PROGRAM_ID,
);

// Vault Authority (per market)
const [vaultAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_authority"), marketPubkey.toBuffer()],
  PROGRAM_ID,
);

// User Position (per user per market)
const [userPosition] = PublicKey.findProgramAddressSync(
  [Buffer.from("user_position"), marketPubkey.toBuffer(), userPubkey.toBuffer()],
  PROGRAM_ID,
);

// LP Position (per user per market)
const [lpPosition] = PublicKey.findProgramAddressSync(
  [Buffer.from("lp_position"), marketPubkey.toBuffer(), userPubkey.toBuffer()],
  PROGRAM_ID,
);
```

### PDA Seed Summary Table

| Account | Seeds | Notes |
|---------|-------|-------|
| `ProtocolConfig` | `["protocol_config"]` | Singleton, created once |
| `UserRole` | `["user_role", user_pubkey, role_u8]` | role: 1=Admin, 2=Oracle, 3=Creator |
| `Market` | `["market", market_count.to_le_bytes()]` | market_count is u64 LE |
| `VaultAuthority` | `["vault_authority", market_pubkey]` | Signs token transfers |
| `UserPosition` | `["user_position", market_pubkey, user_pubkey]` | Created on first trade |
| `LpPosition` | `["lp_position", market_pubkey, user_pubkey]` | Created on first LP deposit |

---

## 9. AMM Math for UI Display

### 9.1 Computing Probabilities (for display)

The L2-norm AMM stores reserves and computes probability as:

```
x[i] = total_minted - reserves[i]     (position in outcome i)
price[i] = x[i]^2 / k_squared          (implied probability)
```

```typescript
function computeProbabilities(
  reserves: bigint[],
  totalMinted: bigint,
  kSquared: bigint,
): number[] {
  if (kSquared === 0n) {
    return reserves.map(() => 1 / reserves.length);
  }
  return reserves.map((r) => {
    const x = totalMinted - r;
    return Number((x * x * 10000n) / kSquared) / 10000;
  });
}
```

> Probabilities naturally sum to 1.0 (within rounding). Display as percentages.

### 9.2 Price Impact Visualization

```
  Before trade:    After trade:

  YES ████████░░   YES ██████████░
      65%              72%

  NO  ████░░░░░░   NO  ███░░░░░░░░
      35%              28%
```

Use the `/amm/estimate-buy` endpoint's `newProbabilities` to show price impact before the user confirms.

### 9.3 SCALE Constant

All on-chain amounts use fixed-point arithmetic with `SCALE = 1,000,000,000` (10^9).

**Collateral amounts** are in token-native units (e.g., USDC has 6 decimals, so 1 USDC = 1,000,000). Collateral does NOT use SCALE.

**Probabilities in `buy_to_price`** use SCALE: a probability of 72% = `720_000_000`.

**Range min/max** for continuous markets are stored in SCALE units.

---

## 10. Market Lifecycle State Machine

```
                        ┌──────────────┐
                        │   Created    │
                        │  (state=0)   │
                        └──────┬───────┘
                               │  create_market tx succeeds
                               │  (initial liquidity deposited)
                               ▼
                        ┌──────────────┐
               ┌───────►│   Active     │◄────────┐
               │        │  (state=0)   │         │
               │        └───┬──────┬───┘         │
               │            │      │             │
               │     pause  │      │  deadline   │  unpause
               │     (admin)│      │  passes*    │  (admin, before
               │            │      │             │   deadline)
               │            ▼      │             │
               │     ┌──────────┐  │      ┌──────┴─────┐
               │     │  Paused  │  │      │  Unpause   │
               │     │ (state=1)│──┘      │  Request   │
               │     └────┬─────┘         └────────────┘
               │          │
               │          │  deadline passes*
               │          ▼
               │   ┌─────────────────┐
               │   │    Pending      │
               └───│  Resolution     │
                   │  (state=2)      │
                   └────────┬────────┘
                            │  resolve_market (oracle)
                            ▼
                   ┌─────────────────┐
                   │   Resolved      │
                   │  (state=3)      │
                   └────────┬────────┘
                            │  claim_payout (traders)
                            │  remove_liquidity (LPs)
                            ▼
                   ┌─────────────────┐
                   │   Settled       │
                   │  (all claimed)  │
                   └─────────────────┘

  * Deadline enforcement is LAZY: state transitions to
    PendingResolution on the first instruction that touches
    the market after deadline passes (e.g., buy, sell,
    pause, etc.). No cron job.
```

### What's Allowed in Each State

| State | Trading | LP Add | LP Remove | Pause/Unpause | Resolve | Claim |
|-------|---------|--------|-----------|---------------|---------|-------|
| **Active** (0) | Yes | Yes | Yes | Pause only | No | No |
| **Paused** (1) | No | No | No | Unpause only (before deadline) | No | No |
| **PendingResolution** (2) | No | No | No | No | Yes (oracle) | No |
| **Resolved** (3) | No | No | Yes (LP exit) | No | No | Yes |

### Frontend Implications

- **Show countdown** for active markets approaching deadline
- **Show "Awaiting Resolution"** for state=2
- **Show "Claim Payout" button** for state=3 (if user has winning tokens)
- **Disable trading UI** for non-active states
- **Show "Paused" badge** for state=1

---

## 11. User Roles & Permissions

```
                    Superadmin
                   (stored in ProtocolConfig.superadmin)
                        │
                        │ can assign/revoke
                        ▼
                ┌───────────────┐
                │     Admin     │  (role = 1)
                │               │
                │ can assign:   │
                │  Oracle,      │
                │  Creator      │
                │ can pause/    │
                │  unpause mkts │
                └───┬───────┬───┘
                    │       │
           ┌────────┘       └────────┐
           ▼                         ▼
    ┌─────────────┐          ┌─────────────┐
    │   Oracle    │          │  Creator    │
    │  (role = 2) │          │  (role = 3) │
    │             │          │             │
    │ resolves    │          │ creates     │
    │ assigned    │          │ markets     │
    │ markets     │          │             │
    └─────────────┘          └─────────────┘

    ┌─────────────┐
    │   Trader    │   (default — any wallet, no role PDA needed)
    │             │
    │ buy, sell,  │
    │ LP, claim   │
    └─────────────┘
```

### How to Check Roles in Frontend

```typescript
// Check if wallet has a specific role
async function hasRole(wallet: PublicKey, role: number): Promise<boolean> {
  const [rolePda] = deriveUserRole(PROGRAM_ID, wallet, role);
  try {
    const account = await program.account.userRole.fetch(rolePda);
    return account !== null;
  } catch {
    return false; // Account doesn't exist = no role
  }
}

// Usage
const isAdmin = await hasRole(wallet, 1);
const isOracle = await hasRole(wallet, 2);
const isCreator = await hasRole(wallet, 3);

// Check superadmin
const config = await program.account.protocolConfig.fetch(protocolConfigPda);
const isSuperadmin = config.superadmin.equals(wallet);
```

### UI Visibility by Role

| Feature | Trader | Creator | Oracle | Admin | Superadmin |
|---------|--------|---------|--------|-------|------------|
| Browse markets | Yes | Yes | Yes | Yes | Yes |
| Trade / LP | Yes | Yes | Yes | Yes | Yes |
| Create market | No | **Yes** | No | **Yes** | **Yes** |
| Pause/Unpause | No | No | No | **Yes** | **Yes** |
| Resolve market | No | No | **Assigned only** | No | No |
| Manage roles | No | No | No | **Oracle/Creator** | **All roles** |
| Update fees | No | No | No | No | **Yes** |
| Collect fees | No | No | No | No | **Yes** |

---

## 12. Shared Types & Constants

### Package Location

```
packages/shared/src/
├── types.ts    # On-chain types, enums, constants, API display types
├── api.ts      # REST API request/response types, WebSocket events
└── index.ts    # Re-exports everything
```

### Key Constants

```typescript
export const MAX_OUTCOMES = 32;      // Max outcomes in multi-outcome market
export const MAX_BINS = 256;         // Max bins in continuous market
export const MIN_LIQUIDITY = 1_000_000;  // 1 USDC (6 decimals)
export const MIN_TRADE_AMOUNT = 1_000;   // 0.001 USDC
export const MAX_FEE_BPS = 5_000;    // 50% max fee
export const SCALE = 1_000_000_000;  // 10^9 fixed-point scale
```

### Key Enums

```typescript
export enum MarketType {
  Binary = 0,
  MultiOutcome = 1,
  Continuous = 2,
}

export enum MarketState {
  Active = 0,
  Paused = 1,
  PendingResolution = 2,
  Resolved = 3,
}

export enum Role {
  Admin = 1,
  Oracle = 2,
  Creator = 3,
}
```

### Important Type Notes

- **All large numbers** (u64, u128) come as `BN` (bn.js) from Anchor and as `string` from the backend API. Always use BigInt or BN for arithmetic — never `Number` for amounts.
- **Probabilities** from the backend are `number[]` with values 0..1. These are approximate (JavaScript float precision).
- **Wallet addresses** are base58-encoded strings in API responses.

---

## 13. Error Handling

### On-Chain Error Codes

The program defines 35 error codes in `DekantPmError`. Anchor auto-assigns numeric codes starting from 6000 based on enum order — **always match on error name strings, not numeric codes.** Common ones the frontend should handle:

| Error Name | When | Suggested User Message |
|------------|------|----------------------|
| `Unauthorized` | Wrong role for operation | "You don't have permission for this action" |
| `MarketNotActive` | Trading on non-active market | "This market is not active" |
| `MarketClosed` | Trading after deadline | "Market deadline has passed" |
| `MarketPaused` | Trading on paused market | "This market is paused" |
| `InsufficientBalance` | Trade amount > user balance | "Insufficient balance" |
| `InsufficientHoldings` | Selling more than you own | "Insufficient token holdings" |
| `InsufficientLiquidity` | AMM can't fill the trade | "Not enough liquidity" |
| `TradeTooSmall` | Below MIN_TRADE_AMOUNT | "Minimum trade is 0.001 USDC" |
| `MaxCollateralExceeded` | buy_to_price slippage exceeded | "Price moved — try again with higher slippage" |
| `MinCollateralNotMet` | sell_to_price slippage exceeded | "Price moved — try again with lower slippage" |
| `InvalidProbability` | Target prob out of valid range | "Invalid target probability" |
| `TargetAlreadyMet` | Price already past target | "Target price already reached" |
| `InvalidSigma` | sigma=0 in distribution trade | "Confidence must be greater than zero" |
| `WrongMarketType` | e.g., buy_distribution on binary | "Wrong instruction for this market type" |
| `AlreadyClaimed` | Double claim attempt | "You already claimed your payout" |
| `NothingToClaim` | No winning tokens held | "No winning tokens to claim" |
| `MathOverflow` | Arithmetic error (amount too large) | "Amount too large" |
| `InsufficientShares` | LP removing more than they hold | "Insufficient LP shares" |
| `LiquidityTooSmall` | LP deposit below minimum | "Minimum liquidity is 1 USDC" |
| `WrongOracle` | Non-assigned oracle trying to resolve | "You are not the oracle for this market" |

### Parsing Anchor Errors

```typescript
import { AnchorError } from "@coral-xyz/anchor";

try {
  const tx = await program.methods.buy(outcome, amount).accounts({...}).rpc();
} catch (err) {
  if (err instanceof AnchorError) {
    const errorCode = err.error.errorCode.code;
    const errorMsg = err.error.errorMessage;

    switch (errorCode) {
      case "InsufficientBalance":
        toast.error("Insufficient balance");
        break;
      case "MaxCollateralExceeded":
        toast.error("Price moved — try again with higher slippage");
        break;
      case "MarketNotActive":
        toast.error("This market is no longer active");
        break;
      case "MarketClosed":
        toast.error("Market deadline has passed");
        break;
      case "MarketPaused":
        toast.error("This market is paused");
        break;
      default:
        toast.error(errorMsg);
    }
  } else {
    // RPC or network error
    toast.error("Transaction failed. Check your connection.");
  }
}
```

### Backend API Errors

```json
{
  "statusCode": 404,
  "message": "Market not found",
  "error": "Not Found"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (validation failed) |
| 401 | Unauthorized (missing/invalid JWT) |
| 404 | Resource not found |
| 500 | Internal server error |

---

## 14. Known Backend Limitations

These are documented bugs/limitations. The frontend should work around them:

| ID | Issue | Frontend Workaround |
|----|-------|-------------------|
| **C4** | Backend AMM invariant is wrong (`totalMinted^2` instead of `sum_of_squares`) | Don't rely on backend probability estimates for critical decisions. Compute client-side from on-chain reserves for accuracy. |
| **C3** | LP removal events not indexed | After LP removal, fetch LP position from on-chain directly rather than relying on backend. |
| **H3** | Admin endpoints lack role authorization | Any authenticated user can call `/admin/*`. Not a security risk (no mutations), but don't expose admin data broadly. |
| **H4** | Trades recorded with slot=0 | Don't rely on slot field for ordering. Use timestamp or tx signature instead. |
| **M1** | Distribution sell estimation not implemented | For continuous market sell estimation, compute client-side or use per-bin discrete sells. |
| **M2** | Precision loss in backend `getPrices` | For accurate probabilities, compute from on-chain reserves using BigInt. |

### Recommended Pattern: Dual-Source Data

```typescript
// For discovery (fast, paginated):
const markets = await fetch("/markets?state=0&sortBy=volume");

// For trading (accurate, fresh):
const marketAccount = await program.account.market.fetch(marketPda);
const probabilities = computeProbabilities(
  marketAccount.reserves,
  marketAccount.totalMinted,
  marketAccount.kSquared,
);
```

---

## 15. Frontend Task Checklist (F-1 → F-13)

| Task | Name | Description |
|------|------|-------------|
| **F-1** | Scaffolding | Next.js + Tailwind + shadcn/ui + Solana deps |
| **F-2** | Wallet & Provider | `WalletProvider`, `ConnectionProvider`, wallet connect button |
| **F-3** | Layout | App shell: navbar, sidebar, footer, responsive layout |
| **F-4** | Market Discovery | Market list page with filters, search, pagination |
| **F-5** | Market Detail | Market detail page with price chart, info, trade history |
| **F-6** | Trading Panel (Binary/Multi) | Buy/sell UI for binary and multi-outcome markets |
| **F-7** | Distribution Input | Center + confidence input with bell curve visualization |
| **F-8** | Trade Execution | Transaction building, wallet signing, confirmation flow |
| **F-9** | Portfolio | User positions, LP positions, trade history, claim UI |
| **F-10** | Admin Dashboard | Role management, fee config, market pause controls |
| **F-11** | Market Creation Form | Multi-step form for creating all 3 market types |
| **F-12** | Oracle Dashboard | Pending markets list, resolution submission |
| **F-13** | E2E Smoke Test | Cypress/Playwright: connect wallet, browse, trade |

### Dependency Chain

```
F-1 ──► F-2 ──► F-3 ──► F-4 ──► F-5 ──► F-6 ──► F-7
                                    │               │
                                    │               ▼
                                    │             F-8
                                    │               │
                                    ▼               ▼
                                  F-9            F-11
                                    │               │
                                    ▼               ▼
                                  F-10           F-12
                                    │               │
                                    └───────┬───────┘
                                            ▼
                                          F-13
```

### Recommended Stack

| Library | Purpose |
|---------|---------|
| `next` (App Router) | Framework |
| `tailwindcss` + `shadcn/ui` | Styling + components |
| `@solana/wallet-adapter-react` | Wallet connection |
| `@coral-xyz/anchor` | Program interaction |
| `@solana/web3.js` | Solana primitives |
| `@tanstack/react-query` | Data fetching + caching |
| `react-hook-form` + `zod` | Form management |
| `recharts` or `d3` | Probability charts |
| `bn.js` | Big number arithmetic |

---

## Appendix A: Fee Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            FEE FLOW                                     │
│                                                                         │
│  ┌─────────┐    creation_fee     ┌──────────────────┐                   │
│  │ Creator │ ──────────────────► │ protocol_fee_    │                   │
│  └─────────┘    (0.5% default)   │ accumulated      │                   │
│                                  │ (in vault)       │                   │
│  ┌─────────┐    trade_fee        │                  │                   │
│  │ Trader  │ ──────────────────► │                  │                   │
│  └─────────┘    (0.3% default)   │  protocol share  │                   │
│                       │          │  (50% default)   │──► collect_fees   │
│                       │          └──────────────────┘    (superadmin    │
│                       │                                   sweeps to     │
│                       │          ┌──────────────────┐     treasury)     │
│                       └────────► │ lp_fee_          │                   │
│                                  │ accumulated      │                   │
│                                  │ (in vault)       │──► LP withdrawal  │
│                                  │  LP share        │    (proportional  │
│                                  │  (50% default)   │     to shares)    │
│  ┌─────────┐    redemption_fee   └──────────────────┘                   │
│  │ Claimer │ ──────────────────► protocol_fee_accumulated               │
│  └─────────┘    (0.5% default)                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

| Fee | Default | Range | When Charged | Destination |
|-----|---------|-------|-------------|-------------|
| `creation_fee_bps` | 50 (0.5%) | 0–5000 | Market creation | Protocol |
| `trade_fee_bps` | 30 (0.3%) | 0–5000 | Every buy/sell | Split: LP + Protocol |
| `redemption_fee_bps` | 50 (0.5%) | 0–5000 | Claim payout | Protocol |
| `lp_fee_share_bps` | 5000 (50%) | 0–10000 | Trade fee split | Fraction → LPs |

### Fee Calculation Example

```
User buys 1,000,000 (1 USDC) of outcome 0:
  trade_fee = 1,000,000 * 30 / 10,000 = 3,000 (0.003 USDC)
  effective_collateral = 1,000,000 - 3,000 = 997,000

  lp_fee = 3,000 * 5,000 / 10,000 = 1,500  → lp_fee_accumulated
  protocol_fee = 3,000 - 1,500 = 1,500       → protocol_fee_accumulated
```

---

## Appendix B: Collateral & Token Decimals

| Token | Decimals | 1 unit = | Example |
|-------|----------|----------|---------|
| USDC | 6 | 1,000,000 | `1 USDC = BN(1_000_000)` |
| USDT | 6 | 1,000,000 | `1 USDT = BN(1_000_000)` |

**Display formatting:**

```typescript
function formatCollateral(amount: BN | string, decimals: number = 6): string {
  const num = typeof amount === 'string' ? BigInt(amount) : BigInt(amount.toString());
  const divisor = BigInt(10 ** decimals);
  const whole = num / divisor;
  const frac = num % divisor;
  return `${whole}.${frac.toString().padStart(decimals, '0')}`;
}

// formatCollateral("1000000") → "1.000000"
// formatCollateral("3000") → "0.003000"
```

---

## Appendix C: WebSocket Events (Future)

The shared types define WebSocket event types for real-time updates. These are NOT yet implemented in the backend but are planned:

```typescript
enum WsEventType {
  MarketUpdate = "market_update",
  TradeExecuted = "trade_executed",
  MarketResolved = "market_resolved",
  PriceUpdate = "price_update",
  LiquidityUpdate = "liquidity_update",
}
```

Until WebSocket support is implemented, use polling or `@tanstack/react-query` with `refetchInterval` for near-real-time updates.

---

## Appendix D: Quick Reference — Most Common Operations

| Operation | Backend Call | On-Chain Tx | Notes |
|-----------|------------|-------------|-------|
| Browse markets | `GET /markets` | — | Paginated, filterable |
| View market | `GET /markets/:id` | `program.account.market.fetch()` | Backend for metadata, RPC for fresh state |
| Get prices | `GET /markets/:id/prices` | Compute from reserves | Backend may be stale — see §14 |
| Estimate buy | `POST /amm/estimate-buy` | — | Preview only |
| Buy (binary) | — | `program.methods.buy()` | Wallet signs |
| Buy (continuous) | — | `program.methods.buyDistribution()` | μ, σ as scaled BN |
| Sell | — | `program.methods.sell()` | Wallet signs |
| Add LP | — | `program.methods.addLiquidity()` | Any active market |
| Remove LP | — | `program.methods.removeLiquidity()` | Even after resolution |
| Claim payout | — | `program.methods.claimPayout()` | Resolved market only |
| Create market | — + `POST /markets` | `program.methods.createMarket()` | Two-phase: tx first, then metadata |
| Authenticate | `POST /auth/challenge` → `POST /auth/verify` | — | Wallet signs message |
| View positions | `GET /users/:addr/positions` | `program.account.userPosition.fetch()` | Backend for list, RPC for accuracy |

---

*End of Frontend Developer Guide v1.0*
