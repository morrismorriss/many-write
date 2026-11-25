// Format templates. One editor, binder and preview serve every format; a
// template only declares its element types, how Enter/Tab move between them,
// and which Typst template typesets it.

export type ElementType =
  | "scene_heading"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "direction"
  | "action"
  | "transition"
  // Musicals: a song's title, and its sung lines.
  | "song"
  | "lyric"
  | "title"
  | "line"
  | "heading"
  | "subheading"
  | "paragraph"
  | "quote"
  | "scene_break"
  // Notion-style blocks for notes, characters and research pages.
  | "bullet"
  | "numbered"
  | "todo"
  | "todo_done"
  | "callout"
  | "divider"
  // Front/back matter: a centred paragraph (dedications, epigraphs).
  | "centered"
  // A picture from the project's assets folder.
  | "image"
  // A source in a Works Cited list or bibliography (hanging indent).
  | "citation"
  // Text-message bubbles: the other person (left) and the phone's owner (right).
  | "text_left"
  | "text_right";

export type TemplateId = "stage-play" | "screenplay" | "poem" | "book" | "article" | "essay" | "document";

/** Citation style of an essay. Older projects may also say "chicago" (author–date); it still renders. */
export type EssayStyle = "mla" | "chicago-notes";
/** How Chicago notes print: at the foot of the page, or gathered at the end. */
export type NotePlacement = "footnotes" | "endnotes";

export const ESSAY_STYLES: { id: EssayStyle; name: string; description: string; sources: string }[] = [
  {
    id: "mla",
    name: "MLA",
    description: "Name, instructor, course and date at the top left; surname and page number on every page.",
    sources: "Works Cited",
  },
  {
    id: "chicago-notes",
    name: "Chicago",
    description: "A title page, then numbered pages; footnotes or endnotes, and a bibliography.",
    sources: "Bibliography",
  },
];
/** Templates used outside the manuscript. */
export type AuxTemplateId = "notes" | "matter" | "title-page";

/** How a template's files are written to and read from markdown. */
export type FileMode = "script" | "prose" | "poem" | "notes";

export interface ElementDef {
  type: ElementType;
  label: string;
  placeholder: string;
  /** Extra words the slash menu matches, e.g. "h1", "list". */
  aliases?: string[];
}

export interface Template {
  id: TemplateId | AuxTemplateId;
  name: string;
  description: string;
  mode: FileMode;
  elements: ElementDef[];
  /** Type of the first line in a new document. */
  firstElement: ElementType;
  /** Enter at the end of a non-empty line: the type of the new line. */
  afterEnter: Partial<Record<ElementType, ElementType>>;
  /** Enter on an empty line changes its type along this cycle. Empty = plain new line. */
  emptyCycle: ElementType[];
  /** Tab / Shift-Tab cycle. Empty = Tab inserts indentation (poems). */
  tabCycle: ElementType[];
  /** What Tab types instead, when set (a title page's column break). */
  tabText?: string;
  /** Enter on an empty line of these types turns it into the given type (leaving a list). */
  emptyExit?: Partial<Record<ElementType, ElementType>>;
  /** Backspace at the start of a line of these types turns it into the given type. */
  backspaceTo?: Partial<Record<ElementType, ElementType>>;
  /** Typst template file inside the engine. */
  typst: string;
  /** Default typeface for the typeset page. */
  pageFont: string;
  docNoun: string;
  folderNoun: string;
  /** New documents in the manuscript start with this content (markdown). Empty: the page shows grey hint text instead. */
  starter: (n: number) => string;
  exports: ExportFormat[];
  titlePageDefault: boolean;
}

export type ExportFormat = "pdf" | "docx" | "epub" | "fdx" | "fountain";

