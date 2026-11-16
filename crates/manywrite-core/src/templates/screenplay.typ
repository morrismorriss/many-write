// Screenplay: scene heading, action, character, parenthetical, dialogue, transition.
// Industry layout: Courier 12pt, 1.5in left margin, dialogue 2.5in from the page edge.
#import "common.typ": script-title-page, script-header, rev-marks, mw-lock, mw-rev, mw-front-start, mw-body-start

#let line-h = 12pt

#let conf(
  title: none, author: none, contact: none, date: none, title-page: true,
  font: "Courier Prime", paper: "us-letter",
  page-fill: white, text-fill: black,
  revision: none,
  body,
) = {
  set document(title: if title != none { title } else { "Untitled" })
  set text(font: font, size: 12pt, fill: text-fill, lang: "en",
    top-edge: 0.8em, bottom-edge: -0.2em, hyphenate: false,
    costs: (orphan: 100%, widow: 100%))
  set par(leading: 0pt, spacing: line-h, justify: false)
  set page(paper: paper, fill: page-fill,
    margin: (left: 1.5in, right: 1in, top: 1in, bottom: 1in),
    header: script-header(revision),
    foreground: rev-marks)
  if title-page and title != none {
    script-title-page(title, author, contact, date)
  }
  body
}

#let gap(kind, prev) = {
  if kind in ("dialogue", "parenthetical") and prev in ("character", "parenthetical", "dialogue") { 0pt }
  else if kind == "scene_heading" { line-h * 2 }
  else { line-h }
}

#let el(kind, prev, body) = {
  let above = gap(kind, prev)
  if kind == "scene_heading" {
    block(sticky: true, above: above, below: 0pt, width: 100%, upper(body))
  } else if kind == "character" {
    block(sticky: true, above: above, below: 0pt, width: 100%, pad(left: 2.2in, upper(body)))
  } else if kind == "parenthetical" {
    block(sticky: true, above: above, below: 0pt, width: 100%, pad(left: 1.6in, right: 2in, body))
  } else if kind == "dialogue" {
    block(above: above, below: 0pt, width: 100%, pad(left: 1in, right: 1.5in, body))
  } else if kind == "transition" {
    block(above: above, below: 0pt, width: 100%, align(right, upper(body)))
  } else {
    block(above: above, below: 0pt, width: 100%, body)
  }
}

#let folder(title, depth, first: false) = none
#let doc-start(title, first: false) = none
