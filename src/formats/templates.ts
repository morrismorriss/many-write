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
  | "image";

export type TemplateId = "stage-play" | "screenplay" | "poem" | "book" | "article";
/** Templates used outside the manuscript. */
export type AuxTemplateId = "notes" | "matter";

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
  /** New documents in the manuscript start with this content (markdown). */
  starter: (n: number) => string;
  exports: ExportFormat[];
  titlePageDefault: boolean;
}

export type ExportFormat = "pdf" | "docx" | "epub" | "fdx" | "fountain";

const scriptExports: ExportFormat[] = ["pdf", "docx", "fdx", "fountain", "epub"];
const proseExports: ExportFormat[] = ["pdf", "docx", "epub"];

export const TEMPLATES: Record<TemplateId, Template> = {
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
    ],
    firstElement: "scene_heading",
    afterEnter: {
      character: "dialogue",
      parenthetical: "dialogue",
      dialogue: "character",
      direction: "character",
      scene_heading: "direction",
      transition: "scene_heading",
    },
    emptyCycle: ["character", "direction", "transition", "scene_heading"],
    tabCycle: ["character", "dialogue", "parenthetical", "direction", "scene_heading", "transition"],
    typst: "stage-play.typ",
    pageFont: "Courier Prime",
    docNoun: "Scene",
    folderNoun: "Act",
    starter: (n) => `## Scene ${n}\n`,
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
    ],
    firstElement: "scene_heading",
    afterEnter: {
      scene_heading: "action",
      action: "character",
      character: "dialogue",
      parenthetical: "dialogue",
      dialogue: "character",
      transition: "scene_heading",
    },
    emptyCycle: ["character", "action", "transition", "scene_heading"],
    tabCycle: ["action", "character", "dialogue", "parenthetical", "scene_heading", "transition"],
    typst: "screenplay.typ",
    pageFont: "Courier Prime",
    docNoun: "Scene",
    folderNoun: "Sequence",
    starter: () => `## INT. LOCATION - DAY\n`,
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
    starter: () => `# Untitled\n\n`,
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
    ],
    firstElement: "paragraph",
    afterEnter: { paragraph: "paragraph", heading: "paragraph", subheading: "paragraph", quote: "paragraph", scene_break: "paragraph" },
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
    ],
    firstElement: "paragraph",
    afterEnter: { paragraph: "paragraph", heading: "paragraph", subheading: "paragraph", quote: "paragraph", scene_break: "paragraph" },
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

const LIST_TYPES: ElementType[] = ["bullet", "numbered", "todo", "todo_done"];

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
    { type: "image", label: "Image", placeholder: "", aliases: ["picture", "photo", "img"] },
  ],
  firstElement: "paragraph",
  afterEnter: { paragraph: "paragraph", centered: "centered", heading: "paragraph", subheading: "paragraph", quote: "paragraph", scene_break: "paragraph" },
  emptyCycle: [],
  tabCycle: ["paragraph", "centered", "heading", "subheading", "quote", "scene_break"],
  typst: "matter.typ",
  pageFont: "",
  docNoun: "Page",
  folderNoun: "Folder",
  starter: () => "",
  exports: [],
  titlePageDefault: false,
};

/** Ready-made front and back matter pages offered in the binder. */
export interface MatterPreset {
  title: string;
  content: string;
  where: "front" | "back";
  forTemplates?: TemplateId[];
}

export const MATTER_PRESETS: MatterPreset[] = [
  { title: "Dedication", where: "front", content: "-> For … <-\n" },
  { title: "Epigraph", where: "front", content: "> A line that sets the tone.\n\n-> — Its author <-\n" },
  { title: "Copyright", where: "front", content: "Copyright © 2026 by the author. All rights reserved.\n" },
  { title: "Cast of characters", where: "front", forTemplates: ["stage-play", "screenplay"], content: "ANNA, thirties, a teacher.\n\nBEN, her brother.\n" },
  { title: "Time and place", where: "front", forTemplates: ["stage-play"], content: "A kitchen in a small town. The present.\n" },
  { title: "Production history", where: "front", forTemplates: ["stage-play"], content: "First performed at …\n" },
  { title: "Preface", where: "front", forTemplates: ["book", "article"], content: "" },
  { title: "Acknowledgements", where: "back", content: "" },
  { title: "Afterword", where: "back", forTemplates: ["book"], content: "" },
  { title: "About the author", where: "back", content: "" },
  { title: "Notes", where: "back", content: "" },
];

export const TEMPLATE_ORDER: TemplateId[] = ["stage-play", "screenplay", "book", "article", "poem"];

export function getTemplate(id: string | undefined): Template {
  return TEMPLATES[(id as TemplateId) ?? "stage-play"] ?? TEMPLATES["stage-play"];
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

/** Element types that keep their text in capitals. */
export const UPPERCASE_TYPES: ElementType[] = ["character", "scene_heading", "transition"];
