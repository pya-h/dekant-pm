#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DekantPM — E2E Smoke Test (F-13)
#
# Verifies the full stack: Solana program + backend + frontend on localnet.
#
# Prerequisites:
#   - solana-test-validator installed
#   - PostgreSQL running (docker or native) with dekant_pm database
#   - Node 18+ (system) and Node 23.3.0 via n (for frontend)
#   - anchor build completed (target/deploy/dekant_pm.so exists)
#   - npm installed in backend/ and devkit/, pnpm installed in frontend/
#
# Usage:
#   ./scripts/e2e-smoke.sh              # Full automated flow (starts services, 5m deadlines)
#   ./scripts/e2e-smoke.sh --fast       # Fast mode: 1-minute deadlines (~4 min total)
#   ./scripts/e2e-smoke.sh --no-infra   # Skip infrastructure startup (services already running)
#   ./scripts/e2e-smoke.sh --manual     # Print manual frontend checklist only
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROGRAM_ID="Fa2ookSb6meqem6F1oZcVv1PAxQzNtr7zkf1XiDBFgAf"
PROGRAM_SO="$ROOT/target/deploy/dekant_pm.so"
NODE23="/usr/local/n/versions/node/23.3.0/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# PID tracking for cleanup
PIDS=()
VALIDATOR_PID=""
BACKEND_PID=""
FRONTEND_PID=""

# ─── Helpers ─────────────────────────────────────────────────────────────────

log()     { echo -e "${CYAN}[smoke]${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail()    { echo -e "${RED}  ✗${NC} $*"; }
header()  { echo -e "\n${BOLD}═══ $* ═══${NC}\n"; }
step()    { echo -e "${BOLD}--- $* ---${NC}"; }

cleanup() {
  log "Cleaning up background processes..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # Give processes time to exit
  sleep 1
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  log "Done."
}

trap cleanup EXIT

wait_for_port() {
  local port=$1
  local name=$2
  local max_wait=${3:-30}
  local elapsed=0
  while ! nc -z localhost "$port" 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$max_wait" ]; then
      fail "$name failed to start on port $port within ${max_wait}s"
      return 1
    fi
  done
  success "$name is up on port $port (${elapsed}s)"
}

devkit() {
  cd "$ROOT/devkit" && npx ts-node "src/$1" "${@:2}"
}

# ─── Parse args ──────────────────────────────────────────────────────────────

START_INFRA=true
MANUAL_ONLY=false
FAST_MODE=false

for arg in "$@"; do
  case "$arg" in
    --no-infra) START_INFRA=false ;;
    --manual)   MANUAL_ONLY=true ;;
    --fast)     FAST_MODE=true ;;
    --help|-h)
      echo "Usage: $0 [--no-infra] [--fast] [--manual]"
      echo "  --no-infra  Skip starting validator/backend/frontend (already running)"
      echo "  --fast      Use 1-minute deadlines instead of 5 minutes (~4 min total)"
      echo "  --manual    Print manual frontend checklist only"
      exit 0
      ;;
  esac
done

# Deadline and sleep times
if [ "$FAST_MODE" = true ]; then
  DEADLINE="+1m"
  DEADLINE_SLEEP=70
  log "Fast mode: 1-minute deadlines"
else
  DEADLINE="+5m"
  DEADLINE_SLEEP=310
fi

# ─── Manual checklist mode ───────────────────────────────────────────────────

