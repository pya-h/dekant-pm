# DekantPM Scripts

Shell scripts and tools for orchestrating, testing, and operating the DekantPM prediction market protocol.

## Overview

| Script / Tool     | Purpose                                                  |
|-------------------|----------------------------------------------------------|
| `lib.sh`          | Shared shell library sourced by all bash scripts         |
| `setup.sh`        | Service orchestrator — starts localnet, backend, frontend|
| `e2e-smoke.sh`    | Automated E2E smoke test across all market types         |
| `down.sh`         | Stops all running DekantPM services                      |
| `operator-cli/`   | Interactive CLI for manual protocol testing              |

## Quick Reference

```bash
# Start everything (localnet + backend + frontend)
bash scripts/setup.sh

# Start with full rebuild + DB reset
bash scripts/setup.sh --reset

# Run automated E2E tests
bash scripts/e2e-smoke.sh

# Run E2E without restarting infrastructure
bash scripts/e2e-smoke.sh --no-infra

# Stop all services
bash scripts/down.sh

# Interactive manual testing
cd scripts/operator-cli
PATH="/usr/local/n/versions/node/22.17.0/bin:$PATH" node src/main.js
```

---

## `lib.sh` — Shared Library

Sourced by `setup.sh`, `e2e-smoke.sh`, and `down.sh`. Provides:

- **Logging**: `log`, `success`, `fail`, `warn`, `header`, `step` — color-coded output with script name prefix
- **State management**: `state_get`, `state_set`, `ensure_state_dir` — key-value store in `.state/env`
- **Config helpers**: `network_rpc`, `get_program_id`, `get_rpc_url`, `propagate_config`
- **Service management**: `start_validator`, `start_backend`, `start_frontend`, `stop`
- **Process control**: `kill_tree` (recursive SIGTERM), PID file tracking, port-based fallback (`lsof`)
- **Devkit wrappers**: `devkit <script> <args>`, `devkit_as <keypair> <script> <args>`
- **Utilities**: `rand`, `rand_choice`, `generate_keypair`, `keypair_address`, `airdrop_sol`, `wait_for_port`

Usage:
```bash
SCRIPT_NAME="my-script"
source "$(dirname "$0")/lib.sh"
```

---

## `setup.sh` — Service Orchestrator

Starts all services needed for development and testing. Handles localnet validator, backend (NestJS), and frontend (Next.js).

### Flags

| Flag                       | Short | Description                                           |
|----------------------------|-------|-------------------------------------------------------|
| `--network <name>`         | `-n`  | Target network: `localnet` (default), `devnet`, `testnet`, `mainnet` |
| `--rpc <url>`              | `-r`  | Custom RPC endpoint (overrides `--network`)           |
| `--reset`                  | `-R`  | Rebuild program, reset validator + DB, re-initialize protocol |
| `--no-backend`             | `-nb` | Skip starting the NestJS backend                      |
| `--no-frontend`            | `-nf` | Skip starting the Next.js frontend                    |
| `--background`             | `-b`  | Detach after startup (services continue in background) |

### What It Does

1. **Localnet**: Starts `solana-test-validator` with the program `.so` preloaded
2. **Reset** (if `--reset`): `anchor build` → propagate program ID → drop + migrate DB → `devkit init`
3. **Backend**: Starts NestJS with correct `.env` pointing to the active RPC
4. **Frontend**: Starts Next.js dev server (Node 23.3.0)
5. **Cleanup**: Ctrl+C triggers `kill_tree` on all child processes

### State Directory

Runtime state is stored in `scripts/.state/` (gitignored):

```
.state/
├── env                # Key-value config (PROGRAM_ID, NETWORK, RPC_URL, DEPLOYER_WALLET)
├── validator.pid      # solana-test-validator PID
├── backend.pid        # Backend PID
├── backend.log        # Backend stdout/stderr
├── frontend.pid       # Frontend PID
├── frontend.log       # Frontend stdout/stderr
├── trader1.json       # Test trader keypairs (created by e2e-smoke.sh)
├── trader2.json
├── trader3.json
└── report.txt         # E2E test report
```

---

## `e2e-smoke.sh` — Automated E2E Test

Comprehensive end-to-end smoke test that exercises all market types, all trade methods, and multiple traders against the full stack.

