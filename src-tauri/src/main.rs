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
    // The path reaches a system program as an argument, so it must be an absolute
    // path with no control characters or quotes (which some platforms' argument
    // handling treats specially) and must not begin with "-" (an option).
    let p = std::path::Path::new(&path);
    if !p.is_absolute() || path.chars().any(|c| c.is_control() || c == '"') || path.starts_with('-') {
        return Err("only plain absolute paths can be revealed".into());
    }
    let target = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    if target.as_os_str().is_empty() || target.to_string_lossy().starts_with('-') {
        return Err("that path cannot be revealed".into());
    }
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program).arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Open a web address (a link clicked in the editor) in the default browser.
/// Only http and https addresses are opened.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) || url.chars().any(|c| c.is_control() || c == '"') {
        return Err("only http and https links can be opened".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url.as_str()]);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// macOS and Windows webviews check spelling on their own. WebKitGTK (Linux)
/// needs it switched on, with the system language's dictionary.
#[cfg(target_os = "linux")]
fn enable_spellcheck(app: &tauri::App) {
    use webkit2gtk::{WebContextExt, WebViewExt};
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(|wv| {
            if let Some(ctx) = wv.inner().context() {
                let lang = std::env::var("LANG").ok().and_then(|l| l.split('.').next().map(str::to_string)).filter(|l| !l.is_empty() && l != "C");
                ctx.set_spell_checking_languages(&[lang.as_deref().unwrap_or("en_US")]);
                ctx.set_spell_checking_enabled(true);
            }
        });
    }
}

#[cfg(not(target_os = "linux"))]
fn enable_spellcheck(_app: &tauri::App) {}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config = app.path().app_config_dir().expect("no config directory");
            app.manage(Arc::new(Core::new(config)));
            enable_spellcheck(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![mw_call, reveal, open_url])
        .run(tauri::generate_context!())
        .expect("error while running Many Write");
}