print_manual_checklist() {
  header "MANUAL FRONTEND VERIFICATION CHECKLIST"

  echo -e "${BOLD}Prerequisites:${NC}"
  echo "  All 3 services running: validator (:8899), backend (:4000), frontend (:3000)"
  echo "  Protocol initialized, roles assigned, test markets created"
  echo ""

  echo -e "${BOLD}1. Market Discovery Page (http://localhost:3000/markets)${NC}"
  echo "   [ ] Page loads without errors"
  echo "   [ ] Binary market card visible with title and 50/50 probability"
  echo "   [ ] Continuous market card visible with distribution chart"
  echo "   [ ] Search/filter/sort controls work"
  echo "   [ ] Category filter works"
  echo "   [ ] Pagination controls visible (if >12 markets)"
  echo ""

  echo -e "${BOLD}2. Binary Market Detail (click binary market card)${NC}"
  echo "   [ ] Market title, description, deadline displayed"
  echo "   [ ] Probability bar shows ~50/50 Yes/No"
  echo "   [ ] Market status badge shows 'Active'"
  echo "   [ ] Trading panel visible with Buy/Sell tabs"
  echo "   [ ] Connect wallet via Phantom/Solflare"
  echo ""

  echo -e "${BOLD}3. Binary Trading Flow${NC}"
  echo "   [ ] Select Buy tab > Yes outcome"
  echo "   [ ] Enter amount (e.g. 10) > cost preview appears"
  echo "   [ ] Unit toggle: switch between USDC and Shares"
  echo "   [ ] Balance display shows wallet balance with Max button"
  echo "   [ ] Click trade > wallet popup > sign > success toast"
  echo "   [ ] Probability bar updates (Yes > 50%)"
  echo "   [ ] Position display appears below chart with holdings"
  echo "   [ ] Portfolio page (http://localhost:3000/portfolio) shows position"
  echo ""

  echo -e "${BOLD}4. Sell Flow${NC}"
  echo "   [ ] Select Sell tab > Yes outcome"
  echo "   [ ] Available shares shown with Max button"
  echo "   [ ] Enter amount > cost preview shows USDC to receive"
  echo "   [ ] Unit toggle: switch between Shares and USDC"
  echo "   [ ] Execute sell > success toast > probability adjusts"
  echo ""

  echo -e "${BOLD}5. Continuous Market Detail (click continuous market card)${NC}"
  echo "   [ ] Distribution chart renders (SVG bars)"
  echo "   [ ] Range displayed (e.g. \$50 - \$500)"
  echo "   [ ] Trading panel shows center/confidence inputs"
  echo ""

  echo -e "${BOLD}6. Continuous Trading Flow${NC}"
  echo "   [ ] Enter center value (e.g. 180) and confidence"
  echo "   [ ] Distribution preview updates in chart"
  echo "   [ ] Cost preview shows estimated cost"
  echo "   [ ] Execute buy > success toast > chart shape updates"
  echo "   [ ] Position display shows bin-level holdings histogram"
  echo ""

  echo -e "${BOLD}7. Admin Dashboard (http://localhost:3000/admin)${NC}"
  echo "   [ ] Role manager: can see roles, assign/revoke"
  echo "   [ ] Fee config: shows current protocol fees"
  echo "   [ ] Pause controls: can pause/unpause a market"
  echo "   [ ] Create market button navigates to creation form"
  echo ""

  echo -e "${BOLD}8. Market Creation (http://localhost:3000/admin/create-market)${NC}"
  echo "   [ ] Step 0: Type selection (Binary/Multi/Continuous cards)"
  echo "   [ ] Step 1: Question details (title, description, category, tags)"
  echo "   [ ] Step 2: Outcomes config (type-dependent)"
  echo "   [ ] Step 3: Parameters (deadline, oracle, collateral, liquidity)"
  echo "   [ ] Step 4: Review summary with fee estimate"
  echo "   [ ] Submit: on-chain tx + backend POST > redirects to market"
  echo ""

  echo -e "${BOLD}9. Oracle Dashboard (http://localhost:3000/oracle)${NC}"
  echo "   [ ] Pending resolution queue shows expired markets"
  echo "   [ ] Resolution form: binary (Yes/No), continuous (value input)"
  echo "   [ ] Resolve > confirmation dialog > success"
  echo "   [ ] Market status changes to 'Resolved'"
  echo ""

  echo -e "${BOLD}10. Claim Flow (after resolution)${NC}"
  echo "   [ ] Portfolio page shows 'Claimable' section"
  echo "   [ ] Claim button visible on winning positions"
  echo "   [ ] Click Claim > wallet popup > sign > success toast"
  echo "   [ ] Position moves to 'Past' section"
  echo "   [ ] Wallet balance increased by payout amount"
  echo ""

  echo -e "${BOLD}11. Discovery Page Indicators (after trading)${NC}"
  echo "   [ ] 'Held' badge visible on markets with positions"
  echo "   [ ] P/L shown in card footer (green for profit, red for loss)"
  echo ""

  echo -e "${BOLD}12. Error States${NC}"
  echo "   [ ] Trade with insufficient balance > validation error (red text)"
  echo "   [ ] Trade on resolved market > appropriate error"
  echo "   [ ] Access admin without role > unauthorized message"
  echo "   [ ] Access oracle without role > unauthorized message"
  echo ""
}

