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
    val=$(grep "^${key}=" "$STATE_ENV" 2>/dev/null | head -1 | cut -d= -f2-) || true
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
  local pid
  pid=$(state_get PROGRAM_ID "")
  if [ -z "$pid" ]; then
    # Fall back to the deploy keypair
    local keypair="$ROOT/target/deploy/dekant_pm-keypair.json"
    pid=$(solana address -k "$keypair" 2>/dev/null || true)
    if [ -n "$pid" ]; then
      state_set PROGRAM_ID "$pid"
    else
      fail "PROGRAM_ID is not set. Run setup.sh first or set it in scripts/.state/env"
      exit 1
    fi
  fi
  echo "$pid"
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

# ── On-chain Clock ──────────────────────────────────────────────────────────
#
# The Solana program's Clock::get()?.unix_timestamp is what gates deadlines —
# NOT the host wallclock. A long-running solana-test-validator can drift
# minutes behind host wallclock between resets, so deadlines computed with
# `date +%s` will be processed by the validator while its on-chain clock is
# still well before that "future" timestamp — and the market never transitions
# to PendingResolution, causing resolve_market to revert.
#
# Use this helper to anchor any deadline math (and any "wait for deadline"
# loop) to the same clock the program will check against.
#
# Echoes the validator's actual on-chain unix_timestamp by reading the Clock
# sysvar directly. This is the same value the program sees via Clock::get(),
# so deadlines computed against it match exactly what require!(clock >=
# deadline) will check inside the instruction.
#
# Avoided alternatives:
#   - getBlockTime + finalized commitment: ~30s lag, deadlines end up too tight
#   - getBlockTime + processed commitment: can return null for very fresh slots
#
# Clock sysvar layout (40 bytes total):
#   bytes  0..8   slot                  u64 LE
#   bytes  8..16  epoch_start_timestamp i64 LE
#   bytes 16..24  epoch                 u64 LE
#   bytes 24..32  leader_schedule_epoch u64 LE
#   bytes 32..40  unix_timestamp        i64 LE   ← what we want
#
# Falls back to host wallclock if RPC is unreachable.
on_chain_now() {
  local rpc=${1:-http://localhost:8899}
  local raw data ts
  raw=$(curl -s "$rpc" -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["SysvarC1ock11111111111111111111111111111111",{"encoding":"base64","commitment":"processed"}]}' 2>/dev/null)
  if [ -z "$raw" ]; then date +%s; return; fi
  data=$(echo "$raw" | sed -n 's/.*"data":\["\([^"]*\)".*/\1/p')
  if [ -z "$data" ]; then date +%s; return; fi
  ts=$(printf '%s' "$data" | base64 -d 2>/dev/null \
    | dd bs=1 skip=32 count=8 status=none 2>/dev/null \
    | od -An -tu8 --endian=little 2>/dev/null \
    | tr -d ' \n')
  if [ -z "$ts" ]; then date +%s; return; fi
  echo "$ts"
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

# Random continuous-market range, printed as "MIN MAX" on stdout. The script
# picks a "shape" first to vary not just the numbers but the geometry — narrow
# windows, large dynamic ranges, ranges that cross zero, etc. Downstream μ/σ
# and resolve-value computations in the smoke script use range_min/range_max
# directly, so they auto-adapt to whatever this returns.
#
# Shapes (weighted by repetition for distribution control):
#   tight     — narrow window (width 20–100), tests boundary bin sizing
#   standard  — legacy smoke range, well-exercised baseline
#   wide      — large dynamic range (width up to ~4000), tests Gaussian compute
#   negative  — crosses zero, common for delta / "change from X" markets
random_continuous_range() {
  local shape min max width
  shape=$(rand_choice tight standard standard wide negative)
  case "$shape" in
    tight)
      min=$(rand 40 80)
      width=$(rand 20 100)
      max=$((min + width))
      ;;
    standard)
      min=$(rand 30 80)
      max=$(rand 300 600)
      ;;
    wide)
      min=$(rand 0 50)
      max=$(rand 1500 4000)
      ;;
    negative)
      min=$(rand -300 -50)
      max=$(rand 50 600)
      ;;
  esac
  echo "$min $max"
}

# ── Keypair Management ──────────────────────────────────────────────────────

