// Article: title, headings, paragraphs, quotes.

#import "bubbles.typ": text-bubble

#let conf(
  title: none, subtitle: none, author: none, contact: none, date: none, title-page: false,
  font: "Libertinus Serif", paper: "us-letter",
  page-fill: white, text-fill: black,
  body,
) = {
  set document(title: if title != none { title } else { "Untitled" })
  set text(font: font, size: 11.5pt, fill: text-fill, lang: "en",
    costs: (orphan: 100%, widow: 100%))
  set par(justify: false, leading: 0.75em, spacing: 1.1em)
  set page(paper: paper, fill: page-fill, margin: (x: 1.2in, y: 1in),
    footer: context align(center, text(size: 9pt, counter(page).display())))
  if title != none {
    block(below: 0.6em, text(size: 22pt, weight: "bold", title))
    if subtitle != none and subtitle != "" { block(below: 0.8em, text(size: 14pt, fill: text-fill.transparentize(20%), subtitle)) }
    if author != none and author != "" { block(below: 2em, text(fill: text-fill.transparentize(30%), author)) }
  }
  body
}

#let el(kind, prev, body) = {
  if kind in ("text_left", "text_right") {
    text-bubble(kind, prev, body)
  } else if kind == "title" {
    block(sticky: true, above: 1.5em, below: 0.8em, text(size: 18pt, weight: "bold", body))
  } else if kind == "heading" {
    block(sticky: true, above: 1.8em, below: 0.8em, text(size: 14pt, weight: "bold", body))
  } else if kind == "subheading" {
    block(sticky: true, above: 1.4em, below: 0.6em, text(weight: "bold", body))
  } else if kind == "quote" {
    block(above: 1.1em, below: 0pt, inset: (left: 1em), stroke: (left: 2pt + luma(180)), emph(body))
  } else if kind == "scene_break" {
    block(above: 1.1em, below: 0pt, width: 100%, align(center, "* * *"))
  } else {
    block(above: 1.1em, below: 0pt, body)
  }
}

#let folder(title, depth, first: false) = none
#let doc-start(title, first: false) = none