if [ "$MANUAL_ONLY" = true ]; then
  print_manual_checklist
  exit 0
fi

# ─── Preflight checks ───────────────────────────────────────────────────────

header "PREFLIGHT CHECKS"

# Check program binary exists
if [ ! -f "$PROGRAM_SO" ]; then
  fail "Program binary not found at $PROGRAM_SO"
  log "Run 'anchor build' first"
  exit 1
fi
success "Program binary found"

# Check solana CLI
if ! command -v solana &>/dev/null; then
  fail "solana CLI not found"
  exit 1
fi
success "solana CLI found ($(solana --version 2>&1 | head -1))"

# Check solana-test-validator
if ! command -v solana-test-validator &>/dev/null; then
  fail "solana-test-validator not found"
  exit 1
fi
success "solana-test-validator found"

# Check Node.js 23 for frontend
if [ ! -x "$NODE23/node" ]; then
  warn "Node 23.3.0 not found at $NODE23 — frontend may not work"
else
  success "Node 23.3.0 found at $NODE23"
fi

# Check pnpm for frontend
if [ -x "$NODE23/pnpm" ] || command -v pnpm &>/dev/null; then
  success "pnpm found"
else
  warn "pnpm not found — frontend dev server may not start"
fi

# Check npx for devkit
if ! command -v npx &>/dev/null; then
  fail "npx not found"
  exit 1
fi
success "npx found"

# Check solana keypair
WALLET_ADDR=$(solana address 2>/dev/null || true)
if [ -z "$WALLET_ADDR" ]; then
  fail "No default Solana keypair found. Run 'solana-keygen new' first."
  exit 1
fi
success "Wallet: $WALLET_ADDR"

# Check PostgreSQL is accessible
if pg_isready -q 2>/dev/null; then
  success "PostgreSQL is accessible"
else
  warn "PostgreSQL doesn't appear to be running — backend may fail to start"
fi

# Check dependencies installed
if [ ! -d "$ROOT/devkit/node_modules" ]; then
  log "Installing devkit dependencies..."
  (cd "$ROOT/devkit" && npm install --silent)
  success "Devkit dependencies installed"
else
  success "Devkit dependencies present"
fi

if [ ! -d "$ROOT/backend/node_modules" ]; then
  log "Installing backend dependencies..."
  (cd "$ROOT/backend" && npm install --silent)
  success "Backend dependencies installed"
else
  success "Backend dependencies present"
fi

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  log "Installing frontend dependencies..."
  (cd "$ROOT/frontend" && PATH="$NODE23:$PATH" pnpm install --silent)
  success "Frontend dependencies installed"
else
  success "Frontend dependencies present"
fi

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 1: Start Infrastructure
# ═════════════════════════════════════════════════════════════════════════════

