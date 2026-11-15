# Third-party components

Many Write is Apache-2.0. Everything it bundles is under a permissive or font licence.

| Component | Use | Licence |
| --- | --- | --- |
| [Typst](https://github.com/typst/typst) (`typst`, `typst-layout`, `typst-pdf`, `typst-svg`) | Typesetting engine for preview and PDF | Apache-2.0 |
| `typst-assets` fonts: Libertinus Serif, New Computer Modern, DejaVu Sans Mono | Page fonts for book, article, poem | SIL OFL 1.1 / GUST / Bitstream Vera |
| [Courier Prime](https://github.com/quoteunquoteapps/CourierPrime) (`crates/manywrite-core/fonts`) | Page font for plays and screenplays | SIL OFL 1.1 (see `OFL-CourierPrime.txt`) |
| Inter, Literata, Courier Prime via `@fontsource` | UI and writing fonts | SIL OFL 1.1 |
| [Tauri](https://tauri.app) and plugins | Desktop shell | MIT / Apache-2.0 |
| React, TipTap, ProseMirror | UI and editor | MIT |
| tiny_http (dev server only, not shipped in the app) | Browser development | MIT / Apache-2.0 |

Pandoc is **not** used or bundled: Word and EPUB files are written directly by
`crates/manywrite-core/src/export.rs`, so there is no GPL dependency.