/** Text-message bubbles, offered in books, articles and documents. */
const BUBBLE_ELEMENTS: ElementDef[] = [
  { type: "text_left", label: "Text message (left)", placeholder: "Their message", aliases: ["text", "message", "sms", "chat", "bubble", "imessage", "left"] },
  { type: "text_right", label: "Text message (right)", placeholder: "Your message", aliases: ["text", "message", "sms", "chat", "bubble", "imessage", "right"] },
];
const BUBBLE_FLOW = {
  afterEnter: { text_left: "text_left", text_right: "text_right" } as Partial<Record<ElementType, ElementType>>,
  emptyExit: { text_left: "paragraph", text_right: "paragraph" } as Partial<Record<ElementType, ElementType>>,
  backspaceTo: { text_left: "paragraph", text_right: "paragraph" } as Partial<Record<ElementType, ElementType>>,
};

/** Songs in a musical, offered in stage plays and screenplays ("/song"). */
const SONG_ELEMENTS: ElementDef[] = [
  { type: "song", label: "Song", placeholder: "SONG TITLE", aliases: ["musical", "number", "song title"] },
  { type: "lyric", label: "Lyric", placeholder: "Sung line", aliases: ["lyrics", "sing", "sung", "verse", "chorus"] },
];
/**
 * A song's title is followed by a cue; each lyric is its own line, so Enter
 * starts the next one. Enter on an empty lyric turns it into the next singer's
 * cue (and a cue inside a song is followed by lyrics; see `inSong`).
 */
const SONG_FLOW = {
  afterEnter: { song: "character", lyric: "lyric" } as Partial<Record<ElementType, ElementType>>,
  emptyExit: { lyric: "character" } as Partial<Record<ElementType, ElementType>>,
};

const scriptExports: ExportFormat[] = ["pdf", "docx", "fdx", "fountain", "epub"];
const proseExports: ExportFormat[] = ["pdf", "docx", "epub"];

