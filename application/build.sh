#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Quibble Desktop – Cross-Platform Build Script
#
# Usage:
#   ./build.sh                   Build for the current platform
#   ./build.sh --all             Build for all supported targets
#   ./build.sh --linux           Build Linux AppImage (amd64 + arm64)
#   ./build.sh --macos           Build macOS DMG     (amd64 + arm64)
#   ./build.sh --windows         Build Windows NSIS  (amd64)
#   ./build.sh --target <triple> Build for a specific Rust target triple
#
# Requirements:
#   - Rust toolchain (rustup)
#   - Node.js >= 18
#   - pnpm
#   - Tauri CLI v2: `cargo install tauri-cli --version "^2"`
#     or use `npx @tauri-apps/cli`
#
# For cross-compilation you may also need:
#   - cross (cargo install cross)
#   - Docker (for cross-compiling Linux targets)
#   - osxcross (for cross-compiling macOS from Linux)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$SCRIPT_DIR/src-tauri"

# Colors (ASCII-safe)
info()  { echo "[*] $*"; }
ok()    { echo "[✓] $*"; }
warn()  { echo "[⚠] $*"; }
err()   { echo "[✗] $*" >&2; }

# ── Prerequisite checks ──

check_prereqs() {
    local missing=0

    if ! command -v node &>/dev/null; then
        err "Node.js is required but not found. Install from https://nodejs.org"
        missing=1
    fi

    if ! command -v pnpm &>/dev/null; then
        err "pnpm is required but not found. Install with: npm i -g pnpm"
        missing=1
    fi

    if ! command -v rustc &>/dev/null; then
        err "Rust is required but not found. Install from https://rustup.rs"
        missing=1
    fi

    if ! command -v cargo &>/dev/null; then
        err "Cargo is required but not found. Install from https://rustup.rs"
        missing=1
    fi

    if [[ $missing -ne 0 ]]; then
        err "Missing prerequisites. Aborting."
        exit 1
    fi

    ok "All prerequisites found"
}

# ── Ensure dependencies ──

install_deps() {
    info "Installing Node.js dependencies..."
    cd "$PROJECT_ROOT"
    pnpm install
    ok "Node dependencies installed"
}

# ── Build frontend (TypeScript compilation) ──

build_frontend() {
    info "Building TypeScript..."
    cd "$PROJECT_ROOT"
    pnpm run build:ts
    ok "TypeScript built"
}

# ── Tauri build for a specific target ──

build_target() {
    local target="$1"
    local bundles="$2"

    info "Building Quibble Desktop for target: $target ($bundles)"

    # Ensure the Rust target is installed
    if ! rustup target list --installed | grep -q "$target"; then
        info "Adding Rust target: $target"
        rustup target add "$target"
    fi

    cd "$TAURI_DIR"

    # Use cargo-tauri (npx fallback)
    local tauri_cmd
    if command -v cargo-tauri &>/dev/null; then
        tauri_cmd="cargo tauri"
    elif command -v npx &>/dev/null; then
        tauri_cmd="npx @tauri-apps/cli"
    else
        err "Neither 'cargo tauri' nor 'npx @tauri-apps/cli' found."
        err "Install with: cargo install tauri-cli --version '^2'"
        exit 1
    fi

    $tauri_cmd build --target "$target" --bundles "$bundles"

    ok "Build complete for $target ($bundles)"
}

# ── Platform build helpers ──

build_linux() {
    info "=== Building Linux targets ==="
    build_target "x86_64-unknown-linux-gnu" "appimage"
    build_target "aarch64-unknown-linux-gnu" "appimage"
    ok "Linux builds complete"
}

build_macos() {
    info "=== Building macOS targets ==="
    build_target "x86_64-apple-darwin" "dmg"
    build_target "aarch64-apple-darwin" "dmg"
    ok "macOS builds complete"
}

build_windows() {
    info "=== Building Windows targets ==="
    build_target "x86_64-pc-windows-msvc" "nsis"
    ok "Windows build complete"
}

build_current() {
    info "=== Building for current platform ==="
    cd "$TAURI_DIR"

    local tauri_cmd
    if command -v cargo-tauri &>/dev/null; then
        tauri_cmd="cargo tauri"
    elif command -v npx &>/dev/null; then
        tauri_cmd="npx @tauri-apps/cli"
    else
        err "Neither 'cargo tauri' nor 'npx @tauri-apps/cli' found."
        exit 1
    fi

    $tauri_cmd build

    ok "Build complete for current platform"
}

# ── Summary ──

show_artifacts() {
    info "Build artifacts:"
    local bundle_dir="$TAURI_DIR/target"
    if [[ -d "$bundle_dir" ]]; then
        find "$bundle_dir" -maxdepth 5 \
            \( -name "*.AppImage" -o -name "*.dmg" -o -name "*.exe" -o -name "*.msi" -o -name "*.deb" \) \
            -print 2>/dev/null | while read -r f; do
            echo "  → $f"
        done
    fi
}

# ── Main ──

main() {
    echo ""
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║   Quibble Desktop – Build Script      ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo ""

    check_prereqs
    install_deps
    build_frontend

    case "${1:-}" in
        --all)
            build_linux
            build_macos
            build_windows
            ;;
        --linux)
            build_linux
            ;;
        --macos)
            build_macos
            ;;
        --windows)
            build_windows
            ;;
        --target)
            if [[ -z "${2:-}" ]]; then
                err "Usage: $0 --target <rust-target-triple>"
                exit 1
            fi
            # Determine bundle type from target
            local bundles="app"
            case "$2" in
                *linux*)   bundles="appimage" ;;
                *darwin*)  bundles="dmg" ;;
                *windows*) bundles="nsis" ;;
            esac
            build_target "$2" "$bundles"
            ;;
        ""|--current)
            build_current
            ;;
        *)
            echo "Usage: $0 [--all|--linux|--macos|--windows|--target <triple>|--current]"
            exit 1
            ;;
    esac

    echo ""
    show_artifacts
    echo ""
    ok "All done!"
}

main "$@"
