/**
 * The design a book is set by: a closed schema whose every field sets
 * one property the pinned engine supports.
 *
 * A field the design leaves unset is left to the layer under it, so a
 * preset shows through wherever the book has settled nothing.
 *
 * The schema is written flat, one key per line, because a novelist who
 * opens Obsidian's properties panel reads `body-line-spacing` there
 * rather than a nested object. Every key names the thing it sets in
 * the words a writer uses.
 */

/** The units a length is written in. */
export const UNITS = ["pt", "in", "mm", "cm", "pc", "em"] as const;

export type Unit = (typeof UNITS)[number];

/** A length, as the note writes it. */
export interface Length {
  value: number;
  unit: Unit;
}

/** A page's width and height. */
export interface Trim {
  width: Length;
  height: Length;
}

/** One trim the panel offers by name. */
export interface BookSize {
  name: string;
  trim: Trim;
}

/**
 * The trims a novel is printed at, in the order the panel offers them.
 * A trim outside this list is written into the note by hand.
 */
export const BOOK_SIZES: readonly BookSize[] = [
  size("Mass market", 4.25, 6.87, "in"),
  size("Digest", 5.5, 8.5, "in"),
  size("Novel", 5.25, 8, "in"),
  size("US trade", 6, 9, "in"),
  size("Demy", 129, 198, "mm"),
  size("Royal", 156, 234, "mm"),
  size("A5", 148, 210, "mm"),
];

function size(
  name: string,
  width: number,
  height: number,
  unit: Unit,
): BookSize {
  return {
    name,
    trim: { width: { value: width, unit }, height: { value: height, unit } },
  };
}

/** A page's margins. Inside is the gutter side and outside the fore-edge. */
export interface Margins {
  inside?: Length;
  outside?: Length;
  top?: Length;
  bottom?: Length;
}

export interface PageDesign {
  trim?: Trim;
  margins: Margins;
  /** Inside and outside swap sides on a left-hand page. */
  mirrored?: boolean;
}

export type Align = "justify" | "left";

export interface BodyDesign {
  /** The font the book is set in, by the name its file carries. */
  font?: string;
  size?: Length;
  lineSpacing?: Length;
  align?: Align;
  /** The indent on a paragraph's first line. */
  indent?: Length;
  /** The indent on the first paragraph after a scene break. */
  indentAfterBreak?: boolean;
  hyphens?: boolean;
  hangingPunctuation?: boolean;
  /** The fewest lines of a paragraph left at the foot of a page. */
  orphans?: number;
  /** The fewest lines of a paragraph carried to the top of a page. */
  widows?: number;
  /** A heading keeps the text under it on the same page. */
  keepHeadings?: boolean;
}

export type Weight = "regular" | "medium" | "semibold" | "bold";

export type Alignment = "left" | "center" | "right";

export type Slope = "roman" | "italic";

/** The type a heading is set in. */
export interface TypeSpec {
  font?: string;
  size?: Length;
  weight?: Weight;
  slope?: Slope;
  align?: Alignment;
}

/** The heading levels markdown writes, which are the ones a design sets. */
export const LEVELS = [1, 2, 3, 4, 5, 6] as const;

export type Level = (typeof LEVELS)[number];

/** One type spec per heading level. A chapter's title is level 1. */
export type Headings = Record<Level, TypeSpec>;

export type Begins = "right-page" | "next-page" | "same-page";

export interface ChapterDesign {
  begins?: Begins;
  /** The blank space above a chapter's title, in lines of body text. */
  spaceAbove?: number;
  /** The blank space below a chapter's title, in lines of body text. */
  spaceBelow?: number;
  /** The lines a drop cap falls over. */
  dropCap?: number;
}

export type SceneMark = "space" | "ornament" | "word";

export interface SceneDesign {
  /** The kind of mark between two scenes. A space leaves a blank line. */
  mark?: SceneMark;
  /** The mark between two scenes, as the glyph itself. */
  ornament?: string;
  /** The word between two scenes, as the author writes it. */
  word?: string;
  /** The blank space above a scene break, in lines of body text. */
  spaceAbove?: number;
  /** The blank space below a scene break, in lines of body text. */
  spaceBelow?: number;
}

export type HeaderSlot = "none" | "author" | "book-title" | "chapter-title";

export type PageNumberPosition = "top" | "bottom" | "outside";

export type NumberFormat = "arabic" | "roman";

export interface HeaderDesign {
  leftPage?: HeaderSlot;
  rightPage?: HeaderSlot;
  pageNumber?: PageNumberPosition;
  pageNumberFormat?: NumberFormat;
  /** The running head is left off a page a section opens on. */
  suppressOnOpenings?: boolean;
}

