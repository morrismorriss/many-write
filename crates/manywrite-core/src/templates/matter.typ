// Front and back matter (dedication, cast of characters, acknowledgements…).
// Works inside every template: it inherits the page, font and size, and only
// sets plain prose spacing.

#let matter-start(title, first: false, centered: false) = {
  if not first { pagebreak(weak: true) }
  if centered { v(22%) } else { v(8%) }
  if title != "" {
    block(sticky: true, above: 0pt, below: 2.2em, width: 100%,
      align(center, text(weight: "bold", upper(title))))
  }
}

#let matter-el(kind, prev, body) = {
  if kind == "heading" {
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
