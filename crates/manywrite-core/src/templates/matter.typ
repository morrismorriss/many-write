// Front and back matter (dedication, cast of characters, acknowledgements…).
// Works inside every template: it inherits the page, font and size, and only
// sets plain prose spacing. In an essay it follows the essay's style, so a
// Works Cited (MLA) or Bibliography (Chicago) page is laid out correctly.

// Set by essay.typ; none in every other template.
#let mw-essay = state("mw-essay", none)

#let matter-start(title, first: false, centered: false) = {
  if not first { pagebreak(weak: true) }
  context {
    let essay = mw-essay.get()
    if essay != none {
      // MLA: the title centred at the top, plain. Chicago: the same, then a blank line.
      if title != "" {
        block(sticky: true, above: 0pt, below: if essay == "chicago" or essay == "chicago-notes" { 2.4em } else { 0pt }, width: 100%,
          align(center, par(first-line-indent: 0pt, title)))
      }
    } else {
      if centered { v(22%) } else { v(8%) }
      if title != "" {
        block(sticky: true, above: 0pt, below: 2.2em, width: 100%,
          align(center, text(weight: "bold", upper(title))))
      }
    }
  }
}

// A source in a Works Cited list or bibliography: a half-inch hanging indent.
#let citation(body) = context {
  let essay = mw-essay.get()
  if essay == "mla" {
    // Double-spaced throughout, no extra space between entries.
    block(above: 1em, below: 0pt, par(first-line-indent: 0pt, hanging-indent: 0.5in, body))
  } else if essay == "chicago" or essay == "chicago-notes" {
    // Single-spaced entries with a blank line between them.
    block(above: 1.4em, below: 0pt, par(first-line-indent: 0pt, hanging-indent: 0.5in, leading: 0.2em, body))
  } else {
    block(above: 0.7em, below: 0pt, par(first-line-indent: 0pt, hanging-indent: 0.5in, justify: false, body))
  }
}

#let matter-el(kind, prev, body) = {
  if kind == "citation" {
    citation(body)
  } else if kind == "heading" {
    block(sticky: true, above: 1.6em, below: 0.6em, text(weight: "bold", body))
  } else if kind == "subheading" {
    block(sticky: true, above: 1.2em, below: 0.4em, emph(body))
  } else if kind == "quote" {
    block(above: 1em, below: 0pt, pad(x: 2em, par(first-line-indent: 0pt, justify: false, emph(body))))
  } else if kind == "scene_break" {
    block(above: 1em, below: 0pt, width: 100%, align(center, "* * *"))
  } else if kind == "centered" {
    block(above: 0.9em, below: 0pt, width: 100%, align(center, par(first-line-indent: 0pt, body)))
  } else {
    block(above: 0.9em, below: 0pt, par(first-line-indent: 0pt, justify: false, body))
  }
}
