# DekantPM Devkit

CLI scripts for direct on-chain interaction with the DekantPM prediction market protocol on Solana.

```
devkit/
  src/
    common.ts   ── shared: PDA derivation, connection, helpers
    setup.ts    ── protocol init, roles, fees
    market.ts   ── create/pause/unpause/claim/info markets
    trade.ts    ── buy/sell/LP/distribution trades
    resolve.ts  ── resolve markets (oracle only)
    query.ts    ── read-only account queries & listings
```

## Prerequisites

- **Node.js** >= 18
- **Solana CLI** with a keypair at `~/.config/solana/id.json`
- Built program: `anchor build` (produces `target/idl/dekant_pm.json`)
- Running validator (localnet: `solana-test-validator --bpf-program <ID> target/deploy/dekant_pm.so`)

## Setup

```bash
cd devkit
cp .env.example .env     # edit RPC_URL, PROGRAM_ID, KEYPAIR_PATH
npm install
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_URL` | `http://localhost:8899` | Solana RPC endpoint |
| `PROGRAM_ID` | `Fa2ookSb6meqem6F1oZcVv1PAxQzNtr7zkf1XiDBFgAf` | Deployed program ID |
| `KEYPAIR_PATH` | `~/.config/solana/id.json` | Signer keypair file |

---

## Scripts Overview

All scripts use `npx ts-node src/<script>.ts <command> [args]`.

```
                        ┌──────────────────────────────────────────┐
                        │          DekantPM On-Chain Program        │
                        └──────────┬───────────────────────────────┘
                                   │
          ┌────────────────────────┼─────────────────────────┐
          │                        │                         │
    ┌─────▼──────┐          ┌──────▼──────┐          ┌───────▼──────┐
    │  setup.ts  │          │  market.ts  │          │  resolve.ts  │
    │            │          │             │          │              │
    │  init      │          │ create-*    │          │ market       │
    │  assign    │          │ pause       │          │ info         │
    │  revoke    │          │ unpause     │          └──────────────┘
    │  fees      │          │ claim       │
    │  collect   │          │ info        │
    │  info      │          └─────────────┘
    └────────────┘
          │                 ┌─────────────┐          ┌──────────────┐
          │                 │  trade.ts   │          │  query.ts    │
          │                 │             │          │              │
          │                 │ buy / sell  │          │ markets      │
          └────────────────►│ buy-dist    │          │ market       │
            (roles needed)  │ sell-dist   │          │ position     │
                            │ buy-to-price│          │ lp           │
                            │ sell-to-price          │ roles        │
                            │ add-lp      │          │ config       │
                            │ remove-lp   │          │ vault        │
                            │ position    │          └──────────────┘
                            │ fund        │
                            └─────────────┘
```

---

## Typical Workflow

```
 1. Initialize protocol ─────►  setup init
 2. Assign roles ────────────►  setup assign-role <wallet> oracle
                                setup assign-role <wallet> creator
 3. Create market ───────────►  market create-binary <oracle> 100 +7d
 4. Fund wallet ─────────────►  trade fund 0 500
 5. Trade ───────────────────►  trade buy 0 0 10
 6. Query state ─────────────►  query markets
                                query market 0
 7. Resolve ─────────────────►  resolve market 0 0
 8. Claim ───────────────────►  market claim 0
```

---

## 1. `setup.ts` — Protocol Administration

### `setup init`

Initialize the protocol (one-time). Creates the `ProtocolConfig` PDA.

```bash
npx ts-node src/setup.ts init
npx ts-node src/setup.ts init --treasury <wallet-address>
```

### `setup assign-role <wallet> <role>`

Assign a role to a wallet. Roles: `admin`, `oracle`, `creator` (or numeric: 1, 2, 3).

```bash
npx ts-node src/setup.ts assign-role 7xKX...abc oracle
npx ts-node src/setup.ts assign-role 7xKX...abc creator
```

### `setup revoke-role <wallet> <role>`

```bash
npx ts-node src/setup.ts revoke-role 7xKX...abc oracle
```

