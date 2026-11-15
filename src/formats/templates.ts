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
  | "scene_break";

export type TemplateId = "stage-play" | "screenplay" | "poem" | "book" | "article";

/** How a template's files are written to and read from markdown. */
export type FileMode = "script" | "prose" | "poem";

export interface ElementDef {
  type: ElementType;
  label: string;
  placeholder: string;
}

export interface Template {
  id: TemplateId;
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
      { type: "character", label: "Character", placeholder: "CHARACTER" },
      { type: "dialogue", label: "Dialogue", placeholder: "Dialogue" },
      { type: "parenthetical", label: "Parenthetical", placeholder: "(beat)" },
      { type: "direction", label: "Stage direction", placeholder: "Stage direction" },
      { type: "scene_heading", label: "Scene heading", placeholder: "SCENE" },
      { type: "transition", label: "Transition", placeholder: "BLACKOUT." },
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

export const TEMPLATE_ORDER: TemplateId[] = ["stage-play", "screenplay", "book", "article", "poem"];

export function getTemplate(id: string | undefined): Template {
  return TEMPLATES[(id as TemplateId) ?? "stage-play"] ?? TEMPLATES["stage-play"];
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
