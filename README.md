# DekantPM Prediction Market Protocol

A decentralized prediction market protocol on Solana that supports **continuous outcome ranges** using an L2-norm constant-function AMM (CFAMM) based on Paradigm's [Distribution Markets](https://www.paradigm.xyz/2024/11/distribution-markets) research.

Unlike binary-only platforms (Polymarket, Kalshi), DekantPM lets traders express full probability distributions over continuous ranges of outcomes — placing capital behind parameterized beliefs rather than simple directional bets.

## What Makes DekantPM Different

- **Distribution Trading** — Traders specify a center (mu) and confidence (sigma) to place Gaussian-weighted positions across continuous outcomes, not just "Yes/No"
- **Three Market Types** — Binary, multi-outcome (up to 32), and continuous range markets (up to 256 bins)
- **L2-Norm AMM** — Invariant `Sum(reserves[i]^2) = k^2` provides automated liquidity without orderbooks
- **On-Chain Math** — All arithmetic in u64/u128 fixed-point (scale 10^9), no floating-point anywhere
- **Role-Based Access** — Superadmin, Admin, Oracle, and Creator roles with on-chain PDA enforcement

## Architecture

```
pm-cont/
├── programs/dekant-pm/         # Solana program (Anchor/Rust)
│   └── src/
│       ├── lib.rs          # 16 instructions
│       ├── state/          # 5 account types (PDA-based)
│       ├── instructions/   # Admin, Market, Trading handlers
│       ├── engine/         # AMM core, fixed-point math, sqrt, normal PDF
│       ├── constants.rs    # Seeds, limits, scale factors
│       ├── errors.rs       # 41 error codes
│       └── events.rs       # 11 event types
├── packages/shared/        # Shared TypeScript types & API contracts
│   └── src/
│       ├── types.ts        # Mirrors on-chain structs (BN-based)
│       └── api.ts          # REST/WS API contract definitions
├── tests/                  # Integration tests (ts-mocha)
│   └── lifecycle.ts        # 58 integration tests across 9 suites
├── backend/                # NestJS backend (API, indexer, AMM estimation)
├── frontend/               # Next.js frontend (trading UI, admin, portfolio)
├── PRD.md                  # Product requirements document
├── TDD.md                  # Technical design document
└── TASKS.md                # Implementation task breakdown
```

## Market Types

| Type | Outcomes | Trading Style | Example |
|------|----------|---------------|---------|
| **Binary** | 2 (Yes/No) | Discrete buy/sell | "Will BTC exceed $100k?" |
| **Multi-Outcome** | 3–32 discrete | Discrete buy/sell | "Which studio wins Best Picture?" |
| **Continuous** | 2–256 bins over a range | Distribution buy/sell (Normal PDF) | "What will SOL price be on July 1?" |

## Market Lifecycle

```
create_market → Active → (pause) → Paused → (unpause) → Active or PendingResolution
                  │                                              │
                  └─────── (deadline passes) ───→ PendingResolution
                                                       │
                                                  resolve_market
                                                       │
                                                    Resolved → claim_payout
```

Deadline enforcement is lazy — the first instruction touching a market after its deadline auto-transitions it to `PendingResolution`.

## On-Chain Instructions (16)

### Admin
| Instruction | Signer | Description |
|-------------|--------|-------------|
| `initialize` | Deployer | One-time protocol setup: superadmin, treasury, default fees |
| `assign_role` | Admin+ | Grant Admin/Oracle/Creator role (creates UserRole PDA) |
| `revoke_role` | Admin+ | Revoke role (closes UserRole PDA, reclaims rent) |
| `update_fees` | Superadmin | Update fee basis points |
| `collect_fees` | Superadmin | Sweep protocol fees from market vault to treasury |

### Market Management
| Instruction | Signer | Description |
|-------------|--------|-------------|
| `create_market` | Creator+ | Create market with initial liquidity, assign oracle |
| `pause_market` | Admin+ | Freeze all trading (emergency halt) |
| `unpause_market` | Admin+ | Resume trading or transition to PendingResolution |
| `resolve_market` | Oracle | Submit resolved outcome/value |

