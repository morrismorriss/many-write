//! Word (.docx) and EPUB export, written directly (no Pandoc needed).
//!
//! The frontend sends a neutral block list; each template maps block kinds to
//! paragraph styles. Word re-paginates on open, so DOCX carries "keep with
//! next" and widow/orphan control flags rather than fixed page breaks.

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
    /// Essays: "mla" or "chicago".
    #[serde(default)]
    pub style: String,
    /// Essays: text before the page number in the running header (MLA: the surname).
    #[serde(default)]
    pub running_head: String,
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

/// The running header: right-aligned, `head` then the page number (a PAGE field).
fn essay_header(head: &str) -> String {
    let lead = if head.is_empty() { String::new() } else { format!("<w:r><w:t xml:space=\"preserve\">{} </w:t></w:r>", xml_escape(head)) };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr>{lead}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>"#
    )
}

pub fn docx(doc: &ExportDoc) -> Result<Vec<u8>, String> {
    let script = matches!(doc.template.as_str(), "stage-play" | "screenplay");
    let essay = doc.template == "essay";
    let chicago = essay && doc.style == "chicago";
    let styles = if essay {
        essay_styles(chicago)
    } else if script {
        script_styles(doc.template == "screenplay")
    } else {
        prose_styles(doc.template == "book")
    };
    let (font, size) = if script {
        ("Courier Prime", 24)
    } else if essay {
        ("Times New Roman", 24)
    } else {
        ("Georgia", 23)
    };

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
    styles_xml.push_str("</w:styles>");

    let known: Vec<&str> = styles.iter().map(|s| s.id).collect();
    let mut body = String::new();
    for block in &doc.blocks {
        if block.kind == "page_break" {
            body.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
            continue;
        }
        let style = if known.contains(&block.kind.as_str()) {
            block.kind.as_str()
        } else if script {
            "direction"
        } else {
            "paragraph"
        };
        body.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"{style}\"/>"));
        if style == "paragraph" || style == "dialogue" || style == "line" {
            body.push_str("<w:widowControl/>");
        }
        body.push_str("</w:pPr>");
        if block.kind == "scene_break" && block.runs.iter().all(|r| r.text.trim().is_empty()) {
            body.push_str("<w:r><w:t>* * *</w:t></w:r>");
        }
        for run in &block.runs {
            let mut rpr = String::new();
            if run.bold {
                rpr.push_str("<w:b/>");
            }
            if run.italic {
                rpr.push_str("<w:i/>");
            }
            if run.underline {
                rpr.push_str("<w:u w:val=\"single\"/>");
            }
            body.push_str("<w:r>");
            if !rpr.is_empty() {
                body.push_str(&format!("<w:rPr>{rpr}</w:rPr>"));
            }
            for (i, part) in run.text.split('\n').enumerate() {
                if i > 0 {
                    body.push_str("<w:br/>");
                }
                body.push_str(&format!("<w:t xml:space=\"preserve\">{}</w:t>", xml_escape(part)));
            }
            body.push_str("</w:r>");
        }
        body.push_str("</w:p>");
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
    let header_types = if essay {
        r#"<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>"#
    } else {
        ""
    };
    let content_types = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>{header_types}</Types>"#
    );
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#;
    let header_rels = if essay {
        r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>"#
    } else {
        ""
    };
    let doc_rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>{header_rels}</Relationships>"#
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
.poem p { text-indent: -2em; margin-left: 2em; white-space: pre-wrap; }
.poem .stanza-break { height: 1em; }
.part { text-align: center; margin-top: 30%; font-variant: small-caps; }
"#;

fn epub_inline(runs: &[Run], preserve_space: bool) -> String {
    let mut s = String::new();
    for r in runs {
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
    for b in &doc.blocks {
        let starts_chapter = matches!(b.kind.as_str(), "chapter" | "folder_heading" | "matter_title")
            || (poem && b.kind == "title");
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
        let html = &mut current.as_mut().unwrap().1;
        let inline = epub_inline(&b.runs, poem);
        // A matter page whose title is left off the page: it only starts a new chapter.
        if b.kind == "matter_title" && plain(&b.runs).trim().is_empty() {
            prev_kind = "chapter".to_string();
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
            _ => {
                let class = if doc.template == "article" {
                    "article"
                } else if prev_kind.is_empty() || matches!(prev_kind.as_str(), "chapter" | "heading" | "subheading") {
                    "first"
                } else {
                    ""
                };
                html.push_str(&format!("<p class=\"{class}\">{inline}</p>\n"));
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
