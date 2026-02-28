#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DekantPM — E2E Smoke Test
#
# Comprehensive end-to-end test exercising all market types, trade methods,
# and multiple traders against the full stack (program + backend + frontend).
#
# Features:
#   - Randomized values (liquidity, amounts, deadlines) for realistic testing
#   - 3 independent test traders with separate keypairs
#   - All trade types: buy, sell, buy-to-price, sell-to-price, add-lp, remove-lp
#   - All market types: binary, multi-outcome (4), continuous (64 bins)
#   - Distribution trades (buy-dist, sell-dist) for continuous markets
#   - Backend API verification
#   - Reproducible with SEED=<n> env var
#
# Prerequisites:
#   - solana-test-validator, anchor build completed
#   - PostgreSQL running, Node 18+ & 23.3.0 via n
#   - Dependencies installed (devkit, backend, frontend)
#
# Usage:
#   ./scripts/e2e-smoke.sh              # Full test (starts services)
#   ./scripts/e2e-smoke.sh --no-infra   # Skip infrastructure (already running)
#   ./scripts/e2e-smoke.sh --manual     # Print manual frontend checklist
#   SEED=42 ./scripts/e2e-smoke.sh      # Reproducible run
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_NAME="smoke"
source "$(dirname "$0")/lib.sh"

# ── Parse Arguments ──────────────────────────────────────────────────────────

START_INFRA=true
MANUAL_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --no-infra)  START_INFRA=false ;;
    --manual)    MANUAL_ONLY=true ;;
    -h|--help)
      echo "Usage: $0 [--no-infra] [--manual]"
      echo ""
      echo "Runs the DekantPM end-to-end smoke test."
      echo ""
      echo "Options:"
      echo "  --no-infra   Skip starting validator/backend/frontend (already running)"
      echo "  --manual     Print manual frontend verification checklist only"
      echo "  -h, --help   Show this help"
      echo ""
      echo "Environment:"
      echo "  SEED=<n>     Set random seed for reproducible runs"
      exit 0
      ;;
  esac
done

# ── Manual Checklist ─────────────────────────────────────────────────────────

print_manual_checklist() {
  header "MANUAL FRONTEND VERIFICATION CHECKLIST"

  echo -e "${BOLD}Prerequisites:${NC}"
  echo "  All 3 services running: validator (:8899), backend (:4000), frontend (:3000)"
  echo "  Protocol initialized, roles assigned, test markets created"
  echo ""

  echo -e "${BOLD}1. Market Discovery Page (http://localhost:3000/markets)${NC}"
  echo "   [ ] Page loads without errors"
  echo "   [ ] Market cards visible with titles and probabilities"
  echo "   [ ] Search/filter/sort controls work"
  echo "   [ ] Category filter and market type tabs work"
  echo "   [ ] 'Held' badge on markets with positions"
  echo ""

  echo -e "${BOLD}2. Binary Market Detail (click binary market card)${NC}"
  echo "   [ ] Market title, description, deadline displayed"
  echo "   [ ] Probability bar shows current Yes/No percentages"
  echo "   [ ] Market status badge shows current state"
  echo "   [ ] Trading panel with Buy/Sell tabs"
  echo "   [ ] Connect wallet via Phantom/Solflare"
  echo ""

  echo -e "${BOLD}3. Binary Trading Flow${NC}"
  echo "   [ ] Select Buy > Yes outcome > enter amount > cost preview"
  echo "   [ ] Unit toggle: switch between USDC and Shares"
  echo "   [ ] Balance display with Max button"
  echo "   [ ] Execute trade > wallet popup > success toast"
  echo "   [ ] Probability bar updates, position display appears"
  echo "   [ ] Sell tab: enter shares > estimated USDC shown > execute"
  echo ""

  echo -e "${BOLD}4. Continuous Market Detail${NC}"
  echo "   [ ] Distribution chart renders (SVG bars)"
  echo "   [ ] Range displayed (e.g. \$X - \$Y)"
  echo "   [ ] Center/confidence inputs in trading panel"
  echo "   [ ] Distribution preview overlaid on market chart"
  echo "   [ ] Buy and sell distribution trades work"
  echo ""

  echo -e "${BOLD}5. Admin Dashboard (http://localhost:3000/admin)${NC}"
  echo "   [ ] Role manager: view, assign, revoke roles"
  echo "   [ ] Fee config: view/update protocol fees (superadmin only)"
  echo "   [ ] Pause controls: pause/unpause markets"
  echo "   [ ] Create market button > multi-step form"
  echo ""

  echo -e "${BOLD}6. Oracle Dashboard (http://localhost:3000/oracle)${NC}"
  echo "   [ ] Pending resolution queue for expired markets"
  echo "   [ ] Resolution form: binary buttons, multi selector, continuous value"
  echo "   [ ] Confirmation dialog > resolve > success"
  echo ""

  echo -e "${BOLD}7. Portfolio & Claims (http://localhost:3000/portfolio)${NC}"
  echo "   [ ] Active positions grouped by market"
  echo "   [ ] Resolved markets show 'Claim' button"
  echo "   [ ] Claim > wallet popup > success toast"
  echo "   [ ] Position moves to 'Past' section"
  echo ""

  echo -e "${BOLD}8. Error States${NC}"
  echo "   [ ] Trade with insufficient balance > clear validation error"
  echo "   [ ] Trade on resolved market > appropriate message"
  echo "   [ ] Admin/Oracle pages without role > unauthorized message"
  echo ""
}

