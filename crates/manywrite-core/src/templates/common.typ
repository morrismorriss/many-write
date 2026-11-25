// Shared helpers for Many Write templates.
// Every template exports: conf, el(kind, prev)[body], folder(title, depth), doc-start(title).

// A centred title page used by the script formats.
#let script-title-page(title, author, contact, date, subtitle: none) = {
  set page(header: none, footer: none)
  v(1fr)
  align(center)[
    #upper(strong(title))
    #if subtitle != none and subtitle != "" [
      #v(1em)
      #subtitle
    ]
    #if author != none and author != "" [
      #v(2em)
      by
      #v(1em)
      #author
    ]
  ]
  v(1.4fr)
  if contact != none and contact != "" {
    block(width: 50%, contact)
  }
  if date != none and date != "" {
    align(right, date)
  }
  // The automatic page step makes the first page after this one page 1.
  counter(page).update(0)
  pagebreak()
}

// ------------------------------------------------------------ production mode
// Front matter (cast list, dedication…) carries no page number. Its start and end are
// marked with metadata rather than a state: a page's header is laid out before the
// content at the top of that page, so a state updated there would not be seen in time.
#let mw-front-mark(on) = [#metadata(on) <mw-front>]

// Whether the current page is front matter. A start mark counts from its own page;
// an end mark sits on the last front page, before the break into the script, so it
// counts from the page after it.
#let in-front-matter() = {
  let here-page = here().page()
  let on = false
  for m in query(<mw-front>) {
    let p = m.location().page()
    if m.value and p <= here-page { on = true }
    else if not m.value and p < here-page { on = false }
  }
  on
}

// A lock marks the line that began a page when the script was locked.
// Hard locks start a new page; soft ones (a speech that was split across a
// page break) say "the page after this one is page n".
// `start` is the page's letter (1 = A): an edited page 3 is "3A", and its overflow "3B".
#let mw-lock(n, hard: true, start: 0) = {
  if hard { pagebreak(weak: true) }
  [#metadata((page: n, hard: hard, start: start)) <mw-lock>]
}

// Marks a revised line; the page foreground draws an asterisk in the margin.
#let mw-rev() = [#metadata("rev") <mw-rev>]

// Front matter starts; and, before the page break into the script, numbering restarts at 1.
#let mw-front-start() = mw-front-mark(true)
#let mw-body-start() = {
  mw-front-mark(false)
  counter(page).update(0)
}

// A play inside a collection (a trilogy…): a new page with its own centred
// title page. Its front matter follows unnumbered; the act after it starts at page 1.
#let mw-play(title, author, first: false) = {
  if not first { pagebreak(weak: true) }
  mw-front-mark(true)
  set page(header: none, footer: none)
  v(1fr)
  align(center)[
    #upper(strong(title))
    #if author != none and author != "" [
      #v(2em)
      by
      #v(1em)
      #author
    ]
  ]
  v(1.4fr)
  pagebreak()
}

// A title page the writer typed (a front matter page called "Title page").
// `middle` is centred halfway down the page; `bottom` sits at the bottom left.
// `play`: a collection play's title page, which starts that play's front matter.
#let mw-title-page(middle, bottom, first: false, play: false) = {
  if not first { pagebreak(weak: true) }
  if play { mw-front-mark(true) }
  set page(header: none, footer: none)
  v(1fr)
  align(center, middle)
  v(1.4fr)
  if bottom != none { block(width: 60%, bottom) }
  if not play { counter(page).update(0) }
  pagebreak()
}

// One line of a typed title page.
#let mw-tp-line(body) = block(above: 0pt, below: 0pt, width: 100%, body)

#let extra-letters(n) = {
  let s = ""
  let k = n
  while k > 0 {
    s = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".at(calc.rem(k - 1, 26)) + s
    k = calc.floor((k - 1) / 26)
  }
  s
}

// The number printed on the current page: 12, or 12A, 12B for added pages.
#let script-page-label() = {
  if in-front-matter() { return none }
  let here-page = here().page()
  let locks = query(<mw-lock>)
  if locks.len() == 0 or here-page < locks.first().location().page() {
    return str(counter(page).get().first())
  }
  let base = none
  let extra = 0
  for p in range(locks.first().location().page(), here-page + 1) {
    let hard = locks.filter(m => m.value.hard and m.location().page() == p)
    let soft = locks.filter(m => not m.value.hard and m.location().page() == p - 1)
    if hard.len() > 0 { base = hard.first().value.page; extra = hard.first().value.at("start", default: 0) }
    else if soft.len() > 0 { base = soft.first().value.page; extra = soft.first().value.at("start", default: 0) }
    else if base != none { extra += 1 }
  }
  if base == none { return none }
  str(base) + extra-letters(extra)
}

#let script-header(revision) = context {
  let label = script-page-label()
  grid(columns: (1fr, auto),
    if revision != none and revision != "" { text(size: 9pt, revision) },
    if label != none [#label.])
}

#let rev-marks = context {
  for m in query(<mw-rev>) {
    let loc = m.location()
    if loc.page() == here().page() {
      place(top + left, dx: page.width - 0.75in, dy: loc.position().y, text(weight: "bold", "*"))
    }
  }
}
