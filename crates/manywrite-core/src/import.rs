//! Reading other formats so they can become Many Write projects:
//! Word (.docx), PDF (text with positions), and RTF.
//! The originals are only ever read, never changed.

use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub text: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub bold: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub italic: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
}

/// One paragraph with its style name (Word style id, or "" for plain).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Para {
    pub style: String,
    pub runs: Vec<Span>,
}

impl Para {
    pub fn text(&self) -> String {
        self.runs.iter().map(|r| r.text.as_str()).collect()
    }
}

fn push_text(runs: &mut Vec<Span>, text: &str, bold: bool, italic: bool, underline: bool) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = runs.last_mut() {
        if last.bold == bold && last.italic == italic && last.underline == underline {
            last.text.push_str(text);
            return;
        }
    }
    runs.push(Span { text: text.to_string(), bold, italic, underline });
}

// ---------------------------------------------------------------- zip

/// Largest entry we will decompress (a .docx body is rarely over a few MB).
const MAX_ENTRY: usize = 64 * 1024 * 1024;

/// Read one file out of a zip archive (stored or deflated entries).
/// Every offset is bounds-checked, so a damaged or hostile file is an error, never a crash.
pub fn unzip_entry(zip: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let bad = || "The file is damaged or not a zip (.docx) file.".to_string();
    let le16 = |o: usize| zip.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize);
    let le32 = |o: usize| zip.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    // End of central directory: scan back from the end.
    let eocd = (0..zip.len().saturating_sub(21))
        .rev()
        .find(|&i| zip[i..].starts_with(&[0x50, 0x4b, 0x05, 0x06]))
        .ok_or("Not a zip file (is this really a .docx?)")?;
    let count = le16(eocd + 10).ok_or_else(bad)?;
    let mut p = le32(eocd + 16).ok_or_else(bad)?;
    for _ in 0..count {
        if !zip.get(p..).is_some_and(|z| z.starts_with(&[0x50, 0x4b, 0x01, 0x02])) {
            break;
        }
        let method = le16(p + 10).ok_or_else(bad)?;
        let csize = le32(p + 20).ok_or_else(bad)?;
        let nlen = le16(p + 28).ok_or_else(bad)?;
        let elen = le16(p + 30).ok_or_else(bad)?;
        let clen = le16(p + 32).ok_or_else(bad)?;
        let local = le32(p + 42).ok_or_else(bad)?;
        let entry = zip.get(p + 46..p + 46 + nlen).ok_or_else(bad)?;
        p += 46 + nlen + elen + clen;
        if entry != name.as_bytes() {
            continue;
        }
        let lnlen = le16(local + 26).ok_or_else(bad)?;
        let lelen = le16(local + 28).ok_or_else(bad)?;
        let start = local + 30 + lnlen + lelen;
        let data = zip.get(start..start.saturating_add(csize)).ok_or_else(bad)?;
        return match method {
            0 if data.len() <= MAX_ENTRY => Ok(data.to_vec()),
            8 => miniz_oxide::inflate::decompress_to_vec_with_limit(data, MAX_ENTRY)
                .map_err(|_| format!("{name} could not be decompressed (damaged, or larger than 64 MB).")),
            0 => Err(format!("{name} is larger than 64 MB.")),
            m => Err(format!("Unsupported compression method {m} in {name}")),
        };
    }
    Err(format!("{name} not found in the file"))
}

