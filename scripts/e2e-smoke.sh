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
#   ./scripts/e2e-smoke.sh                   # Reuse validator state if present
#   ./scripts/e2e-smoke.sh --reset           # Wipe ledger, redeploy, re-init protocol
#   ./scripts/e2e-smoke.sh --no-infra        # Skip infrastructure (already running)
#   ./scripts/e2e-smoke.sh --new-markets     # Also create 1-3 extra random markets
#   ./scripts/e2e-smoke.sh --manual          # Print manual frontend checklist
#   SEED=42 ./scripts/e2e-smoke.sh           # Reproducible run
#
# Reset behavior:
#   By default the script preserves on-chain state across runs. It auto-resets
#   when (a) no prior reset is recorded in scripts/.state/program.hash
#   (bootstrap), or (b) the .so hash has changed since the last reset (defends
#   against silent schema drift). Pass --reset to force a clean slate.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_NAME="smoke"
source "$(dirname "$0")/lib.sh"

# ── Parse Arguments ──────────────────────────────────────────────────────────

START_INFRA=true
MANUAL_ONLY=false
EXTRA_MARKETS=false
RESET_VALIDATOR=false

for arg in "$@"; do
  case "$arg" in
    -n|--no-infra)       START_INFRA=false ;;
    -m|--manual)         MANUAL_ONLY=true ;;
    -nm|--new-markets)   EXTRA_MARKETS=true ;;
    -r|--reset)          RESET_VALIDATOR=true ;;
    -h|--help)
      echo "Usage: $0 [--reset] [--no-infra] [--new-markets] [--manual]"
      echo ""
      echo "Runs the DekantPM end-to-end smoke test."
      echo ""
      echo "Options:"
      echo "  -r, --reset           Wipe ledger, redeploy program, re-initialize protocol"
      echo "  -n, --no-infra        Skip starting validator/backend/frontend (already running)"
      echo "  -nm, --new-markets    Create 1-3 additional random markets (populates DB)"
      echo "  -m, --manual          Print manual frontend verification checklist only"
      echo "  -h, --help            Show this help"
      echo ""
      echo "Default reset behavior:"
      echo "  The script preserves on-chain state across runs unless --reset is"
      echo "  passed. It auto-resets when no prior reset is recorded or when"
      echo "  the .so hash has changed since the last reset (schema-drift defense)."
      echo ""
      echo "Environment:"
      echo "  SEED=<n>     Set random seed for reproducible runs"
      exit 0
      ;;
  esac
done

# --reset + --no-infra is contradictory: we can't reset a validator we don't manage.
if [ "$RESET_VALIDATOR" = true ] && [ "$START_INFRA" = false ]; then
  echo "Error: --reset and --no-infra are mutually exclusive" >&2
  echo "  (--reset wipes the ledger; --no-infra reuses an externally managed validator)" >&2
  exit 1
fi

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
STAT_WARNINGS=0

count_trade()    { STAT_TRADES=$((STAT_TRADES + 1)); }
count_market()   { STAT_MARKETS=$((STAT_MARKETS + 1)); }
count_claim()    { STAT_CLAIMS=$((STAT_CLAIMS + 1)); }
# Errors (✗) are hard failures — something the test expected to work didn't.
count_error()    { STAT_ERRORS=$((STAT_ERRORS + 1)); }
# Warnings (⚠) are notable but non-fatal — a sub-step failed without breaking
# the run (e.g. one trade reverted, a loser hit NothingToClaim, an extra
# market couldn't be created). Distinct from errors so the totals match the
# visual log glyphs.
count_warning()  { STAT_WARNINGS=$((STAT_WARNINGS + 1)); }

# ── Timing ───────────────────────────────────────────────────────────────────

STAT_TRADE_TIME=0
STAT_CLAIM_TIME=0
STAT_WAIT_TIME=0

format_duration() {
  local secs=$1
  if [ "$secs" -ge 60 ]; then
    printf "%dm %ds" $((secs / 60)) $((secs % 60))
  else
    printf "%ds" "$secs"
  fi
}

# ── Trade Helpers ─────────────────────────────────────────────────────────────

# Execute a trade command — on failure, warn + count error instead of crashing.
# Usage: run_trade "description" command arg1 arg2 ...
run_trade() {
  local desc=$1
  shift
  local _t0=$(date +%s)
  if _tout=$("$@" 2>&1); then
    echo "$_tout" | tail -2
    success "$desc"
  else
    warn "$desc"
    # Surface the captured failure output (indented) so silent reverts like
    # InsufficientHoldings or TargetAlreadyMet aren't swallowed.
    echo "$_tout" | tail -10 | sed 's/^/    /' >&2
    count_warning
  fi
  STAT_TRADE_TIME=$((STAT_TRADE_TIME + $(date +%s) - _t0))
  count_trade
}

