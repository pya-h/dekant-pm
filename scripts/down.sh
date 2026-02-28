#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/down.sh — Stop all DekantPM services
#
# Stops any services started by setup.sh or e2e-smoke.sh, including
# orphaned child processes.
#
# Usage:
#   ./scripts/down.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_NAME="down"
source "$(dirname "$0")/lib.sh"

header "Stopping DekantPM Services"

stopped=0

# Stop from PID files
for f in "$STATE_DIR"/*.pid; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .pid)
  pid=$(cat "$f" 2>/dev/null) || continue
  if kill -0 "$pid" 2>/dev/null; then
    kill_tree "$pid"
    success "$name stopped (PID $pid)"
    stopped=$((stopped + 1))
  else
    log "$name: stale PID file removed"
  fi
  rm -f "$f"
done

if [ "$stopped" -gt 0 ]; then
  sleep 1
fi

# Fallback: force-kill by port (catches orphaned child processes)
for entry in "8899:validator" "4000:backend" "3000:frontend"; do
  port=${entry%%:*}
  name=${entry#*:}
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    warn "Force-killed orphan $name on :$port"
    stopped=$((stopped + 1))
  fi
done

# Clean up any remaining PID files
rm -f "$STATE_DIR"/*.pid 2>/dev/null || true

echo ""
if [ "$stopped" -gt 0 ]; then
  success "All services stopped."
else
  log "No running services found."
fi
