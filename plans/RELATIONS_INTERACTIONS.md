# Client–Program Interaction Map

How each client reads data and submits transactions.

---

## Quick Summary

| Client | Submits TXs to Program | Reads from Program | Calls Backend API |
|---|---|---|---|
| **devkit** | Yes (Anchor SDK) | Yes (account fetch) | No |
| **operator-cli** | Yes (Anchor SDK) | Yes (account fetch) | No |
| **goperator-cli** | Yes (solana-go) | Yes (RPC getAccountInfo) | No |
| **scripts** | Indirectly (delegates to devkit) | Indirectly (delegates to devkit) | Yes (curl for verification) |
| **frontend** | Yes (Anchor SDK + wallet adapter) | Minimal (market fetch before TX) | Yes (all reads + AMM estimates) |
| **backend** | Never | Yes (indexer: log listener + sync) | N/A (is the API) |

---

## 1. Devkit (`devkit/src/`)

**Pure on-chain client.** Loads program via Anchor IDL, derives PDAs in `common.ts`, submits all transactions directly (`program.methods.buy().rpc()`), and queries all state directly (`program.account.market.fetch()`). Zero backend dependency.

Used by: developers, scripts, manual testing.

## 2. Operator-CLI (`scripts/operator-cli/src/`)

**Interactive Node.js TUI** (inquirer menus). Mirrors devkit's approach — Anchor SDK + web3.js, direct PDA derivation, direct program calls. Adapted from devkit's `common.ts` into its own `common.js`. No backend dependency.

## 3. Goperator-CLI (`scripts/goperator-cli/`)

**Interactive Go TUI** (bubbletea). Same pattern but uses `gagliardetto/solana-go` instead of Anchor. Builds transactions manually, fetches accounts via `client.GetAccountInfo()`. No backend dependency.

## 4. Scripts (`scripts/`)

**Orchestration layer.** `setup.sh` starts services; `e2e-smoke.sh` runs E2E tests. Scripts never touch the program directly — they delegate to devkit for all on-chain operations (`devkit trade.ts buy`, `devkit query.ts market`, etc.). They also `curl` backend endpoints to verify the indexer picked up on-chain changes.

## 5. Frontend (`frontend/`)

**Hybrid model — writes to chain, reads from backend.**

- **Transactions:** Submitted directly to program via Anchor SDK + wallet adapter. `lib/transactions.ts` builds each instruction (`executeBuy`, `executeSell`, `executeBuyToPrice`, etc.), resolves accounts by fetching the market on-chain (`program.account.market.fetch`), and calls `.rpc()`.

- **Data reads:** All market listings, details, trade history, user positions, and AMM estimates come from the backend API (`lib/api.ts` → `GET /markets`, `POST /amm/estimate-*`, etc.). Frontend never reads reserves/positions directly from chain for display.

- **Why hybrid:** Transactions go directly to the program for trustlessness (user's wallet signs, no server in the middle). Data reads go through backend for performance (indexed DB with search/filter/pagination vs expensive RPC calls).

## 6. Backend (`backend/src/`)

**Read-only indexer + API server.** Never submits transactions.

- **Indexer** (`indexer/indexer.service.ts`): Subscribes to program logs via `connection.onLogs()`, decodes events, and syncs state to PostgreSQL. On startup, runs `syncAllMarkets()`, `syncAllPositions()`, `syncAllLpPositions()` to catch anything missed.

- **AMM service** (`amm/amm.service.ts`): Replicates AMM math in TypeScript to provide cost/return estimates without hitting the chain. These estimates power the frontend's cost preview before trade submission.

- **Source of truth:** On-chain state is authoritative. Backend DB is a mirror that stays in sync via log subscriptions + startup sync.

---

## Data Flow

```
User clicks "Buy" in frontend
    │
    ├─► POST /amm/estimate-buy (backend)     ← preview cost
    │       └─► reads from PostgreSQL (mirrored on-chain state)
    │
    ├─► User confirms
    │
    ├─► program.methods.buy().rpc()           ← TX goes directly to Solana
    │       └─► wallet signs, RPC submits
    │
    └─► Program emits log event
            └─► Backend indexer catches it
                    └─► Updates PostgreSQL
                            └─► Frontend re-fetches from backend API
```

Key insight: **the backend is never in the transaction path**. If the backend goes down, CLI tools and devkit still work. The frontend could still submit transactions but would lack estimates and data display.
