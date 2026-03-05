<# 
.SYNOPSIS
  Quibble Desktop – Windows Build Script

.DESCRIPTION
  Builds the Quibble desktop application for Windows using Tauri v2.

.PARAMETER Target
  The build target. Defaults to current platform.
  Options: current, all, windows

.EXAMPLE
  .\build.ps1
  .\build.ps1 -Target windows
#>

param(
    [ValidateSet("current", "all", "windows")]
    [string]$Target = "current"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$TauriDir = Join-Path $ScriptDir "src-tauri"

function Write-Info  { param($msg) Write-Host "[*] $msg" }
function Write-Ok    { param($msg) Write-Host "[✓] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "[⚠] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "[✗] $msg" -ForegroundColor Red }

# ── Check prerequisites ──

function Test-Prerequisites {
    $missing = $false

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Err "Node.js is required. Install from https://nodejs.org"
        $missing = $true
    }

    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Err "pnpm is required. Install with: npm i -g pnpm"
        $missing = $true
    }

    if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
        Write-Err "Rust is required. Install from https://rustup.rs"
        $missing = $true
    }

    if ($missing) {
        Write-Err "Missing prerequisites. Aborting."
        exit 1
    }

    Write-Ok "All prerequisites found"
}

# ── Install dependencies ──

function Install-Dependencies {
    Write-Info "Installing Node.js dependencies..."
    Push-Location $ProjectRoot
    pnpm install
    Pop-Location
    Write-Ok "Dependencies installed"
}

# ── Build frontend ──

function Build-Frontend {
    Write-Info "Building TypeScript..."
    Push-Location $ProjectRoot
    pnpm run build:ts
    Pop-Location
    Write-Ok "TypeScript built"
}

# ── Tauri build ──

function Build-Tauri {
    param(
        [string]$RustTarget = "",
        [string]$Bundles = ""
    )

    Push-Location $TauriDir

    $tauriCmd = $null
    if (Get-Command cargo-tauri -ErrorAction SilentlyContinue) {
        $tauriCmd = "cargo"
    }

    if ($RustTarget -and $Bundles) {
        Write-Info "Building for target: $RustTarget ($Bundles)"
        if ($tauriCmd) {
            & cargo tauri build --target $RustTarget --bundles $Bundles
        } else {
            & npx @tauri-apps/cli build --target $RustTarget --bundles $Bundles
        }
    } else {
        Write-Info "Building for current platform..."
        if ($tauriCmd) {
            & cargo tauri build
        } else {
            & npx @tauri-apps/cli build
        }
    }

    Pop-Location
    Write-Ok "Build complete"
}

# ── Main ──

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗"
Write-Host "  ║   Quibble Desktop – Build Script      ║"
Write-Host "  ╚═══════════════════════════════════════╝"
Write-Host ""

Test-Prerequisites
Install-Dependencies
Build-Frontend

switch ($Target) {
    "all" {
        Build-Tauri -RustTarget "x86_64-pc-windows-msvc" -Bundles "nsis"
        Build-Tauri -RustTarget "aarch64-pc-windows-msvc" -Bundles "nsis"
    }
    "windows" {
        Build-Tauri -RustTarget "x86_64-pc-windows-msvc" -Bundles "nsis"
    }
    default {
        Build-Tauri
    }
}

Write-Host ""
Write-Ok "All done!"
