use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, RunEvent, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Apply platform-specific workarounds before Tauri starts.
fn apply_platform_workarounds() {
    // On Linux, WebKitGTK's DMA-BUF renderer fails on many NVIDIA GPUs with
    // "Failed to create GBM buffer of size WxH: Invalid argument".
    // Setting this env var forces a software rendering fallback.
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

/// Holds the spawned Node.js server process so we can kill it on exit.
struct ServerProcess(Mutex<Option<Child>>);

/// Spawn the Quibble Node.js backend server.
fn spawn_server(project_root: &str) -> std::io::Result<Child> {
    // We run `node dist/ui/server.js` from the project root.
    // The beforeDevCommand / beforeBuildCommand already ran `pnpm install && pnpm build:ts`,
    // so dist/ should exist.
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "node", "dist/ui/server.js"])
            .current_dir(project_root)
            .env("PORT", "3000")
            .env("HOST", "127.0.0.1")
            .spawn()
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("node")
            .arg("dist/ui/server.js")
            .current_dir(project_root)
            .env("PORT", "3000")
            .env("HOST", "127.0.0.1")
            .spawn()
    }
}

/// Kill the background server process.
fn kill_server(state: &ServerProcess) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }
}

/// Wait for the dev server to become available on localhost:3000
fn wait_for_server(timeout_secs: u64) -> bool {
    use std::net::TcpStream;
    use std::time::{Duration, Instant};

    let start = Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    while start.elapsed() < timeout {
        if TcpStream::connect("127.0.0.1:3000").is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

pub fn run() {
    apply_platform_workarounds();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Determine project root (one level up from application/)
            let project_root = {
                let mut path = std::env::current_exe()
                    .unwrap_or_default()
                    .parent()
                    .unwrap_or(std::path::Path::new("."))
                    .to_path_buf();

                // In dev mode, current_exe is deep in target/debug.
                // Walk up until we find package.json or use CARGO_MANIFEST_DIR.
                if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
                    // During `tauri dev`, CARGO_MANIFEST_DIR points to src-tauri/
                    path = std::path::PathBuf::from(manifest_dir);
                    // Go up from application/src-tauri -> application -> project root
                    path = path
                        .parent()
                        .and_then(|p| p.parent())
                        .unwrap_or(std::path::Path::new("."))
                        .to_path_buf();
                } else {
                    // In production, the binary is in the app bundle.
                    // We expect the project files to be bundled as resources
                    // or the server to be run as a sidecar.
                    // For now, try walking up to find package.json
                    for _ in 0..10 {
                        if path.join("package.json").exists() {
                            break;
                        }
                        path = path
                            .parent()
                            .unwrap_or(std::path::Path::new("."))
                            .to_path_buf();
                    }
                }
                path.to_string_lossy().to_string()
            };

            // Spawn the Node.js server
            match spawn_server(&project_root) {
                Ok(child) => {
                    app.manage(ServerProcess(Mutex::new(Some(child))));
                }
                Err(e) => {
                    eprintln!("[✗] Failed to start Quibble server: {}", e);
                    app.manage(ServerProcess(Mutex::new(None)));
                }
            }

            // Wait for the server to be ready
            if !wait_for_server(30) {
                eprintln!("[⚠] Server did not start within 30 seconds");
            }

            // Show the main window once the server is ready
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            // ── System Tray ──
            let open_item = MenuItemBuilder::with_id("open", "Open Quibble").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Quibble").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .expect("default window icon must be set in tauri.conf.json");

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("Quibble – P2P Chat")
                .icon(tray_icon)
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let state = app_handle.state::<ServerProcess>();
                        kill_server(state.inner());
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app_handle = tray.app_handle();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the default close behavior
                api.prevent_close();

                let app_handle = window.app_handle().clone();
                let window_clone = window.clone();

                // Ask the user: minimize to tray or quit completely?
                app_handle
                    .dialog()
                    .message(
                        "Would you like to minimize Quibble to the system tray \
                         (keeps listening for peers in the background) \
                         or quit completely?",
                    )
                    .title("Close Quibble")
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Minimize to Tray".to_string(),
                        "Quit".to_string(),
                    ))
                    .show(move |minimize_to_tray| {
                        if minimize_to_tray {
                            // Hide the window (minimize to tray)
                            let _ = window_clone.hide();
                        } else {
                            // Quit completely
                            let state = app_handle.state::<ServerProcess>();
                            kill_server(state.inner());
                            app_handle.exit(0);
                        }
                    });
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { api, .. } = &event {
                // Prevent exit when all windows are closed (keep tray alive)
                api.prevent_exit();
            }
            if let RunEvent::Exit = event {
                let state = app_handle.state::<ServerProcess>();
                kill_server(state.inner());
            }
        });
}
