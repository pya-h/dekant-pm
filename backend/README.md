# DekantPM Backend

The off-chain backend for the DekantPM prediction market protocol. Built with [NestJS](https://nestjs.com/) 10, TypeORM, and PostgreSQL.

The backend serves as a **read cache and metadata store** — it does not hold private keys or sign transactions. All authoritative state lives on-chain. The backend indexes on-chain events in real-time, provides a REST API for market discovery and trading estimation, and stores off-chain metadata (titles, descriptions, categories).

## Live Deployment

| Environment | URL |
|-------------|-----|
| **Production** | https://dekant-api.pyron.fi |
| API Docs | https://dekant-api.pyron.fi/api/docs |
| Health Check | https://dekant-api.pyron.fi/health |

## Directory Structure

```
backend/
├── src/
│   ├── main.ts                      # App bootstrap (CORS, validation, Swagger)
│   ├── app.module.ts                # Root module: imports all 6 feature modules
│   ├── data-source.ts               # TypeORM data source (for migration CLI)
│   │
│   ├── common/                      # Shared utilities
│   │   ├── idl.ts                   # IDL loader (bundled or from target/)
│   │   ├── solana.provider.ts       # DI provider for Solana RPC connection
│   │   └── pda.ts                   # PDA derivation functions
│   │
│   ├── auth/                        # Wallet authentication
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts       # POST /auth/challenge, POST /auth/verify
│   │   ├── auth.service.ts          # Ed25519 signature verification, JWT issuance
│   │   ├── guard/auth.guard.ts      # JWT validation guard
│   │   └── dto/auth.dto.ts
│   │
│   ├── market/                      # Market queries and metadata
│   │   ├── market.module.ts
│   │   ├── market.controller.ts     # GET/POST /markets, prices, history
│   │   ├── market.service.ts        # Filtering, pagination, volume tracking
│   │   ├── entity/
│   │   │   ├── market.entity.ts     # MarketEntity (on-chain + off-chain fields)
│   │   │   └── trade.entity.ts      # TradeEntity (indexed from events)
│   │   └── dto/
│   │       ├── create-market.dto.ts
│   │       └── market-filter.dto.ts
│   │
│   ├── amm/                         # AMM estimation engine
│   │   ├── amm.module.ts
│   │   ├── amm.controller.ts       # POST /amm/estimate-buy, estimate-sell, etc.
│   │   ├── amm.service.ts          # L2-norm math (buy, sell, distribution)
│   │   ├── dto/amm.dto.ts
│   │   └── util/normal.ts          # Normal distribution bin weighting
│   │
│   ├── indexer/                     # On-chain event indexer
│   │   ├── indexer.module.ts
│   │   ├── indexer.service.ts       # Event listener, backfill, startup sync
│   │   ├── entity/
│   │   │   └── indexer-state.entity.ts  # Tracks last processed slot
│   │   └── util/parser.ts
│   │
│   ├── user/                        # User positions and admin queries
│   │   ├── user.module.ts
│   │   ├── user.controller.ts       # GET /users/:address/positions, lp-positions, history
│   │   ├── user.service.ts
│   │   └── entity/
│   │       ├── user-position.entity.ts
│   │       ├── lp-position.entity.ts
│   │       └── user-role.entity.ts
│   │
│   ├── health/                      # Health check
│   │   ├── health.module.ts
│   │   └── health.controller.ts     # GET /health
│   │
│   └── migrations/
│       └── 1708800000000-initial-schema.ts
│
├── test/                            # E2E tests
│   ├── jest-e2e.json
│   ├── helpers/
│   │   ├── test-app.ts              # Test module factory with mocked repos
│   │   └── mock-factories.ts        # Mock entity factories
│   ├── auth.e2e-spec.ts
│   ├── market.e2e-spec.ts
│   ├── amm.e2e-spec.ts
│   ├── user.e2e-spec.ts
│   └── health.e2e-spec.ts
│
├── idl/
│   └── dekant_pm.json               # Bundled IDL (for Docker, no Rust build needed)
│
├── Dockerfile                       # Multi-stage production build
├── package.json
├── tsconfig.json
├── nest-cli.json
├── .env                             # Development config
├── .env.production                  # Production config
└── .env.example                     # Template
```

## Modules

### Auth Module

Wallet authentication via Ed25519 signature verification and JWT issuance.

**Flow:**
1. Client requests a challenge: `POST /auth/challenge { walletAddress }`
2. Server returns a nonce and message to sign (expires in 5 minutes)
3. Client signs with wallet, sends back: `POST /auth/verify { walletAddress, signature, nonce }`
4. Server verifies the Ed25519 signature and returns a JWT (24h expiry)

The JWT is required for protected endpoints like `POST /markets` and admin routes. Challenges are stored in memory (ephemeral, not persisted).

### Market Module

Market metadata CRUD, discovery with filtering, trade history, and probability computation.

**Key responsibilities:**
- Create market metadata (title, description, category, tags, outcome labels)
- List markets with pagination, filtering (category, type, state, search), and sorting
- Compute implied probabilities from cached reserves: `price[i] = x[i]^2 / k^2`
- Serve paginated trade history per market
- Track volume and trader counts (updated by indexer events)

### AMM Module

Off-chain AMM estimation engine. Mirrors the on-chain L2-norm math in JavaScript for trade previews without gas costs.

**Estimation endpoints:**
- **Estimate buy** — Given collateral, compute tokens out + new probabilities
- **Estimate sell** — Given tokens, compute collateral out + new probabilities
- **Estimate buy-by-shares** — Given desired tokens, compute collateral needed
- **Estimate sell-by-collateral** — Given desired collateral, compute tokens needed
- **Distribution buy/sell** — Same as above but for continuous markets with mu/sigma

All estimates use 30 bps fee by default (matching on-chain defaults). Distribution operations are restricted to continuous markets (marketType=2).

### Indexer Module

Real-time event listener that syncs on-chain state into PostgreSQL.

**Startup sequence:**
1. `syncAllMarkets()` — Read market count from ProtocolConfig, fetch and upsert every market
2. `syncAllPositions()` — `getProgramAccounts` for all UserPosition accounts, upsert holdings
3. `syncAllLpPositions()` — `getProgramAccounts` for all LpPosition accounts, upsert shares
4. `backfill()` — Fetch all transaction signatures since `lastProcessedSlot`, parse and process events
5. `subscribeToLogs()` — WebSocket subscription for live event processing

**Health check:** Every 60 seconds, compares current slot to last processed slot. If lag exceeds 100 slots, triggers re-sync and backfill.

**Event handlers:**
| Event | Action |
|-------|--------|
| `MarketCreated` | Fetch and upsert market from on-chain |
| `TradePlaced` | Insert trade record, update volume/trader counts, sync user position |
| `MarketResolved` | Fetch and upsert market (now Resolved) |
| `MarketPaused`/`Unpaused` | Fetch and upsert market state |
| `PayoutClaimed` | Mark user position as claimed |
| `LiquidityChanged` | Sync market and LP position from on-chain |
| `RoleAssigned`/`Revoked` | Upsert or delete user role |

### User Module

User position queries, trade history, LP positions, and admin-only role management.

**User endpoints** — public, keyed by wallet address:
- Positions for a specific market
- All positions (with market relations)
- Trade history (paginated)
- LP positions

**Admin endpoints** — JWT required:
- List all role assignments
- Find stale markets (PendingResolution for more than N days)

### Health Module

Simple liveness probe: `GET /health` returns `{ status: "ok" }`.

## API Reference

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/challenge` | No | Request a sign-in challenge |
| POST | `/auth/verify` | No | Verify wallet signature, receive JWT |

### Markets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/markets` | No | List markets (filters: category, marketType, state, oracle, search; sort: newest/deadline/volume; pagination: page/limit) |
| GET | `/markets/:id` | No | Get single market |
| GET | `/markets/:id/prices` | No | Get implied probabilities |
| GET | `/markets/:id/history` | No | Get trade history (pagination: page/limit) |
| POST | `/markets` | JWT | Create market metadata |

### AMM Estimation

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/amm/estimate-buy` | No | Estimate discrete or distribution buy |
| POST | `/amm/estimate-sell` | No | Estimate discrete or distribution sell |
| POST | `/amm/estimate-buy-by-shares` | No | Estimate collateral needed for desired tokens |
| POST | `/amm/estimate-sell-by-collateral` | No | Estimate tokens needed for desired collateral |

The buy/sell endpoints auto-detect distribution mode when `mu` and `sigma` are provided in the request body.

### Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/:address/market-position/:marketId` | No | Position for one market |
| GET | `/users/:address/positions` | No | All positions |
| GET | `/users/:address/history` | No | Trade history (paginated) |
| GET | `/users/:address/lp-positions` | No | LP positions |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/roles` | JWT | All role assignments |
| GET | `/admin/markets/stale` | JWT | Markets stuck in PendingResolution |

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Liveness check |

## Entities

### MarketEntity

Combines on-chain state (cached from indexer) and off-chain metadata:

| Field | Type | Source |
|-------|------|--------|
| `id` | string (bigint) | On-chain `market_id` (PK) |
| `pubkey` | string | On-chain market PDA address |
| `marketType` | number | 0=Binary, 1=Multi, 2=Continuous |
| `state` | number | 0=Active, 1=Paused, 2=Pending, 3=Resolved |
| `reserves` | string[] | Cached reserves from on-chain |
| `kSquared`, `totalMinted` | string | Cached AMM state |
| `title`, `description`, `category`, `tags`, `imageUrl`, `outcomeLabels` | various | Off-chain metadata |
| `totalVolume`, `totalTraders`, `lastTradeAt` | various | Derived from indexed trades |

### TradeEntity

Immutable trade log, indexed from `TradePlaced` events:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Auto-generated |
| `marketId` | string | FK to market |
| `trader` | string | Wallet address |
| `isBuy` | boolean | Buy or sell |
| `collateralAmount` | string | Collateral involved |
| `outcomeIndex` | number | Target outcome (discrete) |
| `mu`, `sigma` | string/null | Distribution params (continuous) |
| `tokensTransacted` | string | Tokens moved |
| `feePaid` | string | Fee amount |
| `txSignature` | string | Solana tx signature (unique) |

### UserPositionEntity

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | string | Composite PK |
| `userAddress` | string | Composite PK |
| `holdings` | string[] | Token balance per outcome |
| `totalDeposited`, `totalWithdrawn` | string | Cumulative amounts |
| `claimed` | boolean | Payout claimed flag |

### LpPositionEntity

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | string | Composite PK |
| `userAddress` | string | Composite PK |
| `shares` | string | LP share amount |
| `depositedCollateral` | string | Cumulative deposit |

### UserRoleEntity

| Field | Type | Description |
|-------|------|-------------|
| `userAddress` | string | Composite PK |
| `role` | number | 0=Creator, 1=Oracle, 2=Admin |
| `assignedBy` | string | Who assigned it |
| `assignedAt` | Date | When assigned |

## Getting Started

### Prerequisites

- **Node.js** v20.18+
- **PostgreSQL** 14+
- **Solana RPC** endpoint (localnet or devnet)

### Install & Run

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database URL, Solana RPC, program ID, JWT secret

# Start in development mode (auto-reload)
npm run start:dev

# Or build and start in production mode
npm run build
npm run start:prod
```

The backend starts on port 4000 by default. Swagger API docs are available at `/api/docs`.

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/dekant_pm` |
| `SOLANA_RPC_URL` | Solana RPC endpoint | `http://localhost:8899` or `https://api.devnet.solana.com` |
| `PROGRAM_ID` | DekantPM program ID | `4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P` |
| `JWT_SECRET` | Secret for JWT signing | (random string, keep secret) |
| `PORT` | Server port | `4000` |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | `https://dekant.pyron.fi,http://localhost:3000` |
| `NODE_ENV` | Environment | `development` or `production` |
| `DB_SYNCHRONIZE` | Auto-create tables from entities | `true` (for Docker/first run) |

### Database Setup

**Development:** Set `DB_SYNCHRONIZE=true` in `.env` to auto-create tables from entity definitions.

**Production:** Run migrations:
```bash
npm run migration:run
```

### IDL Bundling

The backend needs the Anchor IDL to decode on-chain accounts. Two loading strategies:

1. **Local dev:** Reads from `../target/idl/dekant_pm.json` (generated by `anchor build`)
2. **Docker/production:** Reads from `backend/idl/dekant_pm.json` (bundled copy)

If you update the program, copy the new IDL: `cp target/idl/dekant_pm.json backend/idl/`

## Docker

```bash
docker build -t dekant-backend .
docker run -p 4000:4000 \
  -e DATABASE_URL=postgresql://... \
  -e SOLANA_RPC_URL=https://api.devnet.solana.com \
  -e PROGRAM_ID=4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P \
  -e JWT_SECRET=your-secret \
  -e DB_SYNCHRONIZE=true \
  dekant-backend
```

The Dockerfile uses a multi-stage build (builder + runtime) based on `node:20-slim`. The bundled IDL is copied into the image so no Rust toolchain is needed.

## Testing

### Unit Tests

9 test suites covering all service modules:

```bash
npm test
```

### E2E Tests

133 tests covering all API endpoints with mocked repositories:

```bash
npm run test:e2e
```

### Type Check

```bash
npm run typecheck
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Development mode with auto-reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start:prod` | Production mode (`node dist/main`) |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run E2E tests |
| `npm run typecheck` | Type check without emitting |
| `npm run lint` | ESLint |
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:revert` | Rollback one migration |
| `npm run db:sync` | Sync schema from entities |

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **Read-only cache** | Backend mirrors on-chain state; all mutations go through program instructions |
| **Event-driven indexer** | WebSocket subscription + slot-based backfill handles downtime recovery |
| **Slot cursor tracking** | Prevents duplicate event processing; singleton IndexerState row |
| **In-memory challenges** | Auth challenges are ephemeral (5-min TTL); no persistence needed |
| **Bundled IDL** | Enables Docker deployment without Rust build artifacts |
| **String-typed bigints** | Reserves, kSquared, totalMinted stored as strings to avoid JS number precision loss |
| **Global ValidationPipe** | Whitelist + forbidNonWhitelisted strips/rejects unexpected fields on all endpoints |

## License

All rights reserved.
