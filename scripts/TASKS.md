# Scripts — Implementation Tasks

**Goal:** Extract infrastructure setup into a reusable `setup.sh`, create a shared `lib.sh`, and enhance `e2e-smoke.sh` with random values, all trade types, and multiple traders.

---

## Architecture

```
scripts/
├── lib.sh              # Shared functions (colors, config, services, helpers)
├── setup.sh            # Service orchestrator (standalone + used by tests)
├── e2e-smoke.sh        # E2E test runner (uses lib.sh, calls setup.sh logic)
├── TASKS.md            # This file
└── .state/             # Runtime state (gitignored)
    ├── env             # PROGRAM_ID, NETWORK, RPC_URL, DEPLOYER_WALLET
    ├── backend.log     # Backend stdout/stderr
    ├── frontend.log    # Frontend stdout/stderr
    ├── trader1.json    # Test trader 1 keypair
    ├── trader2.json    # Test trader 2 keypair
    └── trader3.json    # Test trader 3 keypair
```

---

## Task 1: `scripts/lib.sh` — Shared Library ✅

Shared shell functions sourced by both `setup.sh` and `e2e-smoke.sh`.

**Contents:**
- Color constants + logging (log, success, fail, warn, header, step)
- State management (state_get, state_set, ensure_state_dir)
- Config helpers (network_rpc, get_program_id, get_rpc_url, propagate_config)
- Port checking (wait_for_port, check_port)
- Devkit wrappers (devkit, devkit_as — with per-keypair override)
- Random value generators (rand, rand_choice)
- Keypair management (generate_keypair, keypair_address)
- Service management (start_validator, start_backend, start_frontend, stop)
- Dependency installer (ensure_deps)
- Airdrop helper (airdrop_sol)
- .env file updater (update_env_file)

---

## Task 2: `scripts/setup.sh` — Service Orchestrator ✅

Standalone script for starting/stopping all services.

**Features:**
- `--network localnet|devnet|testnet|mainnet` — choose network
- `--rpc <url>` — custom RPC (overrides --network)
- `--reset` — rebuild program, reset validator + DB, re-init protocol
- `--no-backend` / `--no-frontend` — skip services
- Localnet only: starts solana-test-validator
- Non-localnet: skips validator, uses remote RPC
- On `--reset`: anchor build → propagate config → reset DB → init protocol
- Ctrl+C to cleanly shut down all services
- Writes state to `scripts/.state/env`

---

## Task 3: `scripts/e2e-smoke.sh` — Full Rewrite ✅

Comprehensive E2E test runner with all improvements.

**Improvements:**
1. **Sources lib.sh** for shared functions
2. **Random values:** liquidity (50–200), amounts (5–30), deadlines (45–120s)
3. **3 test traders:** separate keypairs, SOL airdrops, token funding
4. **All trade types per market:**
   - Binary: buy, sell, buy-to-price, sell-to-price, add-lp, remove-lp
   - Multi-outcome (4 outcomes): buy, sell, buy-to-price
   - Continuous (64 bins): buy-dist, sell-dist
5. **Dynamic deadline wait:** calculates remaining time instead of fixed sleep
6. **Reproducible randomness:** `SEED=<n>` env var for deterministic runs
7. **Backend API verification** with all endpoints
8. **Manual checklist** preserved with `--manual` flag
9. **Test statistics** in summary (trades executed, markets created, etc.)

**Phases:**
1. Preflight checks
2. Infrastructure (via lib.sh functions, or --no-infra)
3. Protocol setup (init, roles)
4. Generate 3 test traders (keypairs + SOL)
5. Binary market flow (all discrete trade types, 3 traders)
6. Multi-outcome market flow (4 outcomes, all traders)
7. Continuous market flow (64 bins, distribution trades)
8. Backend API verification
9. Summary + manual checklist link

---

## Task 4: `.gitignore` Update ✅

Add `scripts/.state/` to project `.gitignore`.

---

## Task 5: Full Review & Debugging ✅

- `bash -n` syntax validation on all scripts
- Logic review: amounts don't exceed funded balances
- Edge cases: sell amounts < buy amounts, reasonable targets
- Verify randomized values produce valid scenarios
- Fixed `generate_keypair` stdout contamination (`2>/dev/null` → `&>/dev/null`)
- Fixed `state_get` pipefail crash when key missing (`|| true`)
- Fixed `| head -N` SIGPIPE/EPIPE crash on informational queries (`|| true`)
- Graceful error handling for expected failures:
  - `sell-to-price` may fail with `InsufficientHoldings` (random amounts may exceed holdings)
  - `claim` may fail with `NothingToClaim` (traders who bet wrong outcome)
  - `remove-lp` may fail with `insufficient funds` (vault drained after claims — normal LP risk)
  - All 3 capture output to suppress full Anchor stack traces, show clean warn messages
