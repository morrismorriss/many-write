//! `cargo run -p manywrite-devserver` then `npm run dev`; Vite proxies /api here.
//! Binds to 127.0.0.1 only. For development and automated tests, not for end users.


use manywrite_core::Core;
use serde_json::{json, Value};

fn main() {
    let port = std::env::var("MW_DEV_PORT").unwrap_or_else(|_| "1421".into());
    let config = std::env::var("MW_CONFIG_DIR").unwrap_or_else(|_| ".manywrite-dev-config".into());
    let core = Core::new(std::path::PathBuf::from(config));
    let server = tiny_http::Server::http(format!("127.0.0.1:{port}")).expect("bind dev server");
    eprintln!("Many Write dev server on http://127.0.0.1:{port}");
    for mut req in server.incoming_requests() {
        let url = req.url().to_string();
        let Some(cmd) = url.strip_prefix("/api/") else {
            let _ = req.respond(tiny_http::Response::from_string("not found").with_status_code(404));
            continue;
        };
        let cmd = cmd.to_string();
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let args: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        let out = match core.call(&cmd, &args) {
            Ok(v) => json!({ "ok": true, "value": v }),
            Err(e) => json!({ "ok": false, "error": e }),
        };
        let header = tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap();
        let _ = req.respond(tiny_http::Response::from_string(out.to_string()).with_header(header));
    }
}