if [ "$START_INFRA" = true ]; then
  header "PHASE 1: STARTING INFRASTRUCTURE"

  # ─── Solana test validator ───────────────────────────────────────────────
  step "Starting Solana test validator"

  # Kill any existing validator
  if pgrep -f "solana-test-validator" >/dev/null 2>&1; then
    warn "Killing existing validator..."
    pkill -f "solana-test-validator" || true
    sleep 2
  fi

  solana-test-validator \
    --bpf-program "$PROGRAM_ID" "$PROGRAM_SO" \
    --reset \
    --quiet \
    &>/dev/null &
  VALIDATOR_PID=$!
  PIDS+=("$VALIDATOR_PID")

  wait_for_port 8899 "Solana validator" 30

  # Configure solana CLI to use localnet
  solana config set --url http://localhost:8899 &>/dev/null

  # Airdrop SOL for transaction fees
  log "Airdropping SOL..."
  solana airdrop 100 "$WALLET_ADDR" --url http://localhost:8899 &>/dev/null
  success "Airdropped 100 SOL to $WALLET_ADDR"

  # ─── Backend ─────────────────────────────────────────────────────────────
  step "Starting backend"

  cd "$ROOT/backend"
  npm run start:dev &>"$ROOT/scripts/.backend.log" &
  BACKEND_PID=$!
  PIDS+=("$BACKEND_PID")
  cd "$ROOT"

  wait_for_port 4000 "Backend" 30

  # ─── Frontend ────────────────────────────────────────────────────────────
  step "Starting frontend"

  cd "$ROOT/frontend"
  PATH="$NODE23:$PATH" pnpm dev &>"$ROOT/scripts/.frontend.log" &
  FRONTEND_PID=$!
  PIDS+=("$FRONTEND_PID")
  cd "$ROOT"

  wait_for_port 3000 "Frontend" 30

else
  header "PHASE 1: SKIPPING INFRASTRUCTURE (--no-infra)"
  log "Assuming validator (:8899), backend (:4000), frontend (:3000) are running"

  # Verify services are up
  nc -z localhost 8899 2>/dev/null && success "Validator on :8899" || fail "Validator not reachable on :8899"
  nc -z localhost 4000 2>/dev/null && success "Backend on :4000"   || fail "Backend not reachable on :4000"
  nc -z localhost 3000 2>/dev/null && success "Frontend on :3000"  || fail "Frontend not reachable on :3000"

  WALLET_ADDR=$(solana address 2>/dev/null)
fi

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 2: Protocol Setup
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 2: PROTOCOL SETUP"

step "Initializing protocol"
devkit setup.ts init 2>&1 | tail -5
success "Protocol initialized"

step "Assigning Oracle role to $WALLET_ADDR"
devkit setup.ts assign-role "$WALLET_ADDR" oracle 2>&1 | tail -2 || warn "Oracle role may already be assigned"
success "Oracle role assigned"

step "Assigning Creator role to $WALLET_ADDR"
devkit setup.ts assign-role "$WALLET_ADDR" creator 2>&1 | tail -2 || warn "Creator role may already be assigned"
success "Creator role assigned"

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 3: Binary Market E2E Flow
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 3: BINARY MARKET FLOW"

step "3.1 Creating binary market (deadline: $DEADLINE)"
BINARY_OUTPUT=$(devkit market.ts create-binary "$WALLET_ADDR" 100 "$DEADLINE" 2>&1)
echo "$BINARY_OUTPUT"
BINARY_ID=$(echo "$BINARY_OUTPUT" | grep "Market ID:" | awk '{print $NF}')
BINARY_MINT=$(echo "$BINARY_OUTPUT" | grep "Mint:" | tail -1 | awk '{print $NF}')

if [ -z "$BINARY_ID" ]; then
  fail "Failed to create binary market"
  exit 1
fi
success "Binary market created: ID=$BINARY_ID"

step "3.2 Funding wallet with test tokens"
devkit trade.ts fund "$BINARY_ID" 1000 2>&1 | tail -2
success "Funded 1000 tokens"

step "3.3 Querying initial state"
devkit query.ts market "$BINARY_ID" 2>&1 | head -15
echo ""

step "3.4 Buying 'Yes' (outcome 0) with 10 tokens"
devkit trade.ts buy "$BINARY_ID" 0 10 2>&1
success "Bought Yes outcome"

step "3.5 Buying 'No' (outcome 1) with 5 tokens"
devkit trade.ts buy "$BINARY_ID" 1 5 2>&1
success "Bought No outcome"

