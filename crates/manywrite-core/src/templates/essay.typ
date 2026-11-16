// Essay: an academic paper in MLA or Chicago style. 12pt, double-spaced,
// 1in margins, half-inch paragraph indents and a running page header.
//
// MLA (9th ed.): no title page. A heading block on page 1 (name, instructor,
// course, date), the title centred, "Surname n" at the top right of every page.
// Chicago (17th ed., student paper): a title page when asked for, then the
// text with page numbers at the top right; the first text page is page 2.

// Read by matter.typ, so Works Cited and Bibliography pages follow the style.
#let mw-essay = state("mw-essay", none)

// Line box of exactly 1em, so leading 1em is true double spacing (2em per line).
#let double = 1em
#let single = 0.2em

#let surname(author) = {
  let words = author.trim().split(" ").filter(w => w != "")
  if words.len() == 0 { "" } else { words.last() }
}

#let conf(
  title: none, subtitle: none, author: none, contact: none, date: none, title-page: false,
  style: "mla", instructor: "", course: "",
  font: "Libertinus Serif", paper: "us-letter",
  page-fill: white, text-fill: black,
  body,
) = {
  let title = if title != none and title != "" { title } else { "Untitled" }
  // MLA and Chicago both join a subtitle to the title with a colon.
  if subtitle != none and subtitle != "" { title = title + ": " + subtitle }
  let author = if author != none { author } else { "" }
  let date = if date != none { date } else { "" }
  let chicago = style == "chicago"
  set document(title: title)
  set text(font: font, size: 12pt, fill: text-fill, lang: "en", hyphenate: false,
    top-edge: 0.8em, bottom-edge: -0.2em,
    costs: (orphan: 100%, widow: 100%))
  set par(justify: false, leading: double, spacing: double,
    first-line-indent: (amount: 0.5in, all: true))
  let name = surname(author)
  set page(paper: paper, fill: page-fill, margin: 1in, header-ascent: 0.5in - 1em,
    header: context {
      let n = counter(page).get().first()
      if chicago {
        if n > 1 { align(right, str(n)) }
      } else {
        align(right, if name != "" [#name #n] else [#n])
      }
    })
  mw-essay.update(style)

  if chicago and title-page {
    // Title page: title a third of the way down; name, course, instructor and date lower.
    set page(header: none)
    set par(first-line-indent: 0pt)
    v(2.2in)
    align(center, title)
    v(1fr)
    align(center, {
      if author != "" { author; linebreak() }
      if course != "" { course; linebreak() }
      if instructor != "" { instructor; linebreak() }
      if date != "" { date }
    })
    v(1.6in)
    pagebreak()
    // The title page counts as page 1 but carries no number.
  } else if chicago {
    block(above: 0pt, below: double, width: 100%, align(center, par(first-line-indent: 0pt, title)))
    let by = (author, course, instructor, date).filter(x => x != "")
    if by.len() > 0 {
      block(above: 0pt, below: double, width: 100%, align(center, par(first-line-indent: 0pt, by.join(linebreak()))))
    }
  } else {
    // MLA heading block: left aligned and double-spaced, then the title centred.
    let lines = (author, instructor, course, date).filter(x => x != "")
    for l in lines { block(above: 0pt, below: double, par(first-line-indent: 0pt, l)) }
    block(above: 0pt, below: double, width: 100%, align(center, par(first-line-indent: 0pt, title)))
  }
  body
}

#let el(kind, prev, body) = context {
  let chicago = mw-essay.get() == "chicago"
  if kind == "title" or kind == "heading" {
    block(sticky: true, above: double, below: 0pt, width: 100%,
      if chicago { align(center, par(first-line-indent: 0pt, strong(body))) } else { par(first-line-indent: 0pt, strong(body)) })
  } else if kind == "subheading" {
    block(sticky: true, above: double, below: 0pt, par(first-line-indent: 0pt, emph(body)))
  } else if kind == "quote" {
    // Block quotation: indented half an inch; Chicago sets it single-spaced with a blank line around it.
    if chicago {
      block(above: 1.4em, below: 1.4em, inset: (left: 0.5in), par(first-line-indent: 0pt, leading: single, body))
    } else {
      block(above: double, below: 0pt, inset: (left: 0.5in), par(first-line-indent: 0pt, body))
    }
  } else if kind == "scene_break" {
    block(above: double, below: 0pt, width: 100%, align(center, "* * *"))
  } else {
    // par(): a lone body in a block is not a paragraph, so it would miss the indent.
    block(above: double, below: 0pt, par(body))
  }
}

#let folder(title, depth, first: false) = {
  block(sticky: true, above: double, below: 0pt, width: 100%, align(center, par(first-line-indent: 0pt, strong(title))))
}
#let doc-start(title, first: false) = none
