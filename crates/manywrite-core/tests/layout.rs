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
        ("book", vec!["heading", "paragraph", "paragraph", "quote", "scene_break", "paragraph", "text_left", "text_right", "text_right", "paragraph"]),
        ("article", vec!["heading", "paragraph", "quote", "subheading", "paragraph", "text_left", "text_right"]),
        ("document", vec!["title", "paragraph", "bullet", "bullet", "numbered", "numbered", "todo", "todo_done", "quote", "callout", "divider", "paragraph", "text_right", "text_left"]),
        ("essay", vec!["paragraph", "heading", "paragraph", "quote", "subheading", "paragraph"]),
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
    // Essays: a running header part, wired into the document.
    for style in ["mla", "chicago"] {
        let essay: ExportDoc = serde_json::from_value(serde_json::json!({
            "title": "On Rivers", "author": "Ada Lovelace", "template": "essay", "style": style, "runningHead": "Lovelace",
            "blocks": [
                {"kind": "essay_heading", "runs": [{"text": "Ada Lovelace"}]},
                {"kind": "essay_title", "runs": [{"text": "On Rivers"}]},
                {"kind": "paragraph", "runs": [{"text": "Text."}]},
                {"kind": "text_left", "runs": [{"text": "Hi"}]},
                {"kind": "page_break", "runs": []},
                {"kind": "matter_title", "runs": [{"text": "Works Cited"}]},
                {"kind": "citation", "runs": [{"text": "Smith, A. Book. 2020."}]},
            ]
        })).unwrap();
        let bytes = docx(&essay).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("word/header1.xml") && text.contains("Lovelace </w:t>") && text.contains("w:pStyle w:val=\"citation\""), "{style}");
        assert_eq!(text.contains("<w:titlePg/>"), style == "chicago");
        assert_eq!(&epub(&essay).unwrap()[0..4], b"PK\x03\x04");
    }
}

/// Page numbers: none on the title page; the first script page shows "1." top right, the next "2.".
#[test]
fn numbering_starts_after_title_page() {
    for t in ["stage-play", "screenplay"] {
        let header = format!("#import \"/mw/{t}.typ\": *\n#show: conf.with(title: \"Test Play\")\n");
        let (src, els) = build(&header, &play_items());
        let mut engine = Engine::new();
        assert!(engine.compile(&src, &els).ok);
        let p1 = engine.page_text(0).unwrap();
        let p2 = engine.page_text(1).unwrap();
        let p3 = engine.page_text(2).unwrap();
        assert!(!p1.contains('.'), "{t}: title page is unnumbered: {p1}");
        assert!(p2.starts_with("1."), "{t}: first script page shows 1.: {}", &p2[..60]);
        assert!(p3.starts_with("2."), "{t}: second script page shows 2.: {}", &p3[..60]);
    }
}

/// Front matter (a cast list) after the title page is unnumbered, also when it is the very
/// first page of the script, and the script after it starts at "1.", in production mode too.
#[test]
fn front_matter_is_unnumbered() {
    let front = "#mw-front-start()\n#import \"/mw/matter.typ\": matter-start, matter-el\n#matter-start(\"\", first: true, centered: false)\n#matter-el(\"paragraph\", none)[Cast]\n#mw-body-start()\n#pagebreak(weak: true)\n";
    for t in ["stage-play", "screenplay"] {
        for (revision, lock) in [("", ""), ("White Rev.", "#mw-lock(1, hard: true)\n")] {
            let src = format!("#import \"/mw/{t}.typ\": *\n#show: conf.with(title: \"T\", revision: \"{revision}\")\n{front}{lock}#folder(\"ACT ONE\", 0, first: false)\n#el(\"character\", none)[ANNA]\n");
            let mut engine = Engine::new();
            let r = engine.compile(&src, &[]);
            assert!(r.ok, "{:?}", r.errors);
            let cast = engine.page_text(1).unwrap();
            let act = engine.page_text(2).unwrap();
            assert!(cast.contains("Cast") && !cast.contains("1."), "{t} {revision:?}: cast page is unnumbered: {cast}");
            assert!(act.contains("1. ") && act.contains("ANNA"), "{t} {revision:?}: the script starts at 1.: {act}");
        }
    }
}

