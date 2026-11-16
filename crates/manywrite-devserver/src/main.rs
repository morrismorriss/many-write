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
        // The server can read and write files, so only the Many Write page on this
        // machine may use it: other websites in the same browser (cross-site requests)
        // and DNS-rebinding tricks are refused.
        if let Err(why) = allowed(&req) {
            let _ = req.respond(tiny_http::Response::from_string(why).with_status_code(403));
            continue;
        }
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

fn header<'a>(req: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

fn is_local(host: &str) -> bool {
    let h = host.rsplit_once(':').filter(|(_, port)| port.chars().all(|c| c.is_ascii_digit())).map_or(host, |(h, _)| h);
    matches!(h, "localhost" | "127.0.0.1" | "[::1]")
}

fn allowed(req: &tiny_http::Request) -> Result<(), &'static str> {
    if *req.method() != tiny_http::Method::Post {
        return Err("POST only");
    }
    // A custom header cannot be sent cross-site without a CORS preflight, which this server never grants.
    if header(req, "X-Many-Write") != Some("1") {
        return Err("missing X-Many-Write header");
    }
    if !header(req, "Host").is_some_and(is_local) {
        return Err("bad Host");
    }
    if let Some(origin) = header(req, "Origin") {
        let host = origin.strip_prefix("http://").unwrap_or("");
        if !is_local(host) {
            return Err("cross-site request refused");
        }
    }
    Ok(())
}