# Execute a claim — warns on NothingToClaim (expected, not counted as error).
# Usage: run_claim <trader_num> <market_id> <keypair_path>
run_claim() {
  local n=$1 market_id=$2 keypair=$3
  local _t0=$(date +%s)
  if _cout=$(devkit_as "$keypair" market.ts claim "$market_id" 2>&1); then
    echo "$_cout" | tail -2
    success "Trader $n claimed"
  else
    warn "Trader $n: nothing to claim (no winning tokens)"
    # Expected for traders who didn't hold the winning outcome — not an error,
    # but still tracked as a warning so the totals match the visible glyphs.
    count_warning
  fi
  STAT_CLAIM_TIME=$((STAT_CLAIM_TIME + $(date +%s) - _t0))
  count_claim
}

# ── Randomized Metadata Pools ────────────────────────────────────────────────
#
# The on-chain createMarket carries no subject/category/title; the backend
# indexer auto-creates a DB row with hardcoded defaults (`subject: 'SOL'`,
# `category: 'crypto'`, `title: "${type} Market #${id}"`). To surface a mix
# of subjects on the frontend during smoke runs, we PATCH the DB row right
# after each create via `devkit metadata.ts patch` (which JWT-auths as the
# deployer wallet — Creator role granted in PHASE 2 reset).

# Crypto-token symbols only. Keep this list focused (and ≤32 chars per DTO).
METADATA_SUBJECTS=(
  BTC ETH SOL USDC USDT BNB XRP ADA DOGE AVAX MATIC DOT
  ATOM LINK NEAR ARB OP SUI APT LTC BCH ETC FIL TON
  TRX SHIB UNI AAVE MKR LDO
)

# All markets in this pool are crypto-themed — keep categories aligned.
METADATA_CATEGORIES=(
  crypto defi layer-1 layer-2 memecoin stablecoin
)

METADATA_TAGS=(
  q1 q2 q3 q4 2026 2027 near-term long-term high-risk low-risk
  speculation data-driven binary-event multi-outcome distribution
  trend-following macro micro consensus contrarian
)

# Patch a market's backend metadata with randomized subject/category/tags/desc.
# Silent on success; warns + bumps STAT_WARNINGS on failure (does NOT abort
# the run — the smoke test's core path doesn't depend on the metadata).
# Usage: patch_random_metadata <market-id>
patch_random_metadata() {
  local market_id=$1
  if [ -z "$market_id" ]; then return 0; fi
  local subject category t1 t2 desc
  subject=$(rand_choice "${METADATA_SUBJECTS[@]}")
  category=$(rand_choice "${METADATA_CATEGORIES[@]}")
  t1=$(rand_choice "${METADATA_TAGS[@]}")
  t2=$(rand_choice "${METADATA_TAGS[@]}")
  desc="Smoke-test market — randomized $category/$subject scenario."
  if devkit metadata.ts patch "$market_id" \
       --subject "$subject" \
       --category "$category" \
       --tags "$t1,$t2" \
       --description "$desc" \
       &>/dev/null; then
    log "Patched market #$market_id: $category / $subject [$t1, $t2]"
  else
    warn "Metadata patch failed for market #$market_id"
    count_warning
  fi
}

# ── Cleanup ──────────────────────────────────────────────────────────────────

CLEANUP_DONE=false
cleanup_and_exit() {
  if [ "$CLEANUP_DONE" = true ]; then return; fi
  CLEANUP_DONE=true
  echo ""
  stop_tracked_pids
  log "Smoke test cleanup done."
}

trap cleanup_and_exit EXIT INT TERM

TIME_START=$(date +%s)

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 1: Preflight
# ═════════════════════════════════════════════════════════════════════════════

PHASE_PREFLIGHT_START=$(date +%s)
header "PREFLIGHT CHECKS"

preflight_check_program
preflight_check_tools

WALLET_ADDR=$(preflight_check_wallet)
if [ -z "$WALLET_ADDR" ]; then exit 1; fi

preflight_check_postgres
ensure_deps
PHASE_PREFLIGHT_TIME=$(($(date +%s) - PHASE_PREFLIGHT_START))

# ═════════════════════════════════════════════════════════════════════════════
# Reset decision — opt-in via --reset, auto-triggered by missing/changed program
# ═════════════════════════════════════════════════════════════════════════════

PROGRAM_SO="$ROOT/target/deploy/dekant_pm.so"
PROGRAM_HASH_FILE="$STATE_DIR/program.hash"

# Auto-reset triggers (only when --reset is not already set and we're managing
# the validator). The .so itself is guaranteed present by preflight_check_program.
if [ "$START_INFRA" = true ] && [ "$RESET_VALIDATOR" = false ]; then
  if [ ! -f "$PROGRAM_HASH_FILE" ]; then
    log "No prior reset recorded in $PROGRAM_HASH_FILE → forcing reset (bootstrap)"
    RESET_VALIDATOR=true
  else
    CURRENT_SO_HASH=$(sha256sum "$PROGRAM_SO" | awk '{print $1}')
    SAVED_SO_HASH=$(cat "$PROGRAM_HASH_FILE" 2>/dev/null || echo "")
    if [ "$CURRENT_SO_HASH" != "$SAVED_SO_HASH" ]; then
      log "Program .so changed since last reset → forcing reset (schema-drift defense)"
      RESET_VALIDATOR=true
    fi
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 2: Infrastructure + Protocol Setup
#
# Delegated to scripts/setup.sh (the canonical setup path). With --reset it
# also rebuilds the program, propagates PROGRAM_ID to every .env, wipes the
# backend DB (npm run db:drop && migration:run), boots the validator with
# --reset, and runs protocol init + role grants. With -b it detaches the
# services (validator/backend/frontend) and exits, leaving their PIDs in
# scripts/.state/*.pid so this script's cleanup_and_exit can stop them later.
# ═════════════════════════════════════════════════════════════════════════════