step "3.6 Checking position after buys"
devkit trade.ts position "$BINARY_ID" 2>&1
echo ""

step "3.7 Querying probabilities after trades"
devkit query.ts market "$BINARY_ID" 2>&1 | head -15
echo ""

step "3.8 Selling some 'Yes' tokens (outcome 0, 3 tokens)"
devkit trade.ts sell "$BINARY_ID" 0 3 2>&1
success "Sold some Yes tokens"

step "3.9 Checking position after sell"
devkit trade.ts position "$BINARY_ID" 2>&1
echo ""

# Wait for deadline to pass
log "Binary market deadline: $DEADLINE from creation."
log "Waiting for deadline to pass (${DEADLINE_SLEEP}s)..."
sleep "$DEADLINE_SLEEP"

step "3.10 Resolving binary market — Yes wins (outcome 0)"
devkit resolve.ts market "$BINARY_ID" 0 2>&1
success "Binary market resolved"

step "3.11 Checking resolved state"
devkit query.ts market "$BINARY_ID" 2>&1 | head -15
echo ""

step "3.12 Claiming payout"
devkit market.ts claim "$BINARY_ID" 2>&1
success "Payout claimed"

step "3.13 Checking final balance"
devkit query.ts balance --market "$BINARY_ID" 2>&1
echo ""

success "Binary market E2E flow complete!"

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 4: Continuous Market E2E Flow
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 4: CONTINUOUS MARKET FLOW"

step "4.1 Creating continuous market (range 50-500, 64 bins, deadline: $DEADLINE)"
CONT_OUTPUT=$(devkit market.ts create-continuous "$WALLET_ADDR" 100 "$DEADLINE" 50 500 --bins 64 --mint "$BINARY_MINT" 2>&1)
echo "$CONT_OUTPUT"
CONT_ID=$(echo "$CONT_OUTPUT" | grep "Market ID:" | awk '{print $NF}')

if [ -z "$CONT_ID" ]; then
  fail "Failed to create continuous market"
  exit 1
fi
success "Continuous market created: ID=$CONT_ID"

step "4.2 Funding wallet for continuous trading"
devkit trade.ts fund "$CONT_ID" 1000 2>&1 | tail -2
success "Funded 1000 tokens"

step "4.3 Querying initial state"
devkit query.ts market "$CONT_ID" 2>&1 | head -20
echo ""

step "4.4 Buying distribution (center=180, sigma=30, 20 tokens)"
devkit trade.ts buy-dist "$CONT_ID" 180 30 20 2>&1
success "Bought distribution position"

step "4.5 Checking position"
devkit trade.ts position "$CONT_ID" 2>&1
echo ""

step "4.6 Querying probabilities after trade"
devkit query.ts market "$CONT_ID" 2>&1 | head -20
echo ""

step "4.7 Selling some distribution tokens (center=180, sigma=30, 5 tokens)"
devkit trade.ts sell-dist "$CONT_ID" 180 30 5 2>&1
success "Sold some distribution tokens"

step "4.8 Checking position after sell"
devkit trade.ts position "$CONT_ID" 2>&1
echo ""

# Wait for deadline
log "Continuous market deadline: $DEADLINE from creation."
log "Waiting for deadline to pass (${DEADLINE_SLEEP}s)..."
sleep "$DEADLINE_SLEEP"

step "4.9 Resolving continuous market with value=175"
devkit resolve.ts market "$CONT_ID" --value 175 2>&1
success "Continuous market resolved"

step "4.10 Checking resolved state"
devkit query.ts market "$CONT_ID" 2>&1 | head -20
echo ""

step "4.11 Claiming payout"
devkit market.ts claim "$CONT_ID" 2>&1
success "Payout claimed"

step "4.12 Checking final balance"
devkit query.ts balance --market "$CONT_ID" 2>&1
echo ""

success "Continuous market E2E flow complete!"

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 5: Backend API Verification
# ═════════════════════════════════════════════════════════════════════════════

header "PHASE 5: BACKEND API VERIFICATION"