/** The whole design, group by group. Every field in a group is optional. */
export interface Design {
  /** The preset under the design, by name. */
  preset?: string;
  page: PageDesign;
  body: BodyDesign;
  headings: Headings;
  chapter: ChapterDesign;
  scene: SceneDesign;
  headers: HeaderDesign;
}

/** A design that sets nothing. */
export function emptyDesign(): Design {
  return {
    page: { margins: {} },
    body: {},
    headings: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} },
    chapter: {},
    scene: {},
    headers: {},
  };
}

/** One scalar a design key is written as. */
export type Written = string | number | boolean;

interface Field {
  key: string;
  /**
   * The CSS property this field sets. `subset.css` declares it. A field
   * that chooses the layer under the design sets none.
   */
  property?: string;
  read(design: Design): Written | undefined;
  write(design: Design, value: unknown): void;
}

/** The preset a design sits over. It sets no property; it picks a layer. */
const PRESET: Field = {
  key: "preset",
  read: ({ preset }) => preset,
  write: (design, value) => {
    const name = asText(value);
    if (name !== undefined) design.preset = name;
  },
};

const PAGE: readonly Field[] = [
  {
    key: "trim",
    property: "size",
    read: ({ page }) =>
      page.trim === undefined
        ? undefined
        : `${written(page.trim.width)} ${written(page.trim.height)}`,
    write: ({ page }, value) => {
      const trim = asTrim(value);
      if (trim !== undefined) page.trim = trim;
    },
  },
  margin("margin-inside", "inside", "margin-left"),
  margin("margin-outside", "outside", "margin-right"),
  margin("margin-top", "top", "margin-top"),
  margin("margin-bottom", "bottom", "margin-bottom"),
  {
    key: "mirrored",
    property: "margin-left",
    read: ({ page }) => page.mirrored,
    write: ({ page }, value) => {
      const flag = asFlag(value);
      if (flag !== undefined) page.mirrored = flag;
    },
  },
];

const BODY: readonly Field[] = [
  {
    key: "body-font",
    property: "font-family",
    read: ({ body }) => body.font,
    write: ({ body }, value) => {
      const font = asText(value);
      if (font !== undefined) body.font = font;
    },
  },
  {
    key: "body-size",
    property: "font-size",
    read: ({ body }) => written(body.size),
    write: ({ body }, value) => {
      const size = asLength(value);
      if (size !== undefined) body.size = size;
    },
  },
  {
    key: "body-line-spacing",
    property: "line-height",
    read: ({ body }) => written(body.lineSpacing),
    write: ({ body }, value) => {
      const spacing = asLength(value);
      if (spacing !== undefined) body.lineSpacing = spacing;
    },
  },
  {
    key: "body-align",
    property: "text-align",
    read: ({ body }) => body.align,
    write: ({ body }, value) => {
      const align = asWord(value, ALIGNS);
      if (align !== undefined) body.align = align;
    },
  },
  {
    key: "body-first-line-indent",
    property: "text-indent",
    read: ({ body }) => written(body.indent),
    write: ({ body }, value) => {
      const indent = asLength(value);
      if (indent !== undefined) body.indent = indent;
    },
  },
  {
    key: "body-indent-after-break",
    property: "text-indent",
    read: ({ body }) => body.indentAfterBreak,
    write: ({ body }, value) => {
      const flag = asFlag(value);
      if (flag !== undefined) body.indentAfterBreak = flag;
    },
  },
  {
    key: "body-hyphens",
    property: "hyphens",
    read: ({ body }) => body.hyphens,
    write: ({ body }, value) => {
      const hyphens = asFlag(value);
      if (hyphens !== undefined) body.hyphens = hyphens;
    },
  },
  {
    key: "body-hanging-punctuation",
    property: "hanging-punctuation",
    read: ({ body }) => body.hangingPunctuation,
    write: ({ body }, value) => {
      const hanging = asFlag(value);
      if (hanging !== undefined) body.hangingPunctuation = hanging;
    },
  },
  {
    key: "body-orphans",
    property: "orphans",
    read: ({ body }) => body.orphans,
    write: ({ body }, value) => {
      const orphans = asCount(value);
      if (orphans !== undefined) body.orphans = orphans;
    },
  },
  {
    key: "body-widows",
    property: "widows",
    read: ({ body }) => body.widows,
    write: ({ body }, value) => {
      const widows = asCount(value);
      if (widows !== undefined) body.widows = widows;
    },
  },
  {
    key: "keep-heading-with-text",
    property: "break-after",
    read: ({ body }) => body.keepHeadings,
    write: ({ body }, value) => {
      const flag = asFlag(value);
      if (flag !== undefined) body.keepHeadings = flag;
    },
  },
];