export const TEMPLATES: Record<TemplateId, Template> = {
  // Defined below NOTE_ELEMENTS; filled in after.
  document: undefined as unknown as Template,
  "stage-play": {
    id: "stage-play",
    name: "Stage play",
    description: "Character cues, dialogue and stage directions, typeset for the rehearsal room.",
    mode: "script",
    elements: [
      { type: "character", label: "Character", placeholder: "CHARACTER", aliases: ["name", "cue", "speaker"] },
      { type: "dialogue", label: "Dialogue", placeholder: "Dialogue", aliases: ["speech", "line"] },
      { type: "parenthetical", label: "Parenthetical", placeholder: "(beat)", aliases: ["paren", "wryly"] },
      { type: "direction", label: "Stage direction", placeholder: "Stage direction", aliases: ["action", "sd"] },
      { type: "scene_heading", label: "Scene heading", placeholder: "SCENE", aliases: ["heading", "scene"] },
      { type: "transition", label: "Transition", placeholder: "BLACKOUT.", aliases: ["blackout", "cut"] },
      ...SONG_ELEMENTS,
    ],
    firstElement: "scene_heading",
    afterEnter: {
      character: "dialogue",
      parenthetical: "dialogue",
      dialogue: "character",
      direction: "character",
      scene_heading: "direction",
      transition: "scene_heading",
      ...SONG_FLOW.afterEnter,
    },
    emptyExit: SONG_FLOW.emptyExit,
    emptyCycle: ["character", "direction", "transition", "scene_heading"],
    tabCycle: ["character", "dialogue", "lyric", "parenthetical", "direction", "scene_heading", "transition"],
    typst: "stage-play.typ",
    pageFont: "Courier Prime",
    docNoun: "Scene",
    folderNoun: "Act",
    starter: () => "",
    exports: scriptExports,
    titlePageDefault: true,
  },
  screenplay: {
    id: "screenplay",
    name: "Screenplay",
    description: "Industry-standard layout: sluglines, action, character, parentheticals and dialogue.",
    mode: "script",
    elements: [
      { type: "scene_heading", label: "Scene heading", placeholder: "INT. LOCATION - DAY" },
      { type: "action", label: "Action", placeholder: "Action" },
      { type: "character", label: "Character", placeholder: "CHARACTER" },
      { type: "parenthetical", label: "Parenthetical", placeholder: "(beat)" },
      { type: "dialogue", label: "Dialogue", placeholder: "Dialogue" },
      { type: "transition", label: "Transition", placeholder: "CUT TO:" },
      ...SONG_ELEMENTS,
    ],
    firstElement: "scene_heading",
    afterEnter: {
      scene_heading: "action",
      action: "character",
      character: "dialogue",
      parenthetical: "dialogue",
      dialogue: "character",
      transition: "scene_heading",
      ...SONG_FLOW.afterEnter,
    },
    emptyExit: SONG_FLOW.emptyExit,
    emptyCycle: ["character", "action", "transition", "scene_heading"],
    tabCycle: ["action", "character", "dialogue", "lyric", "parenthetical", "scene_heading", "transition"],
    typst: "screenplay.typ",
    pageFont: "Courier Prime",
    docNoun: "Scene",
    folderNoun: "Sequence",
    starter: () => "",
    exports: scriptExports,
    titlePageDefault: true,
  },
  poem: {
    id: "poem",
    name: "Poem",
    description: "Line breaks and indentation kept exactly. Nothing is reflowed or justified.",
    mode: "poem",
    elements: [
      { type: "title", label: "Title", placeholder: "Title" },
      { type: "line", label: "Line", placeholder: "" },
    ],
    firstElement: "title",
    afterEnter: { title: "line", line: "line" },
    emptyCycle: [],
    tabCycle: [],
    typst: "poem.typ",
    pageFont: "Libertinus Serif",
    docNoun: "Poem",
    folderNoun: "Section",
    starter: () => "",
    exports: proseExports,
    titlePageDefault: false,
  },
  book: {
    id: "book",
    name: "Book",
    description: "Chapters on a 6×9 trim with a title page, page numbers and proper paragraph indents.",
    mode: "prose",
    elements: [
      { type: "paragraph", label: "Paragraph", placeholder: "Write…" },
      { type: "heading", label: "Heading", placeholder: "Heading" },
      { type: "subheading", label: "Subheading", placeholder: "Subheading" },
      { type: "quote", label: "Quote", placeholder: "Quotation" },
      { type: "scene_break", label: "Scene break", placeholder: "* * *" },
      { type: "title", label: "Heading 1", placeholder: "Heading 1", aliases: ["h1"] },
      { type: "image", label: "Image", placeholder: "", aliases: ["picture", "photo", "img"] },
      ...BUBBLE_ELEMENTS,
    ],
    firstElement: "paragraph",
    afterEnter: { paragraph: "paragraph", heading: "paragraph", subheading: "paragraph", quote: "paragraph", scene_break: "paragraph", ...BUBBLE_FLOW.afterEnter },
    emptyExit: BUBBLE_FLOW.emptyExit,
    backspaceTo: BUBBLE_FLOW.backspaceTo,
    emptyCycle: [],
    tabCycle: ["paragraph", "heading", "subheading", "quote", "scene_break"],
    typst: "book.typ",
    pageFont: "Libertinus Serif",
    docNoun: "Chapter",
    folderNoun: "Part",
    starter: () => ``,
    exports: proseExports,
    titlePageDefault: true,
  },
  article: {
    id: "article",
    name: "Article",
    description: "Headings, paragraphs and quotes on a clean letter page.",
    mode: "prose",
    elements: [
      { type: "paragraph", label: "Paragraph", placeholder: "Write…" },
      { type: "heading", label: "Heading", placeholder: "Heading" },
      { type: "subheading", label: "Subheading", placeholder: "Subheading" },
      { type: "quote", label: "Quote", placeholder: "Quotation" },
      { type: "scene_break", label: "Section break", placeholder: "* * *" },
      { type: "title", label: "Heading 1", placeholder: "Heading 1", aliases: ["h1"] },
      { type: "image", label: "Image", placeholder: "", aliases: ["picture", "photo", "img"] },
      ...BUBBLE_ELEMENTS,
    ],
    firstElement: "paragraph",
    afterEnter: { paragraph: "paragraph", heading: "paragraph", subheading: "paragraph", quote: "paragraph", scene_break: "paragraph", ...BUBBLE_FLOW.afterEnter },
    emptyExit: BUBBLE_FLOW.emptyExit,
    backspaceTo: BUBBLE_FLOW.backspaceTo,
    emptyCycle: [],
    tabCycle: ["paragraph", "heading", "subheading", "quote", "scene_break"],
    typst: "article.typ",
    pageFont: "Libertinus Serif",
    docNoun: "Section",
    folderNoun: "Part",
    starter: () => ``,
    exports: proseExports,
    titlePageDefault: false,
  },
  essay: {
    id: "essay",
    name: "Essay",
    description: "An academic paper in MLA or Chicago style: double-spaced, with a Works Cited or Bibliography page.",
    mode: "prose",
    elements: [
      { type: "paragraph", label: "Paragraph", placeholder: "Write…" },
      { type: "heading", label: "Heading", placeholder: "Heading", aliases: ["h2"] },
      { type: "subheading", label: "Subheading", placeholder: "Subheading", aliases: ["h3"] },
      { type: "quote", label: "Block quote", placeholder: "A quotation of more than four lines", aliases: ["quotation"] },
      { type: "scene_break", label: "Section break", placeholder: "* * *" },
      { type: "image", label: "Image", placeholder: "", aliases: ["picture", "photo", "figure", "img"] },
    ],
    firstElement: "paragraph",
    afterEnter: { paragraph: "paragraph", heading: "paragraph", subheading: "paragraph", quote: "paragraph", scene_break: "paragraph" },
    emptyCycle: [],
    tabCycle: ["paragraph", "heading", "subheading", "quote", "scene_break"],
    typst: "essay.typ",
    pageFont: "Libertinus Serif",
    docNoun: "Section",
    folderNoun: "Part",
    starter: () => ``,
    exports: proseExports,
    titlePageDefault: false,
  },
};