// --------------------------------------------------------------- Word

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/// Paragraphs of a .docx, with style ids and bold/italic/underline.
pub fn docx(bytes: &[u8]) -> Result<Vec<Para>, String> {
    let xml = unzip_entry(bytes, "word/document.xml")?;
    let xml = String::from_utf8_lossy(&xml);
    let doc = roxmltree::Document::parse(&xml).map_err(|e| format!("The Word file could not be read: {e}"))?;
    // Map style ids to names, so "Heading1" and custom styles like "Character" are recognisable.
    let names = unzip_entry(bytes, "word/styles.xml")
        .ok()
        .and_then(|s| {
            let s = String::from_utf8_lossy(&s).into_owned();
            let d = roxmltree::Document::parse(&s).ok()?;
            Some(
                d.descendants()
                    .filter(|n| n.has_tag_name((W, "style")))
                    .filter_map(|n| {
                        let id = n.attribute((W, "styleId"))?.to_string();
                        let name = n.children().find(|c| c.has_tag_name((W, "name")))?.attribute((W, "val"))?.to_string();
                        Some((id, name))
                    })
                    .collect::<std::collections::HashMap<_, _>>(),
            )
        })
        .unwrap_or_default();
    let on = |n: Option<roxmltree::Node>| n.is_some_and(|n| !matches!(n.attribute((W, "val")), Some("0" | "false" | "none")));
    let mut out = Vec::new();
    for p in doc.descendants().filter(|n| n.has_tag_name((W, "p"))) {
        let style_id = p
            .children()
            .find(|c| c.has_tag_name((W, "pPr")))
            .and_then(|ppr| ppr.children().find(|c| c.has_tag_name((W, "pStyle"))))
            .and_then(|s| s.attribute((W, "val")))
            .unwrap_or("");
        let style = names.get(style_id).cloned().unwrap_or_else(|| style_id.to_string());
        let mut runs = Vec::new();
        for r in p.descendants().filter(|n| n.has_tag_name((W, "r"))) {
            let rpr = r.children().find(|c| c.has_tag_name((W, "rPr")));
            let flag = |tag: &str| on(rpr.and_then(|x| x.children().find(|c| c.has_tag_name((W, tag)))));
            let (b, i, u) = (flag("b"), flag("i"), flag("u"));
            for c in r.children() {
                if c.has_tag_name((W, "t")) {
                    push_text(&mut runs, c.text().unwrap_or(""), b, i, u);
                } else if c.has_tag_name((W, "tab")) {
                    push_text(&mut runs, "\t", b, i, u);
                } else if c.has_tag_name((W, "br")) || c.has_tag_name((W, "cr")) {
                    push_text(&mut runs, "\n", b, i, u);
                }
            }
        }
        out.push(Para { style, runs });
    }
    Ok(out)
}

// ---------------------------------------------------------------- PDF

/// One line of text on a PDF page, with its position in points from the top left.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfLine {
    pub page: usize,
    pub x: f32,
    pub y: f32,
    pub size: f32,
    pub text: String,
    pub page_width: f32,
    pub page_height: f32,
}

struct Glyphs {
    out: Vec<(f32, f32, f32, f32, String)>, // x, y, size, advance-guess, text
}

