//! The embedded Typst engine.
//!
//! The live preview and PDF export both go through [`Engine::compile`], so
//! they always share fonts, templates and layout rules. Nothing here touches
//! the network: fonts and templates are compiled into the binary.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use typst::diag::{FileError, FileResult, SourceDiagnostic};
use typst::foundations::{Bytes, Datetime};
use typst::layout::Point;
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World, WorldExt};
use typst::layout::{Frame, FrameItem};
use typst_layout::PagedDocument;

/// Typst templates, one per format, available to documents as `/mw/<name>.typ`.
pub const TEMPLATES: &[(&str, &str)] = &[
    ("common.typ", include_str!("templates/common.typ")),
    ("stage-play.typ", include_str!("templates/stage-play.typ")),
    ("screenplay.typ", include_str!("templates/screenplay.typ")),
    ("poem.typ", include_str!("templates/poem.typ")),
    ("book.typ", include_str!("templates/book.typ")),
    ("article.typ", include_str!("templates/article.typ")),
    ("matter.typ", include_str!("templates/matter.typ")),
    ("document.typ", include_str!("templates/document.typ")),
    ("essay.typ", include_str!("templates/essay.typ")),
    ("bubbles.typ", include_str!("templates/bubbles.typ")),
];

const BUNDLED_FONTS: &[&[u8]] = &[
    include_bytes!("../fonts/CourierPrime-Regular.ttf"),
    include_bytes!("../fonts/CourierPrime-Bold.ttf"),
    include_bytes!("../fonts/CourierPrime-Italic.ttf"),
    include_bytes!("../fonts/CourierPrime-BoldItalic.ttf"),
];

struct FontStore {
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
}

fn font_store() -> &'static FontStore {
    static STORE: OnceLock<FontStore> = OnceLock::new();
    STORE.get_or_init(|| {
        let mut fonts = Vec::new();
        for data in typst_assets::fonts().chain(BUNDLED_FONTS.iter().copied()) {
            fonts.extend(Font::iter(Bytes::new(data)));
        }
        let book = LazyHash::new(FontBook::from_fonts(&fonts));
        FontStore { book, fonts }
    })
}

fn library() -> &'static LazyHash<Library> {
    static LIB: OnceLock<LazyHash<Library>> = OnceLock::new();
    LIB.get_or_init(|| LazyHash::new(Library::default()))
}

fn file_id(path: &str) -> FileId {
    RootedPath::new(VirtualRoot::Project, VirtualPath::new(path).expect("valid path")).intern()
}

/// A world with a single editable main file plus the bundled templates.
struct MwWorld {
    main: Source,
    templates: Vec<Source>,
    /// The open project's folder, for images the writer has added.
    root: Option<std::path::PathBuf>,
    files: std::sync::Mutex<std::collections::HashMap<FileId, Bytes>>,
}

impl MwWorld {
    fn new() -> Self {
        let templates = TEMPLATES
            .iter()
            .map(|(name, text)| Source::new(file_id(&format!("/mw/{name}")), (*text).to_string()))
            .collect();
        Self {
            main: Source::new(file_id("/main.typ"), String::new()),
            templates,
            root: None,
            files: Default::default(),
        }
    }
}

impl World for MwWorld {
    fn library(&self) -> &LazyHash<Library> {
        library()
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &font_store().book
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            return Ok(self.main.clone());
        }
        self.templates
            .iter()
            .find(|s| s.id() == id)
            .cloned()
            .ok_or_else(|| FileError::NotFound(std::path::PathBuf::from(format!("{id:?}"))))
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Ok(s) = self.source(id) {
            return Ok(Bytes::from_string(s.text().to_string()));
        }
        // Project files (images). Only plain paths inside the project folder.
        let root = self.root.as_ref().ok_or_else(|| FileError::NotFound(Default::default()))?;
        if let Some(b) = self.files.lock().unwrap_or_else(|e| e.into_inner()).get(&id) {
            return Ok(b.clone());
        }
        let rel = id.vpath().get_without_slash().to_string();
        if rel.split('/').any(|s| s == ".." || s.is_empty()) {
            return Err(FileError::AccessDenied);
        }
        let path = root.join(&rel);
        let data = std::fs::read(&path).map_err(|e| FileError::from_io(e, &path))?;
        let bytes = Bytes::new(data);
        self.files.lock().unwrap_or_else(|e| e.into_inner()).insert(id, bytes.clone());
        Ok(bytes)
    }

    fn font(&self, index: usize) -> Option<Font> {
        font_store().fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64;
        let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
        Datetime::from_ymd(y as i32, m as u8, d as u8)
    }
}