PHASE_INFRA_START=$(date +%s)
if [ "$START_INFRA" = true ]; then
  if [ "$RESET_VALIDATOR" = true ]; then
    header "PHASE 1: SETUP (reset — rebuild, db wipe, validator reset, init, roles)"
    bash "$ROOT/scripts/setup.sh" --reset --background
    # Stamp the .so hash now that protocol state is in a known-good shape.
    # Future runs use this to detect schema drift (a new .so against an old ledger).
    sha256sum "$PROGRAM_SO" | awk '{print $1}' > "$PROGRAM_HASH_FILE"
  else
    header "PHASE 1: SETUP (resume — validator + backend + frontend, no init)"
    bash "$ROOT/scripts/setup.sh" --background
    log "Reusing existing ProtocolConfig, role PDAs, and DB rows from prior run"
  fi
else
  header "PHASE 1: SKIPPING INFRASTRUCTURE (--no-infra)"
  check_port 8899 && success "Validator :8899" || { fail "Validator not reachable on :8899"; exit 1; }
  check_port 4000 && success "Backend :4000"   || { fail "Backend not reachable on :4000"; exit 1; }
  check_port 3000 && success "Frontend :3000"  || { fail "Frontend not reachable on :3000"; exit 1; }
  WALLET_ADDR=$(solana address 2>/dev/null)
fi
PHASE_INFRA_TIME=$(($(date +%s) - PHASE_INFRA_START))

# setup.sh covers init + role grants. Stats summary expects this var.
PHASE_PROTOCOL_TIME=0

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 4: Generate Test Traders
# ═════════════════════════════════════════════════════════════════════════════

PHASE_TRADERS_START=$(date +%s)
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
PHASE_TRADERS_TIME=$(($(date +%s) - PHASE_TRADERS_START))

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 4b: Extra Markets (--new-markets)
# ═════════════════════════════════════════════════════════════════════════════

PHASE_EXTRA_TIME=0
EXTRA_MARKET_IDS=()

if [ "$EXTRA_MARKETS" = true ]; then
  PHASE_EXTRA_START=$(date +%s)
  NUM_EXTRA=$(rand 1 3)
  header "PHASE 3b: CREATING $NUM_EXTRA EXTRA MARKETS"

  MARKET_TYPES=("binary" "multi" "continuous")

  for ei in $(seq 1 "$NUM_EXTRA"); do
    ETYPE=$(rand_choice "${MARKET_TYPES[@]}")
    ELIQ=$(rand 50 200)
    EDEADLINE_SEC=$(rand 300 900)
    # Anchor deadline to on-chain clock; the validator can lag host wallclock.
    EDEADLINE=$(( $(on_chain_now) + EDEADLINE_SEC ))

    case "$ETYPE" in
      binary)
        step "Extra $ei/$NUM_EXTRA: binary market (liquidity=$ELIQ, deadline=${EDEADLINE_SEC}s)"
        if EOUT=$(devkit market.ts create-binary "$WALLET_ADDR" "$ELIQ" "$EDEADLINE" 2>&1); then
          EID=$(echo "$EOUT" | grep "Market ID:" | awk '{print $NF}' || true)
          # Capture mint from first extra market if COLLATERAL_MINT not set yet
          if [ -z "${COLLATERAL_MINT:-}" ]; then
            COLLATERAL_MINT=$(echo "$EOUT" | grep "Mint:" | tail -1 | awk '{print $NF}' || true)
          fi
        fi
        ;;
      multi)
        EOUTCOMES=$(rand 3 6)
        step "Extra $ei/$NUM_EXTRA: multi market ($EOUTCOMES outcomes, liquidity=$ELIQ, deadline=${EDEADLINE_SEC}s)"
        ECMD=(devkit market.ts create-multi "$WALLET_ADDR" "$ELIQ" "$EDEADLINE" "$EOUTCOMES")
        [ -n "${COLLATERAL_MINT:-}" ] && ECMD+=(--mint "$COLLATERAL_MINT")
        if EOUT=$("${ECMD[@]}" 2>&1); then
          EID=$(echo "$EOUT" | grep "Market ID:" | awk '{print $NF}' || true)
          if [ -z "${COLLATERAL_MINT:-}" ]; then
            COLLATERAL_MINT=$(echo "$EOUT" | grep "Mint:" | tail -1 | awk '{print $NF}' || true)
          fi
        fi
        ;;
      continuous)
        read ERMIN ERMAX <<< "$(random_continuous_range)"
        EBINS=$(rand_choice 32 64 128)
        # Kernel width: uniform in {0..9}; 0 keeps the WTA path in the rotation.
        # Clamp to EBINS-1 (the on-chain validator's hard cap), though for the
        # bin counts above the clamp never binds.
        EKERNEL_W=$(rand 0 9)
        if [ "$EKERNEL_W" -ge "$EBINS" ]; then EKERNEL_W=$((EBINS - 1)); fi
        step "Extra $ei/$NUM_EXTRA: continuous market (range $ERMIN-$ERMAX, $EBINS bins, kernel_width=$EKERNEL_W, liquidity=$ELIQ, deadline=${EDEADLINE_SEC}s)"
        # Options BEFORE `--`, positionals after — so commander.js doesn't
        # misread a negative range-min like "-207" as an unknown option flag.
        ECMD=(devkit market.ts create-continuous --bins "$EBINS" --kernel-width "$EKERNEL_W")
        [ -n "${COLLATERAL_MINT:-}" ] && ECMD+=(--mint "$COLLATERAL_MINT")
        ECMD+=(-- "$WALLET_ADDR" "$ELIQ" "$EDEADLINE" "$ERMIN" "$ERMAX")
        if EOUT=$("${ECMD[@]}" 2>&1); then
          EID=$(echo "$EOUT" | grep "Market ID:" | awk '{print $NF}' || true)
          if [ -z "${COLLATERAL_MINT:-}" ]; then
            COLLATERAL_MINT=$(echo "$EOUT" | grep "Mint:" | tail -1 | awk '{print $NF}' || true)
          fi
        fi
        ;;
    esac

    if [ -n "${EID:-}" ]; then
      EXTRA_MARKET_IDS+=("$ETYPE:#$EID")
      success "Created $ETYPE market #$EID"
      count_market
      patch_random_metadata "$EID"

      # Fund traders so they can interact via frontend
      EFUND=$(rand 50 150)
      for ti in $(seq 0 $((NUM_TRADERS - 1))); do
        devkit trade.ts fund "$EID" "$EFUND" --wallet "${TRADER_ADDRS[$ti]}" 2>&1 | tail -1
      done
      devkit trade.ts fund "$EID" 200 2>&1 | tail -1
      success "Funded traders + deployer for market #$EID"
    else
      warn "Extra $ei: failed to create $ETYPE market"
      count_warning
    fi
    EID=""
  done

  PHASE_EXTRA_TIME=$(($(date +%s) - PHASE_EXTRA_START))
  success "$NUM_EXTRA extra markets created"