### `setup update-fees <creation> <trade> <redemption> <lp-share>`

Update protocol fee parameters in basis points (1 bps = 0.01%).

```bash
npx ts-node src/setup.ts update-fees 50 100 50 5000
#                                     │   │    │   └── LP gets 50% of trade fee
#                                     │   │    └────── 0.50% redemption fee
#                                     │   └─────────── 1.00% trade fee
#                                     └─────────────── 0.50% creation fee
```

### `setup collect-fees <market-id>`

Sweep accumulated protocol fees from a market vault to the treasury.

```bash
npx ts-node src/setup.ts collect-fees 0
```

### `setup info`

Display current protocol configuration.

```bash
npx ts-node src/setup.ts info
```

---

## 2. `market.ts` — Market Management

### `market create-binary <oracle> <liquidity> <deadline>`

Create a Yes/No market with 2 outcomes.

```bash
npx ts-node src/market.ts create-binary 7xKX...abc 100 +7d
npx ts-node src/market.ts create-binary 7xKX...abc 50 2026-03-15T00:00:00Z
npx ts-node src/market.ts create-binary 7xKX...abc 100 +7d --mint <mint-address>
```

### `market create-multi <oracle> <liquidity> <deadline> <num-outcomes>`

Create a multi-outcome market (3-32 outcomes).

```bash
npx ts-node src/market.ts create-multi 7xKX...abc 100 +7d 4
```

### `market create-continuous <oracle> <liquidity> <deadline> <range-min> <range-max>`

Create a continuous distribution market with configurable bins.

```bash
npx ts-node src/market.ts create-continuous 7xKX...abc 100 +7d 50 500
npx ts-node src/market.ts create-continuous 7xKX...abc 100 +7d 50 500 --bins 128
```

> Range values are human-readable (e.g., 50 = price $50). Internally scaled by 10^9.

### Deadline Formats

| Format | Example | Meaning |
|--------|---------|---------|
| Relative hours | `+1h` | 1 hour from now |
| Relative minutes | `+30m` | 30 minutes from now |
| Relative days | `+7d` | 7 days from now |
| ISO 8601 | `2026-03-15T00:00:00Z` | Absolute timestamp |
| Unix seconds | `1742000000` | Raw unix timestamp |

### `market pause <market-id>` / `market unpause <market-id>`

```bash
npx ts-node src/market.ts pause 0
npx ts-node src/market.ts unpause 0
```

### `market claim <market-id>`

Claim payout from a resolved market. Shows winning holdings and net payout.

```bash
npx ts-node src/market.ts claim 0
```

### `market info <market-id>`

Display full market state: reserves, probabilities, vault balance, range.

```bash
npx ts-node src/market.ts info 0
```

---

## 3. `trade.ts` — Trading

### Discrete Trades (Binary / Multi-outcome)

```bash
# Buy 10 USDC worth of outcome 0 (Yes) on market #0
npx ts-node src/trade.ts buy 0 0 10

# Sell 5 tokens of outcome 1 (No) on market #0
npx ts-node src/trade.ts sell 0 1 5
```

### Distribution Trades (Continuous Markets)

Buy/sell a Normal distribution position centered at `mu` with std-dev `sigma`.

```bash
# Buy N(200, 30) distribution on market #2 for 5 USDC
npx ts-node src/trade.ts buy-dist 2 200 30 5

# Sell N(200, 30) distribution, 1 token
npx ts-node src/trade.ts sell-dist 2 200 30 1
```

```
           Distribution Buy: N(200, 30)
    ┌────────────────────────────────────────┐
    │              ▄▄████▄▄                  │
    │           ▄██████████████▄             │
    │        ▄████████████████████▄          │
    │     ▄██████████████████████████▄       │
    │   ▄██████████████████████████████▄     │
    │ ▄██████████████████████████████████▄   │
    └────────────────────────────────────────┘
    50                 200                 500
         rangeMin       mu        rangeMax
```

### Price-Targeted Trades

