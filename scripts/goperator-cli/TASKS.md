# DekantPM Goperator CLI — Implementation Tasks

Go (Bubble Tea) port of operator-cli with Random Mode for fast protocol testing.

## T-1: Project Scaffolding + Dependencies
- [x] Go module (`goperator-cli`), go.mod with deps
- [x] main.go entry point (config -> session -> verify protocol -> launch TUI)
- [x] internal/config: env-based config (RPC_URL, PROGRAM_ID, KEYPAIR_PATH)

## T-2: Chain Layer
- [x] internal/chain/client.go: RPC client, SendAndConfirm with polling
- [x] internal/chain/pda.go: 6 PDA derivations (ProtocolConfig, UserRole, Market, VaultAuthority, UserPosition, LpPosition)
- [x] internal/chain/tx.go: Instruction builder implementing solana.Instruction interface
- [x] internal/chain/token.go: ATA creation, MintTo, GetTokenBalance, CreateMint
- [x] internal/chain/encoding.go: Borsh encode/decode helpers (u8, u16, u32, u64, i64, u128, pubkey, bool, vec)

## T-3: Constants + State + Utilities
- [x] internal/constants: SCALE, roles, market types/states, instruction discriminators, PDA seeds, program IDs
- [x] internal/state: SessionState, User, SessionMarket, TxLogEntry, on-chain account types, deserialization
- [x] internal/util: deadline parsing, token formatting, probability computation, outcome labels

## T-4: Random Generator
- [x] internal/random: Generator with all methods
- [x] UserLabel, FundAmount, Liquidity, Deadline, MarketType, NumOutcomes, RangeValues
- [x] TradeAmount, BuyAmountForBalance, SellAmount, Outcome, TargetProbability
- [x] Mu, Sigma, ResolveOutcome, ResolveValue, Role

## T-5: TUI Framework
- [x] internal/tui/app.go: AppModel with menu, screen routing, banner, status bar
- [x] internal/tui/styles: lipgloss styles, ProbBar
- [x] internal/tui/types: ActionDoneMsg
- [x] internal/tui/screens.go: CreateActionScreen factory (14 actions)
- [x] internal/tui/screens/common.go: Phase type, messages, user/market choice builders, sendTx helper

## T-6: User Management Screens
- [x] Add User (generate keypair + airdrop SOL)
- [x] Assign Role (Oracle / Creator / Admin)
- [x] Fund User (mint USDC via collateral mint)

## T-7: Market Operations Screens
- [x] Create Market (binary / multi / continuous with multi-step form)
- [x] Pause / Unpause Market

## T-8: Trading Screens
- [x] Buy Outcome (fixed amount)
- [x] Sell Outcome (fixed amount)
- [x] Buy/Sell to Price (target probability + limit)
- [x] Buy/Sell Distribution (mu/sigma for continuous markets)
- [x] Compute budget instruction for distribution trades

## T-9: Liquidity Screens
- [x] Add Liquidity
- [x] Remove Liquidity (shares or "all")

## T-10: Settlement Screens
- [x] Resolve Market (discrete outcome or continuous value)
- [x] Claim Payout (with balance diff reporting)
- [x] Collect Fees (superuser -> treasury)

## T-11: Query Screens
- [x] Query Market Info (full details, probabilities, ASCII chart for continuous)
- [x] View Position (holdings, deposited/withdrawn, claimed status)

## T-12: Random Mode Integration
- [x] Ctrl+R toggle in app.go
- [x] Rand field on SessionState, initialized in NewSessionState
- [x] user_add.go: random label
- [x] user_fund.go: random amount
- [x] user_role.go: random role pre-selected
- [x] market_create.go: random type, liquidity, deadline, outcomes, range
- [x] trade.go: random amount, outcome, target prob, mu, sigma
- [x] lp.go: random liquidity amount
- [x] settle.go: random resolve outcome/value
- [x] Status bar indicator for random mode (already shows ON/OFF)

## T-13: Bug Fixes
- [x] Import cycle resolution (styles -> separate package)
- [x] chain.Instruction interface compliance (unexported fields + method names)
- [x] MenuItemDelegate.Render signature (bubbles v1 io.Writer)
- [x] toPrice trade flow (separate phase for target prob form)
- [x] Unused imports cleanup
- [x] go.sum / dependency resolution
