// Many Write desktop shell. All real work happens in `manywrite_core`; this
// file only connects it to the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;

use manywrite_core::Core;
use serde_json::Value;
use tauri::Manager;

/// The one command the UI calls. Runs off the main thread so typesetting a
/// long script never freezes the window.
#[tauri::command]
async fn mw_call(core: tauri::State<'_, Arc<Core>>, cmd: String, args: Value) -> Result<Value, String> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.call(&cmd, &args))
        .await
        .map_err(|e| e.to_string())?
}

/// Show a file or folder in Finder / Explorer / the file manager.
#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let target = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program).arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config = app.path().app_config_dir().expect("no config directory");
            app.manage(Arc::new(Core::new(config)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![mw_call, reveal])
        .run(tauri::generate_context!())
        .expect("error while running Many Write");
}
