# Many Write

A local-first desktop writing app for **stage plays, screenplays, essays, books, articles, poems and plain documents**.

- **Binder with notes**: acts, scenes, characters and research in a sidebar, with a notes file beside each item.
- **Script formatting with Enter/Tab flow**: type a name and press Enter for dialogue; press Enter again for the next speaker.
- **Live typeset preview**: the actual page, updated as you type. Orphan lines and stranded cues are prevented and checked; a warning appears only if something goes wrong.
- **Production mode**: lock page numbers for revisions. Rewrites go onto A-pages (12A, 12B…), changed lines get a margin asterisk, and the header names the revision colour.
- **Notion-style pages**: type `/` anywhere for blocks. Characters and research pages have to-dos, lists, callouts, dividers and images.
- **Open and import**: open a single document on its own, or import Word, Final Draft, Fountain, PDF, RTF and Scrivener projects.
- **Plain files**: every scene is a markdown file in a folder you own. No account, no cloud, no lock-in.

![Stage play in the light theme](docs/screenshots/stage-play-light.png)

| Production mode | Character page | Words and pages |
| --- | --- | --- |
| ![Locked pages with an A-page and revision marks](docs/screenshots/production.png) | ![Notion-style character page](docs/screenshots/character-page.png) | ![Words and pages per scene](docs/screenshots/stats.png) |

| Dark | Pink | Theme builder |
| --- | --- | --- |
| ![Dark](docs/screenshots/dark.png) | ![Pink](docs/screenshots/pink.png) | ![Theme builder](docs/screenshots/theme-builder.png) |

## Writing a play

