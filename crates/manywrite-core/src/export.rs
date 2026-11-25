//! Word (.docx) and EPUB export, written directly (no Pandoc needed).
//!
//! The frontend sends a neutral block list; each template maps block kinds to
//! paragraph styles. Word re-paginates on open, so DOCX carries "keep with
//! next" and widow/orphan control flags rather than fixed page breaks.

use std::collections::HashMap;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub text: String,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub underline: bool,
    /// Chicago notes: the id of the note this run points at.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    #[serde(default)]
    pub runs: Vec<Run>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub kind: String,
    #[serde(default)]
    pub runs: Vec<Run>,
    /// A name for the e-book's table of contents when the block itself prints nothing
    /// (a front or back matter page, whose title is left off the page).
    #[serde(default)]
    pub label: Option<String>,
    /// List items: how many levels deep the item is nested (0 = not nested).
    #[serde(default)]
    pub indent: u32,
    /// Scripts: the speaker's column when two to six characters speak at once (0 = leftmost).
    #[serde(default)]
    pub sim: Option<u32>,
}

/** The cue that opens a simultaneous row: two to six characters speak together. */
fn starts_row(block: &Block) -> bool {
    block.kind == "character" && block.sim == Some(0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDoc {
    pub title: String,
    #[serde(default)]
    pub author: String,
    /// Template id: stage-play, screenplay, poem, book, article, essay, document.
    pub template: String,
    #[serde(default = "default_lang")]
    pub lang: String,
    /// A stable identifier for the project (used for the EPUB id).
    #[serde(default)]
    pub id: String,
    pub blocks: Vec<Block>,
    /// Essays: "mla", "chicago" (author–date) or "chicago-notes".
    #[serde(default)]
    pub style: String,
    /// Essays: text before the page number in the running header (MLA: the surname).
    #[serde(default)]
    pub running_head: String,
    /// Chicago notes: "footnotes" or "endnotes"; empty when notes are not printed.
    #[serde(default)]
    pub note_placement: String,
    /// Chicago notes: the note texts, keyed by the ids on the note runs.
    #[serde(default)]
    pub notes: Vec<Note>,
}

fn default_lang() -> String {
    "en".into()
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // Control characters are not allowed in XML 1.0.
            c if (c as u32) < 0x20 && c != '\n' && c != '\t' => {}
            c => out.push(c),
        }
    }
    out
}

/// One run of text as WordprocessingML. Note runs are handled by the caller.
fn text_run_xml(run: &Run) -> String {
    let mut rpr = String::new();
    if run.bold { rpr.push_str("<w:b/>"); }
    if run.italic { rpr.push_str("<w:i/>"); }
    if run.underline { rpr.push_str("<w:u w:val=\"single\"/>"); }
    let mut out = String::from("<w:r>");
    if !rpr.is_empty() { out.push_str(&format!("<w:rPr>{rpr}</w:rPr>")); }
    for (i, part) in run.text.split('\n').enumerate() {
        if i > 0 { out.push_str("<w:br/>"); }
        out.push_str(&format!("<w:t xml:space=\"preserve\">{}</w:t>", xml_escape(part)));
    }
    out.push_str("</w:r>");
    out
}

// ---------------------------------------------------------------- zip writer

fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (i, slot) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
        *slot = c;
    }
    let mut crc = 0xFFFF_FFFFu32;
    for b in data {
        crc = table[((crc ^ *b as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

/// A minimal store-only ZIP writer; enough for DOCX and EPUB containers.
pub(crate) fn zip_store(files: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let offset = out.len() as u32;
        let crc = crc32(data);
        let size = data.len() as u32;
        let n = name.as_bytes();
        // Local file header.
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&0x0800u16.to_le_bytes()); // flags: UTF-8 names
        out.extend_from_slice(&0u16.to_le_bytes()); // method: store
        out.extend_from_slice(&0u16.to_le_bytes()); // time
        out.extend_from_slice(&0x21u16.to_le_bytes()); // date (1980-01-01)
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&(n.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(n);
        out.extend_from_slice(data);
        // Central directory entry.
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&0x0800u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0x21u16.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&(n.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0u8; 12]); // extra, comment, disk, attrs
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(n);
    }
    let cd_offset = out.len() as u32;
    let cd_size = central.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

// ---------------------------------------------------------------------- DOCX

/// Paragraph style: (id, name, pPr, rPr).
struct Style {
    id: &'static str,
    ppr: &'static str,
    rpr: &'static str,
}

fn script_styles(screenplay: bool) -> Vec<Style> {
    // 1 inch = 1440 twips; 12pt line = 240 twips.
    if screenplay {
        vec![
            Style { id: "scene_heading", ppr: "<w:keepNext/><w:spacing w:before=\"480\" w:after=\"0\"/>", rpr: "<w:caps/>" },
            Style { id: "action", ppr: "<w:spacing w:before=\"240\" w:after=\"0\"/>", rpr: "" },
            Style { id: "direction", ppr: "<w:spacing w:before=\"240\" w:after=\"0\"/>", rpr: "" },
            Style { id: "character", ppr: "<w:keepNext/><w:spacing w:before=\"240\" w:after=\"0\"/><w:ind w:left=\"3168\"/>", rpr: "<w:caps/>" },
            Style { id: "parenthetical", ppr: "<w:keepNext/><w:spacing w:before=\"0\" w:after=\"0\"/><w:ind w:left=\"2304\" w:right=\"2880\"/>", rpr: "" },
            Style { id: "dialogue", ppr: "<w:spacing w:before=\"0\" w:after=\"0\"/><w:ind w:left=\"1440\" w:right=\"2160\"/>", rpr: "" },
            Style { id: "transition", ppr: "<w:spacing w:before=\"240\" w:after=\"0\"/><w:jc w:val=\"right\"/>", rpr: "<w:caps/>" },
            Style { id: "song", ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"480\" w:after=\"0\"/>", rpr: "<w:b/><w:u w:val=\"single\"/><w:caps/>" },
            Style { id: "lyric", ppr: "<w:spacing w:before=\"0\" w:after=\"0\"/><w:ind w:left=\"1440\" w:right=\"2160\"/>", rpr: "<w:i/>" },
            Style { id: "folder_heading", ppr: "<w:keepNext/><w:pageBreakBefore/><w:jc w:val=\"center\"/><w:spacing w:after=\"480\"/>", rpr: "<w:b/><w:u w:val=\"single\"/><w:caps/>" },
            Style { id: "matter_title", ppr: "<w:keepNext/><w:pageBreakBefore/><w:jc w:val=\"center\"/><w:spacing w:before=\"960\" w:after=\"480\"/>", rpr: "<w:b/><w:caps/>" },
            Style { id: "matter_paragraph", ppr: "<w:spacing w:before=\"200\" w:after=\"0\"/>", rpr: "" },
            Style { id: "centered", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"200\" w:after=\"0\"/>", rpr: "" },
            Style { id: "title", ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"2880\" w:after=\"480\"/>", rpr: "<w:b/><w:caps/>" },
            Style { id: "heading", ppr: "<w:keepNext/><w:spacing w:before=\"360\" w:after=\"120\"/>", rpr: "<w:b/>" },
            Style { id: "subheading", ppr: "<w:keepNext/><w:spacing w:before=\"240\" w:after=\"120\"/>", rpr: "<w:i/>" },
            Style { id: "quote", ppr: "<w:spacing w:before=\"120\" w:after=\"120\"/><w:ind w:left=\"720\" w:right=\"720\"/>", rpr: "<w:i/>" },
            Style { id: "scene_break", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"240\" w:after=\"240\"/>", rpr: "" },
            Style { id: "citation", ppr: "<w:spacing w:before=\"120\" w:after=\"0\"/><w:ind w:left=\"720\" w:hanging=\"720\"/>", rpr: "" },
        ]
    } else {
        vec![
            Style { id: "scene_heading", ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"480\" w:after=\"0\"/>", rpr: "<w:b/><w:caps/>" },
            Style { id: "character", ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"240\" w:after=\"0\"/>", rpr: "<w:caps/>" },
            Style { id: "parenthetical", ppr: "<w:keepNext/><w:spacing w:before=\"0\" w:after=\"0\"/><w:ind w:left=\"2160\" w:right=\"2160\"/>", rpr: "<w:i/>" },
            Style { id: "dialogue", ppr: "<w:spacing w:before=\"0\" w:after=\"0\"/>", rpr: "" },
            Style { id: "direction", ppr: "<w:spacing w:before=\"240\" w:after=\"0\"/><w:ind w:left=\"3600\"/>", rpr: "<w:i/>" },
            Style { id: "action", ppr: "<w:spacing w:before=\"240\" w:after=\"0\"/><w:ind w:left=\"3600\"/>", rpr: "<w:i/>" },
            Style { id: "transition", ppr: "<w:spacing w:before=\"240\" w:after=\"0\"/><w:jc w:val=\"right\"/>", rpr: "<w:caps/>" },
            Style { id: "song", ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"480\" w:after=\"0\"/>", rpr: "<w:b/><w:u w:val=\"single\"/><w:caps/>" },
            Style { id: "lyric", ppr: "<w:spacing w:before=\"0\" w:after=\"0\"/><w:ind w:left=\"720\"/>", rpr: "<w:i/>" },
            Style { id: "folder_heading", ppr: "<w:keepNext/><w:pageBreakBefore/><w:jc w:val=\"center\"/><w:spacing w:after=\"480\"/>", rpr: "<w:b/><w:u w:val=\"single\"/><w:caps/>" },
            Style { id: "matter_title", ppr: "<w:keepNext/><w:pageBreakBefore/><w:jc w:val=\"center\"/><w:spacing w:before=\"960\" w:after=\"480\"/>", rpr: "<w:b/><w:caps/>" },
            Style { id: "matter_paragraph", ppr: "<w:spacing w:before=\"200\" w:after=\"0\"/>", rpr: "" },
            Style { id: "centered", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"200\" w:after=\"0\"/>", rpr: "" },
            Style { id: "title", ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"2880\" w:after=\"480\"/>", rpr: "<w:b/><w:caps/>" },
            Style { id: "heading", ppr: "<w:keepNext/><w:spacing w:before=\"360\" w:after=\"120\"/>", rpr: "<w:b/>" },
            Style { id: "subheading", ppr: "<w:keepNext/><w:spacing w:before=\"240\" w:after=\"120\"/>", rpr: "<w:i/>" },
            Style { id: "quote", ppr: "<w:spacing w:before=\"120\" w:after=\"120\"/><w:ind w:left=\"720\" w:right=\"720\"/>", rpr: "<w:i/>" },
            Style { id: "scene_break", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"240\" w:after=\"240\"/>", rpr: "" },
            Style { id: "citation", ppr: "<w:spacing w:before=\"120\" w:after=\"0\"/><w:ind w:left=\"720\" w:hanging=\"720\"/>", rpr: "" },
        ]
    }
}

fn prose_styles(book: bool) -> Vec<Style> {
    vec![
        Style { id: "matter_title", ppr: "<w:keepNext/><w:pageBreakBefore/><w:jc w:val=\"center\"/><w:spacing w:before=\"960\" w:after=\"480\"/>", rpr: "<w:b/><w:caps/>" },
        Style { id: "matter_paragraph", ppr: "<w:spacing w:before=\"200\" w:after=\"0\"/>", rpr: "" },
        Style { id: "centered", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"200\" w:after=\"0\"/>", rpr: "" },
        Style { id: "title", ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"1440\" w:after=\"480\"/>", rpr: "<w:sz w:val=\"40\"/>" },
        Style { id: "chapter", ppr: "<w:keepNext/><w:pageBreakBefore/><w:jc w:val=\"center\"/><w:spacing w:before=\"1440\" w:after=\"480\"/><w:outlineLvl w:val=\"0\"/>", rpr: "<w:sz w:val=\"32\"/>" },
        Style { id: "folder_heading", ppr: "<w:keepNext/><w:pageBreakBefore/><w:jc w:val=\"center\"/><w:spacing w:before=\"2880\" w:after=\"480\"/>", rpr: "<w:smallCaps/><w:sz w:val=\"36\"/>" },
        Style { id: "heading", ppr: "<w:keepNext/><w:spacing w:before=\"360\" w:after=\"120\"/><w:outlineLvl w:val=\"1\"/>", rpr: "<w:b/><w:sz w:val=\"28\"/>" },
        Style { id: "subheading", ppr: "<w:keepNext/><w:spacing w:before=\"240\" w:after=\"120\"/><w:outlineLvl w:val=\"2\"/>", rpr: "<w:b/>" },
        Style {
            id: "paragraph",
            ppr: if book { "<w:spacing w:before=\"0\" w:after=\"0\" w:line=\"300\" w:lineRule=\"auto\"/><w:ind w:firstLine=\"360\"/><w:jc w:val=\"both\"/>" } else { "<w:spacing w:before=\"0\" w:after=\"200\" w:line=\"300\" w:lineRule=\"auto\"/>" },
            rpr: "",
        },
        Style { id: "quote", ppr: "<w:spacing w:before=\"120\" w:after=\"120\"/><w:ind w:left=\"720\" w:right=\"720\"/>", rpr: "<w:i/>" },
        Style { id: "scene_break", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"240\" w:after=\"240\"/>", rpr: "" },
        Style { id: "citation", ppr: "<w:spacing w:before=\"120\" w:after=\"0\"/><w:ind w:left=\"720\" w:hanging=\"720\"/>", rpr: "" },
        Style { id: "text_left", ppr: "<w:keepLines/><w:spacing w:before=\"80\" w:after=\"80\"/><w:ind w:left=\"0\" w:right=\"3240\"/><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"E9E9EB\"/>", rpr: "" },
        Style { id: "text_right", ppr: "<w:keepLines/><w:spacing w:before=\"80\" w:after=\"80\"/><w:ind w:left=\"3240\" w:right=\"0\"/><w:jc w:val=\"right\"/><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"D6E6FF\"/>", rpr: "" },
        Style { id: "list", ppr: "<w:spacing w:before=\"60\" w:after=\"60\"/><w:ind w:left=\"540\" w:hanging=\"360\"/>", rpr: "" },
        // Poem lines: never justified, hanging indent for wrapped lines.
        Style { id: "line", ppr: "<w:spacing w:before=\"0\" w:after=\"0\"/><w:ind w:left=\"720\" w:hanging=\"720\"/>", rpr: "" },
        Style { id: "stanza_break", ppr: "<w:spacing w:before=\"0\" w:after=\"0\"/>", rpr: "" },
    ]
}

/// Essays (MLA and Chicago): 12pt, double-spaced (480 = 2 lines), half-inch indents.
fn essay_styles(chicago: bool) -> Vec<Style> {
    vec![
        Style { id: "paragraph", ppr: "<w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/><w:ind w:firstLine=\"720\"/>", rpr: "" },
        Style { id: "essay_heading", ppr: "<w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/>", rpr: "" },
        Style { id: "essay_title", ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/>", rpr: "" },
        Style { id: "essay_byline", ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/>", rpr: "" },
        Style { id: "essay_cover_title", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"3168\" w:after=\"0\"/>", rpr: "" },
        Style { id: "essay_cover_details", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"5760\" w:after=\"0\"/>", rpr: "" },
        Style { id: "essay_cover_line", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"0\" w:after=\"0\"/>", rpr: "" },
        Style {
            id: "heading",
            ppr: if chicago {
                "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/><w:outlineLvl w:val=\"1\"/>"
            } else {
                "<w:keepNext/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/><w:outlineLvl w:val=\"1\"/>"
            },
            rpr: "<w:b/>",
        },
        Style { id: "subheading", ppr: "<w:keepNext/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/><w:outlineLvl w:val=\"2\"/>", rpr: "<w:i/>" },
        Style {
            id: "quote",
            ppr: if chicago {
                "<w:spacing w:before=\"240\" w:after=\"240\" w:line=\"240\" w:lineRule=\"auto\"/><w:ind w:left=\"720\"/>"
            } else {
                "<w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/><w:ind w:left=\"720\"/>"
            },
            rpr: "",
        },
        Style { id: "scene_break", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/>", rpr: "" },
        Style {
            id: "matter_title",
            ppr: if chicago {
                "<w:keepNext/><w:pageBreakBefore/><w:jc w:val=\"center\"/><w:spacing w:before=\"0\" w:after=\"480\"/>"
            } else {
                "<w:keepNext/><w:pageBreakBefore/><w:jc w:val=\"center\"/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/>"
            },
            rpr: "",
        },
        Style { id: "matter_paragraph", ppr: "<w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/><w:ind w:firstLine=\"720\"/>", rpr: "" },
        Style { id: "centered", ppr: "<w:jc w:val=\"center\"/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/>", rpr: "" },
        Style {
            id: "citation",
            ppr: if chicago {
                "<w:spacing w:before=\"0\" w:after=\"240\" w:line=\"240\" w:lineRule=\"auto\"/><w:ind w:left=\"720\" w:hanging=\"720\"/>"
            } else {
                "<w:spacing w:before=\"0\" w:after=\"0\" w:line=\"480\" w:lineRule=\"auto\"/><w:ind w:left=\"720\" w:hanging=\"720\"/>"
            },
            rpr: "",
        },
    ]
}

/// The running header (essays): right-aligned, `head` then the page number (a PAGE field).
fn essay_header(head: &str) -> String {
    let lead = if head.is_empty() { String::new() } else { format!("<w:r><w:t xml:space=\"preserve\">{} </w:t></w:r>", xml_escape(head)) };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr>{lead}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>"#
    )
}

/// Word page numbers for the formats other than essays: a PAGE field in a header or footer.
struct PageNumbers {
    /// Centred in the footer, or right-aligned in the header.
    footer: bool,
    /// Printed after the number ("." for scripts).
    suffix: &'static str,
    /// The first page is a title page: no number there, and the next page is 1.
    title_page: bool,
}

impl PageNumbers {
    fn kind(&self) -> (&'static str, &'static str) {
        if self.footer { ("footer", "ftr") } else { ("header", "hdr") }
    }

    /// Adds the references (and, after a title page, the numbering restart) to a section.
    fn wire(&self, sect: &str) -> String {
        let (kind, _) = self.kind();
        let mut refs = format!(r#"<w:{kind}Reference w:type="default" r:id="rId2"/>"#);
        let mut tail = String::new();
        if self.title_page {
            refs.push_str(&format!(r#"<w:{kind}Reference w:type="first" r:id="rId3"/>"#));
            tail.push_str(r#"<w:pgNumType w:start="0"/><w:titlePg/>"#);
        }
        sect.replacen("<w:sectPr>", &format!("<w:sectPr>{refs}"), 1).replacen("</w:sectPr>", &format!("{tail}</w:sectPr>"), 1)
    }

    fn content_types(&self) -> String {
        let (kind, _) = self.kind();
        let n = if self.title_page { 2 } else { 1 };
        (1..=n)
            .map(|i| format!(r#"<Override PartName="/word/{kind}{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>"#))
            .collect()
    }

    fn rels(&self) -> String {
        let (kind, _) = self.kind();
        let n = if self.title_page { 2 } else { 1 };
        (1..=n)
            .map(|i| format!(r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}" Target="{kind}{i}.xml"/>"#, i + 1))
            .collect()
    }

    fn parts(&self) -> Vec<(&'static str, Vec<u8>)> {
        let (_, tag) = self.kind();
        let ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        let jc = if self.footer { "center" } else { "right" };
        let suffix = if self.suffix.is_empty() { String::new() } else { format!("<w:r><w:t>{}</w:t></w:r>", self.suffix) };
        let main = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:{tag} xmlns:w="{ns}"><w:p><w:pPr><w:jc w:val="{jc}"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>{suffix}</w:p></w:{tag}>"#
        );
        let (one, two) = if self.footer { ("word/footer1.xml", "word/footer2.xml") } else { ("word/header1.xml", "word/header2.xml") };
        let mut parts = vec![(one, main.into_bytes())];
        if self.title_page {
            // The title page's own header or footer: empty.
            parts.push((two, format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:{tag} xmlns:w="{ns}"><w:p/></w:{tag}>"#).into_bytes()));
        }
        parts
    }
}

pub fn docx(doc: &ExportDoc) -> Result<Vec<u8>, String> {
    let script = matches!(doc.template.as_str(), "stage-play" | "screenplay");
    let essay = doc.template == "essay";
    let chicago = essay && (doc.style == "chicago" || doc.style == "chicago-notes");
    let mut styles = if essay {
        essay_styles(chicago)
    } else if script {
        script_styles(doc.template == "screenplay")
    } else {
        prose_styles(doc.template == "book")
    };
    // A title page the writer typed: its centred lines in a frame in the middle of the
    // page, the lines after them in a frame at the bottom left (as in the PDF). The
    // frames are set on each paragraph (`para`), where every word processor reads them.
    styles.push(Style {
        id: "title_page_middle",
        ppr: "<w:keepNext/><w:jc w:val=\"center\"/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:ind w:left=\"0\" w:right=\"0\" w:firstLine=\"0\"/>",
        rpr: "",
    });
    styles.push(Style {
        id: "title_page_bottom",
        ppr: "<w:keepNext/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:ind w:left=\"0\" w:right=\"0\" w:firstLine=\"0\"/>",
        rpr: "",
    });
    let (font, size) = if script {
        ("Courier Prime", 24)
    } else if essay {
        ("Times New Roman", 24)
    } else {
        ("Georgia", 23)
    };

    let footnotes = doc.note_placement == "footnotes";
    let note_texts: HashMap<&str, &Note> = doc.notes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut note_numbers: HashMap<&str, usize> = HashMap::new();
    if footnotes || doc.note_placement == "endnotes" {
        for block in &doc.blocks {
            for run in &block.runs {
                if let Some(id) = &run.note {
                    if note_texts.contains_key(id.as_str()) && !note_numbers.contains_key(id.as_str()) {
                        let n = note_numbers.len() + 1;
                        note_numbers.insert(id.as_str(), n);
                    }
                }
            }
        }
    }
    let notes_on = !note_numbers.is_empty();

    let mut styles_xml = String::new();
    styles_xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">"#);
    styles_xml.push_str(&format!(
        r#"<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:cs="{font}" w:eastAsia="{font}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/><w:lang w:val="{lang}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>"#,
        lang = xml_escape(&doc.lang)
    ));
    styles_xml.push_str(r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/></w:pPr></w:style>"#);
    for s in &styles {
        styles_xml.push_str(&format!(
            r#"<w:style w:type="paragraph" w:customStyle="1" w:styleId="{id}"><w:name w:val="{name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/>{ppr}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>"#,
            id = s.id,
            name = title_case(s.id),
            ppr = s.ppr,
            rpr = s.rpr
        ));
    }
    if notes_on {
        let (ref_style, text_style) = if footnotes { ("FootnoteReference", "FootnoteText") } else { ("EndnoteReference", "EndnoteText") };
        styles_xml.push_str(&format!(r#"<w:style w:type="character" w:styleId="{ref_style}"><w:name w:val="{ref_style}"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>"#));
        styles_xml.push_str(&format!(r#"<w:style w:type="paragraph" w:styleId="{text_style}"><w:name w:val="{text_style}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>"#));
    }
    styles_xml.push_str("</w:styles>");
    let known: Vec<&str> = styles.iter().map(|s| s.id).collect();
    let mut body = String::new();
    // One paragraph; `in_cell` drops the page-style indents so a speaker fits its column.
    let para = |block: &Block, in_cell: bool| -> String {
        if block.kind == "page_break" {
            return "<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>".to_string();
        }
        let style = if known.contains(&block.kind.as_str()) {
            block.kind.as_str()
        } else if script {
            "direction"
        } else {
            "paragraph"
        };
        let mut p = format!("<w:p><w:pPr><w:pStyle w:val=\"{style}\"/>");
        // Consecutive paragraphs with the same frame share it.
        if style == "title_page_middle" {
            p.push_str(r#"<w:keepNext/><w:framePr w:wrap="around" w:vAnchor="margin" w:hAnchor="margin" w:xAlign="center" w:yAlign="center"/>"#);
        } else if style == "title_page_bottom" {
            p.push_str(r#"<w:keepNext/><w:framePr w:wrap="around" w:vAnchor="margin" w:hAnchor="margin" w:xAlign="left" w:yAlign="bottom"/>"#);
        }
        if style == "paragraph" || style == "dialogue" || style == "line" {
            p.push_str("<w:widowControl/>");
        }
        if in_cell {
            p.push_str("<w:ind w:left=\"0\" w:right=\"0\"/>");
        } else if block.indent > 0 {
            // A nested list item steps in a quarter inch per level from the list style's 540.
            let left = 540 + 360 * block.indent.min(5);
            p.push_str(&format!("<w:ind w:left=\"{left}\" w:hanging=\"360\"/>"));
        }
        p.push_str("</w:pPr>");
        if block.kind == "scene_break" && block.runs.iter().all(|r| r.text.trim().is_empty()) {
            p.push_str("<w:r><w:t>* * *</w:t></w:r>");
        }
        for run in &block.runs {
            if let Some(id) = &run.note {
                if let Some(n) = note_numbers.get(id.as_str()) {
                    let (tag, style) = if footnotes { ("footnoteReference", "FootnoteReference") } else { ("endnoteReference", "EndnoteReference") };
                    p.push_str(&format!(r#"<w:r><w:rPr><w:rStyle w:val="{style}"/></w:rPr><w:{tag} w:id="{n}"/></w:r>"#));
                }
                if run.text.is_empty() {
                    continue;
                }
            }
            p.push_str(&text_run_xml(run));
        }
        p.push_str("</w:p>");
        p
    };
    let mut i = 0;
    while i < doc.blocks.len() {
        let block = &doc.blocks[i];
        // Simultaneous speakers: a borderless table, one cell per speaker, on one row.
        if script && block.sim.is_some() {
            // A row ends where the next one starts (a first cue, column 0), so two scenes' rows stay apart.
            let mut end = i + 1;
            while end < doc.blocks.len() && doc.blocks[end].sim.is_some() && !starts_row(&doc.blocks[end]) {
                end += 1;
            }
            let row = &doc.blocks[i..end];
            let columns = row.iter().filter_map(|b| b.sim).max().unwrap_or(0) + 1;
            let width = 8640 / columns;
            body.push_str(r#"<w:tbl><w:tblPr><w:tblW w:w="8640" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr><w:tblGrid>"#);
            for _ in 0..columns {
                body.push_str(&format!("<w:gridCol w:w=\"{width}\"/>"));
            }
            body.push_str("</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>");
            for column in 0..columns {
                body.push_str(&format!("<w:tc><w:tcPr><w:tcW w:w=\"{width}\" w:type=\"dxa\"/></w:tcPr>"));
                let mut filled = false;
                for cell in row.iter().filter(|b| b.sim == Some(column)) {
                    body.push_str(&para(cell, true));
                    filled = true;
                }
                if !filled {
                    body.push_str("<w:p/>");
                }
                body.push_str("</w:tc>");
            }
            body.push_str("</w:tr></w:tbl>");
            i = end;
            continue;
        }
        body.push_str(&para(block, false));
        i += 1;
    }

    // Essays: Chicago leaves page 1 (the title page, or the first page) unnumbered.
    let essay_sect = if chicago {
        r#"<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:headerReference w:type="first" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:titlePg/></w:sectPr>"#
    } else {
        r#"<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>"#
    };
    let sect = match doc.template.as_str() {
        "essay" => essay_sect,
        "book" => r#"<w:sectPr><w:pgSz w:w="8640" w:h="12960"/><w:pgMar w:top="1080" w:right="900" w:bottom="1224" w:left="1260" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>"#,
        "stage-play" | "screenplay" => r#"<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="2160" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>"#,
        _ => r#"<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1728" w:bottom="1440" w:left="1728" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>"#,
    };

    // Page numbers for the other formats, as in the PDF. A title page (scripts, books) is
    // unnumbered and the page after it is page 1.
    let title_page = doc.blocks.first().is_some_and(|b| b.kind == "title_page_middle")
        || ((script || doc.template == "book") && doc.blocks.first().is_some_and(|b| b.kind == "title"));
    let numbering = match doc.template.as_str() {
        "essay" => None,
        // Scripts: "12." at the top right.
        "stage-play" | "screenplay" => Some(PageNumbers { footer: false, suffix: ".", title_page }),
        // Documents: top right.
        "document" => Some(PageNumbers { footer: false, suffix: "", title_page }),
        // Books, articles, poems: centred at the bottom.
        _ => Some(PageNumbers { footer: true, suffix: "", title_page }),
    };
    let note_pr = if notes_on {
        if footnotes { r#"<w:footnotePr><w:numFmt w:val="decimal"/></w:footnotePr>"# } else { r#"<w:endnotePr><w:numFmt w:val="decimal"/></w:endnotePr>"# }
    } else {
        ""
    };
    let sect = sect.replacen("<w:pgSz", &format!("{note_pr}<w:pgSz"), 1);
    let sect = match &numbering {
        Some(n) => n.wire(&sect),
        None => sect,
    };

    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body}{sect}</w:body></w:document>"#
    );
    let core = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{}</dc:title><dc:creator>{}</dc:creator></cp:coreProperties>"#,
        xml_escape(&doc.title),
        xml_escape(&doc.author)
    );
    let note_part = if footnotes { "footnotes" } else { "endnotes" };
    let note_tag = if footnotes { "footnote" } else { "endnote" };
    let note_ref = if footnotes { "footnoteRef" } else { "endnoteRef" };
    let note_style = if footnotes { "FootnoteText" } else { "EndnoteText" };
    let note_ref_style = if footnotes { "FootnoteReference" } else { "EndnoteReference" };
    let mut note_xml = String::new();
    if notes_on {
        note_xml.push_str(&format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:{note_part} xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
        ));
        for (kind, id) in [("separator", -1), ("continuationSeparator", 0)] {
            note_xml.push_str(&format!(
                r#"<w:{note_tag} w:type="{kind}" w:id="{id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:{kind}/></w:r></w:p></w:{note_tag}>"#
            ));
        }
        let mut ordered: Vec<(&str, usize)> = note_numbers.iter().map(|(id, n)| (*id, *n)).collect();
        ordered.sort_by_key(|(_, n)| *n);
        for (id, n) in ordered {
            let note = note_texts.get(id).expect("numbered notes have text");
            note_xml.push_str(&format!(
                r#"<w:{note_tag} w:id="{n}"><w:p><w:pPr><w:pStyle w:val="{note_style}"/></w:pPr><w:r><w:rPr><w:rStyle w:val="{note_ref_style}"/></w:rPr><w:{note_ref}/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>"#
            ));
            for run in &note.runs {
                note_xml.push_str(&text_run_xml(run));
            }
            note_xml.push_str(&format!("</w:p></w:{note_tag}>"));
        }
        note_xml.push_str(&format!("</w:{note_part}>"));
    }
    let header_types = if essay {
        r#"<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>"#.to_string()
    } else {
        numbering.as_ref().map(|n| n.content_types()).unwrap_or_default()
    };
    let notes_types = if notes_on {
        format!(r#"<Override PartName="/word/{note_part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{note_part}+xml"/>"#)
    } else {
        String::new()
    };
    let content_types = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>{header_types}{notes_types}</Types>"#
    );
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#;
    let header_rels = if essay {
        r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>"#.to_string()
    } else {
        numbering.as_ref().map(|n| n.rels()).unwrap_or_default()
    };
    let notes_rel = if notes_on {
        format!(r#"<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{note_part}" Target="{note_part}.xml"/>"#)
    } else {
        String::new()
    };
    let doc_rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>{header_rels}{notes_rel}</Relationships>"#
    );

    let mut files = vec![
        ("[Content_Types].xml", content_types.into_bytes()),
        ("_rels/.rels", rels.as_bytes().to_vec()),
        ("docProps/core.xml", core.into_bytes()),
        ("word/_rels/document.xml.rels", doc_rels.into_bytes()),
        ("word/document.xml", document.into_bytes()),
        ("word/styles.xml", styles_xml.into_bytes()),
    ];
    if essay {
        files.push(("word/header1.xml", essay_header(&doc.running_head).into_bytes()));
        // The first-page header (Chicago): empty.
        files.push((
            "word/header2.xml",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:hdr>"#
                .to_vec(),
        ));
    }
    if let Some(n) = &numbering {
        files.extend(n.parts());
    }
    if notes_on {
        let name = if footnotes { "word/footnotes.xml" } else { "word/endnotes.xml" };
        files.push((name, note_xml.into_bytes()));
    }
    Ok(zip_store(&files))
}

fn title_case(id: &str) -> String {
    id.split('_')
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------------------------------------------------------------------- EPUB

const EPUB_CSS: &str = r#"body { font-family: serif; line-height: 1.5; margin: 0 1em; }
h1 { text-align: center; font-weight: normal; margin: 2em 0 1.5em; }
h2 { margin: 1.5em 0 0.5em; } h3 { margin: 1.2em 0 0.4em; }
p { margin: 0; text-indent: 1.5em; }
p.first, h1 + p, h2 + p, h3 + p, hr + p, blockquote + p { text-indent: 0; }
p.article { text-indent: 0; margin: 0 0 0.8em; }
blockquote { margin: 1em 2em; font-style: italic; }
hr.scene-break { border: none; text-align: center; margin: 1em 0; }
hr.scene-break::after { content: "* * *"; }
p.citation { text-indent: -2em; margin: 0 0 0.6em 2em; }
p.center { text-indent: 0; text-align: center; }
p.bubble { display: table; max-width: 68%; text-indent: 0; padding: 0.35em 0.8em; border-radius: 1em; margin: 0.35em 0; }
p.bubble.left { background: #e9e9eb; color: #000; }
p.bubble.right { background: #2f7cf6; color: #fff; margin-left: auto; }
.sim { display: table; width: 100%; table-layout: fixed; margin: 0.6em 0; }
.sim-col { display: table-cell; vertical-align: top; padding: 0 0.35em; }
.sim p { text-indent: 0; margin: 0; }
.sim p.character { text-align: center; text-transform: uppercase; }
.sim p.parenthetical { text-align: center; font-style: italic; }
.sim p.lyric { font-style: italic; }
.poem p { text-indent: -2em; margin-left: 2em; white-space: pre-wrap; }
.poem .stanza-break { height: 1em; }
.part { text-align: center; margin-top: 30%; font-variant: small-caps; }
a.noteref { vertical-align: super; font-size: 0.75em; text-decoration: none; }
.endnotes h1 { text-align: left; }
.endnotes ol { padding-left: 1.5em; }
.endnotes li { margin: 0.6em 0; text-indent: 0; }
a.backlink { text-decoration: none; }
"#;

/// Endnote numbering and links for the EPUB. Notes live on their own page, so a
/// reference links to notes.xhtml and the note links back to the chapter.
struct NoteLinks {
    numbers: HashMap<String, usize>,
    chapter: HashMap<usize, usize>,
    refs: HashMap<usize, usize>,
}

impl NoteLinks {
    fn new(doc: &ExportDoc) -> Self {
        let mut numbers = HashMap::new();
        if doc.note_placement == "footnotes" || doc.note_placement == "endnotes" {
            for b in &doc.blocks {
                for r in &b.runs {
                    if let Some(id) = &r.note {
                        if !numbers.contains_key(id) && doc.notes.iter().any(|n| &n.id == id) {
                            let n = numbers.len() + 1;
                            numbers.insert(id.clone(), n);
                        }
                    }
                }
            }
        }
        Self { numbers, chapter: HashMap::new(), refs: HashMap::new() }
    }

    fn marker(&mut self, id: &str, chapter: usize) -> Option<String> {
        let n = *self.numbers.get(id)?;
        self.chapter.entry(n).or_insert(chapter);
        let count = self.refs.entry(n).or_insert(0);
        *count += 1;
        let suffix = if *count == 1 { String::new() } else { format!("-{}", *count) };
        Some(format!(
            r#"<a class="noteref" id="fnref-{n}{suffix}" href="notes.xhtml#fn-{n}" epub:type="noteref">{n}</a>"#
        ))
    }
}

fn epub_inline(runs: &[Run], preserve_space: bool, mut notes: Option<&mut NoteLinks>, chapter: usize) -> String {
    let mut s = String::new();
    for r in runs {
        if let Some(id) = &r.note {
            if let Some(links) = notes.as_deref_mut() {
                if let Some(marker) = links.marker(id, chapter) {
                    s.push_str(&marker);
                }
            }
            continue;
        }
        let mut t = xml_escape(&r.text).replace('\n', "<br/>");
        if preserve_space {
            // Leading and repeated spaces matter in poems.
            t = t.replace("  ", "\u{00a0}\u{00a0}");
            if t.starts_with(' ') {
                t = format!("\u{00a0}{}", &t[1..]);
            }
        }
        if r.underline {
            t = format!("<u>{t}</u>");
        }
        if r.italic {
            t = format!("<em>{t}</em>");
        }
        if r.bold {
            t = format!("<strong>{t}</strong>");
        }
        s.push_str(&t);
    }
    s
}

fn plain(runs: &[Run]) -> String {
    runs.iter().map(|r| r.text.as_str()).collect::<String>()
}

pub fn epub(doc: &ExportDoc) -> Result<Vec<u8>, String> {
    let poem = doc.template == "poem";
    // Split into chapters at chapter / folder headings.
    let mut chapters: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;
    let mut prev_kind = String::new();
    let mut note_links = NoteLinks::new(doc);
    for (bi, b) in doc.blocks.iter().enumerate() {
        let in_title_page = prev_kind.starts_with("title_page");
        // A typed title page is a chapter of its own; the page break after it ends it.
        if b.kind == "page_break" && in_title_page {
            if let Some(c) = current.take() {
                chapters.push(c);
            }
            prev_kind = String::new();
            continue;
        }
        let starts_chapter = matches!(b.kind.as_str(), "chapter" | "folder_heading" | "matter_title")
            || (poem && b.kind == "title")
            || (b.kind == "title_page_middle" && !in_title_page);
        if starts_chapter || current.is_none() {
            if let Some(c) = current.take() {
                chapters.push(c);
            }
            let title = if starts_chapter {
                b.label.clone().filter(|l| !l.trim().is_empty()).unwrap_or_else(|| plain(&b.runs))
            } else {
                doc.title.clone()
            };
            current = Some((title, String::new()));
        }
        let chapter_index = chapters.len();
        let html = &mut current.as_mut().unwrap().1;
        let inline = epub_inline(&b.runs, poem, Some(&mut note_links), chapter_index);
        // A matter page whose title is left off the page: it only starts a new chapter.
        if b.kind == "matter_title" && plain(&b.runs).trim().is_empty() {
            prev_kind = "chapter".to_string();
            continue;
        }
        // Simultaneous speakers: one column per speaker, side by side.
        if b.sim.is_some() {
            // A column past the first is printed with its row's opening cue.
            if bi > 0 && doc.blocks[bi - 1].sim.is_some() && !starts_row(b) {
                continue;
            }
            // A row ends where the next one starts (a first cue, column 0), so two scenes' rows stay apart.
            let mut end = bi + 1;
            while end < doc.blocks.len() && doc.blocks[end].sim.is_some() && !starts_row(&doc.blocks[end]) {
                end += 1;
            }
            let row = &doc.blocks[bi..end];
            let columns = row.iter().filter_map(|x| x.sim).max().unwrap_or(0) + 1;
            html.push_str(&format!("<div class=\"sim cols-{columns}\">"));
            for column in 0..columns {
                html.push_str("<div class=\"sim-col\">");
                for cell in row.iter().filter(|x| x.sim == Some(column)) {
                    let text = epub_inline(&cell.runs, poem, Some(&mut note_links), chapter_index);
                    match cell.kind.as_str() {
                        "character" => html.push_str(&format!("<p class=\"character\">{}</p>\n", text.to_uppercase())),
                        "parenthetical" => html.push_str(&format!("<p class=\"parenthetical\"><em>{text}</em></p>\n")),
                        "lyric" => html.push_str(&format!("<p class=\"lyric\"><em>{text}</em></p>\n")),
                        _ => html.push_str(&format!("<p class=\"dialogue\">{text}</p>\n")),
                    }
                }
                html.push_str("</div>");
            }
            html.push_str("</div>\n");
            prev_kind = row.last().map(|x| x.kind.clone()).unwrap_or_default();
            continue;
        }
        match b.kind.as_str() {
            "chapter" | "title" | "matter_title" | "essay_title" | "essay_cover_title" => html.push_str(&format!("<h1>{inline}</h1>\n")),
            "essay_heading" => html.push_str(&format!("<p class=\"first\">{inline}</p>\n")),
            "essay_byline" | "essay_cover_details" | "essay_cover_line" => html.push_str(&format!("<p class=\"center\">{inline}</p>\n")),
            "citation" => html.push_str(&format!("<p class=\"citation\">{inline}</p>\n")),
            "text_left" => html.push_str(&format!("<p class=\"bubble left\">{inline}</p>\n")),
            "text_right" => html.push_str(&format!("<p class=\"bubble right\">{inline}</p>\n")),
            "page_break" => {}
            "centered" => html.push_str(&format!("<p class=\"first\" style=\"text-align:center\">{inline}</p>\n")),
            "matter_paragraph" => html.push_str(&format!("<p class=\"article\">{inline}</p>\n")),
            "title_page_middle" => html.push_str(&format!("<p class=\"center\">{inline}</p>\n")),
            "title_page_bottom" => html.push_str(&format!("<p class=\"first\">{inline}</p>\n")),
            "folder_heading" => html.push_str(&format!("<h1 class=\"part\">{inline}</h1>\n")),
            "heading" | "scene_heading" => html.push_str(&format!("<h2>{inline}</h2>\n")),
            "subheading" => html.push_str(&format!("<h3>{inline}</h3>\n")),
            "quote" => html.push_str(&format!("<blockquote><p class=\"first\">{inline}</p></blockquote>\n")),
            "scene_break" => html.push_str("<hr class=\"scene-break\"/>\n"),
            "stanza_break" => html.push_str("<div class=\"stanza-break\"></div>\n"),
            "line" => html.push_str(&format!("<p>{inline}</p>\n")),
            "character" => html.push_str(&format!("<p class=\"first\" style=\"text-align:center;margin-top:1em\">{}</p>\n", inline.to_uppercase())),
            "parenthetical" | "direction" | "action" => html.push_str(&format!("<p class=\"first\" style=\"margin:0.6em 0\"><em>{inline}</em></p>\n")),
            "transition" => html.push_str(&format!("<p class=\"first\" style=\"text-align:right\">{inline}</p>\n")),
            "song" => html.push_str(&format!("<p class=\"first\" style=\"text-align:center;margin-top:1.5em;font-weight:bold;text-decoration:underline\">{}</p>\n", inline.to_uppercase())),
            "lyric" => html.push_str(&format!("<p class=\"first\" style=\"margin:0 0 0 2em\"><em>{inline}</em></p>\n")),
            _ => {
                let class = if doc.template == "article" {
                    "article"
                } else if prev_kind.is_empty() || matches!(prev_kind.as_str(), "chapter" | "heading" | "subheading") {
                    "first"
                } else {
                    ""
                };
                if b.indent > 0 {
                    let em = 1.5 * f64::from(b.indent.min(5));
                    html.push_str(&format!("<p class=\"{class}\" style=\"margin-left:{em}em\">{inline}</p>\n"));
                } else {
                    html.push_str(&format!("<p class=\"{class}\">{inline}</p>\n"));
                }
            }
        }
        prev_kind = b.kind.clone();
    }
    if let Some(c) = current.take() {
        chapters.push(c);
    }
    if chapters.is_empty() {
        chapters.push((doc.title.clone(), String::new()));
    }

    let lang = xml_escape(&doc.lang);
    let title = xml_escape(&doc.title);
    let id = if doc.id.is_empty() { format!("manywrite-{}", crate::fs::content_hash(doc.title.as_bytes())) } else { doc.id.clone() };
    let mut files: Vec<(String, Vec<u8>)> = vec![
        ("mimetype".into(), b"application/epub+zip".to_vec()),
        (
            "META-INF/container.xml".into(),
            br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#
                .to_vec(),
        ),
        ("OEBPS/style.css".into(), EPUB_CSS.as_bytes().to_vec()),
    ];
    let body_class = if poem { " class=\"poem\"" } else { "" };
    let mut manifest = String::new();
    let mut spine = String::new();
    let mut nav = String::new();
    for (i, (ch_title, html)) in chapters.iter().enumerate() {
        let name = format!("ch{:03}.xhtml", i + 1);
        let t = xml_escape(ch_title);
        let page = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"{lang}\" lang=\"{lang}\"><head><meta charset=\"UTF-8\"/><title>{t}</title><link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/></head><body{body_class}>\n{html}</body></html>\n"
        );
        files.push((format!("OEBPS/{name}"), page.into_bytes()));
        manifest.push_str(&format!("<item id=\"c{i}\" href=\"{name}\" media-type=\"application/xhtml+xml\"/>"));
        spine.push_str(&format!("<itemref idref=\"c{i}\"/>"));
        nav.push_str(&format!("<li><a href=\"{name}\">{}</a></li>", if t.is_empty() { format!("Section {}", i + 1) } else { t }));
    }
    if !note_links.numbers.is_empty() {
        let mut ordered: Vec<(&String, usize)> = note_links.numbers.iter().map(|(id, n)| (id, *n)).collect();
        ordered.sort_by_key(|(_, n)| *n);
        let mut items = String::new();
        for (id, n) in ordered {
            let text = doc
                .notes
                .iter()
                .find(|x| &x.id == id)
                .map(|x| epub_inline(&x.runs, false, None, 0))
                .unwrap_or_default();
            let back = note_links
                .chapter
                .get(&n)
                .map(|c| format!(r#" <a class="backlink" href="ch{:03}.xhtml#fnref-{n}">↩</a>"#, *c + 1))
                .unwrap_or_default();
            items.push_str(&format!(r#"<li id="fn-{n}" epub:type="endnote">{text}{back}</li>"#));
        }
        let notes_html = format!(r#"<section class="endnotes" epub:type="endnotes"><h1>Endnotes</h1><ol>{items}</ol></section>"#);
        let page = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"{lang}\" lang=\"{lang}\"><head><meta charset=\"UTF-8\"/><title>Endnotes</title><link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/></head><body>\n{notes_html}</body></html>\n"
        );
        files.push(("OEBPS/notes.xhtml".into(), page.into_bytes()));
        manifest.push_str(r#"<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>"#);
        spine.push_str(r#"<itemref idref="notes"/>"#);
        nav.push_str(r#"<li><a href="notes.xhtml">Endnotes</a></li>"#);
    }
    let nav_page = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"{lang}\" lang=\"{lang}\"><head><meta charset=\"UTF-8\"/><title>{title}</title></head><body><nav epub:type=\"toc\" id=\"toc\"><h1>Contents</h1><ol>{nav}</ol></nav></body></html>\n"
    );
    files.push(("OEBPS/nav.xhtml".into(), nav_page.into_bytes()));
    let opf = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="{lang}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">{id}</dc:identifier><dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><dc:language>{lang}</dc:language><meta property="dcterms:modified">{modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>{manifest}</manifest><spine>{spine}</spine></package>"#,
        id = xml_escape(&id),
        author = xml_escape(if doc.author.is_empty() { "Unknown" } else { &doc.author }),
        modified = now_iso(),
    );
    files.push(("OEBPS/content.opf".into(), opf.into_bytes()));
    let refs: Vec<(&str, Vec<u8>)> = files.iter().map(|(n, d)| (n.as_str(), d.clone())).collect();
    Ok(zip_store(&refs))
}

fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = crate::engine::civil_from_days_pub(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(text: &str) -> Run {
        Run { text: text.into(), italic: false, bold: false, underline: false, note: None }
    }

    fn doc(placement: &str) -> ExportDoc {
        ExportDoc {
            title: "Essay".into(),
            author: "A".into(),
            template: "essay".into(),
            lang: "en".into(),
            id: "urn:uuid:x".into(),
            style: "chicago-notes".into(),
            running_head: String::new(),
            note_placement: placement.into(),
            notes: vec![Note { id: "n1".into(), runs: vec![run("First note.")] }],
            blocks: vec![Block {
                kind: "paragraph".into(),
                runs: vec![
                    Run { text: "One".into(), italic: false, bold: false, underline: false, note: Some("n1".into()) },
                    run(" two."),
                ],
                label: None,
                indent: 0,
                sim: None,
            }],
        }
    }

    fn text(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).into_owned()
    }

    #[test]
    fn docx_footnotes_carry_text_and_references() {
        let zip = text(&docx(&doc("footnotes")).unwrap());
        assert!(zip.contains("word/footnotes.xml"));
        assert!(zip.contains(r#"<w:footnoteReference w:id="1"/>"#));
        assert!(zip.contains("First note."));
        assert!(!zip.contains("word/endnotes.xml"));
    }

    #[test]
    fn docx_endnotes_use_the_endnote_parts() {
        let zip = text(&docx(&doc("endnotes")).unwrap());
        assert!(zip.contains("word/endnotes.xml"));
        assert!(zip.contains(r#"<w:endnoteReference w:id="1"/>"#));
        assert!(zip.contains("<w:endnoteRef/>"));
    }

    #[test]
    fn docx_without_a_placement_has_no_notes_part() {
        let zip = text(&docx(&doc("")).unwrap());
        assert!(!zip.contains("word/footnotes.xml"));
        assert!(!zip.contains("word/endnotes.xml"));
        assert!(!zip.contains("First note."));
    }

    fn script_doc() -> ExportDoc {
        let line = |kind: &str, text: &str, sim: Option<u32>| Block { kind: kind.into(), runs: vec![run(text)], label: None, indent: 0, sim };
        ExportDoc {
            title: "Play".into(),
            author: "A".into(),
            template: "stage-play".into(),
            lang: "en".into(),
            id: "urn:uuid:x".into(),
            style: "chicago-notes".into(),
            running_head: String::new(),
            note_placement: "endnotes".into(),
            notes: vec![],
            blocks: vec![
                line("character", "ANNA", Some(0)),
                line("dialogue", "Left.", Some(0)),
                line("character", "BEN", Some(1)),
                line("dialogue", "Right.", Some(1)),
                line("character", "MARA", None),
                line("dialogue", "Alone.", None),
            ],
        }
    }

    #[test]
    fn docx_sets_simultaneous_speakers_in_one_row() {
        let zip = text(&docx(&script_doc()).unwrap());
        assert!(zip.contains("<w:tbl>"));
        assert_eq!(zip.matches("<w:gridCol ").count(), 2);
        assert!(zip.contains("ANNA"));
        assert!(zip.contains("Right."));
        assert!(zip.contains("Alone."));
    }

    #[test]
    fn epub_sets_simultaneous_speakers_in_columns() {
        let zip = text(&epub(&script_doc()).unwrap());
        assert!(zip.contains(r#"<div class="sim cols-2">"#));
        assert_eq!(zip.matches(r#"<div class="sim-col">"#).count(), 2);
        assert!(zip.contains(r#"<p class="character">ANNA</p>"#));
        assert!(zip.contains("Alone."));
    }

    #[test]
    fn epub_links_references_to_an_endnotes_page() {
        let zip = text(&epub(&doc("footnotes")).unwrap());
        assert!(zip.contains(r#"<a class="noteref" id="fnref-1" href="notes.xhtml#fn-1" epub:type="noteref">1</a>"#));
        assert!(zip.contains(r#"<section class="endnotes" epub:type="endnotes">"#));
        assert!(zip.contains(r#"<li id="fn-1" epub:type="endnote">First note."#));
        assert!(zip.contains(r#"href="ch001.xhtml#fnref-1""#));
    }
}