const NOTE_ELEMENTS: ElementDef[] = [
  { type: "paragraph", label: "Text", placeholder: "Type '/' for blocks", aliases: ["paragraph", "plain"] },
  { type: "title", label: "Heading 1", placeholder: "Heading 1", aliases: ["h1", "title"] },
  { type: "heading", label: "Heading 2", placeholder: "Heading 2", aliases: ["h2"] },
  { type: "subheading", label: "Heading 3", placeholder: "Heading 3", aliases: ["h3"] },
  { type: "bullet", label: "Bulleted list", placeholder: "List", aliases: ["ul", "list", "-"] },
  { type: "numbered", label: "Numbered list", placeholder: "List", aliases: ["ol", "1."] },
  { type: "todo", label: "To-do", placeholder: "To-do", aliases: ["checkbox", "task", "[]"] },
  { type: "quote", label: "Quote", placeholder: "Quote", aliases: [">"] },
  { type: "callout", label: "Callout", placeholder: "Callout", aliases: ["note", "info", "tip"] },
  { type: "divider", label: "Divider", placeholder: "", aliases: ["hr", "line", "---"] },
  { type: "image", label: "Image", placeholder: "", aliases: ["picture", "photo", "img"] },
];

export const LIST_TYPES: ElementType[] = ["bullet", "numbered", "todo", "todo_done"];

/** Notes, characters and research pages: Notion-style blocks, never typeset. */
export const NOTES_TEMPLATE: Template = {
  id: "notes",
  name: "Notes",
  description: "",
  mode: "notes",
  elements: NOTE_ELEMENTS,
  firstElement: "paragraph",
  afterEnter: {
    paragraph: "paragraph",
    title: "paragraph",
    heading: "paragraph",
    subheading: "paragraph",
    bullet: "bullet",
    numbered: "numbered",
    todo: "todo",
    todo_done: "todo",
    quote: "paragraph",
    callout: "paragraph",
    divider: "paragraph",
  },
  emptyCycle: [],
  tabCycle: [],
  emptyExit: { bullet: "paragraph", numbered: "paragraph", todo: "paragraph", todo_done: "paragraph", quote: "paragraph", callout: "paragraph" },
  backspaceTo: Object.fromEntries([...LIST_TYPES, "quote", "callout", "title", "heading", "subheading"].map((t) => [t, "paragraph"])),
  typst: "",
  pageFont: "",
  docNoun: "Note",
  folderNoun: "Folder",
  starter: () => "",
  exports: [],
  titlePageDefault: false,
};

