# Many Write file format

A project is a folder of plain files. Nothing is stored anywhere else.

```
My Play/
  project.json          # title, author, format template, theme, binder order
  README.md             # this convention, written into every new project
  front-matter/         # cast list, dedication… (typeset before the script, unnumbered)
  manuscript/
    01-act-one/
      01-scene-1.md
      02-scene-2.md
  back-matter/          # acknowledgements, notes… (typeset after the script)
  characters/  research/  # Notion-style pages, one markdown file each
  archive/              # old drafts: kept, never typeset or exported
  notes/                # notes attached to binder items (linked from project.json)
  assets/               # images added with /image
  goals.json            # writing goals and the daily word log
  production.json       # production mode: locked pages and the current revision
  exports/              # PDFs and other exports
  .trash/               # deleted items and the losing side of any edit conflict
```

## Order

`project.json` holds the binder order. File names carry matching number
prefixes (`01-`, `02-`) so the folder also reads in order elsewhere. Reordering
or renaming in the app renames files; it never rewrites their contents. Files
added from outside the app appear at the end of their folder on next open.

## Safety rules

- Every save is atomic (write to a temp file, then rename).
- Each save checks the file still has the content the app last saw. If not,
  nothing is written: an untouched document reloads from disk; one with unsaved
  typing shows a banner, and whichever version you don't keep goes to `.trash/`.
- Conflict copies made by Dropbox, iCloud, OneDrive, Google Drive or Syncthing
  are detected, marked in the binder and left out of the preview and exports.
- YAML front matter at the top of a file is kept untouched.

## How script files are written

Script files follow a small, Fountain-compatible convention. Separate elements
with a blank line.

| Element | How it is written | Example |
| --- | --- | --- |
| Scene heading | A markdown heading | `## Scene 2` |
| Character cue | A line in CAPITALS, with dialogue directly under it (no blank line) | `ANNA` |
| Parenthetical | A line in (brackets) between the cue and the dialogue | `(quietly)` |
| Dialogue | The lines directly under a cue | `I told you already.` |
| Stage direction / action | Any other paragraph | `She crosses to the window.` |
| Transition | A line starting with `>` | `> BLACKOUT.` |
| Forced cue | `@` before a name (mixed case, or a cue with no dialogue) | `@McCoy` |
| Forced direction | `!` before a paragraph that would otherwise look like a cue | `!NOBODY MOVES.` |

Rules for lines that could be either a character cue or a direction:

1. A line in capitals **directly followed by a non-blank line** is a character cue.
2. A line in capitals **followed by a blank line** is a direction (`BLACKOUT.`).
3. `@` always means a character cue; `!` always means a direction.

Emphasis uses markdown: `*italic*`, `**bold**`, `_underline_`.

## How poem files are written

The first line may be a title (`# Title`). Every other line is a line of the
poem, exactly as written: indentation and blank lines (stanza breaks) are kept.
Emphasis uses markdown: `*italic*`, `**bold**`.

## How files are written

Ordinary markdown: `##` headings, paragraphs separated by blank lines,
`> ` for quotations, `* * *` for a scene break, `*italic*` and `**bold**`.

## Notes, characters and research pages

These use markdown that Obsidian also understands:

| Block | Written as |
| --- | --- |
| Headings | `#`, `##`, `###` |
| Bulleted / numbered list | `- item`, `1. item` |
| To-do | `- [ ] task`, `- [x] done` |
| Quote | `> text` |
| Callout | `> [!note] text` |
| Text message | `> [!text-left] text` (the other person), `> [!text-right] text` (the phone's owner) |
| Divider | `---` |
| Image | `![caption](assets/picture-1a2b3c.png)` |

## Front and back matter

Ordinary prose markdown. A centred line is written `-> text <-` (MultiMarkdown).
A page made only of centred lines or quotes (a dedication, an epigraph) is set lower on the page.
In front and back matter, a `- ` line is a source in a Works Cited list or bibliography, set with a half-inch hanging indent.

Books, articles and essays write text-message bubbles the same way as documents: `> [!text-left] text` and `> [!text-right] text`.
A book's scene-break style is a project setting (`settings.sceneBreak`: `asterisks`, `line`, `hearts` or `image`, with `settings.sceneBreakImage` pointing into `assets/`); the file always says `* * *`.

## Essays

`project.json` keeps the essay's style and heading details in `settings`: `essayStyle` (`mla` or `chicago`), `instructor`, `course` and `date` (empty means today).
MLA puts the name, instructor, course and date at the top left of page 1, the title centred under them, and "Surname n" at the top right of every page.
Chicago starts with a title page (unless turned off) and numbers pages from 2. Both are 12pt, double-spaced, with 1in margins.

## production.json

Written when you lock pages for production:

- `anchors`: for each locked page, the line it started on (`docId`, its position, and a short hash of that line plus the two after it, so a repeated line such as a character cue is still found after lines are added above it).
- `baseline`: each document's text at the start of the current revision. A page whose lines differ from it has been revised: it prints with a letter (3A) and, the first time, its old version is copied into `archive/` as "Page 3 — replaced in White revision".
- `snapshot`: hashes of every line at the start of the revision, for the margin asterisks.
- `pageLetters` / `currentLetters`: letters kept from earlier revisions, and the ones chosen in this revision (1 = A).
- `archived`: which archive document holds each replaced page.

Deleting the file leaves production mode; your script files are never touched by it.

## project.json

```json
{
  "app": "many-write",
  "formatVersion": 1,
  "title": "My Play",
  "author": "",
  "template": "stage-play",
  "theme": "pink",
  "settings": { "titlePage": true, "paper": "us-letter" },
  "binder": [
    { "id": "…", "kind": "folder", "title": "Manuscript", "file": "manuscript", "role": "manuscript",
      "children": [ { "id": "…", "kind": "doc", "title": "Scene 1", "file": "01-scene-1.md",
                      "notes": "notes/scene-1-3fa2c1.md" } ] }
  ]
}
```