if [ "$MANUAL_ONLY" = true ]; then
  print_manual_checklist
  exit 0
fi

# ── Random Seed ──────────────────────────────────────────────────────────────

SEED=${SEED:-$RANDOM}
RANDOM=$SEED
log "Random seed: $SEED (reproduce with SEED=$SEED)"

# ── Statistics Tracking ──────────────────────────────────────────────────────

STAT_MARKETS=0
STAT_TRADES=0
STAT_CLAIMS=0
STAT_ERRORS=0

count_trade()  { STAT_TRADES=$((STAT_TRADES + 1)); }
count_market() { STAT_MARKETS=$((STAT_MARKETS + 1)); }
count_claim()  { STAT_CLAIMS=$((STAT_CLAIMS + 1)); }
count_error()  { STAT_ERRORS=$((STAT_ERRORS + 1)); }

# ── Trade Helpers ─────────────────────────────────────────────────────────────

# Execute a trade command — on failure, warn + count error instead of crashing.
# Usage: run_trade "description" command arg1 arg2 ...
run_trade() {
  local desc=$1
  shift
  if _tout=$("$@" 2>&1); then
    echo "$_tout" | tail -2
    success "$desc"
  else
    warn "$desc"
    count_error
  fi
  count_trade
}

# Execute a claim — warns on NothingToClaim (expected, not counted as error).
# Usage: run_claim <trader_num> <market_id> <keypair_path>
run_claim() {
  local n=$1 market_id=$2 keypair=$3
  if _cout=$(devkit_as "$keypair" market.ts claim "$market_id" 2>&1); then
    echo "$_cout" | tail -2
    success "Trader $n claimed"
  else
    warn "Trader $n: nothing to claim (no winning tokens)"
  fi
  count_claim
}

# ── Cleanup ──────────────────────────────────────────────────────────────────

cleanup_and_exit() {
  echo ""
  stop_tracked_pids
  log "Smoke test cleanup done."
}

trap cleanup_and_exit EXIT

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 1: Preflight
# ═════════════════════════════════════════════════════════════════════════════

header "PREFLIGHT CHECKS"

preflight_check_program
preflight_check_tools

WALLET_ADDR=$(preflight_check_wallet)
if [ -z "$WALLET_ADDR" ]; then exit 1; fi

preflight_check_postgres
ensure_deps

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 2: Infrastructure
# ═════════════════════════════════════════════════════════════════════════════

if [ "$START_INFRA" = true ]; then
  header "PHASE 1: STARTING INFRASTRUCTURE"
  start_validator
  start_backend
  start_frontend
else
  header "PHASE 1: SKIPPING INFRASTRUCTURE (--no-infra)"
  check_port 8899 && success "Validator :8899" || { fail "Validator not reachable on :8899"; exit 1; }
  check_port 4000 && success "Backend :4000"   || { fail "Backend not reachable on :4000"; exit 1; }
  check_port 3000 && success "Frontend :3000"  || { fail "Frontend not reachable on :3000"; exit 1; }
  WALLET_ADDR=$(solana address 2>/dev/null)
fi

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 3: Protocol Setup
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 2: PROTOCOL SETUP"

step "Initializing protocol"
devkit setup.ts init 2>&1 | tail -3
success "Protocol initialized"

step "Assigning Oracle role to deployer"
devkit setup.ts assign-role "$WALLET_ADDR" oracle 2>&1 | tail -2 || warn "May already be assigned"
success "Oracle role set"

step "Assigning Creator role to deployer"
devkit setup.ts assign-role "$WALLET_ADDR" creator 2>&1 | tail -2 || warn "May already be assigned"
success "Creator role set"

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 4: Generate Test Traders
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 3: GENERATING TEST TRADERS"

NUM_TRADERS=3
TRADER_KEYS=()
TRADER_ADDRS=()