| You do | You get |
| --- | --- |
| Type a name, press **Enter** | The next line is **dialogue** |
| Press **Enter** after dialogue | A new **character** line for the next speaker |
| Press **Enter** on an empty character line | It becomes a **stage direction** |
| Press **Enter** on an empty line again | It cycles on to **transition**, then **scene heading** |
| Type **(** on an empty dialogue line | A **parenthetical**, with the cursor inside `()` |
| **Tab** / **Shift-Tab**, or the type menu | Change the current line's type |
| **⌘⌥1…6** (Ctrl+Alt on Windows/Linux) | Jump to a specific type |
| A character line | A list of the names you have used; type to filter, **↑ ↓** and **Enter** (or click) to pick |
| **/** at the start of a line | The block menu: type to filter (`/trans`, `/todo`, `/image`), **Enter** to apply |

Screenplays have their own Enter/Tab flow. Poems keep every line break and indent exactly (Tab indents). Books and articles use paragraphs, headings and quotes. Books, articles and documents also have **text-message bubbles** (`/text`, left or right), and a book's scene breaks can be asterisks, a line, three hearts or your own picture (File › Project settings).

**Essays** come in **MLA** or **Chicago** style, chosen when you create the project: double-spaced 12pt pages, MLA's heading block and "Surname 1" running header, or Chicago's title page. A **Works Cited** (MLA) or **Bibliography** (Chicago) page is added to the back matter with example entries; each `- ` line is one source with a hanging indent. Both are also offered for any project under Back matter › +. Instructor, course and date are in File › Project settings.

## Around the editor

- **Binder**: front matter (cast list, dedication, time and place…), the manuscript, back matter, characters, research and an **archive** for old drafts. Drag to reorder, nest or archive. New scenes go next to the one you're on.
- **Notes**: every binder item has a notes page below the binder, with the same `/` blocks.
- **Find & replace** (⌘F, or ⌘⇧F for the whole script): match case, whole words, every result listed, replace one or all. Bold and italics are kept.
- **Words and pages**: the chart button above the preview lists words and pages for each scene, with totals and a running-time estimate for scripts.
- **Copyright page**: Front matter › + › Copyright lets you tick the clauses you want (all rights reserved, fiction, moral rights, external content, designations, edition, ISBN). They are common wording, not legal advice: you decide what to keep or add.
- **Archive button**: the box icon next to the trash can moves a chapter or scene to the Archive.
- **Theme pictures**: a custom theme can have a background picture behind the editor, with a slider for how strongly it shows.
- **Goals**: a daily word goal with a progress ring, a project goal with a deadline, and this week's progress, laid out the way your computer's calendar is (Sunday- or Monday-first).
- **Pomodoro timer**: the tomato in the top bar. Focus and break lengths you choose, and a happy ding when time is up.
- **File menu**: new project, new or open single document, import, recent projects, spell check on or off. Spelling uses the system dictionary on macOS, Windows and Linux.

## Production mode

When a script is going into rehearsal or production, choose **Production › Lock pages**. From then on:

- every page keeps its number; a cut leaves white space instead of renumbering;
- the first time you edit a locked page, its **old version is moved to the Archive** ("Page 3 — replaced in White revision") and the page prints as **3A**; if the rewrite runs long, it continues on 3B;
- you choose the letter: the Production panel lists every revised page with a picker (3, 3A, 3B…) and a link to its old version;
- changed and new lines are marked with **\*** in the right margin, and the header shows the revision colour (White, Blue, Pink, Yellow, Green, Goldenrod…) and date;
- **Start next revision** moves to the next colour and clears the marks; revised pages keep their letters, and a page edited again moves on (3A → 3B), with its previous version archived too;
- **Leave production mode** lets pages flow freely again.

Locks follow their lines even when you add or cut lines above them.

## Open and import

- **Open document…** edits a single `.md`, `.txt` or `.fountain` file in place, with the preview and exports, without creating a project. Plain files open in the **Document** format: headings, paragraphs, lists, to-dos, quotes and callouts, typeset as a clean page.
- **Import…** creates a new project from:

| From | What comes across |
| --- | --- |
| Word (.docx) | Opens as one Document with its headings, paragraphs and bold/italic/underline; choose Book to split it into chapters at its top headings. Script styles (Character, Dialogue…) become script elements |
| Final Draft (.fdx) | Every element and its emphasis, split into scenes; the title from the title page |
| Fountain | Elements, title page, scenes |
| PDF | The text, rebuilt into paragraphs; scripts are recognised and rebuilt into cues, dialogue, parentheticals and scenes. Scanned PDFs need text recognition first |
| RTF | Paragraphs and emphasis |
| Scrivener (.scriv) | Scrivener 2 and 3: the draft folder structure, research, Characters / Front Matter / Back Matter folders into the matching sections, each document's text, synopsis and notes; Trash and Templates are skipped. On a Mac choose the `.scriv` project itself; on Windows choose its folder or the `.scrivx` file inside. Scrivener 1 projects bring their text in order, but not their titles |

The original file is never changed.

## Your files

```
My Play/
  project.json            title, author, format, theme, binder order
  README.md               explains the convention to anyone opening the folder
  manuscript/01-act-one/01-scene-1.md
  characters/  research/  notes/  exports/  .trash/
```

A scene file reads like this in any text editor or Obsidian:

```markdown
## Scene 1

A kitchen. Morning.

ANNA
(quietly)
I told you already.

> BLACKOUT.
```

The full convention, including the rules for lines that could be a cue or a direction, is in [docs/FILE-FORMAT.md](docs/FILE-FORMAT.md). It is Fountain-compatible.

- Changes save about a second after you stop typing, as an atomic write. There is no save button.
- If a file changes on disk while it's open, the app reloads it. If you were mid-edit at the time, it asks which version to keep and puts the other one in `.trash/`. It never overwrites silently.
- Dropbox, iCloud, OneDrive and Syncthing conflict copies are detected and flagged.
- Reordering in the binder renames the number prefixes. It never rewrites the contents of a file.

## Export

| Format | Notes |
| --- | --- |
| **PDF** | Comes from the same Typst engine as the preview. Widow/orphan control is enforced, a cue is never stranded and a parenthetical stays with its dialogue. Each export is verified. |
| **Word (.docx)** | Paragraph styles with keep-with-next and widow control. Word repaginates on open. |
| **EPUB 3** | For books, articles and poems. Reflowable. |
| **Final Draft (.fdx)** | XML for scripts. Final Draft repaginates on open. |
| **Fountain** | Plain-text screenplay format. |

## Install

Download an installer from [Releases](../../releases). The builds are not code-signed yet:

- **macOS**: right-click the app, choose **Open**, then **Open** again. Or run `xattr -dr com.apple.quarantine "/Applications/Many Write.app"`.
- **Windows**: SmartScreen says "Windows protected your PC". Click **More info**, then **Run anyway**.
- **Linux**: install the `.deb`, or `chmod +x` the AppImage and run it.

## Develop

You need Node 22+ and Rust (stable). On Linux you also need the [Tauri system libraries](https://tauri.app/start/prerequisites/).

```bash
npm install
```

```bash
npm run tauri dev
```

The second command runs the desktop app with hot reload. To work in a browser instead, run `npm run dev`. It starts the core on localhost and serves the UI at http://localhost:1420. Both modes run the same Rust code.

```bash
npm test && cargo test -p manywrite-core
```

```bash
node e2e/smoke.mjs && node e2e/templates.mjs && node e2e/features.mjs && node e2e/imports.mjs
```

That runs the end-to-end checks against `npm run dev` (it needs Playwright).

```bash
npm run tauri build
```

This builds installers for the current platform. CI builds macOS, Windows and Linux installers when you push a `v*` tag (see `.github/workflows/release.yml`).

### Layout

| Path | What |
| --- | --- |
| `crates/manywrite-core` | Rust: file storage (atomic writes, conflict checks), the embedded Typst engine, the layout checker, and DOCX/EPUB writers. Typst templates are in `src/templates/`. |
| `src-tauri` | Desktop shell: one `mw_call` command into the core. |
| `crates/manywrite-devserver` | The same core over localhost HTTP, for browser development and tests. |
| `src/formats` | Templates (element types, Enter/Tab rules), the markdown convention, Typst generation, Fountain/FDX. |
| `src/project` | The open project: binder, autosave queue, outside-edit polling. |
| `src/editor` | TipTap/ProseMirror editor with the script keymap. |

**How "No orphan lines" is measured.** After each layout, the core walks every glyph on every page and traces it back to the line you typed, using Typst source spans. It then counts the lines of each paragraph on each page and checks that every cue, parenthetical and heading shares a page with what follows it. The status reflects that measurement. It is not a setting. A test in `crates/manywrite-core/tests/layout.rs` switches the rules off and confirms the checker catches the problems.

## Privacy and security

- **No internet, ever.** The desktop app contains no networking code: no updater, telemetry, analytics or font downloads. Its window may only talk to its own core (`connect-src ipc:` in the content security policy), Typst cannot fetch packages, and every font is bundled. Your writing never leaves your computer.
- **Text is never code.** Everything you type (or import) reaches the typesetter only inside string literals, so it cannot run as Typst code; this is fuzzed with hostile input. The UI never inserts HTML; the preview is shown as an image.
- **Imported files are untrusted.** Word/zip, PDF, RTF and Scrivener readers are bounds-checked, refuse decompression bombs (64 MB per entry), cannot be steered outside the project being imported, and a damaged file produces an error rather than a crash (`crates/manywrite-core/tests/security.rs`).
- **Saves are safe.** Atomic writes, conflict detection, and nothing is deleted: removed items and replaced versions go to the project's `.trash/` or `archive/`.
- **The browser dev server** (`npm run dev`, never shipped) only answers the Many Write page on `localhost`; requests from other websites and DNS-rebinding attempts are refused. To view it through a forwarding proxy (a hosted preview), start Vite with `MW_PREVIEW=1`; the app's request header is still required.

## Licence

Apache-2.0. Fonts and libraries are listed in [THIRD-PARTY.md](THIRD-PARTY.md). "Final Draft" and "Scrivener" are trademarks of their owners. Many Write is not affiliated with them.