# Generate a new Solana keypair.  $1=name → returns path
generate_keypair() {
  local name=$1
  ensure_state_dir
  local path="$STATE_DIR/${name}.json"
  solana-keygen new --no-bip39-passphrase --outfile "$path" --force --silent &>/dev/null
  echo "$path"
}

# Get the public key (address) of a keypair file.
keypair_address() {
  local path=$1
  solana address -k "$path" 2>/dev/null
}

# ── Service Management ──────────────────────────────────────────────────────

# PID tracking — in-memory array + persistent PID files in .state/
PIDS=()

# Track a PID and save to a named PID file for cross-script cleanup.
# Usage: track_pid <pid> [name]
track_pid() {
  local pid=$1
  local name=${2:-}
  PIDS+=("$pid")
  if [ -n "$name" ]; then
    ensure_state_dir
    echo "$pid" > "$STATE_DIR/${name}.pid"
  fi
}

# Recursively kill a process and all its descendants.
kill_tree() {
  local pid=$1 sig=${2:-TERM}
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

# Stop all tracked processes (PID files + in-memory), with port-based fallback.
stop_tracked_pids() {
  log "Stopping services..."

  # Kill from PID files (survives script restarts)
  for f in "$STATE_DIR"/*.pid; do
    [ -f "$f" ] || continue
    local pid
    pid=$(cat "$f" 2>/dev/null) || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid"
    fi
    rm -f "$f"
  done

  # Kill in-memory tracked PIDs
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid"
    fi
  done

  sleep 1

  # Force-kill survivors by port (catches orphaned child processes)
  for port in 8899 4000 3000; do
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  done

  rm -f "$STATE_DIR"/*.pid 2>/dev/null || true
  PIDS=()
  log "All processes stopped."
}

# Start the Solana test validator (localnet only).
# Pass "reset" as $1 to wipe the ledger; default is to keep existing state.
#
# Program loader selection:
#   If the Solana CLI's default keypair (typically ~/.config/solana/id.json)
#   is readable, the program is preloaded under the upgradeable BPF loader
#   with that wallet as the upgrade authority — so `anchor upgrade` works
#   against the running validator without needing a full --reset.
#
#   If no usable keypair is available, falls back to --bpf-program (BPF
#   Loader v2, immutable). The fallback prints a notice so the surprise of
#   "anchor upgrade rejects my authority" is one log line away.
start_validator() {
  local do_reset="${1:-}"
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

  local reset_flag=""
  if [ "$do_reset" = "reset" ]; then
    reset_flag="--reset"
    log "Validator ledger will be wiped (--reset)"
  fi

  # Resolve the upgrade authority. `solana address` reads the CLI-configured
  # keypair directly (typically ~/.config/solana/id.json) and is the same
  # source of truth the rest of this script uses — so no parsing of `solana
  # config get` output (which formats path lines inconsistently across
  # subcommands). Empty result → no usable keypair → immutable fallback.
  local upgrade_authority
  upgrade_authority=$(solana address 2>/dev/null || true)

  # Best-effort: extract the keypair path for the log message. Strips leading
  # spaces and the trailing space `solana config get` adds after the path.
  local default_keypair=""
  if [ -n "$upgrade_authority" ]; then
    default_keypair=$(solana config get 2>/dev/null \
      | sed -n 's/^Keypair Path:[[:space:]]*//p' \
      | sed 's/[[:space:]]*$//')
  fi

  local program_load_args
  if [ -n "$upgrade_authority" ]; then
    log "Loading program as UPGRADEABLE (authority=$upgrade_authority, keypair=${default_keypair:-<solana CLI config>})"
    program_load_args=(--upgradeable-program "$program_id" "$program_so" "$upgrade_authority")
  else
    warn "No default keypair resolved via 'solana address' → program will be IMMUTABLE"
    warn "  Run 'solana-keygen new' or 'solana config set --keypair <path>' to enable upgrades"
    program_load_args=(--bpf-program "$program_id" "$program_so")
  fi

  solana-test-validator \
    "${program_load_args[@]}" \
    $reset_flag \
    --quiet \
    &>/dev/null &
  track_pid $! validator

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
  track_pid $! backend
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
  track_pid $! frontend
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