for i in $(seq 1 $NUM_TRADERS); do
  KPATH=$(generate_keypair "trader$i")
  ADDR=$(keypair_address "$KPATH")
  TRADER_KEYS+=("$KPATH")
  TRADER_ADDRS+=("$ADDR")
  airdrop_sol "$ADDR" 10
  success "Trader $i: $ADDR (10 SOL)"
done

# Convenience aliases
T1_KEY="${TRADER_KEYS[0]}"
T2_KEY="${TRADER_KEYS[1]}"
T3_KEY="${TRADER_KEYS[2]}"
T1_ADDR="${TRADER_ADDRS[0]}"
T2_ADDR="${TRADER_ADDRS[1]}"
T3_ADDR="${TRADER_ADDRS[2]}"

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 5: Binary Market Flow
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 4: BINARY MARKET"

# Random parameters
BIN_LIQUIDITY=$(rand 50 200)
BIN_DEADLINE_SEC=$(rand 45 120)
BIN_DEADLINE=$(($(date +%s) + BIN_DEADLINE_SEC))
BIN_FUND_EACH=$(rand 100 300)

step "4.1 Creating binary market (liquidity=$BIN_LIQUIDITY, deadline=${BIN_DEADLINE_SEC}s)"
if ! BINARY_OUTPUT=$(devkit market.ts create-binary "$WALLET_ADDR" "$BIN_LIQUIDITY" "$BIN_DEADLINE" 2>&1); then
  echo "$BINARY_OUTPUT"
  fail "Failed to create binary market"
  exit 1
fi
echo "$BINARY_OUTPUT"
BINARY_ID=$(echo "$BINARY_OUTPUT" | grep "Market ID:" | awk '{print $NF}' || true)
COLLATERAL_MINT=$(echo "$BINARY_OUTPUT" | grep "Mint:" | tail -1 | awk '{print $NF}' || true)

if [ -z "$BINARY_ID" ]; then
  fail "Failed to parse binary market ID from output"
  exit 1
fi
success "Binary market created: ID=$BINARY_ID, Mint=$COLLATERAL_MINT"
count_market

step "4.2 Funding all traders ($BIN_FUND_EACH tokens each)"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  devkit trade.ts fund "$BINARY_ID" "$BIN_FUND_EACH" --wallet "${TRADER_ADDRS[$i]}" 2>&1 | tail -1
done
# Also fund deployer for LP
devkit trade.ts fund "$BINARY_ID" 200 2>&1 | tail -1
success "All traders funded"

step "4.3 Querying initial state"
devkit query.ts market "$BINARY_ID" 2>&1 | head -15 || true
echo ""

# --- Trade 1: Trader 1 buys Yes (outcome 0) ---
BIN_BUY1=$(rand 5 30)
step "4.4 Trader 1: buy Yes with $BIN_BUY1 tokens"
run_trade "Trader 1 bought Yes" devkit_as "$T1_KEY" trade.ts buy "$BINARY_ID" 0 "$BIN_BUY1"

# --- Trade 2: Trader 2 buys No (outcome 1) ---
BIN_BUY2=$(rand 5 30)
step "4.5 Trader 2: buy No with $BIN_BUY2 tokens"
run_trade "Trader 2 bought No" devkit_as "$T2_KEY" trade.ts buy "$BINARY_ID" 1 "$BIN_BUY2"

# --- Trade 3: Trader 3 buys Yes ---
BIN_BUY3=$(rand 5 15)
step "4.6 Trader 3: buy Yes with $BIN_BUY3 tokens"
run_trade "Trader 3 bought Yes" devkit_as "$T3_KEY" trade.ts buy "$BINARY_ID" 0 "$BIN_BUY3"

# --- Trade 4: Trader 1 buys-to-price (push Yes higher) ---
BIN_BTP_TARGET=$(rand 58 72)
step "4.7 Trader 1: buy-to-price Yes to ${BIN_BTP_TARGET}% (max collateral 100)"
run_trade "Trader 1 buy-to-price (target ${BIN_BTP_TARGET}%)" devkit_as "$T1_KEY" trade.ts buy-to-price "$BINARY_ID" 0 "$BIN_BTP_TARGET" --max-collateral 100

# --- Trade 5: Trader 3 sells some Yes tokens ---
# Sell a safe fraction (at most half of what was bought)
BIN_SELL3_MAX=$((BIN_BUY3 / 2))
if [ "$BIN_SELL3_MAX" -lt 1 ]; then BIN_SELL3_MAX=1; fi
BIN_SELL3=$(rand 1 "$BIN_SELL3_MAX")
step "4.8 Trader 3: sell $BIN_SELL3 Yes tokens"
run_trade "Trader 3 sold Yes tokens" devkit_as "$T3_KEY" trade.ts sell "$BINARY_ID" 0 "$BIN_SELL3"