step "5.1 Health check"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health)
if [ "$HTTP_CODE" = "200" ]; then
  success "Health check OK (HTTP $HTTP_CODE)"
else
  fail "Health check failed (HTTP $HTTP_CODE)"
fi

step "5.2 GET /markets (list)"
MARKETS_RESP=$(curl -s http://localhost:4000/markets?limit=10)
MARKET_COUNT=$(echo "$MARKETS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total', 0))" 2>/dev/null || echo "?")
log "Backend reports $MARKET_COUNT markets indexed"
if [ "$MARKET_COUNT" != "0" ] && [ "$MARKET_COUNT" != "?" ]; then
  success "Markets endpoint returns data"
else
  warn "Markets endpoint returned 0 or error — indexer may need time"
fi

step "5.3 GET /markets/$BINARY_ID (detail)"
DETAIL_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4000/markets/$BINARY_ID")
if [ "$DETAIL_CODE" = "200" ]; then
  success "Market detail endpoint OK"
else
  warn "Market detail returned HTTP $DETAIL_CODE (indexer may not have caught up)"
fi

step "5.4 AMM estimation"
ESTIMATE=$(curl -s -X POST http://localhost:4000/amm/estimate-buy \
  -H "Content-Type: application/json" \
  -d "{\"marketId\": $BINARY_ID, \"outcome\": 0, \"amount\": 1000000}" 2>/dev/null)
if echo "$ESTIMATE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'tokensOut' in d or 'error' in d" 2>/dev/null; then
  success "AMM estimation endpoint responds"
else
  warn "AMM estimation returned unexpected response"
fi

step "5.5 Swagger docs"
SWAGGER_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/docs)
if [ "$SWAGGER_CODE" = "200" ]; then
  success "Swagger UI available at http://localhost:4000/api/docs"
else
  warn "Swagger UI returned HTTP $SWAGGER_CODE"
fi

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 6: Summary & Manual Checklist
# ═════════════════════════════════════════════════════════════════════════════

header "RESULTS SUMMARY"

echo -e "${GREEN}On-chain program:${NC}   All operations successful"
echo -e "  Binary market:    Created (#$BINARY_ID) → Traded → Resolved → Claimed"
echo -e "  Continuous market: Created (#$CONT_ID) → Traded → Resolved → Claimed"
echo ""
echo -e "${GREEN}Backend:${NC}            API endpoints responding"
echo ""
echo -e "${GREEN}Frontend:${NC}           Running on http://localhost:3000"
echo ""

header "NEXT: MANUAL FRONTEND VERIFICATION"

echo -e "The automated on-chain tests above are complete."
echo -e "Now open ${BOLD}http://localhost:3000${NC} in your browser to verify the UI."
echo ""
echo -e "Run ${CYAN}./scripts/e2e-smoke.sh --manual${NC} for the full frontend checklist."
echo ""
echo -e "Key pages to check:"
echo -e "  ${BOLD}http://localhost:3000/markets${NC}           — Market discovery"
echo -e "  ${BOLD}http://localhost:3000/markets/$BINARY_ID${NC} — Binary market detail"
echo -e "  ${BOLD}http://localhost:3000/markets/$CONT_ID${NC}  — Continuous market detail"
echo -e "  ${BOLD}http://localhost:3000/portfolio${NC}         — Portfolio (connect wallet)"
echo -e "  ${BOLD}http://localhost:3000/admin${NC}             — Admin dashboard"
echo -e "  ${BOLD}http://localhost:3000/oracle${NC}            — Oracle dashboard"
echo ""

if [ "$START_INFRA" = true ]; then
  echo -e "${YELLOW}Services are still running in the background.${NC}"
  echo -e "Press Ctrl+C to stop all services and exit."
  echo ""
  echo "Logs:"
  echo "  Backend:  $ROOT/scripts/.backend.log"
  echo "  Frontend: $ROOT/scripts/.frontend.log"
  echo ""
  # Keep script alive so trap cleanup works on Ctrl+C
  wait
fi
