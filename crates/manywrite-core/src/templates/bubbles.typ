// Text-message bubbles for books, articles and documents: grey on the left
// (the other person), blue on the right (the phone's owner). A bubble is as
// wide as its text, up to about two thirds of the line.

#let text-bubble(kind, prev, body) = {
  let mine = kind == "text_right"
  // Messages in one exchange sit close together.
  let gap = if prev in ("text_left", "text_right") { if prev == kind { 0.3em } else { 0.55em } } else { 1em }
  block(above: gap, below: 0pt, width: 100%, layout(size => {
    let inner = text(fill: if mine { white } else { black }, body)
    let w = calc.min(measure(inner).width, size.width * 0.66)
    align(if mine { right } else { left },
      block(width: w + 1.6em, inset: (x: 0.8em, y: 0.45em), radius: 0.95em, breakable: false,
        fill: if mine { rgb("#2f7cf6") } else { luma(229) },
        par(first-line-indent: 0pt, hanging-indent: 0pt, justify: false, leading: 0.5em, inner)))
  }))
}