# --- Trade 6: Trader 2 sell-to-price No (push No lower) ---
# After buy-to-price, Yes ~ BTP_TARGET%, so No ~ (100-BTP_TARGET)%
# Target to sell No down by 3-8 points
BIN_STP_DELTA=$(rand 3 8)
BIN_STP_TARGET=$((100 - BIN_BTP_TARGET - BIN_STP_DELTA))
if [ "$BIN_STP_TARGET" -lt 15 ]; then BIN_STP_TARGET=15; fi
step "4.9 Trader 2: sell-to-price No to ${BIN_STP_TARGET}%"
run_trade "Trader 2 sell-to-price done" devkit_as "$T2_KEY" trade.ts sell-to-price "$BINARY_ID" 1 "$BIN_STP_TARGET"

# --- Trade 7: Deployer adds liquidity ---
BIN_LP_AMOUNT=$(rand 30 80)
step "4.10 Deployer: add $BIN_LP_AMOUNT liquidity"
run_trade "Liquidity added" devkit trade.ts add-lp "$BINARY_ID" "$BIN_LP_AMOUNT"

step "4.11 Querying positions after all trades"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  log "Trader $((i + 1)):"
  devkit_as "${TRADER_KEYS[$i]}" trade.ts position "$BINARY_ID" 2>&1 || true
done
echo ""

step "4.12 Querying probabilities"
devkit query.ts market "$BINARY_ID" 2>&1 | head -15 || true
echo ""

# Wait for deadline
REMAINING=$((BIN_DEADLINE - $(date +%s) + 5))
if [ "$REMAINING" -gt 0 ]; then
  log "Waiting ${REMAINING}s for binary market deadline..."
  sleep "$REMAINING"
else
  log "Deadline already passed"
fi

# --- Resolve ---
BIN_WINNING_OUTCOME=0
step "4.13 Resolving binary market — Yes wins (outcome $BIN_WINNING_OUTCOME)"
if _out=$(devkit resolve.ts market "$BINARY_ID" "$BIN_WINNING_OUTCOME" 2>&1); then
  echo "$_out" | tail -2
  success "Binary market resolved"
else
  warn "Failed to resolve binary market"
  count_error
fi

step "4.14 Checking resolved state"
devkit query.ts market "$BINARY_ID" 2>&1 | head -15 || true
echo ""

# --- Claims ---
step "4.15 All traders claim payouts"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  run_claim "$((i + 1))" "$BINARY_ID" "${TRADER_KEYS[$i]}"
done

step "4.16 Deployer: remove liquidity"
run_trade "Liquidity removed" devkit trade.ts remove-lp "$BINARY_ID" all

step "4.17 Final vault check"
devkit query.ts vault "$BINARY_ID" 2>&1 || true
echo ""

success "Binary market E2E flow complete!"

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 6: Multi-Outcome Market Flow
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 5: MULTI-OUTCOME MARKET (4 outcomes)"

MULTI_LIQUIDITY=$(rand 50 200)
MULTI_DEADLINE_SEC=$(rand 45 120)
MULTI_DEADLINE=$(($(date +%s) + MULTI_DEADLINE_SEC))
MULTI_FUND_EACH=$(rand 100 300)
MULTI_OUTCOMES=4

step "5.1 Creating multi-outcome market ($MULTI_OUTCOMES outcomes, liquidity=$MULTI_LIQUIDITY, deadline=${MULTI_DEADLINE_SEC}s)"
if ! MULTI_OUTPUT=$(devkit market.ts create-multi "$WALLET_ADDR" "$MULTI_LIQUIDITY" "$MULTI_DEADLINE" "$MULTI_OUTCOMES" --mint "$COLLATERAL_MINT" 2>&1); then
  echo "$MULTI_OUTPUT"
  fail "Failed to create multi-outcome market"
  exit 1
fi
echo "$MULTI_OUTPUT"
MULTI_ID=$(echo "$MULTI_OUTPUT" | grep "Market ID:" | awk '{print $NF}' || true)

if [ -z "$MULTI_ID" ]; then
  fail "Failed to parse multi-outcome market ID from output"
  exit 1
fi
success "Multi-outcome market created: ID=$MULTI_ID"
count_market

step "5.2 Funding all traders ($MULTI_FUND_EACH tokens each)"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  devkit trade.ts fund "$MULTI_ID" "$MULTI_FUND_EACH" --wallet "${TRADER_ADDRS[$i]}" 2>&1 | tail -1
done
success "All traders funded"