Buy/sell to move an outcome to a specific probability (%).

```bash
# Push outcome 0 (Yes) to 75%
npx ts-node src/trade.ts buy-to-price 0 0 75

# Pull outcome 0 (Yes) down to 30%
npx ts-node src/trade.ts sell-to-price 0 0 30

# With collateral limits
npx ts-node src/trade.ts buy-to-price 0 0 75 --max-collateral 50
npx ts-node src/trade.ts sell-to-price 0 0 30 --min-collateral 2
```

### Liquidity Provision

```bash
# Add 50 USDC liquidity to market #0
npx ts-node src/trade.ts add-lp 0 50

# Remove specific LP shares
npx ts-node src/trade.ts remove-lp 0 1000000

# Remove all LP shares
npx ts-node src/trade.ts remove-lp 0 all
```

### View Position

```bash
npx ts-node src/trade.ts position 0
```

### Fund Wallet (Localnet Only)

Mint test collateral tokens to your wallet from a market's mint authority.

```bash
npx ts-node src/trade.ts fund 0 500
```

---

## 4. `resolve.ts` — Resolution (Oracle)

### `resolve market <market-id> <outcome>`

Resolve a binary/multi market. Signer must be the assigned oracle.

```bash
# Resolve market #0 with outcome 0 (Yes wins)
npx ts-node src/resolve.ts market 0 0

# Resolve market #1 with outcome 2
npx ts-node src/resolve.ts market 1 2
```

### `resolve market <market-id> --value <number>`

Resolve a continuous market with an exact value.

```bash
# Resolve market #2 with value 185.5
npx ts-node src/resolve.ts market 2 --value 185
```

> For continuous markets, `<outcome>` is optional (program determines winning bin from value).

```
    Resolution + Claim Flow
    ═══════════════════════

    Market Active ──► Deadline Passes ──► Oracle Resolves ──► Users Claim
         │                  │                   │                  │
      trading            pending            resolvedOutcome    market claim
      allowed            resolution          determined         (payout)
```

### `resolve info <market-id>`

Show resolution details, winning outcome, and final probabilities.

```bash
npx ts-node src/resolve.ts info 0
```

---

## 5. `query.ts` — Read-Only Account Queries

All query commands are read-only and don't submit transactions.

### `query markets`

List all markets with pagination and filtering.

```bash
# List all markets
npx ts-node src/query.ts markets

# Paginate
npx ts-node src/query.ts markets --page 2 --limit 5

# Filter by type
npx ts-node src/query.ts markets --type binary
npx ts-node src/query.ts markets --type continuous

# Filter by state
npx ts-node src/query.ts markets --state active
npx ts-node src/query.ts markets --state resolved
```

Example output:

```
Markets (page 1/1, 3 total):

  ID    Type          State             Outcomes  Deadline                PDA
  ────────────────────────────────────────────────────────────────────────────────────────────
  0     Binary        Active            2         2026-03-05 12:00:00 UTC 4vKn8rPQL3xW...
  1     Multi-outcome Active            4         2026-03-05 12:00:00 UTC 7mRxYhBz2K9a...
  2     Continuous    Active            64        2026-03-05 12:00:00 UTC 9pTz3kDwN5bC...
```

### `query market <market-id>`

Full detail view of a single market (same depth as `market info`).

```bash
npx ts-node src/query.ts market 0
```

### `query position <market-id>`

View a user's trading position in a market.

```bash
# Your position
npx ts-node src/query.ts position 0

# Another wallet's position
npx ts-node src/query.ts position 0 --wallet 7xKX...abc
```

### `query lp <market-id>`

View a user's LP position in a market.

```bash
npx ts-node src/query.ts lp 0
npx ts-node src/query.ts lp 0 --wallet 7xKX...abc
```

### `query roles <wallet>`

Check all roles assigned to a wallet (Admin, Oracle, Creator, Superadmin).

```bash
npx ts-node src/query.ts roles 7xKX...abc
```

Example output:

