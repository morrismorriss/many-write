//! One JSON command surface shared by the desktop app (Tauri) and the browser
//! dev server, so both run exactly the same code.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::engine::{ElementSpan, Engine};
use crate::{export, fs, import};

pub struct Core {
    preview: Mutex<Engine>,
    export: Mutex<Engine>,
    config_dir: PathBuf,
}

fn arg<T: for<'de> Deserialize<'de>>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("Bad argument `{key}`: {e}"))
}

fn path_arg(args: &Value, key: &str) -> Result<PathBuf, String> {
    let p: String = arg(args, key)?;
    if p.is_empty() {
        return Err(format!("Missing path `{key}`"));
    }
    Ok(PathBuf::from(p))
}

impl Core {
    pub fn new(config_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(config_dir.join("themes"));
        Self { preview: Mutex::new(Engine::new()), export: Mutex::new(Engine::new()), config_dir }
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    /// Run one command. Errors are user-facing strings.
    pub fn call(&self, cmd: &str, args: &Value) -> Result<Value, String> {
        match cmd {
            "app.paths" => {
                let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
                let docs = Path::new(&home).join("Documents");
                Ok(json!({
                    "home": home,
                    "documents": if docs.is_dir() { docs } else { PathBuf::from(&home) },
                    "config": self.config_dir,
                    "sep": std::path::MAIN_SEPARATOR.to_string(),
                }))
            }
            "fs.read" => Ok(serde_json::to_value(fs::read(&path_arg(args, "path")?)?).unwrap()),
            "fs.hashes" => {
                let paths: Vec<String> = arg(args, "paths")?;
                let hashes: Vec<Option<String>> = paths.iter().map(|p| fs::hash_of(Path::new(p))).collect();
                Ok(json!(hashes))
            }
            "fs.write" => {
                let path = path_arg(args, "path")?;
                let content: String = arg(args, "content")?;
                let expected: Option<String> = arg(args, "expectedHash")?;
                let force: Option<bool> = arg(args, "force")?;
                let hash = fs::write(&path, content.as_bytes(), expected.as_deref(), force.unwrap_or(false))?;
                Ok(json!({ "hash": hash }))
            }
            "fs.copy" => {
                let from = path_arg(args, "from")?;
                let to = path_arg(args, "to")?;
                let bytes = std::fs::read(&from).map_err(|e| format!("Could not read {}: {e}", from.display()))?;
                fs::write(&to, &bytes, None, true)?;
                self.preview.lock().unwrap().clear_files();
                Ok(Value::Null)
            }
            "fs.writeBase64" => {
                let data: String = arg(args, "data")?;
                let bytes = base64_decode(&data).ok_or("Invalid file data")?;
                fs::write(&path_arg(args, "path")?, &bytes, None, true)?;
                self.preview.lock().unwrap().clear_files();
                Ok(Value::Null)
            }
            "fs.readBase64" => {
                let path = path_arg(args, "path")?;
                let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
                Ok(json!(base64_encode(&bytes)))
            }
            "fs.exists" => Ok(json!(path_arg(args, "path")?.exists())),
            "fs.walk" => Ok(serde_json::to_value(fs::walk(&path_arg(args, "path")?)?).unwrap()),
            "fs.mkdir" => fs::mkdir(&path_arg(args, "path")?).map(|_| Value::Null),
            "fs.rename" => fs::rename(&path_arg(args, "from")?, &path_arg(args, "to")?).map(|_| Value::Null),
            "fs.trash" => {
                let dest = fs::trash(&path_arg(args, "path")?, &path_arg(args, "root")?)?;
                Ok(json!(dest))
            }
            "config.read" => {
                let name: String = arg(args, "name")?;
                Ok(serde_json::to_value(fs::read(&self.config_path(&name)?)?).unwrap())
            }
            "config.write" => {
                let name: String = arg(args, "name")?;
                let content: String = arg(args, "content")?;
                fs::write(&self.config_path(&name)?, content.as_bytes(), None, true)?;
                Ok(Value::Null)
            }
            "config.list" => {
                let dir: String = arg(args, "dir")?;
                let entries = fs::walk(&self.config_path(&dir)?)?;
                Ok(json!(entries.into_iter().filter(|e| !e.is_dir).map(|e| e.path).collect::<Vec<_>>()))
            }
            "config.delete" => {
                let name: String = arg(args, "name")?;
                std::fs::remove_file(self.config_path(&name)?).map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "typst.compile" => {
                let source: String = arg(args, "source")?;
                let elements: Vec<ElementSpan> = arg(args, "elements")?;
                let root: Option<String> = arg(args, "root")?;
                let mut engine = self.preview.lock().unwrap();
                engine.set_root(root.map(PathBuf::from));
                let report = engine.compile(&source, &elements);
                Ok(serde_json::to_value(report).unwrap())
            }
            "typst.page" => {
                let index: usize = arg(args, "index")?;
                let svg = self.preview.lock().unwrap().page_svg(index);
                Ok(json!({ "svg": svg }))
            }
            "typst.pageText" => {
                let index: usize = arg(args, "index")?;
                Ok(json!(self.preview.lock().unwrap().page_text(index)))
            }
            "import.docx" => {
                let path = path_arg(args, "path")?;
                let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
                Ok(serde_json::to_value(import::docx(&bytes)?).unwrap())
            }
            "import.pdf" => {
                let path = path_arg(args, "path")?;
                let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
                Ok(serde_json::to_value(import::pdf(bytes)?).unwrap())
            }
            "import.scrivener" => Ok(serde_json::to_value(import::scrivener(&path_arg(args, "path")?)?).unwrap()),
            "import.rtf" => {
                let path = path_arg(args, "path")?;
                let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
                Ok(serde_json::to_value(import::rtf(&String::from_utf8_lossy(&bytes))).unwrap())
            }
            "export.pdf" => {
                let source: String = arg(args, "source")?;
                let elements: Vec<ElementSpan> = arg(args, "elements")?;
                let path = path_arg(args, "path")?;
                let root: Option<String> = arg(args, "root")?;
                let mut engine = self.export.lock().unwrap();
                engine.set_root(root.map(PathBuf::from));
                engine.clear_files();
                let report = engine.compile(&source, &elements);
                if !report.ok {
                    let msg = report.errors.first().map(|e| e.message.clone()).unwrap_or_default();
                    return Err(format!("The document could not be typeset: {msg}"));
                }
                let bytes = engine.pdf()?;
                fs::write(&path, &bytes, None, true)?;
                Ok(serde_json::to_value(report).unwrap())
            }
            "export.docx" => {
                let doc: export::ExportDoc = arg(args, "doc")?;
                let bytes = export::docx(&doc)?;
                fs::write(&path_arg(args, "path")?, &bytes, None, true)?;
                Ok(Value::Null)
            }
            "export.epub" => {
                let doc: export::ExportDoc = arg(args, "doc")?;
                let bytes = export::epub(&doc)?;
                fs::write(&path_arg(args, "path")?, &bytes, None, true)?;
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown command: {cmd}")),
        }
    }

    /// Resolve a name inside the config folder, refusing anything that escapes it.
    fn config_path(&self, name: &str) -> Result<PathBuf, String> {
        if name.split(['/', '\\']).any(|seg| seg == ".." ) || Path::new(name).is_absolute() {
            return Err("Invalid config path".into());
        }
        Ok(self.config_dir.join(name))
    }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(B64[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let s = s.split_once(',').map_or(s, |(head, rest)| if head.contains("base64") { rest } else { s });
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut buf, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' | b'\n' | b'\r' | b' ' => continue,
            _ => return None,
        } as u32;
        buf = buf << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn base64_round_trip() {
        for data in [&b""[..], b"a", b"ab", b"abc", b"hello world\x00\xff"] {
            assert_eq!(super::base64_decode(&super::base64_encode(data)).unwrap(), data);
        }
        assert_eq!(super::base64_encode(b"Man"), "TWFu");
    }
}