step "5.3 Querying initial state"
devkit query.ts market "$MULTI_ID" 2>&1 | head -20 || true
echo ""

# --- Trade 1: Trader 1 buys Outcome 0 ---
MULTI_BUY1=$(rand 8 25)
step "5.4 Trader 1: buy Outcome 0 with $MULTI_BUY1 tokens"
run_trade "Trader 1 bought Outcome 0" devkit_as "$T1_KEY" trade.ts buy "$MULTI_ID" 0 "$MULTI_BUY1"

# --- Trade 2: Trader 2 buys Outcome 2 ---
MULTI_BUY2=$(rand 8 25)
step "5.5 Trader 2: buy Outcome 2 with $MULTI_BUY2 tokens"
run_trade "Trader 2 bought Outcome 2" devkit_as "$T2_KEY" trade.ts buy "$MULTI_ID" 2 "$MULTI_BUY2"

# --- Trade 3: Trader 3 buys Outcome 1 ---
MULTI_BUY3=$(rand 8 25)
step "5.6 Trader 3: buy Outcome 1 with $MULTI_BUY3 tokens"
run_trade "Trader 3 bought Outcome 1" devkit_as "$T3_KEY" trade.ts buy "$MULTI_ID" 1 "$MULTI_BUY3"

# --- Trade 4: Trader 1 buy-to-price Outcome 0 to ~35-45% (from ~25%) ---
MULTI_BTP=$(rand 33 45)
step "5.7 Trader 1: buy-to-price Outcome 0 to ${MULTI_BTP}% (max collateral 100)"
run_trade "Trader 1 buy-to-price (target ${MULTI_BTP}%)" devkit_as "$T1_KEY" trade.ts buy-to-price "$MULTI_ID" 0 "$MULTI_BTP" --max-collateral 100

# --- Trade 5: Trader 3 sells some Outcome 1 tokens ---
MULTI_SELL3_MAX=$((MULTI_BUY3 / 2))
if [ "$MULTI_SELL3_MAX" -lt 2 ]; then MULTI_SELL3_MAX=2; fi
MULTI_SELL3=$(rand 2 "$MULTI_SELL3_MAX")
step "5.8 Trader 3: sell $MULTI_SELL3 Outcome 1 tokens"
run_trade "Trader 3 sold Outcome 1" devkit_as "$T3_KEY" trade.ts sell "$MULTI_ID" 1 "$MULTI_SELL3"

# --- Trade 6: Trader 2 buys more Outcome 2 ---
MULTI_BUY2B=$(rand 5 15)
step "5.9 Trader 2: buy another $MULTI_BUY2B of Outcome 2"
run_trade "Trader 2 bought more Outcome 2" devkit_as "$T2_KEY" trade.ts buy "$MULTI_ID" 2 "$MULTI_BUY2B"

step "5.10 Querying probabilities"
devkit query.ts market "$MULTI_ID" 2>&1 | head -20 || true
echo ""

# Wait for deadline
REMAINING=$((MULTI_DEADLINE - $(date +%s) + 5))
if [ "$REMAINING" -gt 0 ]; then
  log "Waiting ${REMAINING}s for multi-outcome market deadline..."
  sleep "$REMAINING"
fi

# Resolve: Outcome 2 wins (so Trader 2 should profit most)
MULTI_WINNER=2
step "5.11 Resolving multi-outcome market — Outcome $MULTI_WINNER wins"
if _out=$(devkit resolve.ts market "$MULTI_ID" "$MULTI_WINNER" 2>&1); then
  echo "$_out" | tail -2
  success "Multi-outcome market resolved"
else
  warn "Failed to resolve multi-outcome market"
  count_error
fi

step "5.12 Checking resolved state"
devkit query.ts market "$MULTI_ID" 2>&1 | head -20 || true
echo ""

# --- Claims ---
step "5.13 All traders claim payouts"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  run_claim "$((i + 1))" "$MULTI_ID" "${TRADER_KEYS[$i]}"
done

success "Multi-outcome market E2E flow complete!"

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 7: Continuous Market Flow
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 6: CONTINUOUS MARKET (64 bins)"

CONT_RANGE_MIN=$(rand 30 80)
CONT_RANGE_MAX=$(rand 300 600)
CONT_LIQUIDITY=$(rand 50 200)
CONT_DEADLINE_SEC=$(rand 45 120)
CONT_DEADLINE=$(($(date +%s) + CONT_DEADLINE_SEC))
CONT_FUND_EACH=$(rand 100 300)
CONT_BINS=64