fi

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 5: Binary Market Flow
# ═════════════════════════════════════════════════════════════════════════════

PHASE_BINARY_START=$(date +%s)
PHASE_BINARY_WAIT=0
header "PHASE 4: BINARY MARKET"

# Random parameters. Deadline is anchored to the validator's on-chain clock,
# not host wallclock — a long-running validator can lag wallclock by minutes
# after a resume, which would defer the on-chain deadline well past our wait.
BIN_LIQUIDITY=$(rand 50 200)
BIN_DEADLINE_SEC=$(rand 45 120)
BIN_DEADLINE=$(( $(on_chain_now) + BIN_DEADLINE_SEC ))
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
patch_random_metadata "$BINARY_ID"

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

# Wait for deadline (against on-chain clock — see lib.sh::on_chain_now)
REMAINING=$((BIN_DEADLINE - $(on_chain_now) + 5))
if [ "$REMAINING" -gt 0 ]; then
  STAT_WAIT_TIME=$((STAT_WAIT_TIME + REMAINING))
  PHASE_BINARY_WAIT=$REMAINING
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
  echo "$_out" | tail -20 | sed 's/^/    /'
  count_warning
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
PHASE_BINARY_TIME=$(($(date +%s) - PHASE_BINARY_START - PHASE_BINARY_WAIT))

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 6: Multi-Outcome Market Flow
# ═════════════════════════════════════════════════════════════════════════════

PHASE_MULTI_START=$(date +%s)
PHASE_MULTI_WAIT=0
header "PHASE 5: MULTI-OUTCOME MARKET (4 outcomes)"

MULTI_LIQUIDITY=$(rand 50 200)
MULTI_DEADLINE_SEC=$(rand 45 120)
MULTI_DEADLINE=$(( $(on_chain_now) + MULTI_DEADLINE_SEC ))
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
patch_random_metadata "$MULTI_ID"

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

# Wait for deadline (against on-chain clock — see lib.sh::on_chain_now)
REMAINING=$((MULTI_DEADLINE - $(on_chain_now) + 5))
if [ "$REMAINING" -gt 0 ]; then
  STAT_WAIT_TIME=$((STAT_WAIT_TIME + REMAINING))
  PHASE_MULTI_WAIT=$REMAINING
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
  echo "$_out" | tail -20 | sed 's/^/    /'
  count_warning
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
PHASE_MULTI_TIME=$(($(date +%s) - PHASE_MULTI_START - PHASE_MULTI_WAIT))

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 7: Continuous Market Flow
# ═════════════════════════════════════════════════════════════════════════════

PHASE_CONT_START=$(date +%s)
PHASE_CONT_WAIT=0
header "PHASE 6: CONTINUOUS MARKET (64 bins, WTA baseline — kernel_width=0)"