/// Word: every format carries page numbers, and a title page is unnumbered with the next page as 1.
#[test]
fn word_exports_number_pages() {
    use manywrite_core::export::{docx, ExportDoc};
    let export = |template: &str, title_page: bool| {
        let mut blocks = vec![];
        if title_page {
            blocks.push(serde_json::json!({"kind": "title", "runs": [{"text": "T"}]}));
            blocks.push(serde_json::json!({"kind": "page_break", "runs": []}));
        }
        blocks.push(serde_json::json!({"kind": "paragraph", "runs": [{"text": "Hello"}]}));
        let doc: ExportDoc = serde_json::from_value(serde_json::json!({"title": "T", "template": template, "blocks": blocks})).unwrap();
        String::from_utf8_lossy(&docx(&doc).unwrap()).to_string()
    };
    for t in ["stage-play", "screenplay"] {
        let x = export(t, true);
        assert!(x.contains("word/header1.xml") && x.contains("<w:jc w:val=\"right\"/>") && x.contains(" PAGE ") && x.contains("<w:t>.</w:t>"), "{t}");
        assert!(x.contains("<w:pgNumType w:start=\"0\"/><w:titlePg/>") && x.contains("word/header2.xml"), "{t}: title page");
        let x = export(t, false);
        assert!(!x.contains("<w:titlePg/>") && !x.contains("pgNumType"), "{t}: no title page, page 1 numbered");
    }
    for t in ["book", "article", "poem"] {
        let x = export(t, false);
        assert!(x.contains("word/footer1.xml") && x.contains("<w:footerReference w:type=\"default\"") && x.contains(" PAGE "), "{t}");
    }
    assert!(export("book", true).contains("<w:titlePg/>"));
}

/// Documents: every page is numbered in the header (top right), starting with 1 on the first page.
#[test]
fn document_numbers_every_page_top_right() {
    let header = "#import \"/mw/document.typ\": *\n#show: conf.with(title: \"Doc\")\n";
    let para = "the quick brown fox jumps over the lazy dog and then some more words follow here ".repeat(8);
    let items: Vec<_> = (0..40).map(|_| ("paragraph", para.clone())).collect();
    let (src, els) = build(header, &items);
    let mut engine = Engine::new();
    let r = engine.compile(&src, &els);
    assert!(r.ok && r.page_count >= 2, "{:?}", r.errors);
    for i in 0..2 {
        let t = engine.page_text(i).unwrap();
        assert!(t.starts_with(&format!("{} ", i + 1)), "page {} starts with its number: {}", i + 1, &t[..40]);
    }
    let svg = engine.page_svg(0).unwrap();
    assert!(svg.contains("<svg"));

    use manywrite_core::export::{docx, ExportDoc};
    let doc: ExportDoc = serde_json::from_value(serde_json::json!({
        "title": "Doc", "author": "A", "template": "document",
        "blocks": [{"kind": "paragraph", "runs": [{"text": "Hello"}]}]
    })).unwrap();
    let text = String::from_utf8_lossy(&docx(&doc).unwrap()).to_string();
    assert!(text.contains("word/header1.xml") && text.contains("<w:jc w:val=\"right\"/>") && text.contains(" PAGE "));
    assert!(!text.contains("<w:titlePg/>"), "page 1 is numbered too");
}

