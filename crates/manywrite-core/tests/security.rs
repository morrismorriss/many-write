//! Hostile or damaged input must produce an error, never crash the app,
//! and the config folder must not be escapable.
use manywrite_core::Core;
use serde_json::json;

fn tmp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("mw-sec-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn damaged_pdfs_are_errors_not_crashes() {
    let dir = tmp("pdf");
    let core = Core::new(dir.join("config"));
    // A real PDF from our own engine, then cut short at many points and scribbled on.
    let mut engine = manywrite_core::engine::Engine::new();
    assert!(engine.compile("#set page(width: 3in, height: 3in)\nHello *world*.", &[]).ok);
    let pdf = engine.pdf().unwrap();
    let path = dir.join("x.pdf");
    let mut variants: Vec<Vec<u8>> = vec![b"%PDF-1.7\n garbage".to_vec(), vec![0xff; 4096], Vec::new()];
    for cut in (0..pdf.len()).step_by((pdf.len() / 40).max(1)) {
        variants.push(pdf[..cut].to_vec());
    }
    for i in (0..pdf.len()).step_by((pdf.len() / 40).max(1)) {
        let mut v = pdf.clone();
        v[i] ^= 0x5a;
        variants.push(v);
    }
    for v in variants {
        std::fs::write(&path, &v).unwrap();
        // Ok or Err are both fine; returning at all is the test.
        let _ = core.call("import.pdf", &json!({ "path": path }));
    }
    // And the core still works afterwards.
    assert!(core.call("app.paths", &json!({})).is_ok());
}

#[test]
fn config_names_cannot_escape_the_config_folder() {
    let dir = tmp("cfg");
    let core = Core::new(dir.join("config"));
    for name in ["../outside.json", "themes/../../outside.json", "/etc/passwd", "..\\\\outside.json"] {
        assert!(core.call("config.write", &json!({ "name": name, "content": "x" })).is_err(), "{name}");
        assert!(core.call("config.read", &json!({ "name": name })).is_err(), "{name}");
    }
    assert!(!dir.join("outside.json").exists());
}

#[test]
fn typst_source_cannot_read_files_outside_the_project() {
    // Even hand-written Typst (not something the app generates) cannot reach outside the project.
    let dir = tmp("typst");
    std::fs::write(dir.join("secret.txt"), "TOP SECRET").unwrap();
    let project = dir.join("project");
    std::fs::create_dir_all(&project).unwrap();
    let mut engine = manywrite_core::engine::Engine::new();
    engine.set_root(Some(project));
    let r = engine.compile("#read(\"../secret.txt\")", &[]);
    assert!(!r.ok || !engine.page_text(0).unwrap_or_default().contains("SECRET"));
    let r = engine.compile("#read(\"/etc/hostname\")", &[]);
    assert!(!r.ok, "absolute paths resolve inside the project, so this file does not exist");
}
