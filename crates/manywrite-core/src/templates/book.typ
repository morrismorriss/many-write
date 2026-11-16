// Book: chapters, headings, paragraphs, front matter, trim size and page numbers.

#let conf(
  title: none, author: none, contact: none, date: none, title-page: true,
  font: "Libertinus Serif", paper: none, trim: (6in, 9in),
  page-fill: white, text-fill: black,
  body,
) = {
  set document(title: if title != none { title } else { "Untitled" })
  set text(font: font, size: 11pt, fill: text-fill, lang: "en", hyphenate: true,
    costs: (orphan: 100%, widow: 100%))
  set par(justify: true, leading: 0.65em, spacing: 0.65em, first-line-indent: (amount: 1.5em, all: true))
  set page(width: trim.at(0), height: trim.at(1), fill: page-fill,
    margin: (inside: 0.875in, outside: 0.625in, top: 0.75in, bottom: 0.85in),
    footer: context {
      let n = counter(page).get().first()
      if n > 0 { align(center, text(size: 9pt, str(n))) }
    })
  if title-page and title != none {
    set page(footer: none)
    v(25%)
    align(center, text(size: 24pt, title))
    if author != none and author != "" { v(1.5em); align(center, text(size: 13pt, author)) }
    pagebreak()
    // Blank verso; numbering starts at 1 on the next page.
    counter(page).update(0)
    pagebreak()
  }
  body
}

#let el(kind, prev, body) = {
  if kind == "title" {
    block(sticky: true, above: 2.4em, below: 1.2em, align(center, text(size: 15pt, body)))
  } else if kind == "heading" {
    block(sticky: true, above: 2em, below: 1em, text(size: 13pt, weight: "bold", body))
  } else if kind == "subheading" {
    block(sticky: true, above: 1.5em, below: 0.8em, text(weight: "bold", body))
  } else if kind == "quote" {
    block(above: 1em, below: 1em, pad(x: 1.5em, par(first-line-indent: 0pt, body)))
  } else if kind == "scene_break" {
    block(above: 1em, below: 1em, width: 100%, align(center, sym.ast.op + h(1em) + sym.ast.op + h(1em) + sym.ast.op))
  } else if kind == "paragraph" and prev in (none, "title", "heading", "subheading", "chapter", "scene_break", "quote") {
    // No indent on the first paragraph after a heading or break.
    block(above: 0.65em, below: 0pt, par(first-line-indent: 0pt, body))
  } else {
    block(above: 0.65em, below: 0pt, par(body))
  }
}

#let folder(title, depth, first: false) = {
  pagebreak(weak: true, to: "odd")
  v(30%)
  align(center, text(size: 18pt, smallcaps(title)))
  pagebreak()
}

#let doc-start(title, first: false) = {
  pagebreak(weak: true)
  v(18%)
  block(sticky: true, below: 3em, align(center, text(size: 18pt, title)))
}
