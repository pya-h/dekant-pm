# DekantPM Goperator CLI

A full-featured Go CLI for manually testing and operating the DekantPM prediction market protocol on Solana. Built with [Bubble Tea](https://github.com/charmbracelet/bubbletea) for a rich terminal UI experience — navigable menus, form inputs, status bar, and transaction logging, all in a compiled binary with no runtime dependencies.

> **See also:** [`operator-cli/`](../operator-cli/) — a Node.js version with the same feature set using readline prompts.

## Prerequisites

- **Go 1.25+**
- **Solana localnet** running with the DekantPM program deployed
- **Protocol initialized** (`cd devkit && npx ts-node src/setup.ts init`)
- **`devkit/.env`** configured with `PROGRAM_ID` (required, no default)

## Quick Start

```bash
# 1. Start localnet + deploy (from project root)
bash scripts/setup.sh

# 2. Run directly
cd scripts/goperator-cli
go run .

# Or build and run the binary
go build -o goperator .
./goperator
```

## Configuration

The CLI loads configuration from `devkit/.env` (discovered automatically from several candidate paths):

| Variable       | Description                | Required | Default                      |
|----------------|----------------------------|----------|------------------------------|
| `PROGRAM_ID`   | DekantPM program address   | **Yes**  | —                            |
| `RPC_URL`      | Solana RPC endpoint        | No       | `http://localhost:8899`      |
| `KEYPAIR_PATH` | Superuser keypair file     | No       | `~/.config/solana/id.json`   |

The CLI will **exit with an error** if `PROGRAM_ID` is not set. `setup.sh` populates `devkit/.env` automatically.

The `.env` file is discovered in this order:
1. `../../devkit/.env` (relative to CWD — works when run from `scripts/goperator-cli/`)
2. `<binary_dir>/../../devkit/.env` (relative to compiled binary location)
3. `<source_root>/devkit/.env` (compile-time source path fallback)

## Main Menu

The TUI presents a navigable menu with number shortcuts and section headers:

```
── User Management ──
  Add New User           Generate keypair + airdrop SOL
  Assign Role            Oracle / Creator / Admin
  Fund User              Mint USDC to user

── Market Operations ──
  Create Market          Binary / Multi / Continuous
  Pause / Unpause        Toggle market state

── Trading ──
  Buy Outcome            Fixed / To-Price / Distribution
  Sell Outcome           Fixed / To-Price / Distribution

── Liquidity ──
  Add Liquidity          Deposit collateral
  Remove Liquidity       Burn LP shares

── Settlement ──
  Resolve Market         Set winning outcome
  Claim Payout           Withdraw winnings
  Collect Fees           Transfer to treasury

── Query ──
  View Position          User holdings
  Query Market Info      Full market details
```

**14 protocol actions** covering the full market lifecycle.

## How It Works

### Architecture

```
main.go
  └─ config.Load()         # env vars from devkit/.env
  └─ state.NewSessionState  # RPC connection, keypair, program verification
  └─ tui.NewAppModel       # Bubble Tea app with menu routing
       └─ screens/*        # 10 screen files, one per action group
```

The TUI uses Bubble Tea's `Model` interface. The root `AppModel` manages menu navigation and delegates to action-specific screen models when an item is selected.

### Session State

The CLI maintains an in-memory session with:
- **Users**: Generated keypairs tracked with labels and assigned roles
- **Markets**: Created markets tracked with type, mint, oracle, and range info
- **Superuser**: Loaded from `KEYPAIR_PATH`, used for admin-only operations
- **Transaction log**: All submitted transactions with status and signatures

State is session-only — nothing persists to disk. Each run starts fresh.

### On-Chain Interaction

The `internal/chain/` package handles all Solana interaction:
- **client.go**: RPC client with `SendAndConfirm` using polling-based confirmation
- **pda.go**: 6 PDA derivations (ProtocolConfig, UserRole, Market, VaultAuthority, UserPosition, LpPosition)
- **tx.go**: Instruction builder implementing `solana.Instruction` interface, plus Borsh encoding/decoding helpers
- **token.go**: SPL token operations (ATA creation, MintTo, GetTokenBalance, CreateMint)

All instructions are built from raw bytes using Borsh serialization with Anchor discriminators — no Anchor Go SDK dependency.

### Trade Types by Market

| Market Type | Available Trades                                           |
|-------------|-------------------------------------------------------------|
| Binary      | Buy/Sell (fixed amount), Buy/Sell to Price                  |
| Multi       | Buy/Sell (fixed amount), Buy/Sell to Price                  |
| Continuous  | Buy/Sell Distribution (mu + sigma + amount)                 |

"Inverse" trades (specify shares for buy, or target collateral for sell) use the AMM binary search in `internal/amm/amm.go`.

Distribution trades include a `ComputeBudget::SetComputeUnitLimit(1,000,000)` pre-instruction.

### AMM Simulation

The `internal/amm/` package provides client-side L2-norm AMM math:
- `SimulateBuy` / `SimulateSell` — compute expected output for a given input
- `FindCollateralForShares` — binary search for collateral needed to buy target shares
- `FindTokensForCollateral` — binary search for tokens to sell for target collateral
- Uses `math/big.Int` for u128-precision arithmetic matching on-chain math

### Random Mode (Ctrl+R)

Press **Ctrl+R** at any time to toggle random mode. When active:
- All numeric inputs are auto-filled with random values within safe bounds
- Market type, outcomes, trade parameters, roles are randomly selected
- User and market selection still require manual input
- Status bar shows **Random: ON** / **Random: OFF**

Random values are generated by `internal/random/random.go` with ranges matching the protocol's safe operational bounds:
- Liquidity: 50–500 USDC
- Trade amounts: 5–30 USDC
- Deadlines: 30 min – 24 hours
- Continuous mu: within 20–80% of range, sigma: 5–30% of range spread

### Transaction Log (Ctrl+L)

Press **Ctrl+L** to view the transaction log — a scrollable list of all submitted transactions with their status (success/error), action name, and signature.

## Keyboard Shortcuts

| Key         | Action                                        |
|-------------|-----------------------------------------------|
| Enter       | Confirm selection / submit form               |
| Arrow keys  | Navigate menu / form fields                   |
| 0-9         | Quick-select menu item by number              |
| Ctrl+R      | Toggle Random Mode (auto-fill inputs)         |
| Ctrl+L      | Toggle Transaction Log                        |
| Esc / q     | Return to menu / exit from menu               |
| Ctrl+C      | Force quit                                    |

## Project Structure

```
goperator-cli/
├── main.go                          Entry point
├── go.mod / go.sum                  Dependencies
├── TASKS.md                         Implementation task tracker
├── README.md                        This file
└── internal/
    ├── config/
    │   └── config.go                Env loading, .env discovery
    ├── chain/
    │   ├── client.go                RPC client, SendAndConfirm
    │   ├── pda.go                   PDA derivations
    │   ├── tx.go                    Instruction builder + Borsh encoding
    │   └── token.go                 SPL token operations
    ├── constants/
    │   └── constants.go             SCALE, roles, market types, discriminators, seeds
    ├── state/
    │   └── state.go                 SessionState, on-chain account deserialization
    ├── util/
    │   ├── format.go                Token formatting, probability computation
    │   └── deadline.go              Deadline parsing (+1h, ISO 8601, unix)
    ├── random/
    │   └── random.go                Random value generator for all input types
    ├── amm/
    │   └── amm.go                   L2-norm AMM simulation (BigInt binary search)
    └── tui/
        ├── app.go                   Root Bubble Tea model, menu, routing
        ├── screens.go               Screen factory (14 actions)
        ├── types/                   Shared TUI message types
        ├── styles/
        │   └── styles.go            Lipgloss color scheme, ProbBar
        └── screens/
            ├── common.go            Shared helpers, sendTx, phase types
            ├── user_add.go          Add User
            ├── user_role.go         Assign Role
            ├── user_fund.go         Fund User
            ├── market_create.go     Create Market
            ├── market_pause.go      Pause / Unpause
            ├── trade.go             Buy / Sell (all trade types)
            ├── lp.go                Add / Remove Liquidity
            ├── settle.go            Resolve, Claim, Collect Fees
            └── query.go             View Position, Query Market Info
```

## Dependencies

| Package                     | Purpose                    |
|-----------------------------|----------------------------|
| `charmbracelet/bubbletea`   | TUI framework              |
| `charmbracelet/bubbles`     | TUI components (list)      |
| `charmbracelet/huh`         | Form inputs                |
| `charmbracelet/lipgloss`    | Terminal styling            |
| `gagliardetto/solana-go`    | Solana RPC + crypto types  |
| `joho/godotenv`             | .env file loading          |

## Typical Test Flow

1. **Add 2-3 users** and note their labels
2. **Assign roles**: Oracle to User 1, Creator to User 2
3. **Create a binary market** as User 2 (Creator), with User 1 as oracle
4. **Fund users** with USDC via the market's collateral mint
5. **Buy outcome** as different users, observe probability changes
6. **Sell outcome** or **buy-to-price** to move probabilities
7. **Resolve market** as User 1 (Oracle) after deadline passes
8. **Claim payout** for each user
9. **Collect fees** (superuser auto)
10. **Query Market Info** to see final state + ASCII probability chart

## Troubleshooting

| Error                         | Fix                                                |
|-------------------------------|----------------------------------------------------|
| `PROGRAM_ID is not set`       | Set `PROGRAM_ID` in `devkit/.env` or run `setup.sh` |
| `Protocol error: ...`         | Run `cd devkit && npx ts-node src/setup.ts init`   |
| `Config error: invalid PROGRAM_ID` | Check the value is a valid base58 Solana address |
| `OracleOnly` / `CreatorOnly`  | Select a user with the correct role                |
| `InsufficientFunds`           | Fund the user first (`Fund User` action)           |
| TUI rendering issues          | Ensure terminal supports 256 colors (most modern terminals do) |

## Comparison with operator-cli (Node.js)

| Feature                 | operator-cli (Node.js)      | goperator-cli (Go)          |
|-------------------------|-----------------------------|-----------------------------|
| Runtime                 | Node.js 22+                 | Compiled Go binary          |
| UI Framework            | inquirer prompts            | Bubble Tea TUI              |
| Config                  | dotenv from devkit/.env     | godotenv from devkit/.env   |
| IDL                     | Anchor Program from JSON    | Raw Borsh + discriminators  |
| Trade types             | All 4 + distribution        | All 4 + distribution        |
| Random mode             | Ctrl+R toggle               | Ctrl+R toggle               |
| AMM simulation          | BigInt binary search        | big.Int binary search       |
| Transaction log         | Console output              | Ctrl+L scrollable log       |
| Number shortcuts        | —                           | 0-9 quick select            |