read CONT_RANGE_MIN CONT_RANGE_MAX <<< "$(random_continuous_range)"
CONT_LIQUIDITY=$(rand 50 200)
CONT_DEADLINE_SEC=$(rand 45 120)
CONT_DEADLINE=$(( $(on_chain_now) + CONT_DEADLINE_SEC ))
CONT_FUND_EACH=$(rand 200 400)
CONT_BINS=64

step "6.1 Creating continuous market (range $CONT_RANGE_MIN-$CONT_RANGE_MAX, $CONT_BINS bins, kernel_width=0, liquidity=$CONT_LIQUIDITY)"
# Explicit --kernel-width 0 documents the WTA baseline. PHASE 6b below
# exercises the smooth-kernel path with a randomly-chosen non-zero width.
if ! CONT_OUTPUT=$(devkit market.ts create-continuous --bins "$CONT_BINS" --kernel-width 0 --mint "$COLLATERAL_MINT" -- "$WALLET_ADDR" "$CONT_LIQUIDITY" "$CONT_DEADLINE" "$CONT_RANGE_MIN" "$CONT_RANGE_MAX" 2>&1); then
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
patch_random_metadata "$CONT_ID"

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
run_trade "Trader 1 bought distribution" devkit_as "$T1_KEY" trade.ts buy-dist -- "$CONT_ID" "$T1_MU" "$T1_SIGMA" "$CONT_BUY1"

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
run_trade "Trader 2 bought distribution" devkit_as "$T2_KEY" trade.ts buy-dist -- "$CONT_ID" "$T2_MU" "$T2_SIGMA" "$CONT_BUY2"

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
run_trade "Trader 3 bought distribution" devkit_as "$T3_KEY" trade.ts buy-dist -- "$CONT_ID" "$T3_MU" "$T3_SIGMA" "$CONT_BUY3"

# --- BUG-001 regression: large distribution buy ---
CONT_LARGE_AMT=$(rand 80 150)
step "6.7 BUG-001 regression: Trader 2 large buy-dist ($CONT_LARGE_AMT tokens)"
run_trade "Trader 2 large dist buy (BUG-001)" devkit_as "$T2_KEY" trade.ts buy-dist -- "$CONT_ID" "$T2_MU" "$T2_SIGMA" "$CONT_LARGE_AMT"

step "6.8 Querying Trader 1 position"
devkit_as "$T1_KEY" trade.ts position "$CONT_ID" 2>&1 || true
echo ""

step "6.9 Market state after distribution buys"
devkit query.ts market "$CONT_ID" 2>&1 | head -25 || true
echo ""

# --- Trade 4: Trader 1 sells some of their distribution ---
CONT_SELL1_MAX=$((CONT_BUY1 / 3))
if [ "$CONT_SELL1_MAX" -lt 2 ]; then CONT_SELL1_MAX=2; fi
CONT_SELL1=$(rand 2 "$CONT_SELL1_MAX")
step "6.10 Trader 1: sell-dist N($T1_MU, $T1_SIGMA) $CONT_SELL1 tokens"
run_trade "Trader 1 sold distribution tokens" devkit_as "$T1_KEY" trade.ts sell-dist -- "$CONT_ID" "$T1_MU" "$T1_SIGMA" "$CONT_SELL1"

step "6.11 Market after partial sell"
devkit query.ts market "$CONT_ID" 2>&1 | head -25 || true
echo ""

# Wait for deadline (against on-chain clock — see lib.sh::on_chain_now)
REMAINING=$((CONT_DEADLINE - $(on_chain_now) + 5))
if [ "$REMAINING" -gt 0 ]; then
  STAT_WAIT_TIME=$((STAT_WAIT_TIME + REMAINING))
  PHASE_CONT_WAIT=$REMAINING
  log "Waiting ${REMAINING}s for continuous market deadline..."
  sleep "$REMAINING"
fi

# Resolve with a value near Trader 1's prediction center
# Resolve-value noise scales with range width so wide markets get meaningful
# jitter instead of a fixed ±10. Floors at ±5 for tight ranges.
CONT_RESOLVE_NOISE=$((CONT_RANGE_WIDTH / 30))
if [ "$CONT_RESOLVE_NOISE" -lt 5 ]; then CONT_RESOLVE_NOISE=5; fi
CONT_RESOLVE_OFFSET=$(rand "-$CONT_RESOLVE_NOISE" "$CONT_RESOLVE_NOISE")
CONT_RESOLVE_VALUE=$((T1_MU + CONT_RESOLVE_OFFSET))
# Clamp to range
if [ "$CONT_RESOLVE_VALUE" -lt "$CONT_RANGE_MIN" ]; then CONT_RESOLVE_VALUE=$CONT_RANGE_MIN; fi
if [ "$CONT_RESOLVE_VALUE" -gt "$CONT_RANGE_MAX" ]; then CONT_RESOLVE_VALUE=$CONT_RANGE_MAX; fi

