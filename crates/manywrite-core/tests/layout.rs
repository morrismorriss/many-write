use manywrite_core::engine::{ElementSpan, Engine};

/// Build a Typst document the same way the frontend generator does.
fn build(header: &str, items: &[(&str, String)]) -> (String, Vec<ElementSpan>) {
    let mut src = String::from(header);
    let mut els = Vec::new();
    let mut prev = "none".to_string();
    for (i, (kind, text)) in items.iter().enumerate() {
        let start = src.len();
        let p = if prev == "none" { "none".to_string() } else { format!("\"{prev}\"") };
        src.push_str(&format!("#el(\"{kind}\", {p})[#\"{}\"]\n", text.replace('\\', "\\\\").replace('"', "\\\"")));
        els.push(ElementSpan { id: format!("e{i}"), kind: kind.to_string(), start, end: src.len() });
        prev = kind.to_string();
    }
    (src, els)
}

fn play_items() -> Vec<(&'static str, String)> {
    let mut items = vec![("scene_heading", "Scene 1".to_string())];
    let words = "the quick brown fox jumps over the lazy dog and then some more words follow here";
    for i in 0..120 {
        items.push(("character", if i % 2 == 0 { "ANNA".into() } else { "BEN".into() }));
        if i % 7 == 3 {
            items.push(("parenthetical", "(quietly)".into()));
        }
        // Vary dialogue length from 1 to 9 lines so breaks land everywhere.
        let n = (i * 5) % 70 + 3;
        items.push(("dialogue", words.split(' ').cycle().take(n).collect::<Vec<_>>().join(" ")));
        if i % 5 == 0 {
            items.push(("direction", words.split(' ').cycle().take((i * 3) % 40 + 4).collect::<Vec<_>>().join(" ")));
        }
    }
    items
}

#[test]
fn stage_play_has_no_orphans_or_stranded_cues() {
    let header = "#import \"/mw/stage-play.typ\": *\n#show: conf.with(title: \"Test Play\", author: \"A. Writer\")\n";
    let (src, els) = build(header, &play_items());
    let mut engine = Engine::new();
    let report = engine.compile(&src, &els);
    assert!(report.ok, "errors: {:?}", report.errors);
    assert!(report.page_count > 10, "pages: {}", report.page_count);
    assert!(report.issues.is_empty(), "issues: {:#?}", report.issues);
    // Every element was located, and the first is after the title page.
    assert!(report.element_pages.iter().all(|&p| p > 0));
    assert_eq!(report.element_pages[0], 2);
    let pdf = engine.pdf().unwrap();
    assert!(pdf.starts_with(b"%PDF"));
    let svg = engine.page_svg(1).unwrap();
    assert!(svg.contains("<svg"));
    eprintln!("{} pages in {} ms", report.page_count, report.compile_ms);
}

#[test]
fn screenplay_has_no_orphans_or_stranded_cues() {
    let header = "#import \"/mw/screenplay.typ\": *\n#show: conf.with(title: \"Test\")\n";
    let items: Vec<_> = play_items()
        .into_iter()
        .map(|(k, t)| (if k == "direction" { "action" } else { k }, t))
        .collect();
    let (src, els) = build(header, &items);
    let report = Engine::new().compile(&src, &els);
    assert!(report.ok, "errors: {:?}", report.errors);
    assert!(report.issues.is_empty(), "issues: {:#?}", report.issues);
}

/// With the rules switched off the checker must find problems; this proves
/// the "No orphan lines" status is a real measurement, not a constant.
#[test]
fn checker_detects_problems_when_rules_are_off() {
    let header = r#"
#set page(height: 3in, width: 4in, margin: 0.5in)
#set text(size: 12pt, costs: (orphan: 0%, widow: 0%))
#set par(leading: 0.5em, spacing: 0.5em)
#let el(kind, prev, body) = block(above: 0.5em, below: 0pt, body)
"#;
    let (src, els) = build(header, &play_items());
    let report = Engine::new().compile(&src, &els);
    assert!(report.ok, "errors: {:?}", report.errors);
    let kinds: std::collections::BTreeSet<_> = report.issues.iter().map(|i| i.problem.as_str()).collect();
    assert!(kinds.contains("stranded"), "{kinds:?}");
    assert!(kinds.contains("orphan") || kinds.contains("widow"), "{kinds:?}");
}

#[test]
fn every_template_compiles() {
    for (t, kinds) in [
        ("poem", vec!["title", "line", "line"]),
        ("book", vec!["heading", "paragraph", "paragraph", "quote", "scene_break", "paragraph"]),
        ("article", vec!["heading", "paragraph", "quote", "subheading", "paragraph"]),
    ] {
        let header = format!("#import \"/mw/{t}.typ\": *\n#show: conf.with(title: \"T\", author: \"A\")\n#doc-start(\"Chapter\", first: true)\n");
        let items: Vec<_> = kinds.iter().map(|k| (*k, "Some words for the text here.".to_string())).collect();
        let (src, els) = build(&header, &items);
        let report = Engine::new().compile(&src, &els);
        assert!(report.ok, "{t}: {:?}", report.errors);
        assert!(report.issues.is_empty(), "{t}: {:?}", report.issues);
    }
}

#[test]
fn exports_are_valid_zips() {
    use manywrite_core::export::{docx, epub, ExportDoc};
    let doc: ExportDoc = serde_json::from_value(serde_json::json!({
        "title": "T & <T>", "author": "A", "template": "book",
        "blocks": [
            {"kind": "chapter", "runs": [{"text": "One"}]},
            {"kind": "paragraph", "runs": [{"text": "Hello "}, {"text": "world", "italic": true}]},
        ]
    })).unwrap();
    for bytes in [docx(&doc).unwrap(), epub(&doc).unwrap()] {
        assert_eq!(&bytes[0..4], b"PK\x03\x04");
    }
}

/// Page numbers: none on the title page or the first script page; the next shows "2.".
#[test]
fn numbering_starts_after_title_page() {
    let header = "#import \"/mw/stage-play.typ\": *\n#show: conf.with(title: \"Test Play\")\n";
    let (src, els) = build(header, &play_items());
    let mut engine = Engine::new();
    assert!(engine.compile(&src, &els).ok);
    let p2 = engine.page_text(1).unwrap();
    let p3 = engine.page_text(2).unwrap();
    assert!(!p2.contains("1."), "first script page is unnumbered: {}", &p2[..60]);
    assert!(p3.starts_with("2."), "second script page shows 2.: {}", &p3[..60]);
}
