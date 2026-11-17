// Document: a plain document, like a word processor page. Headings,
// paragraphs, lists, to-dos, quotes, callouts and dividers.

#import "bubbles.typ": text-bubble

#let mw-num = counter("mw-num")

#let conf(
  title: none, subtitle: none, author: none, contact: none, date: none, title-page: false,
  font: "Libertinus Serif", paper: "us-letter",
  page-fill: white, text-fill: black,
  body,
) = {
  set document(title: if title != none { title } else { "Untitled" })
  set text(font: font, size: 11.5pt, fill: text-fill, lang: "en", costs: (orphan: 100%, widow: 100%))
  set par(justify: false, leading: 0.7em, spacing: 0.7em)
  set page(paper: paper, fill: page-fill, margin: (x: 1in, y: 1in),
    footer: context {
      let n = counter(page).get().first()
      if n > 1 { align(center, text(size: 9pt, str(n))) }
    })
  body
}

// Items of one list sit close together; a new list (or a different kind) gets a paragraph gap.
#let family(kind) = if kind in ("todo", "todo_done") { "todo" } else { kind }
#let list-item(kind, prev, marker, body) = block(
  above: if family(kind) == family(prev) { 0.45em } else { 0.9em }, below: 0pt,
  grid(columns: (1.6em, 1fr), column-gutter: 0.55em, align(right, marker), body))

#let el(kind, prev, body) = {
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
    list-item(kind, prev, [•], body)
  } else if kind == "numbered" {
    if prev != "numbered" { mw-num.update(0) }
    mw-num.step()
    list-item(kind, prev, context [#mw-num.get().first().], body)
  } else if kind == "todo" {
    list-item(kind, prev, box(width: 0.75em, height: 0.75em, stroke: 0.6pt, radius: 1.5pt), body)
  } else if kind == "todo_done" {
    list-item(kind, prev, box(width: 0.75em, height: 0.75em, stroke: 0.6pt, radius: 1.5pt, fill: luma(60), align(center + horizon, text(size: 0.6em, fill: white, sym.checkmark))), text(fill: luma(110), strike(body)))
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