/// Days since 1970-01-01 to (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

/// One script/prose element in the generated Typst source, as a UTF-8 byte
/// range. The frontend sends these so layout problems can be traced back to
/// the line the writer typed.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementSpan {
    pub id: String,
    pub kind: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutIssue {
    pub id: String,
    pub kind: String,
    /// 1-based page number.
    pub page: usize,
    /// `orphan`, `widow` or `stranded`.
    pub problem: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub message: String,
    pub start: Option<usize>,
    pub end: Option<usize>,
    pub hints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompileReport {
    pub ok: bool,
    pub page_count: usize,
    /// Page size in points (width, height) of the first page.
    pub page_width: f64,
    pub page_height: f64,
    pub errors: Vec<Diagnostic>,
    pub warnings: Vec<Diagnostic>,
    /// For each element (same order as the request), the 1-based page its
    /// first line landed on, or 0 when it produced no visible text.
    pub element_pages: Vec<usize>,
    /// For each element, the 1-based page its last line landed on (0 = none).
    pub element_last_pages: Vec<usize>,
    pub issues: Vec<LayoutIssue>,
    pub compile_ms: u64,
}

/// Kinds that must never sit alone at the bottom of a page.
const KEEP_WITH_NEXT: &[&str] =
    &["character", "parenthetical", "scene_heading", "heading", "title", "folder_heading"];
/// Kinds whose paragraphs must not leave a single line on either side of a page break.
const FLOWING: &[&str] = &["dialogue", "direction", "action", "paragraph", "quote", "line"];

pub struct Engine {
    world: MwWorld,
    doc: Option<PagedDocument>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        Self { world: MwWorld::new(), doc: None }
    }

    /// Compile `source` and check the result against the layout rules.
    /// The laid-out document is kept for [`Engine::page_svg`] and [`Engine::pdf`].
    /// Set the project folder that images are loaded from.
    pub fn set_root(&mut self, root: Option<std::path::PathBuf>) {
        if self.world.root != root {
            self.world.root = root;
            self.world.files.lock().unwrap_or_else(|e| e.into_inner()).clear();
        }
    }

    /// Forget cached project files (after an image is added or replaced).
    pub fn clear_files(&mut self) {
        self.world.files.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    pub fn compile(&mut self, source: &str, elements: &[ElementSpan]) -> CompileReport {
        let started = std::time::Instant::now();
        self.world.main.replace(source);
        let warned = typst::compile::<PagedDocument>(&self.world);
        let mut report = CompileReport {
            warnings: warned.warnings.iter().map(|d| self.diag(d)).collect(),
            ..Default::default()
        };
        match warned.output {
            Ok(doc) => {
                report.ok = true;
                report.page_count = doc.pages().len();
                if let Some(first) = doc.pages().first() {
                    report.page_width = first.frame.width().to_pt();
                    report.page_height = first.frame.height().to_pt();
                }
                let (pages, last_pages, issues) = check_layout(&self.world, &doc, elements);
                report.element_pages = pages;
                report.element_last_pages = last_pages;
                report.issues = issues;
                self.doc = Some(doc);
            }
            Err(errors) => {
                report.errors = errors.iter().map(|d| self.diag(d)).collect();
                // Keep the previous document so the preview does not flash empty
                // while the writer is mid-edit.
            }
        }
        typst::comemo::evict(30);
        report.compile_ms = started.elapsed().as_millis() as u64;
        report
    }

    fn diag(&self, d: &SourceDiagnostic) -> Diagnostic {
        let range = self.world.range(d.span).filter(|_| d.span.id() == Some(self.world.main.id()));
        Diagnostic {
            message: d.message.to_string(),
            start: range.as_ref().map(|r| r.start),
            end: range.as_ref().map(|r| r.end),
            hints: d.hints.iter().map(|h| h.v.to_string()).collect(),
        }
    }

    pub fn page_count(&self) -> usize {
        self.doc.as_ref().map_or(0, |d| d.pages().len())
    }

    /// Render one page (0-based) of the last successful compile to SVG.
    pub fn page_svg(&self, index: usize) -> Option<String> {
        let page = self.doc.as_ref()?.pages().get(index)?;
        Some(typst_svg::svg(page, &typst_svg::SvgOptions::default()))
    }

    /// The text on one page (0-based), in reading order. For tests and diagnostics.
    pub fn page_text(&self, index: usize) -> Option<String> {
        let page = self.doc.as_ref()?.pages().get(index)?;
        let mut out = String::new();
        walk(&page.frame, Point::zero(), &mut |_, item| {
            if let FrameItem::Text(t) = item {
                out.push_str(&t.text);
                out.push(' ');
            }
        });
        Some(out)
    }

    /// Export the last successful compile to PDF.
    pub fn pdf(&self) -> Result<Vec<u8>, String> {
        let doc = self.doc.as_ref().ok_or("Nothing has been typeset yet.")?;
        typst_pdf::pdf(doc, &typst_pdf::PdfOptions::default()).map_err(|errs| {
            errs.iter().map(|e| e.message.to_string()).collect::<Vec<_>>().join("; ")
        })
    }
}

/// Where the text of each element ended up: page -> set of line baselines.
type Placement = BTreeMap<usize, BTreeSet<i64>>;

fn check_layout(
    world: &MwWorld,
    doc: &PagedDocument,
    elements: &[ElementSpan],
) -> (Vec<usize>, Vec<usize>, Vec<LayoutIssue>) {
    let mut placements: Vec<Placement> = vec![Placement::new(); elements.len()];
    let main = world.main.id();
    // Elements arrive in source order; make sure for the binary search.
    let mut order: Vec<usize> = (0..elements.len()).collect();
    order.sort_by_key(|&i| elements[i].start);

    let locate = |offset: usize| -> Option<usize> {
        let pos = order.partition_point(|&i| elements[i].start <= offset);
        if pos == 0 {
            return None;
        }
        let idx = order[pos - 1];
        (offset < elements[idx].end).then_some(idx)
    };

    for (page_no, page) in doc.pages().iter().enumerate() {
        walk(&page.frame, Point::zero(), &mut |pos, item| {
            let FrameItem::Text(text) = item else { return };
            // A text item is one run on one line; its first glyph with a span
            // into the main file tells us which element it belongs to.
            let owner = text.glyphs.iter().find_map(|g| {
                let span = g.span.0;
                if span.id() != Some(main) {
                    return None;
                }
                world.range(span).and_then(|r| locate(r.start))
            });
            if let Some(idx) = owner {
                // Round baselines to tenths of a point so runs on one line merge.
                let y = (pos.y.to_pt() * 10.0).round() as i64;
                placements[idx].entry(page_no + 1).or_default().insert(y);
            }
        });
    }

    let first_pages: Vec<usize> =
        placements.iter().map(|p| p.keys().next().copied().unwrap_or(0)).collect();
    let last_pages: Vec<usize> =
        placements.iter().map(|p| p.keys().last().copied().unwrap_or(0)).collect();

    let mut issues = Vec::new();
    for (i, el) in elements.iter().enumerate() {
        let placed = &placements[i];
        if placed.is_empty() {
            continue;
        }
        let first = *placed.keys().next().unwrap();
        let last = *placed.keys().last().unwrap();
        if FLOWING.contains(&el.kind.as_str()) && first != last {
            if placed[&first].len() == 1 {
                issues.push(LayoutIssue {
                    id: el.id.clone(),
                    kind: el.kind.clone(),
                    page: first,
                    problem: "orphan".into(),
                    message: format!("A single line of {} is stranded at the bottom of page {first}.", el.kind),
                });
            }
            if placed[&last].len() == 1 {
                issues.push(LayoutIssue {
                    id: el.id.clone(),
                    kind: el.kind.clone(),
                    page: last,
                    problem: "widow".into(),
                    message: format!("A single line of {} is stranded at the top of page {last}.", el.kind),
                });
            }
        }
        if KEEP_WITH_NEXT.contains(&el.kind.as_str()) {
            // The next element in source order that produced any text.
            let next = (i + 1..elements.len()).find(|&j| !placements[j].is_empty());
            if let Some(j) = next {
                let next_first = *placements[j].keys().next().unwrap();
                if next_first > last {
                    issues.push(LayoutIssue {
                        id: el.id.clone(),
                        kind: el.kind.clone(),
                        page: last,
                        problem: "stranded".into(),
                        message: format!(
                            "The {} at the bottom of page {last} is separated from what follows it.",
                            el.kind.replace('_', " ")
                        ),
                    });
                }
            }
        }
    }
    (first_pages, last_pages, issues)
}

fn walk(frame: &Frame, offset: Point, f: &mut impl FnMut(Point, &FrameItem)) {
    for (pos, item) in frame.items() {
        let at = offset + *pos;
        if let FrameItem::Group(group) = item {
            // Templates only translate groups; ignore scale/rotation.
            let t = group.transform;
            walk(&group.frame, at + Point::new(t.tx, t.ty), f);
        } else {
            f(at, item);
        }
    }
}

pub(crate) fn civil_from_days_pub(days: i64) -> (i64, u32, u32) {
    civil_from_days(days)
}