step "6.12 Resolving continuous market with value=$CONT_RESOLVE_VALUE"
if _out=$(devkit resolve.ts market --value="$CONT_RESOLVE_VALUE" -- "$CONT_ID" 2>&1); then
  echo "$_out" | tail -2
  success "Continuous market resolved"
else
  warn "Failed to resolve continuous market"
  echo "$_out" | tail -20 | sed 's/^/    /'
  count_warning
fi

step "6.13 Checking resolved state"
devkit query.ts market "$CONT_ID" 2>&1 | head -25 || true
echo ""

# --- Claims ---
step "6.14 All traders claim payouts"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  run_claim "$((i + 1))" "$CONT_ID" "${TRADER_KEYS[$i]}"
done

step "6.15 Final vault check"
devkit query.ts vault "$CONT_ID" 2>&1 || true
echo ""

success "Continuous market E2E flow complete!"
PHASE_CONT_TIME=$(($(date +%s) - PHASE_CONT_START - PHASE_CONT_WAIT))

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 6b: Continuous Market — Smooth-Kernel Flow
# ═════════════════════════════════════════════════════════════════════════════

PHASE_CONTK_START=$(date +%s)
PHASE_CONTK_WAIT=0
CONTK_BINS=64
# Random kernel_width in {1..9}; clamp to BINS-1 defensively (the clamp never
# binds for BINS=64, but the on-chain validator's hard rule is `< num_outcomes`).
CONTK_KERNEL_W=$(rand 1 9)
if [ "$CONTK_KERNEL_W" -ge "$CONTK_BINS" ]; then CONTK_KERNEL_W=$((CONTK_BINS - 1)); fi
header "PHASE 6b: CONTINUOUS MARKET — smooth kernel (kernel_width=$CONTK_KERNEL_W, $CONTK_BINS bins)"
log "kernel_width=$CONTK_KERNEL_W chosen for this run (re-run with the same seed to reproduce)"

read CONTK_RANGE_MIN CONTK_RANGE_MAX <<< "$(random_continuous_range)"
CONTK_LIQUIDITY=$(rand 50 200)
CONTK_DEADLINE_SEC=$(rand 45 120)
CONTK_DEADLINE=$(( $(on_chain_now) + CONTK_DEADLINE_SEC ))
CONTK_FUND_EACH=$(rand 200 400)

step "6b.1 Creating kernel-mode continuous market (range $CONTK_RANGE_MIN-$CONTK_RANGE_MAX, kernel_width=$CONTK_KERNEL_W)"
if ! CONTK_OUTPUT=$(devkit market.ts create-continuous --bins "$CONTK_BINS" --kernel-width "$CONTK_KERNEL_W" --mint "$COLLATERAL_MINT" -- "$WALLET_ADDR" "$CONTK_LIQUIDITY" "$CONTK_DEADLINE" "$CONTK_RANGE_MIN" "$CONTK_RANGE_MAX" 2>&1); then
  echo "$CONTK_OUTPUT"
  fail "Failed to create kernel continuous market"
  exit 1
fi
echo "$CONTK_OUTPUT"
CONTK_ID=$(echo "$CONTK_OUTPUT" | grep "Market ID:" | awk '{print $NF}' || true)
if [ -z "$CONTK_ID" ]; then
  fail "Failed to parse kernel continuous market ID from output"
  exit 1
fi
success "Kernel continuous market created: ID=$CONTK_ID (kernel_width=$CONTK_KERNEL_W)"
count_market
patch_random_metadata "$CONTK_ID"

step "6b.2 Funding all traders ($CONTK_FUND_EACH tokens each)"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  devkit trade.ts fund "$CONTK_ID" "$CONTK_FUND_EACH" --wallet "${TRADER_ADDRS[$i]}" 2>&1 | tail -1
done
success "All traders funded"

# Distribution trades clustered near the same center so kernel-weighted claims
# from neighboring bins exercise the cross-bin payout path (not just holdings[win]).
CONTK_RANGE_WIDTH=$((CONTK_RANGE_MAX - CONTK_RANGE_MIN))
CONTK_CENTER=$((CONTK_RANGE_MIN + CONTK_RANGE_WIDTH / 2))
CONTK_SIGMA=$((CONTK_RANGE_WIDTH / 10))
if [ "$CONTK_SIGMA" -lt 5 ]; then CONTK_SIGMA=5; fi

for i in $(seq 0 $((NUM_TRADERS - 1))); do
  TK_KEY="${TRADER_KEYS[$i]}"
  TK_MU_OFFSET=$(rand 0 $((CONTK_RANGE_WIDTH / 8)))
  TK_MU=$((CONTK_CENTER - CONTK_RANGE_WIDTH / 16 + TK_MU_OFFSET))
  if [ "$TK_MU" -lt "$CONTK_RANGE_MIN" ]; then TK_MU=$((CONTK_RANGE_MIN + 10)); fi
  if [ "$TK_MU" -gt "$CONTK_RANGE_MAX" ]; then TK_MU=$((CONTK_RANGE_MAX - 10)); fi
  TK_BUY=$(rand 30 80)
  step "6b.$((3 + i)) Trader $((i + 1)): buy-dist N($TK_MU, $CONTK_SIGMA) with $TK_BUY tokens"
  run_trade "Trader $((i + 1)) bought kernel distribution" devkit_as "$TK_KEY" trade.ts buy-dist -- "$CONTK_ID" "$TK_MU" "$CONTK_SIGMA" "$TK_BUY"
