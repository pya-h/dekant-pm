# DekantPM Operator CLI — Implementation Tasks

## T-1: Project Scaffolding ✅
- [x] Directory structure, package.json
- [x] Install deps, verify module loading
- [x] main.js skeleton with bootstrap + main menu loop

## T-2: Session State + UI Utilities ✅
- [x] state.js: SessionState class
- [x] ui.js: clear, banner, pressKey, formatError, probBar, printBeforeAfter

## T-3: Reusable Prompts ✅
- [x] prompts/user-select.js (roles, balance, cancel, superuser)
- [x] prompts/market-select.js (live probs, state, type, filter)
- [x] prompts/trade-params.js (discrete/distribution, fixed/toPrice)

## T-4: User Management ✅
- [x] Add User, Assign Role, Fund User

## T-5: Create Market ✅
- [x] Binary, Multi, Continuous creation with permission retry

## T-6: Trading (Buy + Sell) ✅
- [x] Discrete buy/sell, distribution buy/sell, buy/sell-to-price

## T-7: Liquidity ✅
- [x] Add Liquidity, Remove Liquidity

## T-8: Settlement ✅
- [x] Resolve Market, Claim Payout, Collect Fees

## T-9: Query + Market Management ✅
- [x] Query Market Info (with ASCII chart for continuous)
- [x] View Position
- [x] Pause/Unpause

## T-10: Verification ✅
- [x] All 12 modules load cleanly (Node 22)
- [x] App starts, connects to RPC, verifies protocol

## T-11: Random Input Mode ✅
- [x] Add Ctrl+R toggle for random mode in main menu loop
- [x] Auto-fill user labels, fund amounts, trade amounts, deadlines, etc. with random values
- [x] Still require manual user/market selection
- [x] Show "Random: ON/OFF" in status bar
- [x] Reference: goperator-cli random.Generator for value ranges and distributions
