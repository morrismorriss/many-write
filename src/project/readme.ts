// The README written into every new project, so the files explain themselves
// to anyone who opens the folder without Many Write.

import type { Template } from "../formats/templates";

export function projectReadme(title: string, template: Template): string {
  const script = template.mode === "script";
  return `# ${title}

This folder is a **Many Write** project. Everything is plain text; you can read
and edit it with any text editor, Obsidian, or version control.

- \`manuscript/\` — the ${template.name.toLowerCase()} itself, one markdown file per ${template.docNoun.toLowerCase()}.
  Folders are ${template.folderNoun.toLowerCase()}s. Number prefixes (\`01-\`, \`02-\`) give the reading order.
- \`characters/\`, \`research/\` — your reference notes.
- \`notes/\` — notes attached to individual ${template.docNoun.toLowerCase()}s in the binder.
- \`project.json\` — title, author, format, theme and the binder order.
- \`exports/\` — PDFs and other exports (safe to delete).
- \`.trash/\` — items deleted in the app, kept here until you empty it yourself.

${script ? SCRIPT_CONVENTION : template.mode === "poem" ? POEM_CONVENTION : PROSE_CONVENTION}
`;
}

export const SCRIPT_CONVENTION = `## How script files are written

Script files follow a small, Fountain-compatible convention. Separate elements
with a blank line.

| Element | How it is written | Example |
| --- | --- | --- |
| Scene heading | A markdown heading | \`## Scene 2\` |
| Character cue | A line in CAPITALS, with dialogue directly under it (no blank line) | \`ANNA\` |
| Parenthetical | A line in (brackets) between the cue and the dialogue | \`(quietly)\` |
| Dialogue | The lines directly under a cue | \`I told you already.\` |
| Stage direction / action | Any other paragraph | \`She crosses to the window.\` |
| Transition | A line starting with \`>\` | \`> BLACKOUT.\` |
| Forced cue | \`@\` before a name (mixed case, or a cue with no dialogue) | \`@McCoy\` |
| Forced direction | \`!\` before a paragraph that would otherwise look like a cue | \`!NOBODY MOVES.\` |

Rules for lines that could be either a character cue or a direction:

1. A line in capitals **directly followed by a non-blank line** is a character cue.
2. A line in capitals **followed by a blank line** is a direction (\`BLACKOUT.\`).
3. \`@\` always means a character cue; \`!\` always means a direction.

Emphasis uses markdown: \`*italic*\`, \`**bold**\`, \`_underline_\`.
`;

export const POEM_CONVENTION = `## How poem files are written

The first line may be a title (\`# Title\`). Every other line is a line of the
poem, exactly as written: indentation and blank lines (stanza breaks) are kept.
Emphasis uses markdown: \`*italic*\`, \`**bold**\`.
`;

export const PROSE_CONVENTION = `## How files are written

Ordinary markdown: \`##\` headings, paragraphs separated by blank lines,
\`> \` for quotations, \`* * *\` for a scene break, \`*italic*\` and \`**bold**\`.
`;
