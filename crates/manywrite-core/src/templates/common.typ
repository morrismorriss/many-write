// Shared helpers for Many Write templates.
// Every template exports: conf, el(kind, prev)[body], folder(title, depth), doc-start(title).

// A centred title page used by the script formats.
#let script-title-page(title, author, contact, date) = {
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
