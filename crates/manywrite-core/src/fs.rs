//! Plain-file storage. Every write is atomic (temp file + rename) and checked
//! against the content hash the app last saw, so an edit made outside the app
//! is never silently overwritten.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// FNV-1a 64-bit, hex encoded. Stable across platforms and versions.
pub fn content_hash(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub exists: bool,
    pub content: String,
    pub hash: Option<String>,
}

pub fn read(path: &Path) -> Result<ReadResult, String> {
    match fs::read(path) {
        Ok(bytes) => {
            let hash = content_hash(&bytes);
            Ok(ReadResult { exists: true, content: String::from_utf8_lossy(&bytes).into_owned(), hash: Some(hash) })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(ReadResult { exists: false, content: String::new(), hash: None })
        }
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

pub fn hash_of(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|b| content_hash(&b))
}

/// Error prefix the frontend matches to show the conflict banner.
pub const CONFLICT: &str = "CONFLICT";

/// Write `content` atomically.
///
/// `expected`: the hash the caller believes is on disk (`None` = the caller
/// believes the file does not exist). Unless `force` is set, a mismatch is a
/// conflict and nothing is written.
pub fn write(path: &Path, content: &[u8], expected: Option<&str>, force: bool) -> Result<String, String> {
    if !force {
        let current = hash_of(path);
        if current.as_deref() != expected {
            return Err(format!(
                "{CONFLICT}: {} changed on disk since it was opened.",
                path.display()
            ));
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{name}.mw-tmp"));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
        f.write_all(content).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
        f.sync_all().ok();
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not save {}: {e}", path.display())
    })?;
    Ok(content_hash(content))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Path relative to the walked root, with `/` separators.
    pub path: String,
    pub is_dir: bool,
}

/// List everything under `root`, skipping hidden files and folders.
pub fn walk(root: &Path) -> Result<Vec<Entry>, String> {
    let mut out = Vec::new();
    fn rec(root: &Path, dir: &Path, out: &mut Vec<Entry>) -> std::io::Result<()> {
        let mut entries: Vec<_> = fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let p = e.path();
            let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
            let is_dir = e.file_type()?.is_dir();
            out.push(Entry { path: rel, is_dir });
            if is_dir {
                rec(root, &p, out)?;
            }
        }
        Ok(())
    }
    if root.is_dir() {
        rec(root, root, &mut out).map_err(|e| format!("Could not list {}: {e}", root.display()))?;
    }
    Ok(out)
}

pub fn mkdir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("Could not create {}: {e}", path.display()))
}

/// Rename or move. Refuses to replace something that already exists.
pub fn rename(from: &Path, to: &Path) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    // Case-only renames on case-insensitive file systems: `to` "exists" but is `from`.
    let same_file = to.exists()
        && fs::canonicalize(from).ok().is_some()
        && fs::canonicalize(from).ok() == fs::canonicalize(to).ok();
    if to.exists() && !same_file {
        return Err(format!("{} already exists.", to.display()));
    }
    if let Some(parent) = to.parent() {
        mkdir(parent)?;
    }
    if same_file {
        let tmp = to.with_file_name(format!(".mw-rename-{}", std::process::id()));
        fs::rename(from, &tmp).and_then(|_| fs::rename(&tmp, to))
    } else {
        fs::rename(from, to)
    }
    .map_err(|e| format!("Could not move {} to {}: {e}", from.display(), to.display()))
}

/// Move a file or folder into `<project>/.trash/` instead of deleting it.
pub fn trash(path: &Path, project_root: &Path) -> Result<PathBuf, String> {
    let trash = project_root.join(".trash");
    mkdir(&trash)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let dest = trash.join(format!("{stamp}-{name}"));
    rename(path, &dest)?;
    Ok(dest)
}