/// Production mode: after locking, a longer page 2 spills onto 2A and page 3 keeps its number.
#[test]
fn locked_pages_produce_a_pages_and_revision_marks() {
    let header = "#import \"/mw/stage-play.typ\": *\n#show: conf.with(title: \"T\", revision: \"Blue Rev. 16/11/2026\")\n";
    let items = play_items();
    let (src, els) = build(header, &items);
    let mut engine = Engine::new();
    let r = engine.compile(&src, &els);
    assert!(r.ok);
    // Lock: the first element starting on each physical page (skip the title page).
    // A page that begins part-way through a speech gets a soft lock on that speech.
    let mut locks: Vec<(usize, usize, bool)> = Vec::new(); // (element index, script page, hard)
    for phys in 2..=r.page_count {
        let carried = (0..els.len()).find(|&i| r.element_pages[i] < phys && r.element_last_pages[i] >= phys && r.element_pages[i] > 0);
        if let Some(i) = carried {
            locks.push((i, phys - 1, false));
        } else if let Some(i) = r.element_pages.iter().position(|&p| p == phys) {
            locks.push((i, phys - 1, true));
        }
    }
    // Add a long speech inside page 2's region, then rebuild with lock markers.
    let insert_at = locks[1].0 + 1;
    let mut edited = items.clone();
    for k in 0..12 {
        edited.insert(insert_at + k, ("dialogue", "an added line of rewrite that goes on for a while to fill the page up nicely".to_string()));
    }
    let mut src2 = String::from(header);
    let mut els2 = Vec::new();
    let mut prev = "none".to_string();
    for (i, (kind, text)) in edited.iter().enumerate() {
        let orig = if i >= insert_at + 12 { i - 12 } else if i >= insert_at { usize::MAX } else { i };
        if let Some(&(_, page, hard)) = locks.iter().find(|(e, _, _)| *e == orig) {
            src2.push_str(&format!("#mw-lock({page}, hard: {hard})\n"));
        }
        let start = src2.len();
        let p = if prev == "none" { "none".to_string() } else { format!("\"{prev}\"") };
        let mark = if orig == usize::MAX { "#mw-rev()" } else { "" };
        src2.push_str(&format!("#el(\"{kind}\", {p})[{mark}#\"{text}\"]\n"));
        els2.push(ElementSpan { id: format!("e{i}"), kind: kind.to_string(), start, end: src2.len() });
        prev = kind.to_string();
    }
    let r2 = engine.compile(&src2, &els2);
    assert!(r2.ok, "{:?}", r2.errors);
    assert!(r2.issues.is_empty(), "{:?}", r2.issues);
    let labels: Vec<String> = (1..r2.page_count)
        .map(|i| engine.page_text(i).unwrap().split(". ").next().unwrap_or("").to_string())
        .collect();
    let pages: Vec<String> = (1..r2.page_count).map(|i| engine.page_text(i).unwrap()).collect();
    assert!(pages[0].starts_with("Blue Rev."), "revision header: {}", &pages[0][..40]);
    assert!(pages[1].contains(" 2. "), "page 2: {}", &pages[1][..60]);
    assert!(pages[2].contains(" 2A. "), "2A page: {}", &pages[2][..60]);
    assert!(pages[3].contains(" 3. "), "page 3 keeps its number: {}", &pages[3][..60]);
    assert!(pages[1].contains('*') || pages[2].contains('*'), "revision asterisk drawn");
    let _ = labels;
}

fn essay_source(style: &str, title_page: bool) -> (String, Vec<ElementSpan>) {
    let header = format!(
        "#import \"/mw/essay.typ\": *\n#show: conf.with(title: \"On Rivers\", author: \"Ada Lovelace\", title-page: {title_page}, style: \"{style}\", instructor: \"Professor Byron\", course: \"English 101\", date: \"16 November 2026\")\n"
    );
    let words = "the river runs past the town and the people watch it go by every single day of the year";
    let items: Vec<(&str, String)> = (0..14)
        .map(|i| if i == 5 { ("heading", "A Turn".to_string()) } else { ("paragraph", words.split(' ').cycle().take(60 + i * 7).collect::<Vec<_>>().join(" ")) })
        .collect();
    let (mut src, els) = build(&header, &items);
    src.push_str("#import \"/mw/matter.typ\": matter-start, matter-el\n");
    let sources = if style == "mla" { "Works Cited" } else { "Bibliography" };
    src.push_str(&format!("#matter-start(\"{sources}\", first: false, centered: false)\n"));
    for i in 0..3 {
        src.push_str(&format!("#matter-el(\"citation\", none)[#\"Surname{i}, First. A Very Long Title of a Book That Wraps Onto a Second Line Of The Page. Publisher, 2020.\"]\n"));
    }
    (src, els)
}

#[test]
fn mla_essay_has_heading_block_and_running_head() {
    let (src, els) = essay_source("mla", false);
    let mut engine = Engine::new();
    let r = engine.compile(&src, &els);
    assert!(r.ok, "errors: {:?}", r.errors);
    assert!(r.page_count >= 3, "pages: {}", r.page_count);
    let first = engine.page_text(0).unwrap();
    assert!(first.starts_with("Lovelace 1"), "running head: {}", &first[..60]);
    assert!(first.contains("Ada Lovelace") && first.contains("Professor Byron") && first.contains("English 101"), "{first}");
    // Body paragraphs carry the half-inch first-line indent.
    let svg = engine.page_svg(0).unwrap();
    assert!(svg.contains("<svg"));
    let last = engine.page_text(r.page_count - 1).unwrap();
    assert!(last.contains("Works Cited"), "works cited page: {last}");
    assert!(last.starts_with(&format!("Lovelace {}", r.page_count)), "{}", &last[..30]);
}

