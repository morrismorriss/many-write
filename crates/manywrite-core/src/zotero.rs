//! Zotero 7's local API is plain HTTP on this computer. The webview cannot call
//! it directly (Zotero sends no CORS headers for it), so the core opens the
//! socket and returns the JSON.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::Value;

const ADDRESS: &str = "127.0.0.1:23119";

fn urlencode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn get(path: &str) -> Result<String, String> {
    let addr: SocketAddr = ADDRESS.parse().map_err(|e| format!("Bad Zotero address: {e}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3))
        .map_err(|e| format!("Could not reach Zotero at {}. Is Zotero running? ({})", ADDRESS, e))?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\nZotero-Allowed-Request: true\r\nConnection: close\r\n\r\n",
        ADDRESS
    );
    stream.write_all(request.as_bytes()).map_err(|e| format!("Could not ask Zotero: {e}"))?;
    let mut answer = Vec::new();
    stream.read_to_end(&mut answer).map_err(|e| format!("Zotero did not answer: {e}"))?;
    let text = String::from_utf8_lossy(&answer);
    let (head, body) = text.split_once("\r\n\r\n").ok_or_else(|| "Zotero sent a malformed answer".to_string())?;
    let status = head.lines().next().unwrap_or_default();
    let code: u16 = status.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    if code < 200 || code >= 300 {
        return Err(format!("Zotero answered {status}"));
    }
    Ok(body.to_string())
}

/// Search the local library. Zotero must be running with its local API on.
pub fn search(query: &str, limit: usize) -> Result<Value, String> {
    let limit = limit.clamp(1, 100);
    let query = query.trim();
    let path = if query.is_empty() {
        format!("/api/users/0/items?limit={limit}&format=json")
    } else {
        format!("/api/users/0/items?q={}&limit={limit}&format=json", urlencode(query))
    };
    let body = get(&path)?;
    serde_json::from_str(&body).map_err(|e| format!("Zotero sent a bad answer: {e}"))
}

#[cfg(test)]
mod tests {
    use super::urlencode;

    #[test]
    fn encodes_a_search_query() {
        assert_eq!(urlencode("beloved 1987"), "beloved%201987");
        assert_eq!(urlencode("a&b=c"), "a%26b%3Dc");
        assert_eq!(urlencode("café"), "caf%C3%A9");
        assert_eq!(urlencode("A-z_0.9~"), "A-z_0.9~");
    }
}