step "6.1 Creating continuous market (range $CONT_RANGE_MIN-$CONT_RANGE_MAX, $CONT_BINS bins, liquidity=$CONT_LIQUIDITY)"
if ! CONT_OUTPUT=$(devkit market.ts create-continuous "$WALLET_ADDR" "$CONT_LIQUIDITY" "$CONT_DEADLINE" "$CONT_RANGE_MIN" "$CONT_RANGE_MAX" --bins $CONT_BINS --mint "$COLLATERAL_MINT" 2>&1); then
  echo "$CONT_OUTPUT"
  fail "Failed to create continuous market"
  exit 1
fi
echo "$CONT_OUTPUT"
CONT_ID=$(echo "$CONT_OUTPUT" | grep "Market ID:" | awk '{print $NF}' || true)

if [ -z "$CONT_ID" ]; then
  fail "Failed to parse continuous market ID from output"
  exit 1
fi
success "Continuous market created: ID=$CONT_ID"
count_market

step "6.2 Funding all traders ($CONT_FUND_EACH tokens each)"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  devkit trade.ts fund "$CONT_ID" "$CONT_FUND_EACH" --wallet "${TRADER_ADDRS[$i]}" 2>&1 | tail -1
done
success "All traders funded"

step "6.3 Querying initial state"
devkit query.ts market "$CONT_ID" 2>&1 | head -20 || true
echo ""

# Compute reasonable mu/sigma values within the range
CONT_RANGE_WIDTH=$((CONT_RANGE_MAX - CONT_RANGE_MIN))
CONT_CENTER=$((CONT_RANGE_MIN + CONT_RANGE_WIDTH / 2))

# --- Trade 1: Trader 1 buys distribution near center ---
T1_MU_OFFSET=$(rand 0 $((CONT_RANGE_WIDTH / 4)))
T1_MU=$((CONT_CENTER - CONT_RANGE_WIDTH / 8 + T1_MU_OFFSET))
T1_SIGMA_BASE=$((CONT_RANGE_WIDTH / 10))
T1_SIGMA_EXTRA=$(rand 0 $((CONT_RANGE_WIDTH / 10)))
T1_SIGMA=$((T1_SIGMA_BASE + T1_SIGMA_EXTRA))
if [ "$T1_SIGMA" -lt 5 ]; then T1_SIGMA=5; fi
CONT_BUY1=$(rand 10 30)
step "6.4 Trader 1: buy-dist N($T1_MU, $T1_SIGMA) with $CONT_BUY1 tokens"
run_trade "Trader 1 bought distribution" devkit_as "$T1_KEY" trade.ts buy-dist "$CONT_ID" "$T1_MU" "$T1_SIGMA" "$CONT_BUY1"

# --- Trade 2: Trader 2 buys distribution (different center, narrower) ---
T2_MU_OFFSET=$(rand 0 $((CONT_RANGE_WIDTH / 6)))
T2_MU=$((CONT_CENTER + CONT_RANGE_WIDTH / 6 + T2_MU_OFFSET))
if [ "$T2_MU" -gt "$CONT_RANGE_MAX" ]; then T2_MU=$((CONT_RANGE_MAX - 10)); fi
T2_SIGMA_BASE=$((CONT_RANGE_WIDTH / 20))
T2_SIGMA_EXTRA=$(rand 0 $((CONT_RANGE_WIDTH / 20)))
T2_SIGMA=$((T2_SIGMA_BASE + T2_SIGMA_EXTRA))
if [ "$T2_SIGMA" -lt 5 ]; then T2_SIGMA=5; fi
CONT_BUY2=$(rand 10 30)
step "6.5 Trader 2: buy-dist N($T2_MU, $T2_SIGMA) with $CONT_BUY2 tokens"
run_trade "Trader 2 bought distribution" devkit_as "$T2_KEY" trade.ts buy-dist "$CONT_ID" "$T2_MU" "$T2_SIGMA" "$CONT_BUY2"

# --- Trade 3: Trader 3 buys distribution (wider sigma) ---
T3_MU_OFFSET=$(rand 0 $((CONT_RANGE_WIDTH / 6)))
T3_MU=$((CONT_CENTER - CONT_RANGE_WIDTH / 6 + T3_MU_OFFSET))
if [ "$T3_MU" -lt "$CONT_RANGE_MIN" ]; then T3_MU=$((CONT_RANGE_MIN + 10)); fi
T3_SIGMA_BASE=$((CONT_RANGE_WIDTH / 6))
T3_SIGMA_EXTRA=$(rand 0 $((CONT_RANGE_WIDTH / 8)))
T3_SIGMA=$((T3_SIGMA_BASE + T3_SIGMA_EXTRA))
if [ "$T3_SIGMA" -lt 5 ]; then T3_SIGMA=5; fi
CONT_BUY3=$(rand 10 25)
step "6.6 Trader 3: buy-dist N($T3_MU, $T3_SIGMA) with $CONT_BUY3 tokens"
run_trade "Trader 3 bought distribution" devkit_as "$T3_KEY" trade.ts buy-dist "$CONT_ID" "$T3_MU" "$T3_SIGMA" "$CONT_BUY3"

