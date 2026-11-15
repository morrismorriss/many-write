// Poem: title and lines. Line breaks and indentation are preserved exactly;
// nothing is reflowed or justified. Long lines wrap with a hanging indent.

#let conf(
  title: none, author: none, contact: none, date: none, title-page: false,
  font: "Libertinus Serif", paper: "us-letter",
  page-fill: white, text-fill: black,
  body,
) = {
  set document(title: if title != none { title } else { "Untitled" })
  set text(font: font, size: 12pt, fill: text-fill, lang: "en", hyphenate: false,
    costs: (orphan: 100%, widow: 100%))
  set par(justify: false, leading: 0.6em, spacing: 0.6em, hanging-indent: 2em)
  set page(paper: paper, fill: page-fill, margin: 1.25in,
    footer: context align(center, text(size: 10pt, counter(page).display())))
  if title-page and title != none {
    align(center, text(size: 20pt, title))
    if author != none and author != "" { align(center, emph(author)) }
    v(3em)
  }
  body
}

// Stanzas of up to 12 lines never break across pages.
#let stanza(body, lines: 1) = block(breakable: lines > 12, above: 1.4em, below: 0pt, body)

#let el(kind, prev, body) = {
  if kind == "title" {
    block(sticky: true, above: 2.5em, below: 1.2em, text(size: 15pt, weight: "bold", body))
  } else {
    block(above: 0.6em, below: 0pt, body)
  }
}

#let folder(title, depth, first: false) = none
#let doc-start(title, first: false) = if not first { pagebreak(weak: true) }