/** Front and back matter: typeset prose that sits before or after the manuscript. */
export const MATTER_TEMPLATE: Template = {
  id: "matter",
  name: "Front & back matter",
  description: "",
  mode: "prose",
  elements: [
    { type: "paragraph", label: "Paragraph", placeholder: "Write…", aliases: ["text"] },
    { type: "centered", label: "Centred", placeholder: "Centred text", aliases: ["center", "dedication"] },
    { type: "heading", label: "Heading", placeholder: "Heading", aliases: ["h2"] },
    { type: "subheading", label: "Subheading", placeholder: "Subheading", aliases: ["h3"] },
    { type: "quote", label: "Quote", placeholder: "Quotation", aliases: ["epigraph"] },
    { type: "scene_break", label: "Break", placeholder: "* * *", aliases: ["divider"] },
    { type: "citation", label: "Source", placeholder: "Surname, First. Title. Publisher, Year.", aliases: ["citation", "works cited", "bibliography", "reference", "cite"] },
    { type: "image", label: "Image", placeholder: "", aliases: ["picture", "photo", "img"] },
  ],
  firstElement: "paragraph",
  afterEnter: { paragraph: "paragraph", centered: "centered", heading: "paragraph", subheading: "paragraph", quote: "paragraph", scene_break: "paragraph", citation: "citation" },
  emptyCycle: [],
  emptyExit: { citation: "paragraph" },
  backspaceTo: { citation: "paragraph" },
  tabCycle: ["paragraph", "centered", "heading", "subheading", "quote", "citation", "scene_break"],
  typst: "matter.typ",
  pageFont: "",
  docNoun: "Page",
  folderNoun: "Folder",
  starter: () => "",
  exports: [],
  titlePageDefault: false,
};

/**
 * A title page the writer types (front matter called "Title page"): matter
 * pages' lines, but Tab types a tab, which splits a line into columns
 * ("Book by⇥Music by"), or at the bottom puts what follows on the right.
 */
export const TITLE_PAGE_TEMPLATE: Template = {
  ...MATTER_TEMPLATE,
  id: "title-page",
  name: "Title page",
  tabCycle: [],
  tabText: "\t",
};

/**
 * Works Cited (MLA 9) and Bibliography (Chicago 17, notes-bibliography) pages.
 * Each "- " line is one source, typeset with a half-inch hanging indent; the
 * examples show the pattern for common kinds of source. Keep them in
 * alphabetical order by the first word.
 */
export const WORKS_CITED_STARTER = `- Author Surname, First Name. *Title of Book*. Publisher, Year.

- Author Surname, First Name. "Title of Article." *Journal Name*, vol. 1, no. 2, Year, pp. 10–20.

- Author Surname, First Name. "Title of Web Page." *Name of Website*, Day Month Year, www.example.com/page.
`;

export const BIBLIOGRAPHY_STARTER = `- Surname, First Name. *Title of Book*. City: Publisher, Year.

- Surname, First Name. "Title of Article." *Journal Name* 1, no. 2 (Year): 10–20.

- Surname, First Name. "Title of Web Page." Name of Website. Month Day, Year. https://www.example.com/page.
`;