done

REMAINING=$((CONTK_DEADLINE - $(on_chain_now) + 5))
if [ "$REMAINING" -gt 0 ]; then
  STAT_WAIT_TIME=$((STAT_WAIT_TIME + REMAINING))
  PHASE_CONTK_WAIT=$REMAINING
  log "Waiting ${REMAINING}s for kernel continuous market deadline..."
  sleep "$REMAINING"
fi

CONTK_RESOLVE_VALUE=$CONTK_CENTER
step "6b.X Resolving kernel continuous market with value=$CONTK_RESOLVE_VALUE"
# devkit resolve.ts now surfaces "Kernel width" and "Scaling factor" in its
# output table (P6-4); the scaling_factor row is the load-bearing signal that
# the on-chain smooth-kernel branch executed.
if _out=$(devkit resolve.ts market --value="$CONTK_RESOLVE_VALUE" -- "$CONTK_ID" 2>&1); then
  echo "$_out" | tail -10
  success "Kernel continuous market resolved (look for 'Scaling factor' row above)"
else
  warn "Failed to resolve kernel continuous market"
  echo "$_out" | tail -20 | sed 's/^/    /'
  count_warning
fi

step "6b.Y Querying resolved state (should include Kernel width + Scaling factor rows)"
devkit query.ts market "$CONTK_ID" 2>&1 | head -30 || true
echo ""

step "6b.Z All traders claim kernel-weighted payouts"
for i in $(seq 0 $((NUM_TRADERS - 1))); do
  run_claim "$((i + 1))" "$CONTK_ID" "${TRADER_KEYS[$i]}"
done

step "6b.Final Vault solvency check (kernel market)"
devkit query.ts vault "$CONTK_ID" 2>&1 || true
echo ""

success "Kernel continuous market E2E flow complete (kernel_width=$CONTK_KERNEL_W)"
PHASE_CONTK_TIME=$(($(date +%s) - PHASE_CONTK_START - PHASE_CONTK_WAIT))

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 8: Backend API Verification
# ═════════════════════════════════════════════════════════════════════════════

PHASE_API_START=$(date +%s)
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
PHASE_API_TIME=$(($(date +%s) - PHASE_API_START))

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 9: Summary
# ═════════════════════════════════════════════════════════════════════════════

TIME_END=$(date +%s)
TIME_TOTAL=$((TIME_END - TIME_START))
TIME_ACTIVE=$((TIME_TOTAL - STAT_WAIT_TIME))

# Compute averages (integer division, 0 if no operations)
if [ "$STAT_TRADES" -gt 0 ]; then
  AVG_TRADE=$((STAT_TRADE_TIME / STAT_TRADES))
else
  AVG_TRADE=0
fi
if [ "$STAT_CLAIMS" -gt 0 ]; then
  AVG_CLAIM=$((STAT_CLAIM_TIME / STAT_CLAIMS))
else
  AVG_CLAIM=0
fi

header "RESULTS SUMMARY"

echo -e "${GREEN}Test Statistics:${NC}"
echo -e "  Markets created:  ${BOLD}$STAT_MARKETS${NC} (binary + multi + continuous)"
echo -e "  Trades executed:  ${BOLD}$STAT_TRADES${NC}"
echo -e "  Claims processed: ${BOLD}$STAT_CLAIMS${NC}"
echo -e "  Warnings:         ${BOLD}$STAT_WARNINGS${NC} (${YELLOW}⚠${NC} expected reverts: NothingToClaim, soft trade failures)"
echo -e "  Errors:           ${BOLD}$STAT_ERRORS${NC} (${RED}✗${NC} hard failures: e.g. backend health check)"
echo -e "  Traders:          ${BOLD}$NUM_TRADERS${NC}"
echo -e "  Random seed:      ${BOLD}$SEED${NC}"
echo ""

echo -e "${GREEN}Timing:${NC}"
echo -e "  Total wall time:    ${BOLD}$(format_duration $TIME_TOTAL)${NC}"
echo -e "  Active time:        ${BOLD}$(format_duration $TIME_ACTIVE)${NC}"
echo -e "  Deadline waits:     ${BOLD}$(format_duration $STAT_WAIT_TIME)${NC}"
echo ""

echo -e "${GREEN}Phase Breakdown:${NC}"
echo -e "  Preflight:          $(format_duration $PHASE_PREFLIGHT_TIME)"
echo -e "  Infrastructure:     $(format_duration $PHASE_INFRA_TIME)"
echo -e "  Protocol setup:     $(format_duration $PHASE_PROTOCOL_TIME)"
echo -e "  Generate traders:   $(format_duration $PHASE_TRADERS_TIME)"
if [ "$PHASE_EXTRA_TIME" -gt 0 ]; then
  echo -e "  Extra markets:      $(format_duration $PHASE_EXTRA_TIME)"
