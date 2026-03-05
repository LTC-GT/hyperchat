#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  launch-macos.sh  –  Run Quibble desktop in debug mode
#
#  Builds the Tauri app in debug mode and launches it directly
#  with full stdout/stderr output so you can see all logs from
#  both the Rust (Tauri) side and the Node.js server.
#
#  Usage:  ./launch-macos.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$SCRIPT_DIR/src-tauri"

echo "┌──────────────────────────────────────────────┐"
echo "│  Quibble Desktop – Debug Launch               │"
echo "└──────────────────────────────────────────────┘"
echo ""

# ── 1. Install deps & build TypeScript ──────────────────────
echo "[⚙] Installing dependencies & building TypeScript..."
cd "$PROJECT_ROOT"
pnpm install
pnpm run build:ts
echo "[✓] TypeScript build complete"
echo ""

# ── 2. Build CSS (if script exists) ─────────────────────────
if pnpm run build:css 2>/dev/null; then
  echo "[✓] CSS build complete"
else
  echo "[⚠] No build:css script found (skipping)"
fi
echo ""

# ── 3. Build Tauri in debug mode ────────────────────────────
echo "[⚙] Building Tauri app (debug)..."
cd "$TAURI_DIR"
cargo build 2>&1
echo "[✓] Cargo build complete"
echo ""

# ── 4. Launch the debug binary with full logging ────────────
BINARY="$TAURI_DIR/target/debug/quibble-desktop"

if [ ! -f "$BINARY" ]; then
  echo "[✗] Binary not found at: $BINARY"
  echo "    Trying to locate it..."
  BINARY=$(find "$TAURI_DIR/target/debug" -maxdepth 1 -type f -perm +111 -name "quibble*" | head -1)
  if [ -z "$BINARY" ]; then
    echo "[✗] Could not find any quibble binary in target/debug/"
    exit 1
  fi
  echo "    Found: $BINARY"
fi

echo "┌──────────────────────────────────────────────┐"
echo "│  Launching Quibble (debug)                    │"
echo "│  Binary: $BINARY"
echo "│  All stdout/stderr will appear below.         │"
echo "│  Press Ctrl+C to stop.                        │"
echo "└──────────────────────────────────────────────┘"
echo ""

# Set RUST_LOG for verbose Tauri/WebView logging and
# RUST_BACKTRACE for full backtraces on panics.
export RUST_LOG="${RUST_LOG:-debug}"
export RUST_BACKTRACE="${RUST_BACKTRACE:-1}"

# CARGO_MANIFEST_DIR is used by lib.rs to find the project root
export CARGO_MANIFEST_DIR="$TAURI_DIR"

exec "$BINARY"