/** Clauses offered for a copyright page. `{author}` becomes the project's author. */
export const COPYRIGHT_CLAUSES: { id: string; title: string; text: string; defaultOn: boolean }[] = [
  {
    id: "rights",
    title: "All rights reserved",
    defaultOn: true,
    text: "All rights reserved. No part of this publication may be reproduced, stored, or transmitted in any form or by any means, electronic, mechanical, photocopying, recording, scanning, or otherwise without written permission from the publisher. It is illegal to copy this book, post it to a website, or distribute it by any other means without permission.",
  },
  {
    id: "fiction",
    title: "Fiction",
    defaultOn: false,
    text: "This novel is entirely a work of fiction. The names, characters, and incidents portrayed in it are the work of the author's imagination. Any resemblance to actual persons, living or dead, events, or localities is entirely coincidental.",
  },
  { id: "moral", title: "Moral rights", defaultOn: false, text: "{author} asserts the moral right to be identified as the author of this work." },
  {
    id: "external",
    title: "External content",
    defaultOn: false,
    text: "{author} has no responsibility for the persistence or accuracy of URLs for external or third-party Internet Websites referred to in this publication and does not guarantee that any content on such Websites is, or will remain, accurate or appropriate.",
  },
  {
    id: "designations",
    title: "Designations",
    defaultOn: false,
    text: "Designations used by companies to distinguish their products are often claimed as trademarks. All brand names and product names used in this book and on its cover are trade names, service marks, trademarks, and registered trademarks of their respective owners. The publishers and the book are not associated with any product or vendor mentioned in this book. None of the companies referenced within the book have endorsed the book.",
  },
  { id: "edition", title: "Edition", defaultOn: false, text: "First edition" },
  { id: "isbn", title: "ISBN", defaultOn: false, text: "ISBN: 000-0-00-000000-0" },
];

/** The copyright page: the notice, then the chosen clauses, each its own paragraph. */
export function copyrightPage(author: string, year: number, clauseIds: string[]): string {
  const name = author.trim() || "the author";
  const lines = [`Copyright © ${year} by ${name}`];
  for (const c of COPYRIGHT_CLAUSES) if (clauseIds.includes(c.id)) lines.push(c.text.replace(/\{author\}/g, name));
  return lines.join("\n\n") + "\n";
}

/** Ready-made front and back matter pages offered in the binder. */
export interface MatterPreset {
  title: string;
  /** Starting text. Empty for every preset: the page shows `hint` in grey until the writer types. */
  content: string;
  where: "front" | "back";
  forTemplates?: TemplateId[];
  /** Grey text shown on the empty page, replaced by whatever the writer types. */
  hint?: string;
  /** The type of the page's first line (a dedication is centred, a source has a hanging indent). */
  firstType?: ElementType;
}

export const MATTER_PRESETS: MatterPreset[] = [
  // Content comes from the project (titlePageStarter); it replaces the automatic title page.
  { title: "Title page", where: "front", content: "", firstType: "centered", hint: "TITLE" },
  { title: "Dedication", where: "front", content: "", firstType: "centered", hint: "For …" },
  { title: "Epigraph", where: "front", content: "", firstType: "quote", hint: "A line that sets the tone. — Its author" },
  // Content comes from the copyright dialog (copyrightPage); this is the fallback.
  { title: "Copyright", where: "front", content: "", hint: "Copyright © 2026 by the author. All rights reserved." },
  { title: "Cast of characters", where: "front", forTemplates: ["stage-play", "screenplay"], content: "", hint: "ANNA, thirties, a teacher." },
  { title: "Time and place", where: "front", forTemplates: ["stage-play"], content: "", hint: "A kitchen in a small town. The present." },
  { title: "Production history", where: "front", forTemplates: ["stage-play"], content: "", hint: "First performed at …" },
  { title: "Preface", where: "front", forTemplates: ["book", "article"], content: "", hint: "Why this book, and how to read it…" },
  { title: "Acknowledgements", where: "back", content: "", hint: "Thank you to…" },
  { title: "Afterword", where: "back", forTemplates: ["book"], content: "" },
  { title: "About the author", where: "back", content: "", hint: "A few lines about you…" },
  { title: "Notes", where: "back", content: "" },
  { title: "Works Cited", where: "back", content: "", firstType: "citation", hint: "Surname, First Name. Title of Book. Publisher, Year." },
  { title: "Bibliography", where: "back", content: "", firstType: "citation", hint: "Surname, First Name. Title of Book. City: Publisher, Year." },
];