### Flags

| Flag              | Short  | Description                                           |
|-------------------|--------|-------------------------------------------------------|
| `--no-infra`      | `-n`   | Skip infrastructure startup (assumes services running)|
| `--new-markets`   | `-nm`  | Create 1-3 extra random markets after main tests      |
| `--manual`        | `-m`   | Print manual frontend checklist at the end             |

### Environment Variables

| Variable | Description                          | Default |
|----------|--------------------------------------|---------|
| `SEED`   | Random seed for reproducible runs    | Random  |

### Test Phases

1. **Preflight**: Verify tools (`solana`, `anchor`, `psql`, `node`)
2. **Infrastructure**: Start services via `lib.sh` (skipped with `--no-infra`)
3. **Protocol setup**: Initialize protocol, assign Oracle + Creator roles
4. **Traders**: Generate 3 keypairs, airdrop SOL, fund with USDC
5. **Binary market**: Buy, sell, buy-to-price, sell-to-price, add-lp, remove-lp (3 traders)
6. **Multi-outcome market**: 4 outcomes, buy/sell/buy-to-price across traders
7. **Continuous market**: 64 bins, buy-dist/sell-dist with randomized mu/sigma
8. **Resolution + Claims**: Resolve all markets, claim payouts, collect fees
9. **Backend API**: Verify all REST endpoints return expected data
10. **Summary**: Trade counts, timing stats, pass/fail report saved to `.state/report.txt`

### Randomization

Values are randomized within safe bounds to catch edge cases:
- Liquidity: 50-200 USDC
- Trade amounts: 5-30 USDC
- Deadlines: 45-120 seconds from now
- Continuous mu/sigma: within market range

Use `SEED=42` for reproducible runs.

### Expected Failures

Some operations may fail gracefully during randomized testing:
- `sell-to-price` — `InsufficientHoldings` if random amount exceeds position
- `claim` — `NothingToClaim` for traders who bet on the losing outcome
- `remove-lp` — `insufficient funds` if vault was drained after claims (normal LP risk)

These are logged as warnings, not errors.

---

## `down.sh` — Service Stopper

Stops all services started by `setup.sh` or `e2e-smoke.sh`.

```bash
bash scripts/down.sh
```

**How it works:**
1. Reads PID files from `.state/` and kills each process tree
2. Falls back to port-based detection (`lsof`) for orphaned processes on known ports (8899, 3001, 3000)
3. Cleans up stale PID files

---

## `operator-cli/` — Interactive Operator CLI

A menu-driven Node.js CLI for manual protocol testing. Unlike `e2e-smoke.sh` which runs automated tests, the operator CLI lets you interactively:

- Create and manage test users (generate keypairs, assign roles, fund tokens)
- Create any market type (binary, multi-outcome, continuous) with custom parameters
- Execute all trade types (fixed, to-price, distribution) as any user
- Resolve markets, claim payouts, collect fees
- Query market state with live probability displays and ASCII charts

The operator CLI is ideal for:
- **Exploratory testing**: Try unexpected parameter combinations
- **Permission testing**: Verify which roles can perform which actions
- **Demo walkthroughs**: Step through the full market lifecycle interactively
- **Debugging**: Inspect market state and positions after specific operations

See [`operator-cli/README.md`](operator-cli/README.md) for full documentation, setup instructions, and usage guide.

---

## Dependencies Between Scripts

```
lib.sh ─────────────────────┐
  (sourced by)               │
  ├── setup.sh               │
  ├── e2e-smoke.sh           │   operator-cli/
  └── down.sh                │   (independent Node.js app)
                             │     └── reads devkit/.env
e2e-smoke.sh                 │     └── reads target/idl/dekant_pm.json
  └── calls lib.sh functions │
      (start_validator, etc) │
                             │
setup.sh                     │
  └── called by e2e-smoke.sh │
      (via lib.sh functions) │
```

The bash scripts (`lib.sh`, `setup.sh`, `e2e-smoke.sh`, `down.sh`) share state through `.state/` and source `lib.sh` for common functions.

The `operator-cli/` is a standalone Node.js application that reads configuration from `devkit/.env` and the program IDL — it does not depend on or interact with the bash scripts.
