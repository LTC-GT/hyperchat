#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  launch-linux.sh  –  Run Quibble desktop in debug mode
#
#  Builds the Tauri app in debug mode and launches it directly
#  with full stdout/stderr output so you can see all logs from
#  both the Rust (Tauri) side and the Node.js server.
#
#  Prerequisites: rustup, cargo, rustc, node, pnpm
#  Works on Fedora, Ubuntu/Debian, Arch, openSUSE, etc.
#
#  Usage:  ./launch-linux.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$SCRIPT_DIR/src-tauri"

echo "┌──────────────────────────────────────────────┐"
echo "│  Quibble Desktop – Linux Debug Launch         │"
echo "└──────────────────────────────────────────────┘"
echo ""

# ── 0. Check required tools ─────────────────────────────────
missing=""
for cmd in rustc cargo node pnpm; do
  if ! command -v "$cmd" &>/dev/null; then
    missing="$missing $cmd"
  fi
done
if [ -n "$missing" ]; then
  echo "[✗] Missing required commands:$missing"
  echo "    Install Rust via https://rustup.rs and Node/pnpm via your package manager."
  exit 1
fi
echo "[✓] rustc $(rustc --version | awk '{print $2}'), cargo, node $(node --version), pnpm $(pnpm --version)"

# ── 0b. Check system libraries needed by Tauri/WebKitGTK ────
echo ""
echo "[⚙] Checking system libraries for Tauri..."

check_lib() {
  pkg-config --exists "$1" 2>/dev/null
}

MISSING_LIBS=""
# Tauri v2 requires these pkg-config packages
for lib in gtk+-3.0 glib-2.0 webkit2gtk-4.1 libsoup-3.0 gdk-pixbuf-2.0 cairo pango; do
  if ! check_lib "$lib"; then
    MISSING_LIBS="$MISSING_LIBS $lib"
  fi
done

if [ -n "$MISSING_LIBS" ]; then
  echo "[⚠] Missing system libraries (pkg-config names):$MISSING_LIBS"
  echo ""
  echo "    Install them with your package manager:"
  echo ""

  # Detect distro and show the right command
  if command -v dnf &>/dev/null; then
    echo "    Fedora/RHEL:"
    echo "      sudo dnf install gtk3-devel webkit2gtk4.1-devel libsoup3-devel \\"
    echo "        glib2-devel cairo-devel pango-devel gdk-pixbuf2-devel \\"
    echo "        openssl-devel librsvg2-devel"
  elif command -v apt-get &>/dev/null; then
    echo "    Ubuntu/Debian:"
    echo "      sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev \\"
    echo "        libglib2.0-dev libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev \\"
    echo "        libssl-dev librsvg2-dev libjavascriptcoregtk-4.1-dev"
  elif command -v pacman &>/dev/null; then
    echo "    Arch:"
    echo "      sudo pacman -S gtk3 webkit2gtk-4.1 libsoup3 glib2 cairo pango \\"
    echo "        gdk-pixbuf2 openssl librsvg"
  elif command -v zypper &>/dev/null; then
    echo "    openSUSE:"
    echo "      sudo zypper install gtk3-devel webkit2gtk3-soup2-devel libsoup3-devel \\"
    echo "        glib2-devel cairo-devel pango-devel gdk-pixbuf-devel \\"
    echo "        libopenssl-devel librsvg-devel"
  else
    echo "    (Could not detect package manager — install the equivalents for your distro)"
  fi

  echo ""
  echo "    Then re-run this script."
  exit 1
fi
echo "[✓] All required system libraries found"
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

# ── 4. Locate & launch the debug binary ─────────────────────
BINARY="$TAURI_DIR/target/debug/quibble-desktop"

if [ ! -f "$BINARY" ]; then
  echo "[⚠] Binary not found at: $BINARY"
  echo "    Searching..."
  BINARY=$(find "$TAURI_DIR/target/debug" -maxdepth 1 -type f -executable -name "quibble*" | head -1)
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

# Verbose Tauri/wry/WebView logging + full panic backtraces
export RUST_LOG="${RUST_LOG:-debug}"
export RUST_BACKTRACE="${RUST_BACKTRACE:-1}"

# Work around NVIDIA GBM/DMA-BUF failures on Linux.
# WebKitGTK tries hardware-accelerated DMA-BUF rendering which breaks
# on many NVIDIA driver versions ("Failed to create GBM buffer").
# This forces a software rendering fallback.
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"

# lib.rs uses CARGO_MANIFEST_DIR to find the project root
export CARGO_MANIFEST_DIR="$TAURI_DIR"

exec "$BINARY"
