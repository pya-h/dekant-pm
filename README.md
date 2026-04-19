# DekantPM Prediction Market Protocol

A decentralized prediction market protocol on Solana that supports **continuous outcome ranges** using an L2-norm constant-function AMM (CFAMM) based on Paradigm's [Distribution Markets](https://www.paradigm.xyz/2024/11/distribution-markets) research.

Unlike binary-only platforms (Polymarket, Kalshi), DekantPM lets traders express full probability distributions over continuous ranges of outcomes — placing capital behind parameterized beliefs rather than simple directional bets.

## Live Deployment

| Component | URL |
|-----------|-----|
| Frontend | https://dekant.pyron.fi/ |
| Backend API | https://dekant-api.pyron.fi |
| Program | `F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL` on Solana **devnet** |

## What Makes DekantPM Different

- **Distribution Trading** — Traders specify a center (mu) and confidence (sigma) to place Gaussian-weighted positions across continuous outcomes, not just "Yes/No"
- **Three Market Types** — Binary, multi-outcome (up to 32), and continuous range markets (up to 256 bins)
- **L2-Norm AMM** — Invariant `Sum(x[i]^2) = k^2` provides automated liquidity without orderbooks
- **On-Chain Math** — All arithmetic in u64/u128 fixed-point (scale 10^9), no floating-point anywhere
- **Role-Based Access** — Superadmin, Admin, Oracle, and Creator roles with on-chain PDA enforcement

## Architecture

DekantPM is a full-stack protocol with three main sections:

```
pm-cont/
├── programs/dekant-pm/    # Solana program (Anchor/Rust) ─── on-chain logic
├── backend/               # NestJS API + indexer ─────────── off-chain read cache
├── frontend/              # Next.js trading UI ───────────── user interface
│
├── tests/                 # Integration tests (ts-mocha, 70 tests)
├── packages/shared/       # Shared TypeScript types & API contracts
├── devkit/                # CLI for direct program interaction
├── scripts/               # Bash orchestration & E2E smoke tests
└── plans/                 # Design docs (PRD, TDD, tasks, bug reports)
```

**Data flow:**

```
  Trader (browser)
       │
       ▼
  ┌──────────┐    read cache     ┌──────────┐    on-chain events    ┌──────────┐
  │ Frontend  │ ◄───────────────► │ Backend  │ ◄────────────────────► │ Solana   │
  │ (Next.js) │                   │ (NestJS) │    (WebSocket sub)    │ Program  │
  └──────────┘                    └──────────┘                       └──────────┘
       │                                                                  ▲
       └───────────── signs & sends transactions ─────────────────────────┘
```

- The **program** holds all state on-chain: markets, positions, reserves, LP shares, fees
- The **backend** indexes on-chain events into PostgreSQL for fast queries and serves a REST API
- The **frontend** reads from the backend API and sends transactions directly to the program via wallet

Each section has its own detailed README:

- [**programs/dekant-pm/README.md**](programs/dekant-pm/README.md) — On-chain program: instructions, state, AMM math, errors, events
- [**backend/README.md**](backend/README.md) — Backend API: modules, endpoints, indexer, entities, Docker setup
- [**frontend/README.md**](frontend/README.md) — Frontend app: pages, components, hooks, wallet integration, styling

## Market Types

| Type | Outcomes | Trading Style | Example |
|------|----------|---------------|---------|
| **Binary** | 2 (Yes/No) | Discrete buy/sell | "Will BTC exceed $100k?" |
| **Multi-Outcome** | 3-32 discrete | Discrete buy/sell | "Which studio wins Best Picture?" |
| **Continuous** | 2-256 bins over a range | Distribution buy/sell (Normal PDF) | "What will SOL price be on July 1?" |

## Market Lifecycle

```
create_market --> Active --> (pause) --> Paused --> (unpause) --> Active or PendingResolution
                    |                                                    |
                    +------- (deadline passes) ------> PendingResolution |
                                                             |
                                                        resolve_market
                                                             |
                                                          Resolved --> claim_payout
```

Deadline enforcement is lazy — the first instruction touching a market after its deadline auto-transitions it to `PendingResolution`.