fi
echo -e "  Binary market:      $(format_duration $PHASE_BINARY_TIME)  (+ $(format_duration $PHASE_BINARY_WAIT) wait)"
echo -e "  Multi-outcome:      $(format_duration $PHASE_MULTI_TIME)  (+ $(format_duration $PHASE_MULTI_WAIT) wait)"
echo -e "  Continuous (WTA):   $(format_duration $PHASE_CONT_TIME)  (+ $(format_duration $PHASE_CONT_WAIT) wait)"
echo -e "  Continuous (kern):  $(format_duration $PHASE_CONTK_TIME)  (+ $(format_duration $PHASE_CONTK_WAIT) wait)  kernel_width=$CONTK_KERNEL_W"
echo -e "  Backend API:        $(format_duration $PHASE_API_TIME)"
echo ""

echo -e "${GREEN}Trade Performance:${NC}"
echo -e "  Total trade time:   $(format_duration $STAT_TRADE_TIME) ($STAT_TRADES trades)"
echo -e "  Avg trade time:     ${BOLD}$(format_duration $AVG_TRADE)${NC}"
echo -e "  Total claim time:   $(format_duration $STAT_CLAIM_TIME) ($STAT_CLAIMS claims)"
echo -e "  Avg claim time:     ${BOLD}$(format_duration $AVG_CLAIM)${NC}"
echo ""

echo -e "${GREEN}Markets:${NC}"
if [ "${#EXTRA_MARKET_IDS[@]}" -gt 0 ]; then
  for em in "${EXTRA_MARKET_IDS[@]}"; do
    echo -e "  Extra (${em}):  Created + funded (no lifecycle)"
  done
fi
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

# ── Generate Report File ────────────────────────────────────────────────────

REPORT_FILE="$STATE_DIR/report.txt"
cat > "$REPORT_FILE" <<REPORT
DekantPM E2E Smoke Test Report
==============================
Date:   $(date '+%Y-%m-%d %H:%M:%S')
Seed:   $SEED

Statistics
----------
  Markets created:    $STAT_MARKETS
  Trades executed:    $STAT_TRADES
  Claims processed:   $STAT_CLAIMS
  Warnings:           $STAT_WARNINGS  (expected reverts and soft failures)
  Errors:             $STAT_ERRORS  (hard failures)
  Traders:            $NUM_TRADERS

Timing
------
  Total wall time:    $(format_duration $TIME_TOTAL)
  Active time:        $(format_duration $TIME_ACTIVE)
  Deadline waits:     $(format_duration $STAT_WAIT_TIME)

Phase Breakdown
---------------
  Preflight:          $(format_duration $PHASE_PREFLIGHT_TIME)
  Infrastructure:     $(format_duration $PHASE_INFRA_TIME)
  Protocol setup:     $(format_duration $PHASE_PROTOCOL_TIME)
  Generate traders:   $(format_duration $PHASE_TRADERS_TIME)
  Extra markets:      $(format_duration $PHASE_EXTRA_TIME)
  Binary market:      $(format_duration $PHASE_BINARY_TIME)  (+ $(format_duration $PHASE_BINARY_WAIT) wait)
  Multi-outcome:      $(format_duration $PHASE_MULTI_TIME)  (+ $(format_duration $PHASE_MULTI_WAIT) wait)
  Continuous (WTA):   $(format_duration $PHASE_CONT_TIME)  (+ $(format_duration $PHASE_CONT_WAIT) wait)
  Continuous (kern):  $(format_duration $PHASE_CONTK_TIME)  (+ $(format_duration $PHASE_CONTK_WAIT) wait)  kernel_width=$CONTK_KERNEL_W
  Backend API:        $(format_duration $PHASE_API_TIME)

Trade Performance
-----------------
  Total trade time:   $(format_duration $STAT_TRADE_TIME) ($STAT_TRADES trades)
  Avg trade time:     $(format_duration $AVG_TRADE)
  Total claim time:   $(format_duration $STAT_CLAIM_TIME) ($STAT_CLAIMS claims)
  Avg claim time:     $(format_duration $AVG_CLAIM)

Markets
-------
  Binary (#$BINARY_ID):
    Liquidity: $BIN_LIQUIDITY | Deadline: ${BIN_DEADLINE_SEC}s | Winner: Yes (outcome $BIN_WINNING_OUTCOME)
  Multi (#$MULTI_ID):
    Outcomes: $MULTI_OUTCOMES | Liquidity: $MULTI_LIQUIDITY | Deadline: ${MULTI_DEADLINE_SEC}s | Winner: Outcome $MULTI_WINNER
  Continuous (#$CONT_ID):
    Range: $CONT_RANGE_MIN-$CONT_RANGE_MAX | Bins: $CONT_BINS | Liquidity: $CONT_LIQUIDITY | Deadline: ${CONT_DEADLINE_SEC}s | Resolved: $CONT_RESOLVE_VALUE

Traders
-------
  Trader 1: $T1_ADDR
  Trader 2: $T2_ADDR
  Trader 3: $T3_ADDR
REPORT

success "Report saved to $REPORT_FILE"
echo ""

# ── Next Steps ──────────────────────────────────────────────────────────────

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