```
Roles for 7xKX...abc:

  [x] Admin
  [x] Oracle
  [x] Creator

  * This wallet is the protocol superadmin
```

### `query config`

Display the protocol configuration.

```bash
npx ts-node src/query.ts config
```

### `query vault <market-id>`

Show vault balance, authority PDA, and fee accumulation for a market.

```bash
npx ts-node src/query.ts vault 0
```

---

## AMM Reference

DekantPM uses an **L2-norm (sum-of-squares) AMM** invariant:

```
    Invariant: Sum(x[i]^2) = k^2

    where x[i] = totalMinted - reserves[i]  (tokens held by traders for outcome i)

    Probability of outcome i:
        p(i) = x[i]^2 / Sum(x[j]^2)  =  (totalMinted - reserves[i])^2 / totalMinted^2
```

```
    Binary Market Probability Curve
    ┌────────────────────────────────────┐
    │ P(Yes)                             │
    │ 100% ─── ·                         │
    │  90% ───  ·                        │
    │  80% ───   ·                       │
    │  70% ───    ·                      │
    │  60% ───     ·                     │
    │  50% ───      ·                    │
    │  40% ───       ·                   │
    │  30% ───        ·                  │
    │  20% ───         ·                 │
    │  10% ───          ·               │
    │   0% ───           ···────────── │
    └────────────────────────────────────┘
           Buy Yes ──────────► Sell Yes
```

### Amounts & Scaling

| What | Decimals | Example |
|------|----------|---------|
| Collateral (USDC) | 6 | `"10"` = 10,000,000 raw |
| SCALE (AMM math) | 9 | `10^9` for fixed-point |
| Probability (on-chain) | 9 | `750,000,000` = 75% |
| Range values | 9 | `"50"` stored as `50 * 10^9` |

---

## Full Example: Binary Market Lifecycle

```bash
# 1. Start validator (separate terminal)
solana-test-validator --bpf-program Fa2ookSb6meqem6F1oZcVv1PAxQzNtr7zkf1XiDBFgAf \
  ../target/deploy/dekant_pm.so --reset

# 2. Initialize protocol
npx ts-node src/setup.ts init

# 3. Get signer address and assign roles
WALLET=$(solana address)
npx ts-node src/setup.ts assign-role $WALLET oracle
npx ts-node src/setup.ts assign-role $WALLET creator

# 4. Create a binary market: 100 USDC liquidity, 1 hour deadline
npx ts-node src/market.ts create-binary $WALLET 100 +1h
#   Market ID:  0
#   Market PDA: 4vKn8rPQL3xW...

# 5. Fund wallet with extra test tokens
npx ts-node src/trade.ts fund 0 500

# 6. Buy "Yes" (outcome 0) for 10 USDC
npx ts-node src/trade.ts buy 0 0 10
#   Yes     50.00% ->    65.30%
#   No      50.00% ->    34.70%

# 7. Push Yes to 80%
npx ts-node src/trade.ts buy-to-price 0 0 80
#   Yes     65.30% ->    80.00%

# 8. Check position
npx ts-node src/trade.ts position 0

# 9. List all markets
npx ts-node src/query.ts markets

# 10. Wait for deadline, then resolve (Yes wins)
npx ts-node src/resolve.ts market 0 0

# 11. Claim winnings
npx ts-node src/market.ts claim 0
#   Net payout: 14.52
```

## Full Example: Continuous Market Lifecycle

```bash
# 1. Create continuous market: range [50, 500], 64 bins, 100 USDC, 1 hour
npx ts-node src/market.ts create-continuous $WALLET 100 +1h 50 500
#   Market ID:  1

# 2. Fund and buy distribution N(200, 30) for 5 USDC
npx ts-node src/trade.ts fund 1 500
npx ts-node src/trade.ts buy-dist 1 200 30 5

# 3. Query market details
npx ts-node src/query.ts market 1

# 4. Resolve with value 185
npx ts-node src/resolve.ts market 1 --value 185

# 5. Claim
npx ts-node src/market.ts claim 1
```