const CHAPTER: readonly Field[] = [
  {
    key: "chapter-begins",
    property: "break-before",
    read: ({ chapter }) => chapter.begins,
    write: ({ chapter }, value) => {
      const begins = asWord(value, BEGINS);
      if (begins !== undefined) chapter.begins = begins;
    },
  },
  {
    key: "chapter-space-above",
    property: "margin-top",
    read: ({ chapter }) => chapter.spaceAbove,
    write: ({ chapter }, value) => {
      const lines = asCount(value);
      if (lines !== undefined) chapter.spaceAbove = lines;
    },
  },
  {
    key: "chapter-space-below",
    property: "margin-bottom",
    read: ({ chapter }) => chapter.spaceBelow,
    write: ({ chapter }, value) => {
      const lines = asCount(value);
      if (lines !== undefined) chapter.spaceBelow = lines;
    },
  },
  {
    key: "chapter-drop-cap",
    property: "initial-letter",
    read: ({ chapter }) => chapter.dropCap,
    write: ({ chapter }, value) => {
      const lines = asCount(value);
      if (lines !== undefined) chapter.dropCap = lines;
    },
  },
];

const SCENE: readonly Field[] = [
  {
    key: "scene-break-mark",
    property: "content",
    read: ({ scene }) => scene.mark,
    write: ({ scene }, value) => {
      const mark = asWord(value, MARKS);
      if (mark !== undefined) scene.mark = mark;
    },
  },
  {
    key: "scene-break-ornament",
    property: "content",
    read: ({ scene }) => scene.ornament,
    write: ({ scene }, value) => {
      const ornament = asText(value);
      if (ornament !== undefined) scene.ornament = ornament;
    },
  },
  {
    key: "scene-break-word",
    property: "content",
    read: ({ scene }) => scene.word,
    write: ({ scene }, value) => {
      const word = asText(value);
      if (word !== undefined) scene.word = word;
    },
  },
  {
    key: "scene-break-space-above",
    property: "margin-top",
    read: ({ scene }) => scene.spaceAbove,
    write: ({ scene }, value) => {
      const lines = asCount(value);
      if (lines !== undefined) scene.spaceAbove = lines;
    },
  },
  {
    key: "scene-break-space-below",
    property: "margin-bottom",
    read: ({ scene }) => scene.spaceBelow,
    write: ({ scene }, value) => {
      const lines = asCount(value);
      if (lines !== undefined) scene.spaceBelow = lines;
    },
  },
];

const HEADERS: readonly Field[] = [
  slot("header-left-page", "leftPage"),
  slot("header-right-page", "rightPage"),
  {
    key: "page-number-position",
    property: "content",
    read: ({ headers }) => headers.pageNumber,
    write: ({ headers }, value) => {
      const position = asWord(value, POSITIONS);
      if (position !== undefined) headers.pageNumber = position;
    },
  },
  {
    key: "page-number-format",
    property: "content",
    read: ({ headers }) => headers.pageNumberFormat,
    write: ({ headers }, value) => {
      const format = asWord(value, FORMATS);
      if (format !== undefined) headers.pageNumberFormat = format;
    },
  },
  {
    key: "suppress-head-on-openings",
    property: "content",
    read: ({ headers }) => headers.suppressOnOpenings,
    write: ({ headers }, value) => {
      const flag = asFlag(value);
      if (flag !== undefined) headers.suppressOnOpenings = flag;
    },
  },
];

/** The design's fields, in the order the frontmatter writes them. */
const FIELDS: readonly Field[] = [
  PRESET,
  ...PAGE,
  ...BODY,
  ...LEVELS.flatMap(heading),
  ...CHAPTER,
  ...SCENE,
  ...HEADERS,
];

/** The design's frontmatter keys, in the order the format writes them. */
export const DESIGN_KEYS: readonly string[] = FIELDS.map((field) => field.key);

/** The CSS properties a design sets, each declared in `subset.css`. */
export const DESIGN_PROPERTIES: readonly string[] = [
  ...new Set(
    FIELDS.flatMap((field) =>
      field.property === undefined ? [] : [field.property],
    ),
  ),
];

/**
 * The design in a note's properties. A key the schema does not have is
 * skipped, and so is a value the schema cannot read.
 */
export function readDesign(properties: Readonly<Record<string, unknown>>): Design {
  const design = emptyDesign();
  for (const field of FIELDS) {
    const value = properties[field.key];
    if (value !== undefined && value !== null) field.write(design, value);
  }
  return design;
}

/**
 * The design as properties, one scalar per key. A field the design does
 * not set gets no key.
 */
export function writeDesign(design: Design): Record<string, Written> {
  const properties: Record<string, Written> = {};
  for (const field of FIELDS) {
    const value = field.read(design);
    if (value !== undefined) properties[field.key] = value;
  }
  return properties;
}

/**
 * The two designs as one, field by field. `over` wins wherever it sets
 * a field, which is how a book overrides the preset under it.
 */
