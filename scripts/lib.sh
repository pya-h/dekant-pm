#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/lib.sh — Shared shell library for DekantPM scripts
#
# Source this file from setup.sh and e2e-smoke.sh:
#   source "$(dirname "$0")/lib.sh"
# ─────────────────────────────────────────────────────────────────────────────

# ── Paths ────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT/scripts/.state"
STATE_ENV="$STATE_DIR/env"
NODE23="/usr/local/n/versions/node/23.3.0/bin"

# ── Colors ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Logging ──────────────────────────────────────────────────────────────────
# SCRIPT_NAME should be set by the sourcing script (e.g., SCRIPT_NAME="setup")

log()     { echo -e "${CYAN}[${SCRIPT_NAME:-lib}]${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail()    { echo -e "${RED}  ✗${NC} $*"; }
header()  { echo -e "\n${BOLD}═══ $* ═══${NC}\n"; }
step()    { echo -e "${BOLD}--- $* ---${NC}"; }

# ── State Management ────────────────────────────────────────────────────────

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
}

# Read a value from the state file.  $1=key, $2=default
state_get() {
  local key=$1
  local default=${2:-}
  if [ -f "$STATE_ENV" ]; then
    local val
    val=$(grep "^${key}=" "$STATE_ENV" 2>/dev/null | head -1 | cut -d= -f2-)
    echo "${val:-$default}"
  else
    echo "$default"
  fi
}

# Write a value to the state file.  $1=key, $2=value
state_set() {
  local key=$1
  local value=$2
  ensure_state_dir
  if [ -f "$STATE_ENV" ] && grep -q "^${key}=" "$STATE_ENV" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$STATE_ENV"
  else
    echo "${key}=${value}" >> "$STATE_ENV"
  fi
}

# ── Network / Config ────────────────────────────────────────────────────────

# Map network name to RPC URL
network_rpc() {
  local network=$1
  case "$network" in
    localnet)              echo "http://localhost:8899" ;;
    devnet)                echo "https://api.devnet.solana.com" ;;
    testnet)               echo "https://api.testnet.solana.com" ;;
    mainnet|mainnet-beta)  echo "https://api.mainnet-beta.solana.com" ;;
    *)                     echo "$network" ;;  # treat as custom URL
  esac
}

get_program_id() {
  state_get PROGRAM_ID "Fa2ookSb6meqem6F1oZcVv1PAxQzNtr7zkf1XiDBFgAf"
}

get_network() {
  state_get NETWORK "localnet"
}

get_rpc_url() {
  state_get RPC_URL "http://localhost:8899"
}

# Returns true if the RPC URL points to localhost
is_local_rpc() {
  local rpc=${1:-$(get_rpc_url)}
  [[ "$rpc" == *"localhost"* ]] || [[ "$rpc" == *"127.0.0.1"* ]]
}