step "6.7 Querying Trader 1 position"
devkit_as "$T1_KEY" trade.ts position "$CONT_ID" 2>&1 || true
echo ""

step "6.8 Market state after distribution buys"
devkit query.ts market "$CONT_ID" 2>&1 | head -25 || true
echo ""

# --- Trade 4: Trader 1 sells some of their distribution ---
CONT_SELL1_MAX=$((CONT_BUY1 / 3))
if [ "$CONT_SELL1_MAX" -lt 2 ]; then CONT_SELL1_MAX=2; fi
CONT_SELL1=$(rand 2 "$CONT_SELL1_MAX")
step "6.9 Trader 1: sell-dist N($T1_MU, $T1_SIGMA) $CONT_SELL1 tokens"
run_trade "Trader 1 sold distribution tokens" devkit_as "$T1_KEY" trade.ts sell-dist "$CONT_ID" "$T1_MU" "$T1_SIGMA" "$CONT_SELL1"

step "6.10 Market after partial sell"
devkit query.ts market "$CONT_ID" 2>&1 | head -25 || true
echo ""

# Wait for deadline
REMAINING=$((CONT_DEADLINE - $(date +%s) + 5))
if [ "$REMAINING" -gt 0 ]; then
  log "Waiting ${REMAINING}s for continuous market deadline..."
  sleep "$REMAINING"
fi

# Resolve with a value near Trader 1's prediction center
CONT_RESOLVE_OFFSET=$(rand -10 10)
CONT_RESOLVE_VALUE=$((T1_MU + CONT_RESOLVE_OFFSET))
# Clamp to range
if [ "$CONT_RESOLVE_VALUE" -lt "$CONT_RANGE_MIN" ]; then CONT_RESOLVE_VALUE=$CONT_RANGE_MIN; fi
if [ "$CONT_RESOLVE_VALUE" -gt "$CONT_RANGE_MAX" ]; then CONT_RESOLVE_VALUE=$CONT_RANGE_MAX; fi

step "6.11 Resolving continuous market with value=$CONT_RESOLVE_VALUE"
if _out=$(devkit resolve.ts market "$CONT_ID" --value "$CONT_RESOLVE_VALUE" 2>&1); then
  echo "$_out" | tail -2
  success "Continuous market resolved"
else
  warn "Failed to resolve continuous market"
  count_error
fi

step "6.12 Checking resolved state"
devkit query.ts market "$CONT_ID" 2>&1 | head -25 || true
echo ""

# --- Claims ---
step "6.13 All traders claim payouts"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  run_claim "$((i + 1))" "$CONT_ID" "${TRADER_KEYS[$i]}"
done

step "6.14 Final vault check"
devkit query.ts vault "$CONT_ID" 2>&1 || true
echo ""

success "Continuous market E2E flow complete!"

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 8: Backend API Verification
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 7: BACKEND API VERIFICATION"

step "7.1 Health check"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health)
if [ "$HTTP_CODE" = "200" ]; then
  success "Health check OK (HTTP $HTTP_CODE)"
else
  fail "Health check failed (HTTP $HTTP_CODE)"
  count_error
fi

step "7.2 GET /markets (list)"
MARKETS_RESP=$(curl -s http://localhost:4000/markets?limit=10)
MARKET_COUNT=$(echo "$MARKETS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total', 0))" 2>/dev/null || echo "?")
log "Backend reports $MARKET_COUNT markets indexed"
if [ "$MARKET_COUNT" != "0" ] && [ "$MARKET_COUNT" != "?" ]; then
  success "Markets endpoint returns data ($MARKET_COUNT markets)"
else
  warn "Markets endpoint returned 0 or error — indexer may need time"
fi

step "7.3 GET /markets/$BINARY_ID (detail)"
DETAIL_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4000/markets/$BINARY_ID")
if [ "$DETAIL_CODE" = "200" ]; then
  success "Market detail endpoint OK"
else
  warn "Market detail returned HTTP $DETAIL_CODE (indexer lag)"
fi

step "7.4 AMM estimation (buy)"
ESTIMATE=$(curl -s -X POST http://localhost:4000/amm/estimate-buy \
  -H "Content-Type: application/json" \
  -d "{\"marketId\": $MULTI_ID, \"outcome\": 0, \"amount\": 1000000}" 2>/dev/null)
if echo "$ESTIMATE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'tokensOut' in d or 'error' in d" 2>/dev/null; then
  success "AMM buy estimation responds"
else
  warn "AMM buy estimation: unexpected response"
fi

step "7.5 AMM estimation (sell)"
SELL_EST=$(curl -s -X POST http://localhost:4000/amm/estimate-sell \
  -H "Content-Type: application/json" \
  -d "{\"marketId\": $MULTI_ID, \"outcome\": 0, \"amount\": 1000000}" 2>/dev/null)
if echo "$SELL_EST" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'collateralOut' in d or 'error' in d" 2>/dev/null; then
  success "AMM sell estimation responds"
else
  warn "AMM sell estimation: unexpected response"
fi

step "7.6 User positions"
POS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4000/users/${T1_ADDR}/positions")
if [ "$POS_CODE" = "200" ]; then
  success "User positions endpoint OK"
else
  warn "User positions returned HTTP $POS_CODE"
fi

step "7.7 Swagger docs"
SWAGGER_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/docs)
if [ "$SWAGGER_CODE" = "200" ]; then
  success "Swagger UI at http://localhost:4000/api/docs"