export function mergeDesign(under: Design, over: Design): Design {
  const headings = emptyDesign().headings;
  for (const level of LEVELS) {
    headings[level] = { ...under.headings[level], ...over.headings[level] };
  }
  const preset = over.preset ?? under.preset;
  return {
    ...(preset === undefined ? {} : { preset }),
    page: {
      ...under.page,
      ...over.page,
      margins: { ...under.page.margins, ...over.page.margins },
    },
    body: { ...under.body, ...over.body },
    headings,
    chapter: { ...under.chapter, ...over.chapter },
    scene: { ...under.scene, ...over.scene },
    headers: { ...under.headers, ...over.headers },
  };
}

const ALIGNS: readonly Align[] = ["justify", "left"];
const ALIGNMENTS: readonly Alignment[] = ["left", "center", "right"];
const WEIGHTS: readonly Weight[] = ["regular", "medium", "semibold", "bold"];
const SLOPES: readonly Slope[] = ["roman", "italic"];
const BEGINS: readonly Begins[] = ["right-page", "next-page", "same-page"];
const MARKS: readonly SceneMark[] = ["space", "ornament", "word"];
const SLOTS: readonly HeaderSlot[] = [
  "none",
  "author",
  "book-title",
  "chapter-title",
];
const POSITIONS: readonly PageNumberPosition[] = ["top", "bottom", "outside"];
const FORMATS: readonly NumberFormat[] = ["arabic", "roman"];

/** The unit a length written as a bare number is given. */
const UNIT: Unit = "pt";

/** The fields that set one heading level's type. */
function heading(level: Level): Field[] {
  return [
    {
      key: `heading-${level}-font`,
      property: "font-family",
      read: ({ headings }) => headings[level].font,
      write: ({ headings }, value) => {
        const font = asText(value);
        if (font !== undefined) headings[level].font = font;
      },
    },
    {
      key: `heading-${level}-size`,
      property: "font-size",
      read: ({ headings }) => written(headings[level].size),
      write: ({ headings }, value) => {
        const size = asLength(value);
        if (size !== undefined) headings[level].size = size;
      },
    },
    {
      key: `heading-${level}-weight`,
      property: "font-weight",
      read: ({ headings }) => headings[level].weight,
      write: ({ headings }, value) => {
        const weight = asWord(value, WEIGHTS);
        if (weight !== undefined) headings[level].weight = weight;
      },
    },
    {
      key: `heading-${level}-slope`,
      property: "font-style",
      read: ({ headings }) => headings[level].slope,
      write: ({ headings }, value) => {
        const slope = asWord(value, SLOPES);
        if (slope !== undefined) headings[level].slope = slope;
      },
    },
    {
      key: `heading-${level}-align`,
      property: "text-align",
      read: ({ headings }) => headings[level].align,
      write: ({ headings }, value) => {
        const align = asWord(value, ALIGNMENTS);
        if (align !== undefined) headings[level].align = align;
      },
    },
  ];
}

function margin(key: string, side: keyof Margins, property: string): Field {
  return {
    key,
    property,
    read: ({ page }) => written(page.margins[side]),
    write: ({ page }, value) => {
      const length = asLength(value);
      if (length !== undefined) page.margins[side] = length;
    },
  };
}

function slot(key: string, side: "leftPage" | "rightPage"): Field {
  return {
    key,
    property: "string-set",
    read: ({ headers }) => headers[side],
    write: ({ headers }, value) => {
      const found = asWord(value, SLOTS);
      if (found !== undefined) headers[side] = found;
    },
  };
}

/** A length in the form the note writes it, which CSS also accepts. */
export function written(length: Length | undefined): string | undefined {
  return length === undefined ? undefined : `${trimmed(length.value)}${length.unit}`;
}

function trimmed(value: number): string {
  return String(Number(value.toFixed(4)));
}

function asLength(value: unknown): Length | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value, unit: UNIT } : undefined;
  }
  if (typeof value !== "string") return undefined;
  const found = /^(-?\d+(?:\.\d+)?)\s*([a-z]+)?$/i.exec(value.trim());
  if (found === null) return undefined;
  const unit = (found[2] ?? UNIT).toLowerCase();
  if (!UNITS.includes(unit as Unit)) return undefined;
  return { value: Number(found[1]), unit: unit as Unit };
}

function asTrim(value: unknown): Trim | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 2) return undefined;
  const width = asLength(parts[0]);
  const height = asLength(parts[1]);
  return width === undefined || height === undefined ? undefined : { width, height };
}

function asCount(value: unknown): number | undefined {
  const count = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    return undefined;
  }
  return count;
}

function asFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "yes" || value === "true") return true;
  if (value === "no" || value === "false") return false;
  return undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

function asWord<T extends string>(value: unknown, words: readonly T[]): T | undefined {
  if (typeof value !== "string") return undefined;
  const word = value.trim().toLowerCase();
  return words.find((each) => each === word);
}
