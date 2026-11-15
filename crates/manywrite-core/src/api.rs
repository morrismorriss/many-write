//! One JSON command surface shared by the desktop app (Tauri) and the browser
//! dev server, so both run exactly the same code.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::engine::{ElementSpan, Engine};
use crate::{export, fs};

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
                let report = self.preview.lock().unwrap().compile(&source, &elements);
                Ok(serde_json::to_value(report).unwrap())
            }
            "typst.page" => {
                let index: usize = arg(args, "index")?;
                let svg = self.preview.lock().unwrap().page_svg(index);
                Ok(json!({ "svg": svg }))
            }
            "export.pdf" => {
                let source: String = arg(args, "source")?;
                let elements: Vec<ElementSpan> = arg(args, "elements")?;
                let path = path_arg(args, "path")?;
                let mut engine = self.export.lock().unwrap();
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