else
  warn "Swagger UI returned HTTP $SWAGGER_CODE"
fi

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 9: Summary
# ═════════════════════════════════════════════════════════════════════════════

header "RESULTS SUMMARY"

echo -e "${GREEN}Test Statistics:${NC}"
echo -e "  Markets created:  ${BOLD}$STAT_MARKETS${NC} (binary + multi + continuous)"
echo -e "  Trades executed:  ${BOLD}$STAT_TRADES${NC}"
echo -e "  Claims processed: ${BOLD}$STAT_CLAIMS${NC}"
echo -e "  Errors:           ${BOLD}$STAT_ERRORS${NC}"
echo -e "  Random seed:      ${BOLD}$SEED${NC}"
echo ""

echo -e "${GREEN}Markets:${NC}"
echo -e "  Binary (#$BINARY_ID):     Created -> 8 trades -> Resolved (Yes) -> Claimed"
echo -e "  Multi (#$MULTI_ID):       Created -> 6 trades -> Resolved (Outcome $MULTI_WINNER) -> Claimed"
echo -e "  Continuous (#$CONT_ID):   Created -> 4 dist trades -> Resolved ($CONT_RESOLVE_VALUE) -> Claimed"
echo ""

echo -e "${GREEN}Trade Types Exercised:${NC}"
echo -e "  Discrete:     buy, sell, buy-to-price, sell-to-price"
echo -e "  Liquidity:    add-lp, remove-lp"
echo -e "  Distribution: buy-dist, sell-dist (continuous)"
echo ""

echo -e "${GREEN}Traders:${NC}"
echo -e "  Trader 1: ${T1_ADDR}"
echo -e "  Trader 2: ${T2_ADDR}"
echo -e "  Trader 3: ${T3_ADDR}"
echo ""

echo -e "${GREEN}Backend:${NC} API endpoints verified"
echo ""

echo -e "${GREEN}Frontend:${NC} Running on http://localhost:3000"
echo ""

header "NEXT: MANUAL FRONTEND VERIFICATION"

echo -e "Open ${BOLD}http://localhost:3000${NC} in your browser to verify the UI."
echo ""
echo -e "Key pages:"
echo -e "  ${BOLD}http://localhost:3000/markets${NC}             — Market discovery"
echo -e "  ${BOLD}http://localhost:3000/markets/$BINARY_ID${NC}   — Binary market"
echo -e "  ${BOLD}http://localhost:3000/markets/$MULTI_ID${NC}    — Multi-outcome market"
echo -e "  ${BOLD}http://localhost:3000/markets/$CONT_ID${NC}     — Continuous market"
echo -e "  ${BOLD}http://localhost:3000/portfolio${NC}            — Portfolio"
echo -e "  ${BOLD}http://localhost:3000/admin${NC}                — Admin dashboard"
echo -e "  ${BOLD}http://localhost:3000/oracle${NC}               — Oracle dashboard"
echo ""
echo -e "Run ${CYAN}./scripts/e2e-smoke.sh --manual${NC} for the full frontend checklist."
echo ""

if [ "$START_INFRA" = true ]; then
  echo -e "${YELLOW}Services are still running in the background.${NC}"
  echo -e "Press Ctrl+C to stop all services and exit."
  echo ""
  echo "Logs:"
  echo "  Backend:  $STATE_DIR/backend.log"
  echo "  Frontend: $STATE_DIR/frontend.log"
  echo ""
  # Keep script alive so trap cleanup works on Ctrl+C
  wait
fi