### Trading
| Instruction | Signer | Description |
|-------------|--------|-------------|
| `buy` | Trader | Buy tokens for a single discrete outcome |
| `sell` | Trader | Sell tokens for a single discrete outcome |
| `buy_distribution` | Trader | Buy across bins via Normal(mu, sigma) weighting |
| `sell_distribution` | Trader | Sell across bins via Normal(mu, sigma) weighting |
| `add_liquidity` | LP | Deposit proportional liquidity, receive LP shares |
| `remove_liquidity` | LP | Burn LP shares, receive collateral + fee share |
| `claim_payout` | Trader | Redeem winning tokens from resolved market |

## Fee Model

| Fee | Default | Applied When |
|-----|---------|--------------|
| Creation fee | 0.5% (50 bps) | Market creation (deducted from initial liquidity) |
| Trade fee | 0.3% (30 bps) | Every buy/sell — split between LPs and protocol |
| Redemption fee | 0.5% (50 bps) | Payout claim |
| LP fee share | 50% (5000 bps) | Portion of trade fee routed to LPs |

All fees are configurable by the superadmin via `update_fees`. Maximum rate fee is 50%.

---

## Program

### Prerequisites

- **Rust** — 1.79+ (via `rustup`)
- **Solana CLI** — v1.18+ (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`)
- **Anchor CLI** — v0.32.1 (`cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.32.1 && avm use 0.32.1`)
- **Node.js** — v20.18+ and **Yarn** v1

### Build

```bash
anchor build
```

This compiles the program to `target/deploy/dekant_pm.so` and generates the IDL at `target/idl/dekant_pm.json`.

### Run Rust Unit Tests

The program has **142 unit tests** covering the AMM engine, market state machine, fixed-point arithmetic, and normal PDF computation.

```bash
cargo test --manifest-path programs/dekant-pm/Cargo.toml
```

Or run all workspace tests:

```bash
cargo test
```

### Deploy

**Localnet** (for development):

```bash
# Start a local validator (in a separate terminal)
solana-test-validator

# Deploy
anchor deploy --provider.cluster localnet
```

**Devnet**:

```bash
# Ensure your wallet has devnet SOL
solana airdrop 5 --url devnet

# Deploy
anchor deploy --provider.cluster devnet
```

The program ID is `F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL` (declared in `lib.rs` and `Anchor.toml`). To deploy under a different keypair, update `declare_id!` and regenerate the program keypair.

### Run Integration Tests

The test suite contains **58 integration tests** across 9 suites covering the full protocol lifecycle:

1. **Protocol Setup** — Initialize, role assignment, fee updates
2. **Binary Market** — Create, buy, sell, add/remove liquidity, resolve, claim payout
3. **Multi-Outcome Market** — 4-outcome market lifecycle
4. **Continuous Market** — Distribution buy/sell with Normal PDF
5. **Error Cases** — Insufficient balance, deadline enforcement, minimum trade
6. **Role Revocation** — Superadmin/admin revoke, unauthorized attempts
7. **Paused Market Resolution** — Pause blocks oracle, unpause re-enables resolution
8. **Sell Distribution** — Continuous sell, min trade, wrong market type guards
9. **Superadmin Pause** — Pause without role PDA, unauthorized pause rejection

```bash
# Install dependencies
yarn install

# Run tests (requires anchor localnet — starts automatically)
anchor test
```

To run tests without restarting the validator:

```bash
anchor test --skip-local-validator
```

---

## Backend (Planned)

The backend is a **NestJS** application that serves as a read cache and metadata store. It does not hold private keys or sign transactions.

### Responsibilities

- **Indexer Service** — Subscribe to on-chain events via Solana WebSocket, index into PostgreSQL
- **Market Service** — REST API for market discovery, filtering, and metadata (title, description, tags)
- **Auth Service** — Wallet signature verification for protected endpoints
- **Cost Estimator** — Off-chain AMM simulation for trade previews (no gas cost)

### API Contracts

Shared TypeScript types and API contracts are defined in `packages/shared/src/`:

- `types.ts` — On-chain account types, enums, pagination, filters
- `api.ts` — REST/WS endpoint request/response interfaces

### How to Run (once implemented)

```bash
cd backend

# Install dependencies
yarn install

# Configure environment
cp .env.example .env
# Edit .env with your database URL, Solana RPC endpoint, etc.

# Run database migrations
yarn migration:run

# Start in development mode
yarn start:dev

# Start in production mode
yarn build && yarn start:prod
```

### Key Endpoints (planned)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/markets` | List markets with filters & pagination |
| GET | `/markets/:id` | Market detail with on-chain state |
| GET | `/markets/:id/prices` | Current implied probabilities |
| GET | `/markets/:id/history` | Trade history |
| POST | `/markets` | Create off-chain metadata for a market |
| GET | `/users/:address/positions` | User's open positions |
| GET | `/users/:address/lp` | User's LP positions |
| WS | `/ws` | Real-time market updates |

---

## Frontend (Planned)

The frontend is a **Next.js** desktop-first web application that connects to Solana wallets (Phantom, Solflare, Backpack) for transaction signing.

### Responsibilities

- Market browsing with category/type/state filters
- Trading UI with distribution visualization (Normal PDF curve)
- Portfolio management (positions, PnL, LP shares)
- Admin panel (role management, market pause/unpause, fee config)
- Oracle panel (pending resolutions, outcome submission)

### How to Run (once implemented)

```bash
cd frontend

# Install dependencies
yarn install

# Configure environment
cp .env.example .env
# Edit .env with your backend URL, Solana RPC endpoint, program ID

# Start in development mode
yarn dev

# Build for production
yarn build && yarn start
```

---

## Shared Package

`packages/shared/` contains TypeScript types shared between backend and frontend:

```bash
cd packages/shared

# Build
yarn build
```

This package mirrors all on-chain account structures, enums, constants, and defines the REST/WS API contracts so both backend and frontend stay in sync.

---

## Project Configuration

| File | Purpose |
|------|---------|
| `Anchor.toml` | Anchor framework config (version, program IDs, cluster, test script) |
| `Cargo.toml` | Rust workspace with release optimizations (overflow-checks, LTO, single codegen unit) |
| `programs/dekant-pm/Cargo.toml` | Program crate (anchor-lang 0.32.1, anchor-spl 0.32.1) |
| `package.json` | Node dependencies (@coral-xyz/anchor 0.32.1, @solana/web3.js 1.98.4) |
| `tsconfig.json` | TypeScript config for integration tests (ES6, Mocha/Chai) |

## Key Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `SCALE` | 10^9 | Fixed-point arithmetic precision |
| `MAX_OUTCOMES` | 32 | Max discrete outcomes |
| `MAX_BINS` | 256 | Max continuous bins |
| `MIN_LIQUIDITY` | 1,000,000 | 1 USDC minimum initial liquidity |
| `MIN_TRADE_AMOUNT` | 1,000 | 0.001 USDC minimum trade |
| `MAX_FEE_BPS` | 5,000 | 50% fee cap |
| `INVARIANT_TOLERANCE` | 256 | Rounding tolerance for L2-norm checks |

## AMM Reference

The L2-norm CFAMM maintains the invariant `Sum(reserves[i]^2) = k^2`:

- **Buy** — Mint complete sets, drain target outcome via `isqrt(k^2 - sum_others_sq)`
- **Sell** — Add tokens back, solve quadratic for burn amount
- **Distribution Buy** — Gaussian-weighted multi-bin purchase via lambda solve
- **Distribution Sell** — Gaussian-weighted multi-bin sale with quadratic burn
- **Implied Probability** — `price[i] = reserves[i]^2 / k^2`
- **LP Add** — Scale all reserves proportionally, mint LP shares
- **LP Remove** — Scale down reserves, return collateral + accumulated LP fees

For the full mathematical specification, see [TDD.md](TDD.md) Section 5.

## License

All rights reserved.
