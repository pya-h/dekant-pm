# DekantPM Operator CLI

Interactive menu-driven Node.js CLI for manually testing and operating the DekantPM prediction market protocol on Solana. Unlike the automated `e2e-smoke.sh`, this tool lets you exercise every protocol instruction interactively — create users, assign roles, create markets, trade, resolve, and claim — all through a guided menu.

> **See also:** [`goperator-cli/`](../goperator-cli/) — a Go (Bubble Tea) TUI port with the same feature set. No Node.js required.

## Prerequisites

- **Node.js 22+** (via `n`: `/usr/local/n/versions/node/22.17.0/bin`)
- **Solana localnet** running with the DekantPM program deployed
- **Protocol initialized** (`cd devkit && npx ts-node src/setup.ts init`)
- **`devkit/.env`** configured with `PROGRAM_ID` (required, no default)

## Quick Start

```bash
# 1. Start localnet + deploy (from project root)
bash scripts/setup.sh

# 2. Install deps (first time only)
cd scripts/operator-cli
PATH="/usr/local/n/versions/node/22.17.0/bin:$PATH" npm install --legacy-peer-deps --ignore-scripts

# 3. Run
PATH="/usr/local/n/versions/node/22.17.0/bin:$PATH" node src/main.js
```

## Configuration

The CLI reads configuration from `devkit/.env` (loaded automatically via dotenv):

| Variable       | Description                | Required | Default                      |
|----------------|----------------------------|----------|------------------------------|
| `PROGRAM_ID`   | DekantPM program address   | **Yes**  | —                            |
| `RPC_URL`      | Solana RPC endpoint        | No       | `http://localhost:8899`      |
| `KEYPAIR_PATH` | Superuser keypair file     | No       | `~/.config/solana/id.json`   |

The CLI will **exit with an error** if `PROGRAM_ID` is not set. Make sure `devkit/.env` exists and contains it (setup.sh populates this automatically).

**IDL:** The program IDL is loaded from `target/idl/dekant_pm.json`, with fallback to `backend/idl/dekant_pm.json`.

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

Additionally, "inverse" trades (fixed-by-shares for buys, fixed-by-collateral for sells) are available. These use client-side AMM binary search (`amm.js`) to find the required input.

Distribution trades automatically include a `ComputeBudgetProgram.setComputeUnitLimit(1,000,000)` pre-instruction.

### Market Creation Details

When creating a market, the CLI:
1. Creates a new SPL mint with **superuser as authority** (so `Fund User` works regardless of market creator)
2. Mints 5x the initial liquidity to the creator
3. Checks if the selected oracle has the Oracle role — offers to auto-assign if not
4. Uses a fresh vault keypair as signer

### Random Mode (Ctrl+R)

Press **Ctrl+R** at any time in the main menu to toggle random mode. When active:
- All numeric inputs (amounts, deadlines, liquidity, range values) are auto-filled with random values within safe bounds
- Market type, outcomes, trade parameters are randomly selected
- User and market selection still require manual input
- Status bar shows **Random: ON** / **Random: OFF**

Random mode is useful for rapidly creating test scenarios without manually typing every parameter. Random values are generated by `random.js` with ranges matching the protocol's safe operational bounds.

### AMM Simulation

The `amm.js` module provides client-side L2-norm AMM math for inverse trade computation:
- `findCollateralForShares()` — binary search for collateral needed to buy target shares
- `findTokensForCollateral()` — binary search for shares to sell for target collateral
- All math uses `BigInt` to match on-chain u128 precision

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
    ├── random.js            RandomGenerator class for auto-filling inputs
    ├── amm.js               L2-norm AMM simulation (BigInt, binary search)
    ├── prompts/
    │   ├── user-select.js   Reusable user picker (roles, balance, cancel, superuser)
    │   ├── market-select.js Reusable market picker (live probs, state display)
    │   └── trade-params.js  Trade parameter collection per market type
    └── actions/
        ├── user.js          Add User, Assign Role, Fund User
        ├── market.js        Create Market, Pause/Unpause
        ├── trade.js         Buy/Sell (fixed, to-price, inverse, distribution)
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

| Key         | Action                                        |
|-------------|-----------------------------------------------|
| Enter       | Confirm selection / continue after results    |
| Arrow keys  | Navigate menu choices                         |
| Ctrl+R      | Toggle Random Mode (auto-fill inputs)         |
| Ctrl+C      | Cancel current prompt / return to menu / exit |

## Troubleshooting

| Error                         | Fix                                                |
|-------------------------------|----------------------------------------------------|
| `PROGRAM_ID is not set`       | Set `PROGRAM_ID` in `devkit/.env` or run `setup.sh` |
| `IDL not found`               | Run `anchor build` to generate `target/idl/`       |
| `Protocol not initialized`    | Run `cd devkit && npx ts-node src/setup.ts init`   |
| `OracleOnly` / `CreatorOnly`  | Select a user with the correct role                |
| `InsufficientFunds`           | Fund the user first (`Fund User` action)           |
