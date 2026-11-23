// Stage play: character cue, dialogue, stage direction, scene heading, transition.
#import "common.typ": script-title-page, script-header, rev-marks, mw-lock, mw-rev, mw-front-start, mw-body-start, mw-play

#let line-h = 12pt

#let conf(
  title: none, subtitle: none, author: none, contact: none, date: none, title-page: true,
  font: "Courier Prime", paper: "us-letter",
  page-fill: white, text-fill: black,
  revision: none,
  body,
) = {
  set document(title: if title != none { title } else { "Untitled" })
  set text(font: font, size: 12pt, fill: text-fill, lang: "en",
    top-edge: 0.8em, bottom-edge: -0.2em, hyphenate: false,
    // Hard rule: never leave a single line of a paragraph alone on a page.
    costs: (orphan: 100%, widow: 100%))
  set par(leading: 0pt, spacing: line-h, justify: false)
  set page(paper: paper, fill: page-fill,
    margin: (left: 1.5in, right: 1in, top: 1in, bottom: 1in),
    header: script-header(revision),
    foreground: rev-marks)
  if title-page and title != none {
    script-title-page(title, author, contact, date, subtitle: subtitle)
  }
  body
}

#let gap(kind, prev) = {
  if kind in ("dialogue", "parenthetical", "lyric") and prev in ("character", "parenthetical", "dialogue", "lyric") { 0pt }
  else if kind in ("scene_heading", "song") { line-h * 2 }
  else { line-h }
}

#let el(kind, prev, body) = {
  let above = gap(kind, prev)
  if kind == "scene_heading" {
    block(sticky: true, above: above, below: 0pt, width: 100%, align(center, strong(upper(body))))
  } else if kind == "character" {
    // Sticky: a cue always moves to the next page with its dialogue.
    block(sticky: true, above: above, below: 0pt, width: 100%, align(center, upper(body)))
  } else if kind == "parenthetical" {
    block(sticky: true, above: above, below: 0pt, width: 100%, pad(left: 1.5in, right: 1.5in, emph(body)))
  } else if kind == "dialogue" {
    block(above: above, below: 0pt, width: 100%, body)
  } else if kind == "song" {
    // Musicals: the song's title, centred, before its first cue.
    block(sticky: true, above: above, below: 0pt, width: 100%, align(center, strong(underline(upper(body)))))
  } else if kind == "lyric" {
    // A sung line: in italics, one line of the song per line.
    block(above: above, below: 0pt, width: 100%, pad(left: 0.5in, emph(body)))
  } else if kind == "transition" {
    block(above: above, below: 0pt, width: 100%, align(right, upper(body)))
  } else {
    // Stage direction.
    block(above: above, below: 0pt, width: 100%, pad(left: 2.5in, emph(body)))
  }
}

#let folder(title, depth, first: false) = {
  if not first { pagebreak(weak: true) }
  block(sticky: true, above: 0pt, below: line-h * 2, width: 100%,
    align(center, strong(underline(upper(title)))))
}

// Each scene starts on a new page (Project settings can turn this off).
#let doc-start(title, first: false, new-page: true) = {
  if new-page and not first { pagebreak(weak: true) }
}