/** The preset a front or back matter page was made from, found by its title. */
export function presetFor(title: string): MatterPreset | undefined {
  const t = title.trim().toLowerCase();
  return MATTER_PRESETS.find((p) => p.title.toLowerCase() === t);
}

/** A plain document, like a word processor: Notion-style blocks, typeset as a clean page. */
TEMPLATES.document = {
  ...NOTES_TEMPLATE,
  elements: [...NOTE_ELEMENTS, ...BUBBLE_ELEMENTS],
  afterEnter: { ...NOTES_TEMPLATE.afterEnter, ...BUBBLE_FLOW.afterEnter },
  emptyExit: { ...NOTES_TEMPLATE.emptyExit, ...BUBBLE_FLOW.emptyExit },
  backspaceTo: { ...NOTES_TEMPLATE.backspaceTo, ...BUBBLE_FLOW.backspaceTo },
  id: "document",
  name: "Document",
  description: "A plain document, like a word processor: headings, lists, to-dos and quotes.",
  typst: "document.typ",
  pageFont: "Libertinus Serif",
  docNoun: "Page",
  folderNoun: "Part",
  starter: () => "",
  exports: ["pdf", "docx", "epub"],
  titlePageDefault: false,
};

export const TEMPLATE_ORDER: TemplateId[] = ["stage-play", "screenplay", "document", "essay", "book", "article", "poem"];

export function getTemplate(id: string | undefined): Template {
  // `id` comes from project.json, which may have been shared or hand-edited:
  // only our own template ids count, never an inherited Object.prototype key.
  return (id && Object.hasOwn(TEMPLATES, id) ? TEMPLATES[id as TemplateId] : undefined) ?? TEMPLATES["stage-play"];
}

/** Types that have a valid slash-menu / markdown-shortcut meaning in a template. */
export function hasType(t: Template, type: ElementType): boolean {
  return t.elements.some((e) => e.type === type) || (type === "todo_done" && t.elements.some((e) => e.type === "todo"));
}

export function elementLabel(t: Template, type: ElementType): string {
  return t.elements.find((e) => e.type === type)?.label ?? type.replace("_", " ");
}

/** Next element in a cycle; types not in the cycle enter it at the start. */
export function cycleNext(cycle: ElementType[], current: ElementType, step = 1): ElementType {
  const i = cycle.indexOf(current);
  if (i < 0) return cycle[0];
  return cycle[(i + step + cycle.length) % cycle.length];
}

/**
 * Is a line at `index` inside a song? Looking back past cues, parentheticals and
 * directions, the nearest song title or lyric says yes; spoken dialogue, a scene
 * heading or a transition says no. A cue inside a song is followed by lyrics.
 */
export function inSong(types: ElementType[], index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const t = types[i];
    if (t === "song" || t === "lyric") return true;
    if (t === "character" || t === "parenthetical" || t === "direction" || t === "action") continue;
    return false;
  }
  return false;
}

/** Element types that keep their text in capitals. */
export const UPPERCASE_TYPES: ElementType[] = ["character", "scene_heading", "transition"];

/** How many levels a list item can be indented under the one above it. */
export const MAX_INDENT = 5;

export function isListType(type: ElementType | string): boolean {
  return (LIST_TYPES as string[]).includes(type);
}

/**
 * The number each numbered list item shows (0 for every other line). Each
 * indent level counts on its own: a nested list starts again at 1, and the
 * list it sits in carries on counting after it. Anything that is not a list
 * item ends every list.
 */
export function listNumbers(blocks: { type: ElementType | string; indent?: number }[]): number[] {
  const levels: { type: string; n: number }[] = [];
  return blocks.map((b) => {
    if (!isListType(b.type)) {
      levels.length = 0;
      return 0;
    }
    const level = Math.min(levels.length, Math.max(0, b.indent ?? 0));
    const prev = levels[level];
    const n = b.type === "numbered" ? (prev?.type === "numbered" ? prev.n + 1 : 1) : 0;
    levels[level] = { type: b.type, n };
    levels.length = level + 1;
    return n;
  });
}
