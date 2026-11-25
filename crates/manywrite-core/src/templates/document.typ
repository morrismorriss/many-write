// Document: a plain document, like a word processor page. Headings,
// paragraphs, lists, to-dos, quotes, callouts and dividers.

#import "bubbles.typ": text-bubble

#let mw-num = counter("mw-num")

#let conf(
  title: none, subtitle: none, author: none, contact: none, date: none, cover: none, title-page: false,
  font: "Libertinus Serif", paper: "us-letter",
  page-fill: white, text-fill: black,
  body,
) = {
  set document(title: if title != none { title } else { "Untitled" })
  set text(font: font, size: 11.5pt, fill: text-fill, lang: "en", costs: (orphan: 100%, widow: 100%))
  set par(justify: false, leading: 0.7em, spacing: 0.7em)
  // Page numbers: top right, from page 1.
  set page(paper: paper, fill: page-fill, margin: (x: 1in, y: 1in),
    header: context align(right, text(size: 9pt, counter(page).display())))
  // A title page the writer typed (titlepage.typ) comes first, in place of the automatic one.
  if cover != none { cover }
  body
}

// Items of one list (and the lists nested in it) sit close together; a new list
// (or a different kind) gets a paragraph gap. Nested items step in one marker width per level.
#let family(kind) = if kind in ("todo", "todo_done") { "todo" } else { kind }
#let list-kinds = ("bullet", "numbered", "todo", "todo_done")
#let list-item(kind, prev, level, prev-level, marker, body) = block(
  above: if family(kind) == family(prev) or (prev in list-kinds and (level > 0 or prev-level > 0)) { 0.45em } else { 0.9em },
  below: 0pt,
  pad(left: level * 2.15em, grid(columns: (1.6em, 1fr), column-gutter: 0.55em, align(right, marker), body)))
// Bullets by level: disc, circle, square, then round again.
#let bullet-marker(level) = ([•], [◦], [▪]).at(calc.rem(level, 3))

#let el(kind, prev, level: 0, prev-level: 0, num: none, body) = {
  let gap = 0.9em
  if kind in ("text_left", "text_right") {
    text-bubble(kind, prev, body)
  } else if kind == "title" {
    block(sticky: true, above: 1.6em, below: 0.7em, text(size: 20pt, weight: "bold", body))
  } else if kind == "heading" {
    block(sticky: true, above: 1.5em, below: 0.6em, text(size: 15pt, weight: "bold", body))
  } else if kind == "subheading" {
    block(sticky: true, above: 1.2em, below: 0.5em, text(size: 12.5pt, weight: "bold", body))
  } else if kind == "bullet" {
    list-item(kind, prev, level, prev-level, bullet-marker(level), body)
  } else if kind == "numbered" {
    if num != none {
      list-item(kind, prev, level, prev-level, str(num) + ".", body)
    } else {
      if prev != "numbered" { mw-num.update(0) }
      mw-num.step()
      list-item(kind, prev, level, prev-level, context [#mw-num.get().first().], body)
    }
  } else if kind == "todo" {
    list-item(kind, prev, level, prev-level, box(width: 0.75em, height: 0.75em, stroke: 0.6pt, radius: 1.5pt), body)
  } else if kind == "todo_done" {
    list-item(kind, prev, level, prev-level, box(width: 0.75em, height: 0.75em, stroke: 0.6pt, radius: 1.5pt, fill: luma(60), align(center + horizon, text(size: 0.6em, fill: white, sym.checkmark))), text(fill: luma(110), strike(body)))
  } else if kind == "quote" {
    block(above: gap, below: 0pt, inset: (left: 1em), stroke: (left: 2pt + luma(170)), emph(body))
  } else if kind == "callout" {
    block(above: gap, below: 0pt, width: 100%, inset: 0.8em, radius: 4pt, fill: luma(240), body)
  } else if kind == "divider" or kind == "scene_break" {
    block(above: 1.2em, below: 0.4em, line(length: 100%, stroke: 0.5pt + luma(160)))
  } else if kind == "centered" {
    block(above: gap, below: 0pt, width: 100%, align(center, body))
  } else {
    block(above: if prev in ("bullet", "numbered", "todo", "todo_done") { gap } else { 0.7em }, below: 0pt, body)
  }
}

#let folder(title, depth, first: false) = {
  if not first { pagebreak(weak: true) }
  block(sticky: true, below: 1em, text(size: 20pt, weight: "bold", title))
}
// Each page of a document starts on a new page.
#let doc-start(title, first: false) = if not first { pagebreak(weak: true) }
