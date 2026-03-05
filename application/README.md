# Quibble Desktop Application

A lightweight desktop wrapper for Quibble using [Tauri v2](https://v2.tauri.app/) system webview.

## How It Works

The Tauri app:
1. Compiles the TypeScript backend (`pnpm build:ts`)
2. Spawns the Node.js Quibble web server on `localhost:3000`
3. Opens a native webview window pointing to the server
4. Provides a **system tray icon** for background operation

### System Tray Behavior

When you close the window, Quibble asks:
- **Minimize to Tray** – hides the window but keeps the P2P daemon running (listening for peers)
- **Quit** – shuts down the server and exits completely

The tray icon menu provides:
- **Open Quibble** – show/focus the main window
- **Quit Quibble** – shut down everything

Double-clicking the tray icon also reopens the window.

## Prerequisites

- [Node.js](https://nodejs.org) >= 18
- [pnpm](https://pnpm.io)
- [Rust](https://rustup.rs) toolchain
- Platform dependencies for Tauri:
  - **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: WebView2 (usually pre-installed on Windows 10/11), VS Build Tools

## Development

```bash
# From the project root:
pnpm install

# Install Tauri CLI (if not already):
cargo install tauri-cli --version "^2"

# Run in development mode:
cd application/src-tauri
cargo tauri dev
```

## Building

### Current platform (quickest)

```bash
cd application
./build.sh
```

### Specific platforms

```bash
./build.sh --macos     # DMG for amd64 + arm64
./build.sh --linux     # AppImage for amd64 + arm64
./build.sh --windows   # NSIS exe for amd64
./build.sh --all       # All of the above
```

### Windows (PowerShell)

```powershell
cd application
.\build.ps1
.\build.ps1 -Target windows
```

### Custom target

```bash
./build.sh --target aarch64-apple-darwin
```

## Build Artifacts

After building, artifacts are found in:

```
application/src-tauri/target/<target-triple>/release/bundle/
├── appimage/    # Linux AppImage
├── dmg/         # macOS disk image
├── nsis/        # Windows installer
└── macos/       # macOS .app bundle
```

## Icons

Place your custom icons in `src-tauri/icons/`:
- `32x32.png` – small icon
- `128x128.png` – medium icon
- `128x128@2x.png` – retina icon
- `icon.png` – 512x512 source icon
- `icon.icns` – macOS icon (generate with `iconutil`)
- `icon.ico` – Windows icon (generate with ImageMagick)

The generated placeholder icons show a "Q" shape. Replace them with proper branding before release.