impl<'a> hayro_interpret::Device<'a> for Glyphs {
    fn set_soft_mask(&mut self, _: Option<hayro_interpret::SoftMask<'a>>) {}
    fn set_blend_mode(&mut self, _: hayro_interpret::BlendMode) {}
    fn draw_path(&mut self, _: &kurbo::BezPath, _: kurbo::Affine, _: &hayro_interpret::Paint<'a>, _: &hayro_interpret::PathDrawMode) {}
    fn push_clip_path(&mut self, _: &hayro_interpret::ClipPath) {}
    fn push_transparency_group(&mut self, _: f32, _: Option<hayro_interpret::SoftMask<'a>>, _: hayro_interpret::BlendMode) {}
    fn draw_glyph(
        &mut self,
        glyph: &hayro_interpret::font::Glyph<'a>,
        transform: kurbo::Affine,
        glyph_transform: kurbo::Affine,
        _: &hayro_interpret::Paint<'a>,
        _: &hayro_interpret::GlyphDrawMode,
    ) {
        let Some(u) = glyph.as_unicode() else { return };
        let text = match u {
            hayro_interpret::hayro_cmap::BfString::Char(c) => c.to_string(),
            hayro_interpret::hayro_cmap::BfString::String(s) => s,
        };
        let t = transform * glyph_transform;
        let origin = t * kurbo::Point::ORIGIN;
        // Font size: the text transform's vertical scale.
        let size = (transform * kurbo::Point::new(0.0, 1.0) - transform * kurbo::Point::ORIGIN).hypot() as f32;
        // Where this glyph ends, from its advance width in glyph units.
        let adv_units = match glyph {
            hayro_interpret::font::Glyph::Outline(g) => g.advance_width().map(|a| a as f64),
            _ => None,
        };
        let end = adv_units.map(|a| (t * kurbo::Point::new(a, 0.0)).x as f32).unwrap_or(origin.x as f32 + size * 0.5);
        self.out.push((origin.x as f32, origin.y as f32, size, end, text));
    }
    fn draw_image(&mut self, _: hayro_interpret::Image<'a, '_>, _: kurbo::Affine) {}
    fn pop_clip_path(&mut self) {}
    fn pop_transparency_group(&mut self) {}
}

/// The text of a PDF as positioned lines, in reading order.
pub fn pdf(bytes: Vec<u8>) -> Result<Vec<PdfLine>, String> {
    use hayro_interpret::{Context, InterpreterCache, InterpreterSettings, TransformExt};
    let pdf = hayro_syntax::Pdf::new(bytes).map_err(|e| format!("The PDF could not be read: {e:?}"))?;
    let cache = InterpreterCache::new();
    let mut lines = Vec::new();
    for (pi, page) in pdf.pages().iter().enumerate() {
        let (w, h) = page.render_dimensions();
        let mut ctx = Context::new(
            page.initial_transform(true).to_kurbo(),
            kurbo::Rect::new(0.0, 0.0, w as f64, h as f64),
            &cache,
            page.xref(),
            InterpreterSettings::default(),
        );
        let mut dev = Glyphs { out: Vec::new() };
        hayro_interpret::interpret_page(page, &mut ctx, &mut dev);
        // Group glyphs into lines by baseline, then order each line left to right.
        let mut glyphs = dev.out;
        glyphs.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap().then(a.0.partial_cmp(&b.0).unwrap()));
        let mut cur: Vec<(f32, f32, f32, f32, String)> = Vec::new();
        let mut flush = |cur: &mut Vec<(f32, f32, f32, f32, String)>| {
            if cur.is_empty() {
                return;
            }
            cur.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            let size = cur.iter().map(|g| g.2).fold(0.0, f32::max);
            let mut text = String::new();
            let mut end = cur[0].0;
            let mut adv = size * 0.5;
            for g in cur.iter() {
                // A gap wider than a quarter of a character is a space (many PDFs draw no space glyphs).
                if !text.is_empty() && g.0 - end > adv.max(0.5) * 0.25 && !text.ends_with(' ') {
                    text.push(' ');
                }
                text.push_str(&g.4);
                adv = (g.3 - g.0).abs().max(size * 0.2);
                end = g.3.max(g.0);
            }
            let text = text.trim_end().to_string();
            if !text.trim().is_empty() {
                lines.push(PdfLine { page: pi + 1, x: cur[0].0, y: cur[0].1, size, text, page_width: w, page_height: h });
            }
            cur.clear();
        };
        for g in glyphs {
            if let Some(last) = cur.last() {
                if (g.1 - last.1).abs() > g.2.max(1.0) * 0.4 {
                    flush(&mut cur);
                }
            }
            cur.push(g);
        }
        flush(&mut cur);
    }
    Ok(lines)
}

// ---------------------------------------------------------------- RTF

/// A small RTF reader: paragraphs, bold/italic/underline, Unicode and code-page characters.
/// Font tables, pictures, headers and other destinations are skipped.
pub fn rtf(src: &str) -> Vec<Para> {
    #[derive(Clone, Copy)]
    struct St {
        b: bool,
        i: bool,
        u: bool,
        skip: bool,
        uc: usize,
    }
    const SKIP: &[&str] = &[
        "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr",
        "listtable", "listoverridetable", "generator", "rsidtbl", "xmlnstbl", "themedata", "colorschememapping",
        "latentstyles", "datastore", "fldinst", "expandedcolortbl", "filetbl", "revtbl", "object", "nonshppict",
    ];
    let bytes = src.as_bytes();
    let mut stack: Vec<St> = Vec::new();
    let mut st = St { b: false, i: false, u: false, skip: false, uc: 1 };
    let mut paras: Vec<Para> = Vec::new();
    let mut runs: Vec<Span> = Vec::new();
    let mut pending_skip = 0usize; // characters to skip after \u
    let mut i = 0;
    let end_para = |runs: &mut Vec<Span>, paras: &mut Vec<Para>| {
        paras.push(Para { style: String::new(), runs: std::mem::take(runs) });
    };
    while i < bytes.len() {
        let c = bytes[i];
        match c {
            b'{' => {
                stack.push(st);
                i += 1;
            }
            b'}' => {
                if let Some(s) = stack.pop() {
                    st = s;
                }
                i += 1;
            }
            b'\\' => {
                i += 1;
                if i >= bytes.len() {
                    break;
                }
                let n = bytes[i];
                if n.is_ascii_alphabetic() {
                    let ws = i;
                    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    let word = &src[ws..i];
                    let ps = i;
                    if i < bytes.len() && (bytes[i] == b'-' || bytes[i].is_ascii_digit()) {
                        i += 1;
                        while i < bytes.len() && bytes[i].is_ascii_digit() {
                            i += 1;
                        }
                    }
                    let param: Option<i32> = src[ps..i].parse().ok();
                    if i < bytes.len() && bytes[i] == b' ' {
                        i += 1;
                    }
                    let on = param != Some(0);
                    match word {
                        "par" | "sect" | "page" => {
                            if !st.skip {
                                end_para(&mut runs, &mut paras)
                            }
                        }
                        "line" => {
                            if !st.skip {
                                push_text(&mut runs, "\n", st.b, st.i, st.u)
                            }
                        }
                        "tab" => {
                            if !st.skip {
                                push_text(&mut runs, "\t", st.b, st.i, st.u)
                            }
                        }
                        "emdash" => push_text(&mut runs, "—", st.b, st.i, st.u),
                        "endash" => push_text(&mut runs, "–", st.b, st.i, st.u),
                        "lquote" => push_text(&mut runs, "‘", st.b, st.i, st.u),
                        "rquote" => push_text(&mut runs, "’", st.b, st.i, st.u),
                        "ldblquote" => push_text(&mut runs, "“", st.b, st.i, st.u),
                        "rdblquote" => push_text(&mut runs, "”", st.b, st.i, st.u),
                        "bullet" => push_text(&mut runs, "•", st.b, st.i, st.u),
                        "b" => st.b = on,
                        "i" => st.i = on,
                        "ul" => st.u = on,
                        "ulnone" => st.u = false,
                        "plain" => {
                            st.b = false;
                            st.i = false;
                            st.u = false;
                        }
                        "uc" => st.uc = param.unwrap_or(1).max(0) as usize,
                        "u" => {
                            if let Some(mut v) = param {
                                if v < 0 {
                                    v += 65536;
                                }
                                if !st.skip {
                                    if let Some(ch) = char::from_u32(v as u32) {
                                        push_text(&mut runs, &ch.to_string(), st.b, st.i, st.u);
                                    }
                                }
                                pending_skip = st.uc;
                            }
                        }
                        w if SKIP.contains(&w) => st.skip = true,
                        _ => {}
                    }
                    continue;
                }
                match n {
                    b'\'' => {
                        let hex = src.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok());
                        i += 3;
                        if pending_skip > 0 {
                            pending_skip -= 1;
                        } else if let Some(byte) = hex {
                            if !st.skip {
                                push_text(&mut runs, &cp1252(byte).to_string(), st.b, st.i, st.u);
                            }
                        }
                    }
                    b'*' => {
                        st.skip = true;
                        i += 1;
                    }
                    b'~' => {
                        if !st.skip {
                            push_text(&mut runs, "\u{a0}", st.b, st.i, st.u);
                        }
                        i += 1;
                    }
                    b'\n' | b'\r' => {
                        if !st.skip {
                            end_para(&mut runs, &mut paras);
                        }
                        i += 1;
                    }
                    b'-' | b'_' => i += 1,
                    other => {
                        if !st.skip {
                            push_text(&mut runs, &(other as char).to_string(), st.b, st.i, st.u);
                        }
                        i += 1;
                    }
                }
            }
            b'\r' | b'\n' => i += 1,
            _ => {
                // Plain text up to the next control character (keeps UTF-8 intact).
                let s = i;
                while i < bytes.len() && !matches!(bytes[i], b'\\' | b'{' | b'}' | b'\r' | b'\n') {
                    i += 1;
                }
                let mut text = &src[s..i];
                while pending_skip > 0 && !text.is_empty() {
                    let mut it = text.chars();
                    it.next();
                    text = it.as_str();
                    pending_skip -= 1;
                }
                if !st.skip {
                    push_text(&mut runs, text, st.b, st.i, st.u);
                }
            }
        }
    }
    if !runs.is_empty() {
        end_para(&mut runs, &mut paras);
    }
    paras
}

fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    if (0x80..0xa0).contains(&b) {
        HIGH[(b - 0x80) as usize]
    } else {
        b as char
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rtf_paragraphs_marks_and_unicode() {
        let src = r"{\rtf1\ansi{\fonttbl{\f0 Courier;}}{\colortbl;\red0\green0\blue0;}\f0 Hello \b bold\b0  and \i it\i0 .\par Caf\'e9 \u8212? done\par}";
        let p = rtf(src);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].text(), "Hello bold and it.");
        assert!(p[0].runs.iter().any(|r| r.bold && r.text == "bold"));
        assert!(p[0].runs.iter().any(|r| r.italic && r.text == "it"));
        assert_eq!(p[1].text(), "Café — done");
    }

    #[test]
    fn docx_round_trip_through_our_own_writer() {
        let doc: crate::export::ExportDoc = serde_json::from_value(serde_json::json!({
            "title": "T", "template": "screenplay",
            "blocks": [
                {"kind": "scene_heading", "runs": [{"text": "INT. HOUSE - DAY"}]},
                {"kind": "character", "runs": [{"text": "ANNA"}]},
                {"kind": "dialogue", "runs": [{"text": "Hi "}, {"text": "there", "italic": true}]},
            ]
        }))
        .unwrap();
        let bytes = crate::export::docx(&doc).unwrap();
        let paras = docx(&bytes).unwrap();
        assert_eq!(paras.len(), 3);
        assert_eq!(paras[0].style, "Scene Heading");
        assert_eq!(paras[1].style, "Character");
        assert_eq!(paras[2].text(), "Hi there");
        assert!(paras[2].runs[1].italic);
    }

    #[test]
    fn pdf_text_with_positions() {
        // Typeset a tiny screenplay with our own engine, then read it back.
        let src = "#import \"/mw/screenplay.typ\": *\n#show: conf.with(title: \"T\", title-page: false)\n#el(\"scene_heading\", none)[#\"INT. HOUSE - DAY\"]\n#el(\"character\", \"scene_heading\")[#\"ANNA\"]\n#el(\"dialogue\", \"character\")[#\"Hello there.\"]\n";
        let mut engine = crate::engine::Engine::new();
        assert!(engine.compile(src, &[]).ok);
        let lines = pdf(engine.pdf().unwrap()).unwrap();
        let texts: Vec<_> = lines.iter().map(|l| l.text.as_str()).collect();
        assert_eq!(texts, ["INT. HOUSE - DAY", "ANNA", "Hello there."], "{lines:?}");
        // The cue sits about 2.2in right of the action margin, dialogue about 1in.
        assert!((lines[1].x - lines[0].x - 158.4).abs() < 3.0, "{lines:?}");
        assert!((lines[2].x - lines[0].x - 72.0).abs() < 3.0, "{lines:?}");
    }

    #[test]
    fn damaged_zip_files_are_errors_not_crashes() {
        let good = crate::export::zip_store(&[("word/document.xml", b"<x/>".to_vec())]);
        // Every truncation, and every single-byte corruption of the header fields, must return Ok or Err.
        for n in 0..good.len() {
            let _ = unzip_entry(&good[..n], "word/document.xml");
        }
        for i in 0..good.len() {
            for v in [0u8, 0xff, 0x7f] {
                let mut bad = good.clone();
                bad[i] = v;
                let _ = unzip_entry(&bad, "word/document.xml");
                let _ = docx(&bad);
            }
        }
        assert!(unzip_entry(b"not a zip", "x").is_err());
    }

    #[test]
    fn zip_bombs_are_refused() {
        // 300 MB of zeros compresses to a few hundred KB.
        let big = vec![0u8; 300 * 1024 * 1024];
        let deflated = miniz_oxide::deflate::compress_to_vec(&big, 6);
        drop(big);
        // Build a one-entry zip by hand with method 8.
        let mut z = Vec::new();
        let name = b"word/document.xml";
        z.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        z.extend_from_slice(&[20, 0, 0, 0, 8, 0, 0, 0, 0x21, 0]);
        z.extend_from_slice(&0u32.to_le_bytes());
        z.extend_from_slice(&(deflated.len() as u32).to_le_bytes());
        z.extend_from_slice(&(300u32 * 1024 * 1024).to_le_bytes());
        z.extend_from_slice(&(name.len() as u16).to_le_bytes());
        z.extend_from_slice(&0u16.to_le_bytes());
        z.extend_from_slice(name);
        z.extend_from_slice(&deflated);
        let cd = z.len() as u32;
        z.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        z.extend_from_slice(&[20, 0, 20, 0, 0, 0, 8, 0, 0, 0, 0x21, 0]);
        z.extend_from_slice(&0u32.to_le_bytes());
        z.extend_from_slice(&(deflated.len() as u32).to_le_bytes());
        z.extend_from_slice(&(300u32 * 1024 * 1024).to_le_bytes());
        z.extend_from_slice(&(name.len() as u16).to_le_bytes());
        z.extend_from_slice(&[0u8; 12]);
        z.extend_from_slice(&0u32.to_le_bytes());
        z.extend_from_slice(name);
        let cd_size = z.len() as u32 - cd;
        z.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        z.extend_from_slice(&[0, 0, 0, 0, 1, 0, 1, 0]);
        z.extend_from_slice(&cd_size.to_le_bytes());
        z.extend_from_slice(&cd.to_le_bytes());
        z.extend_from_slice(&0u16.to_le_bytes());
        assert!(unzip_entry(&z, "word/document.xml").is_err(), "a 300 MB entry must be refused");
    }
}