## On-Chain Instructions (17)

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
| `buy_to_price` | Trader | Buy until reaching a target probability |
| `sell_to_price` | Trader | Sell until reaching a target probability |
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

All fees are configurable by the superadmin via `update_fees`. Maximum fee is 50%.

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

The L2-norm CFAMM maintains the invariant `Sum(x[i]^2) = k^2` where `x[i] = totalMinted - reserves[i]`:

- **Buy** — Mint complete sets, drain target outcome via `isqrt(k^2 - sum_others_sq)`
- **Sell** — Add tokens back, solve quadratic for burn amount
- **Distribution Buy** — Gaussian-weighted multi-bin purchase via lambda solve
- **Distribution Sell** — Gaussian-weighted multi-bin sale with quadratic burn
- **Implied Probability** — `price[i] = x[i]^2 / k^2`
- **LP Add** — Scale all reserves proportionally, mint LP shares
- **LP Remove** — Scale down reserves, return collateral + accumulated LP fees

For the full mathematical specification, see [plans/TDD.md](plans/TDD.md) Section 5.

## Quick Start

### Prerequisites

- **Rust** 1.79+ (via `rustup`)
- **Solana CLI** v1.18+ (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`)
- **Anchor CLI** v0.32.1 (`avm install 0.32.1 && avm use 0.32.1`)
- **Node.js** v20.18+ and **Yarn** v1 (for integration tests)
- **PostgreSQL** 14+ (for the backend)
- **pnpm** (for the frontend)

### Build & Test Everything

```bash
# Build the Solana program
anchor build

# Run Rust unit tests (205 tests)
cargo test

# Run integration tests (70 tests, starts local validator)
anchor test

# Start the backend
cd backend && npm install && cp .env.example .env && npm run start:dev

# Start the frontend
cd frontend && pnpm install && cp .env.example .env.local && pnpm dev
```

### Automated Setup (scripts)

```bash
cd scripts

# Start everything (validator + backend + frontend)
bash setup.sh

# Run E2E smoke tests
bash e2e-smoke.sh

# Shutdown
bash down.sh
```

## Tooling

### Devkit

The `devkit/` directory provides a CLI for direct program interaction without the frontend:

```bash
cd devkit && cp .env.example .env

npx ts-node src/setup.ts init                              # Initialize protocol
npx ts-node src/market.ts create-binary "Will X?" 100      # Create binary market
npx ts-node src/trade.ts buy 1 0 50                        # Buy 50 on outcome 0
npx ts-node src/query.ts market 1                          # Query market state
```

### Scripts

The `scripts/` directory provides orchestration for the full local development environment:

- `setup.sh` — Start local validator, backend, frontend with configurable flags
- `e2e-smoke.sh` — End-to-end smoke tests across all market types
- `down.sh` — Graceful shutdown of all services
- `init-devnet.ts` — Initialize protocol on devnet after deployment

## Project Configuration

| File | Purpose |
|------|---------|
| `Anchor.toml` | Anchor framework config (version, program IDs, cluster, test script) |
| `Cargo.toml` | Rust workspace with release optimizations (overflow-checks, LTO) |
| `package.json` | Root Node.js deps for integration tests |
| `tsconfig.json` | TypeScript config for integration tests (ES6, Mocha/Chai) |

## Documentation

| Document | Location | Purpose |
|----------|----------|---------|
| Product Requirements | [plans/PRD.md](plans/PRD.md) | What the protocol should do |
| Technical Design | [plans/TDD.md](plans/TDD.md) | How it works (AMM math, architecture, data model) |
| Task Breakdown | [plans/TASKS.md](plans/TASKS.md) | 57-task dependency graph with status tracking |
| Frontend Guide | [plans/FRONTEND_GUIDE.md](plans/FRONTEND_GUIDE.md) | Frontend development reference |
| Bug Report | [plans/BUG_REPORT.md](plans/BUG_REPORT.md) | Tracked bugs by severity |

## Test Coverage

| Layer | Tests | Command |
|-------|-------|---------|
| Rust unit tests | 205 | `cargo test` |
| Integration tests | 70 | `anchor test` |
| Backend unit tests | 9 suites | `cd backend && npm test` |
| Backend E2E tests | 133 | `cd backend && npm run test:e2e` |

## License

All rights reserved.
