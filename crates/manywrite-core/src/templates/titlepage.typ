// A title page the writer typed (a front matter page called "Title page").
// Works in every template: it inherits the page, font and size. It replaces the
// template's own title page (passed to conf as `cover`), or comes before the
// text as a cover where the template has none.
#import "common.typ": mw-front-mark

// `middle` is centred halfway down the page; `bottom` sits at the bottom left.
// `play`: a collection play's title page, which starts that play's front matter.
// `reset`: the page after this one is page 1 (an essay's title page counts as page 1).
// `verso`: a blank page follows, as after a book's title page.
#let mw-title-page(middle, bottom, first: false, play: false, reset: true, verso: false) = {
  if not first { pagebreak(weak: true) }
  if play { mw-front-mark(true) }
  set page(header: none, footer: none)
  set par(first-line-indent: 0pt, justify: false)
  v(1fr)
  align(center, middle)
  v(1.4fr)
  if bottom != none { block(width: 60%, bottom) }
  if verso { pagebreak() }
  if reset and not play { counter(page).update(0) }
  pagebreak()
}

// One line of a typed title page.
#let mw-tp-line(body) = block(above: 0pt, below: 0pt, width: 100%, body)
