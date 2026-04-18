# DekantPM Operator CLI

Interactive menu-driven CLI for manually testing and operating the DekantPM prediction market protocol on Solana. Unlike the automated `e2e-smoke.sh`, this tool lets you exercise every protocol instruction interactively — create users, assign roles, create markets, trade, resolve, and claim — all through a guided menu.

## Prerequisites

- **Node.js 22+** (via `n`: `/usr/local/n/versions/node/22.17.0/bin`)
- **Solana localnet** running with the DekantPM program deployed
- **Protocol initialized** (`cd devkit && npx ts-node src/setup.ts init`)
- **Dependencies installed** (`npm install --legacy-peer-deps --ignore-scripts`)

## Quick Start

```bash
# 1. Start localnet + deploy (from project root)
cd scripts && bash setup.sh

# 2. Install deps (first time only)
cd scripts/operator-cli
PATH="/usr/local/n/versions/node/22.17.0/bin:$PATH" npm install --legacy-peer-deps --ignore-scripts

# 3. Run
PATH="/usr/local/n/versions/node/22.17.0/bin:$PATH" node src/main.js
```

## Configuration

The CLI reads configuration from `devkit/.env`:

| Variable       | Description                              | Default                                        |
|----------------|------------------------------------------|------------------------------------------------|
| `RPC_URL`      | Solana RPC endpoint                      | `http://localhost:8899`                         |
| `PROGRAM_ID`   | DekantPM program address                 | `F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL` |
| `KEYPAIR_PATH` | Superuser keypair file                   | `~/.config/solana/id.json`                      |

No separate `.env` file is needed — the CLI loads devkit's configuration automatically.

## Main Menu

```
── User Management ──
  Add New User           Generate keypair + airdrop 10 SOL
  Assign Role            Oracle / Creator / Admin (superuser auto)
  Fund User              Mint USDC to a user's ATA (superuser auto)

── Market Operations ──
  Create Market          Binary / Multi-outcome / Continuous
  Pause / Unpause        Toggle market state

── Trading ──
  Buy Outcome            Fixed amount, buy-to-price, or distribution
  Sell Outcome           Fixed amount, sell-to-price, or distribution

── Liquidity ──
  Add Liquidity          Deposit collateral for LP shares
  Remove Liquidity       Burn LP shares for collateral

── Settlement ──
  Resolve Market         Set winning outcome or continuous value
  Claim Payout           Withdraw winnings
  Collect Fees           Transfer protocol fees to treasury (superuser auto)

── Query ──
  View Position          User holdings + PnL in a market
  Query Market Info      Full market details + ASCII probability chart
```

## How It Works

### Session State

The CLI maintains an in-memory session with:
- **Users**: Generated keypairs tracked with labels and assigned roles
- **Markets**: Created markets tracked with type, mint, oracle, and range info
- **Superuser**: Loaded from `KEYPAIR_PATH`, used for admin-only operations

State is session-only — nothing persists to disk. Each run starts fresh.

### Multi-User Provider Switching

Every transaction runs through a per-user Anchor `Program` instance:

```
state.programForUser(keypair)  →  new AnchorProvider  →  new Program(IDL)
```

This lets you test different users' permissions against the same protocol.

### Navigation Patterns

**Pattern A — Superuser Auto:** Some actions (Assign Role, Fund User, Collect Fees) are superuser-only. The CLI executes them directly without asking who should sign.

**Pattern B — Permission Testable:** Most actions let you pick which user signs the transaction. If it fails (wrong role, insufficient balance), you see the error and can retry with a different user or Cancel:

```
  Error: OracleOnly
  Select a different user or Cancel.
```

### Trade Types by Market

| Market Type | Available Trades                                          |
|-------------|-----------------------------------------------------------|
| Binary      | Buy/Sell (fixed amount), Buy/Sell to Price                |
| Multi       | Buy/Sell (fixed amount), Buy/Sell to Price                |
| Continuous  | Buy/Sell Distribution (mu + sigma + amount)               |

Distribution trades automatically include a `ComputeBudgetProgram.setComputeUnitLimit(1,000,000)` pre-instruction.

### Market Creation Details

When creating a market, the CLI:
1. Creates a new SPL mint with **superuser as authority** (so `Fund User` works regardless of market creator)
2. Mints 5x the initial liquidity to the creator
3. Checks if the selected oracle has the Oracle role — offers to auto-assign if not
4. Uses a fresh vault keypair as signer

## Project Structure

```
operator-cli/
├── package.json
├── TASKS.md
├── README.md
└── src/
    ├── main.js              Entry point: bootstrap, verify protocol, main menu loop
    ├── common.js            Shared utilities (PDAs, token helpers, formatters, constants)
    ├── state.js             SessionState class (users, markets, superuser, connection)
    ├── ui.js                Screen helpers (clear, banner, pressKey, probBar, printKV)
    ├── prompts/
    │   ├── user-select.js   Reusable user picker (roles, balance, cancel, superuser)
    │   ├── market-select.js Reusable market picker (live probs, state display)
    │   └── trade-params.js  Trade parameter collection per market type
    └── actions/
        ├── user.js          Add User, Assign Role, Fund User
        ├── market.js        Create Market, Pause/Unpause
        ├── trade.js         Buy/Sell (fixed, to-price, distribution)
        ├── liquidity.js     Add/Remove Liquidity
        ├── settle.js        Resolve Market, Claim Payout, Collect Fees
        └── query.js         Query Market Info, View Position
```

## Typical Test Flow

1. **Add 2-3 users** and note their labels
2. **Assign roles**: Oracle to User 1, Creator to User 2
3. **Create a binary market** as User 2 (Creator), with User 1 as oracle
4. **Fund users** with USDC via the market's collateral mint
5. **Buy outcome** as different users, observe probability changes
6. **Sell outcome** or **buy-to-price** to move probabilities
7. **Resolve market** as User 1 (Oracle)
8. **Claim payout** for each user
9. **Collect fees** (superuser auto)
10. **Query Market Info** to see final state

## Keyboard Shortcuts

- **Enter**: Confirm selection / continue after results
- **Arrow keys**: Navigate menu choices
- **Ctrl+C**: Cancel current prompt (returns to main menu) or exit app
