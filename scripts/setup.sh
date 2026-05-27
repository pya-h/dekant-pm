#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/setup.sh — DekantPM Service Orchestrator
#
# Starts all services needed for development and testing.
# Supports network selection, program redeployment, and DB reset.
#
# Usage:
#   ./scripts/setup.sh                              # Start services (localnet)
#   ./scripts/setup.sh --network devnet             # Use Solana devnet
#   ./scripts/setup.sh --network testnet            # Use Solana testnet
#   ./scripts/setup.sh --rpc https://custom.rpc     # Custom RPC endpoint
#   ./scripts/setup.sh --reset                      # Rebuild, redeploy, reset DB
#   ./scripts/setup.sh --no-backend                 # Skip backend
#   ./scripts/setup.sh --no-frontend                # Skip frontend
#   ./scripts/setup.sh -b                           # Start in background
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_NAME="setup"
source "$(dirname "$0")/lib.sh"

# ── Parse Arguments ──────────────────────────────────────────────────────────

NETWORK="localnet"
CUSTOM_RPC=""
DO_RESET=false
START_BACKEND=true
START_FRONTEND=true
BACKGROUND=false

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--network)
      NETWORK="${2:-localnet}"
      shift 2
      ;;
    --network=*)
      NETWORK="${1#*=}"
      shift
      ;;
    -r|--rpc)
      CUSTOM_RPC="${2:-}"
      shift 2
      ;;
    --rpc=*)
      CUSTOM_RPC="${1#*=}"
      shift
      ;;
    -R|--reset)
      DO_RESET=true
      shift
      ;;
    -nb|--no-backend)
      START_BACKEND=false
      shift
      ;;
    -nf|--no-frontend)
      START_FRONTEND=false
      shift
      ;;
    -b|--back|--background)
      BACKGROUND=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Starts DekantPM development services (validator, backend, frontend)."
      echo "Press Ctrl+C to stop all services."
      echo ""
      echo "Options:"
      echo "  -n, --network <net>   Network: localnet (default), devnet, testnet, mainnet"
      echo "  -r, --rpc <url>       Custom RPC URL (overrides --network)"
      echo "  -R, --reset           Rebuild program, reset validator + DB, re-init protocol"
      echo "  -nb, --no-backend     Don't start backend"
      echo "  -nf, --no-frontend    Don't start frontend"
      echo "  -b, --back            Start services in background and exit"
      echo "  -h, --help            Show this help"
      echo ""
      echo "Examples:"
      echo "  $0                             # Quick start on localnet"
      echo "  $0 --reset                     # Fresh start: rebuild + reset everything"
      echo "  $0 --network devnet            # Connect to Solana devnet"
      echo "  $0 --rpc http://my-rpc:8899    # Use custom RPC"
      echo "  $0 -b                          # Start in background (use down.sh to stop)"
      exit 0
      ;;
    *)
      fail "Unknown option: $1 (use --help)"
      exit 1
      ;;
  esac
done

# Determine RPC URL
if [ -n "$CUSTOM_RPC" ]; then
  RPC_URL="$CUSTOM_RPC"
else
  RPC_URL=$(network_rpc "$NETWORK")
fi

IS_LOCAL=false
if is_local_rpc "$RPC_URL"; then
  IS_LOCAL=true
fi

# ── Cleanup Trap ─────────────────────────────────────────────────────────────

CLEANUP_DONE=false
cleanup_and_exit() {
  if [ "$CLEANUP_DONE" = true ]; then return; fi
  CLEANUP_DONE=true
  echo ""
  stop_tracked_pids
  log "All services stopped."
  exit 0
}

trap cleanup_and_exit EXIT INT TERM

# ── Main ─────────────────────────────────────────────────────────────────────

header "DekantPM Setup — $NETWORK"

ensure_state_dir

# ── Preflight Checks ────────────────────────────────────────────────────────

step "Preflight checks"

PROGRAM_SO="$ROOT/target/deploy/dekant_pm.so"
PROGRAM_KEYPAIR="$ROOT/target/deploy/dekant_pm-keypair.json"

# Program binary is required unless we're about to build it
if [ "$DO_RESET" = false ] && [ ! -f "$PROGRAM_SO" ]; then
  fail "Program binary not found. Run 'anchor build' or use --reset"
  exit 1
fi

preflight_check_tools

WALLET_ADDR=$(solana address 2>/dev/null || true)
if [ -z "$WALLET_ADDR" ]; then
  fail "No Solana keypair. Run 'solana-keygen new'"
  exit 1