# Update a single key=value in a file.  $1=file, $2=key, $3=value
update_env_file() {
  local file=$1
  local key=$2
  local value=$3
  if [ ! -f "$file" ]; then return; fi
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# Propagate program ID, RPC URL, and network to all .env files + state
propagate_config() {
  local program_id=$1
  local rpc_url=$2
  local network=$3

  update_env_file "$ROOT/backend/.env" "PROGRAM_ID" "$program_id"
  update_env_file "$ROOT/backend/.env" "SOLANA_RPC_URL" "$rpc_url"
  update_env_file "$ROOT/frontend/.env.local" "NEXT_PUBLIC_PROGRAM_ID" "$program_id"
  update_env_file "$ROOT/frontend/.env.local" "NEXT_PUBLIC_RPC_URL" "$rpc_url"
  update_env_file "$ROOT/frontend/.env.local" "NEXT_PUBLIC_NETWORK" "$network"
  update_env_file "$ROOT/devkit/.env" "PROGRAM_ID" "$program_id"
  update_env_file "$ROOT/devkit/.env" "RPC_URL" "$rpc_url"

  state_set PROGRAM_ID "$program_id"
  state_set RPC_URL "$rpc_url"
  state_set NETWORK "$network"
}

# ── Port Checking ───────────────────────────────────────────────────────────

# Wait until a TCP port is accepting connections.  $1=port, $2=name, $3=timeout
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

# Non-blocking port check.  Returns 0 if port is open.
check_port() {
  local port=$1
  nc -z localhost "$port" 2>/dev/null
}

# ── Devkit Wrappers ─────────────────────────────────────────────────────────

# Run a devkit command using the default keypair.
devkit() {
  local script=$1
  shift
  (cd "$ROOT/devkit" && npx ts-node "src/$script" "$@")
}

# Run a devkit command as a specific keypair.
# Usage: devkit_as /path/to/keypair.json trade.ts buy 0 0 10
devkit_as() {
  local keypair=$1
  local script=$2
  shift 2
  (cd "$ROOT/devkit" && KEYPAIR_PATH="$keypair" npx ts-node "src/$script" "$@")
}

# ── Random Values ───────────────────────────────────────────────────────────

# Random integer between min and max (inclusive).  $1=min, $2=max
rand() {
  local min=$1 max=$2
  echo $(( RANDOM % (max - min + 1) + min ))
}

# Pick a random element from the arguments.
rand_choice() {
  local arr=("$@")
  echo "${arr[RANDOM % ${#arr[@]}]}"
}

# ── Keypair Management ──────────────────────────────────────────────────────

# Generate a new Solana keypair.  $1=name → returns path
generate_keypair() {
  local name=$1
  ensure_state_dir
  local path="$STATE_DIR/${name}.json"
  solana-keygen new --no-bip39-passphrase --outfile "$path" --force --silent 2>/dev/null
  echo "$path"
}

# Get the public key (address) of a keypair file.
keypair_address() {
  local path=$1
  solana address -k "$path" 2>/dev/null
}

# ── Service Management ──────────────────────────────────────────────────────

# PID tracking array — shared across all scripts that source lib.sh
PIDS=()

track_pid() {
  PIDS+=("$1")
}

# Gracefully stop all tracked PIDs, then force-kill survivors.
stop_tracked_pids() {
  if [ ${#PIDS[@]} -eq 0 ]; then return; fi
  log "Stopping background processes..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  PIDS=()
  log "All processes stopped."
}

# Start the Solana test validator (localnet only).
start_validator() {
  local program_id
  program_id=$(get_program_id)
  local program_so="$ROOT/target/deploy/dekant_pm.so"

  if check_port 8899; then
    warn "Validator already running on :8899"
    return 0
  fi

  if [ ! -f "$program_so" ]; then
    fail "Program binary not found: $program_so"
    fail "Run 'anchor build' first, or use --reset"
    return 1
  fi

  step "Starting Solana test validator"

  # Kill any lingering validator
  pkill -f "solana-test-validator" 2>/dev/null || true
  sleep 1

  solana-test-validator \
    --bpf-program "$program_id" "$program_so" \
    --reset \
    --quiet \
    &>/dev/null &
  track_pid $!

  wait_for_port 8899 "Solana validator" 30

  # Point solana CLI to localnet
  solana config set --url http://localhost:8899 &>/dev/null

  # Airdrop SOL to the deployer
  local wallet
  wallet=$(solana address 2>/dev/null)
  solana airdrop 100 "$wallet" --url http://localhost:8899 &>/dev/null
  success "Airdropped 100 SOL to deployer ($wallet)"
}

# Start the NestJS backend.
start_backend() {
  if check_port 4000; then
    warn "Backend already running on :4000"
    return 0
  fi

  step "Starting backend"
  ensure_state_dir
  # Must not use subshell for backgrounding — $! would capture subshell PID
  local _prev_dir="$PWD"
  cd "$ROOT/backend"
  npm run start:dev &>"$STATE_DIR/backend.log" &
  track_pid $!
  cd "$_prev_dir"

  wait_for_port 4000 "Backend" 30
}

# Start the Next.js frontend.
start_frontend() {
  if check_port 3000; then
    warn "Frontend already running on :3000"
    return 0
  fi

  step "Starting frontend"
  ensure_state_dir
  local _prev_dir="$PWD"
  cd "$ROOT/frontend"
  PATH="$NODE23:$PATH" pnpm dev &>"$STATE_DIR/frontend.log" &
  track_pid $!
  cd "$_prev_dir"

  wait_for_port 3000 "Frontend" 45
}

# ── Dependency Installation ─────────────────────────────────────────────────

ensure_deps() {
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
}

# ── SOL Airdrop ─────────────────────────────────────────────────────────────

# Airdrop SOL to a wallet address.  $1=address, $2=amount (default 10)
airdrop_sol() {
  local address=$1
  local amount=${2:-10}
  local rpc_url
  rpc_url=$(get_rpc_url)
  solana airdrop "$amount" "$address" --url "$rpc_url" &>/dev/null
}

# ── Preflight Checks ───────────────────────────────────────────────────────

preflight_check_program() {
  local program_so="$ROOT/target/deploy/dekant_pm.so"
  if [ ! -f "$program_so" ]; then
    fail "Program binary not found at $program_so"
    log "Run 'anchor build' first"
    return 1
  fi
  success "Program binary found"
}

preflight_check_tools() {
  if ! command -v solana &>/dev/null; then
    fail "solana CLI not found"
    return 1
  fi
  success "solana CLI ($(solana --version 2>&1 | head -1))"

  if ! command -v solana-test-validator &>/dev/null; then
    warn "solana-test-validator not found (needed for localnet)"
  else
    success "solana-test-validator found"
  fi

  if [ -x "$NODE23/node" ]; then
    success "Node 23.3.0 found"
  else
    warn "Node 23.3.0 not found at $NODE23 — frontend may not work"
  fi

  if [ -x "$NODE23/pnpm" ] || command -v pnpm &>/dev/null; then
    success "pnpm found"
  else
    warn "pnpm not found"
  fi

  if ! command -v npx &>/dev/null; then
    fail "npx not found"
    return 1
  fi
  success "npx found"
}

preflight_check_wallet() {
  local wallet
  wallet=$(solana address 2>/dev/null || true)
  if [ -z "$wallet" ]; then
    fail "No default Solana keypair. Run 'solana-keygen new'" >&2
    return 1
  fi
  # Decorative output to stderr so $(preflight_check_wallet) captures only the address
  success "Wallet: $wallet" >&2
  echo "$wallet"
}

preflight_check_postgres() {
  if pg_isready -q 2>/dev/null; then
    success "PostgreSQL is accessible"
  else
    warn "PostgreSQL not running — backend may fail"
  fi
}