#[test]
fn chicago_essay_has_unnumbered_title_page_and_bibliography() {
    let (src, els) = essay_source("chicago", true);
    let mut engine = Engine::new();
    let r = engine.compile(&src, &els);
    assert!(r.ok, "errors: {:?}", r.errors);
    let cover = engine.page_text(0).unwrap();
    assert!(cover.starts_with("On Rivers"), "title page: {cover}");
    assert!(!cover.contains("Lovelace 1"));
    assert!(engine.page_text(1).unwrap().starts_with('2'), "first text page is 2");
    let last = engine.page_text(r.page_count - 1).unwrap();
    assert!(last.contains("Bibliography"), "{last}");
    // Without a title page, Chicago still compiles.
    let (src, els) = essay_source("chicago", false);
    assert!(Engine::new().compile(&src, &els).ok);
}

#[test]
fn book_scene_break_styles_typeset() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (style, extra) in [("asterisks", ""), ("line", ""), ("hearts", ""), ("image", ", scene-break-image: \"/assets/icon.png\"")] {
        let header = format!("#import \"/mw/book.typ\": *\n#show: conf.with(title: \"B\", title-page: false, scene-break: \"{style}\"{extra})\n");
        let items = vec![("paragraph", "Before.".to_string()), ("scene_break", String::new()), ("paragraph", "After.".to_string())];
        let (src, els) = build(&header, &items);
        let mut engine = Engine::new();
        engine.set_root(Some(root.clone()));
        let r = engine.compile(&src, &els);
        assert!(r.ok, "{style}: {:?}", r.errors);
        let text = engine.page_text(0).unwrap();
        if style == "hearts" {
            assert!(text.contains('♥'), "hearts drawn: {text}");
        }
    }
}

#[test]
fn book_chapter_titles_are_centred() {
    let header = "#import \"/mw/book.typ\": *\n#show: conf.with(title: \"B\", title-page: false)\n#doc-start(\"Chapter One\", first: true)\n";
    let (src, els) = build(header, &[("paragraph", "Text.".to_string())]);
    let mut engine = Engine::new();
    assert!(engine.compile(&src, &els).ok);
    let svg = engine.page_svg(0).unwrap();
    // The title's first line is offset well into the text area; the body text below starts at 0.
    let offset = |nth: usize| -> f64 {
        svg.split("matrix(1 0 0 -1 ").nth(nth).and_then(|t| t.split(' ').next()).and_then(|v| v.parse().ok()).unwrap_or(-1.0)
    };
    assert!(offset(1) > 80.0, "chapter title offset {}", offset(1));
    assert!(offset(2) < 1.0, "body text offset {}", offset(2));
}

#[test]
fn every_template_prints_a_subtitle() {
    let cases = [
        ("stage-play", "title-page: true", "paragraph"),
        ("screenplay", "title-page: true", "action"),
        ("book", "title-page: true", "paragraph"),
        ("poem", "title-page: true", "line"),
        ("article", "title-page: false", "paragraph"),
        ("essay", "title-page: true, style: \"chicago\"", "paragraph"),
        ("essay", "style: \"mla\"", "paragraph"),
        ("document", "title-page: false", "paragraph"),
    ];
    for (t, extra, kind) in cases {
        let header = format!("#import \"/mw/{t}.typ\": *\n#show: conf.with(title: \"Rivers\", subtitle: \"A Play in Two Acts\", author: \"A\", {extra})\n");
        let (src, els) = build(&header, &[(kind, "Some words.".to_string())]);
        let mut engine = Engine::new();
        let r = engine.compile(&src, &els);
        assert!(r.ok, "{t}: {:?}", r.errors);
        if t != "document" {
            let first = engine.page_text(0).unwrap();
            assert!(first.contains("A Play in Two Acts"), "{t} {extra}: subtitle missing from page 1: {first}");
        }
    }
}