fi
success "Deployer: $WALLET_ADDR"
state_set DEPLOYER_WALLET "$WALLET_ADDR"

if [ "$START_BACKEND" = true ]; then
  preflight_check_postgres
fi

# ── Reset Flow ───────────────────────────────────────────────────────────────

if [ "$DO_RESET" = true ]; then
  header "RESET: Rebuilding & Redeploying"

  step "Building program (anchor build)"
  (cd "$ROOT" && anchor build)
  success "Program built"

  PROGRAM_ID=$(solana address -k "$PROGRAM_KEYPAIR" 2>/dev/null)
  success "Program ID: $PROGRAM_ID"

  # Propagate config to all .env files
  propagate_config "$PROGRAM_ID" "$RPC_URL" "$NETWORK"
  success "Config propagated to all .env files"

  # Reset backend database
  if [ "$START_BACKEND" = true ]; then
    step "Resetting backend database"
    (cd "$ROOT/backend" && npm run db:drop 2>/dev/null || true)
    (cd "$ROOT/backend" && npm run migration:run 2>/dev/null)
    success "Database reset and migrated"
  fi
else
  # Use existing config (get_program_id falls back to deploy keypair)
  PROGRAM_ID=$(get_program_id)
  propagate_config "$PROGRAM_ID" "$RPC_URL" "$NETWORK"
  log "Using program ID: $PROGRAM_ID"
fi

# ── Install Dependencies ────────────────────────────────────────────────────

step "Checking dependencies"
ensure_deps

# ── Start Services ───────────────────────────────────────────────────────────

header "Starting Services"

# Validator — only for local networks
if [ "$IS_LOCAL" = true ]; then
  if [ "$DO_RESET" = true ]; then
    start_validator reset
  else
    start_validator
  fi
else
  log "Skipping validator (network: $NETWORK, RPC: $RPC_URL)"
  # Verify remote RPC is reachable
  if solana cluster-version --url "$RPC_URL" &>/dev/null; then
    success "Remote RPC reachable ($NETWORK)"
  else
    warn "Cannot reach RPC at $RPC_URL"
  fi
fi

# Backend
if [ "$START_BACKEND" = true ]; then
  start_backend
fi

# Frontend
if [ "$START_FRONTEND" = true ]; then
  start_frontend
fi

# ── Initialize Protocol on Reset ────────────────────────────────────────────

if [ "$DO_RESET" = true ]; then
  header "Initializing Protocol"

  step "Running protocol init"
  devkit setup.ts init 2>&1 | tail -5
  success "Protocol initialized"

  step "Assigning Oracle role to deployer"
  devkit setup.ts assign-role "$WALLET_ADDR" oracle 2>&1 | tail -2 || warn "May already be assigned"

  step "Assigning Creator role to deployer"
  devkit setup.ts assign-role "$WALLET_ADDR" creator 2>&1 | tail -2 || warn "May already be assigned"

  success "Protocol ready!"
fi

# ── Ready ────────────────────────────────────────────────────────────────────

header "Services Running"

echo -e "  Network:     ${BOLD}$NETWORK${NC}"
echo -e "  RPC:         ${BOLD}$RPC_URL${NC}"
echo -e "  Program ID:  ${BOLD}$PROGRAM_ID${NC}"
echo -e "  Deployer:    ${BOLD}$WALLET_ADDR${NC}"
echo ""
if [ "$IS_LOCAL" = true ]; then
  echo -e "  Validator:   ${GREEN}http://localhost:8899${NC}"
fi
if [ "$START_BACKEND" = true ]; then
  echo -e "  Backend:     ${GREEN}http://localhost:4000${NC}  (Swagger: /api/docs)"
fi
if [ "$START_FRONTEND" = true ]; then
  echo -e "  Frontend:    ${GREEN}http://localhost:3000${NC}"
fi
echo ""
echo "Logs:"
if [ "$START_BACKEND" = true ]; then
  echo "  Backend:   $STATE_DIR/backend.log"
fi
if [ "$START_FRONTEND" = true ]; then
  echo "  Frontend:  $STATE_DIR/frontend.log"
fi
echo ""

if [ "$BACKGROUND" = true ]; then
  # Background mode: detach and exit without killing services
  trap - EXIT INT TERM
  success "Services started in background mode."
  log "Use ./scripts/down.sh to stop all services."
else
  echo -e "${YELLOW}Press Ctrl+C to stop all services.${NC}"
  echo ""
  # Keep alive until Ctrl+C
  wait
fi
