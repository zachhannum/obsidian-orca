/**
 * The design a book is set by: a closed schema whose every field sets
 * one property the pinned engine supports.
 *
 * A field the design leaves unset takes the default that the engine and
 * the bundled theme give a book that sets nothing.
 *
 * The schema is written flat, one key per line, because a novelist who
 * opens Obsidian's properties panel reads `body-line-spacing` there
 * rather than a nested object. Every key names the thing it sets in
 * the words a writer uses.
 */

/** The units a length is written in. */
export const UNITS = ["pt", "in", "mm", "cm", "pc", "em"] as const;

export type Unit = (typeof UNITS)[number];

/** The units a person can prefer for a page's margins and trim. */
export const PAGE_UNITS = ["in", "mm", "pt"] as const;

export type PageUnit = (typeof PAGE_UNITS)[number];

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
 * An author writes a trim outside this list into the note by hand.
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
  /** The font's variant, by name. A font's default variant is stored as absent. */
  fontVariant?: string;
  size?: Length;
  lineSpacing?: Length;
  align?: Align;
  /** The indent on a paragraph's first line. */
  indent?: Length;
  /** When true, the first paragraph after a scene break takes the first-line indent. */
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

export type Alignment = "left" | "center" | "right";

/**
 * The type a heading is set in. Bold and italic inside a heading come
 * from the markdown, so a spec sets neither.
 */
export interface TypeSpec {
  font?: string;
  /** The font's variant, by name. A font's default variant is stored as absent. */
  fontVariant?: string;
  size?: Length;
  align?: Alignment;
}

/** The heading levels markdown writes, which are the ones a design sets. */
export const LEVELS = [1, 2, 3, 4, 5, 6] as const;

export type Level = (typeof LEVELS)[number];

/** One type spec per heading level. A chapter's title is level 1. */
export type Headings = Record<Level, TypeSpec>;

export type Begins = "right-page" | "next-page" | "same-page";

/** The case a place is set in. Small caps is the font's feature, all caps the text transformed. */
export type Caps = "normal" | "small-caps" | "all-caps";

export interface ChapterDesign {
  begins?: Begins;
  /** The blank space above a chapter's title, in lines of body text. */
  spaceAbove?: number;
  /** The blank space below a chapter's title, in lines of body text. */
  spaceBelow?: number;
  /** The lines a drop cap falls over. */
  dropCap?: number;
  /** The case a chapter's label and title are set in. */
  openingCaps?: Caps;
  /** The letter spacing on a chapter's label and title. */
  openingLetterSpacing?: Length;
  /** The case a chapter's first line is set in. */
  firstLineCaps?: Caps;
  /** The letter spacing on a chapter's first line. */
  firstLineLetterSpacing?: Length;
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

/**
 * The position of a running head across the top of its page. A folio
 * at the top moves to the outside corner when the heads are centered.
 */
export type HeaderPosition = "outside" | "center";

export interface HeaderDesign {
  leftPage?: HeaderSlot;
  rightPage?: HeaderSlot;
  position?: HeaderPosition;
  pageNumber?: PageNumberPosition;
  pageNumberFormat?: NumberFormat;
  /** The case the running heads are set in. */
  caps?: Caps;
  /** The letter spacing on the running heads. */
  letterSpacing?: Length;
  /** When true, the running heads are set in italic. A margin box takes no markdown. */
  italic?: boolean;
  /** When true, the page a section opens on has no running head and no folio. */
  suppressOnOpenings?: boolean;
}

/** The whole design, group by group. Every field in a group is optional. */
export interface Design {
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

/**
 * Every font a design names, the body's first and then each heading
 * level's. A family two places name is listed once, however it is
 * capitalized, because the index matches a name without case.
 */
export function designFonts(design: Design): string[] {
  const named = [
    design.body.font,
    ...LEVELS.map((level) => design.headings[level].font),
  ];
  const seen = new Set<string>();
  const fonts: string[] = [];
  for (const font of named) {
    if (font === undefined) continue;
    const key = font.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fonts.push(font);
  }
  return fonts;
}

/** A font and the variant of it a design sets. An undefined variant is the font's default. */
export interface FontUse {
  font: string;
  variant: string | undefined;
}

/**
 * Every font and variant a design sets, the body's first and then each
 * heading level's. A level with no font of its own takes the body's
 * font and variant as a pair. A level with its own font and no variant
 * takes that font's default. A pair two places set is listed once,
 * however it is capitalized.
 */
export function designUses(design: Design): FontUse[] {
  const { font, fontVariant } = design.body;
  const body = font === undefined ? undefined : { font, variant: fontVariant };
  const named = [
    body,
    ...LEVELS.map((level) => headingUse(design.headings[level], body)),
  ];
  const seen = new Set<string>();
  const uses: FontUse[] = [];
  for (const use of named) {
    if (use === undefined) continue;
    const key = useKey(use);
    if (seen.has(key)) continue;
    seen.add(key);
    uses.push(use);
  }
  return uses;
}

/** The font and variant a heading level is set in, given the body's. */
export function headingUse(
  type: TypeSpec,
  body: FontUse | undefined,
): FontUse | undefined {
  if (type.font === undefined) return body;
  return { font: type.font, variant: type.fontVariant };
}

/** A use as one key, the same however it is capitalized. */
export function useKey(use: FontUse): string {
  return JSON.stringify([
    use.font.trim().toLowerCase(),
    use.variant?.trim().toLowerCase() ?? null,
  ]);
}

/** One scalar a design key is written as. */
export type Written = string | number | boolean;

interface Field {
  key: string;
  /** The CSS properties this field sets, each declared in `subset.css`. */
  property: string | readonly string[];
  read(design: Design): Written | undefined;
  write(design: Design, value: unknown): void;
}

/** Small caps is a font feature and all caps a transform, so one key sets either. */
const CAPS_PROPERTIES: readonly string[] = ["font-variant-caps", "text-transform"];

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
    // A variant picks among a font's faces and sets no CSS of its own.
    key: "body-font-variant",
    property: "font-family",
    read: ({ body }) => body.fontVariant,
    write: ({ body }, value) => {
      const variant = asText(value);
      if (variant !== undefined) body.fontVariant = variant;
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
    property: "padding-top",
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
    key: "chapter-opening-caps",
    property: CAPS_PROPERTIES,
    read: ({ chapter }) => chapter.openingCaps,
    write: ({ chapter }, value) => {
      const caps = asWord(value, CAPS);
      if (caps !== undefined) chapter.openingCaps = caps;
    },
  },
  {
    key: "chapter-opening-letter-spacing",
    property: "letter-spacing",
    read: ({ chapter }) => written(chapter.openingLetterSpacing),
    write: ({ chapter }, value) => {
      const spacing = asLength(value);
      if (spacing !== undefined) chapter.openingLetterSpacing = spacing;
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
  {
    key: "chapter-first-line-caps",
    property: CAPS_PROPERTIES,
    read: ({ chapter }) => chapter.firstLineCaps,
    write: ({ chapter }, value) => {
      const caps = asWord(value, CAPS);
      if (caps !== undefined) chapter.firstLineCaps = caps;
    },
  },
  {
    key: "chapter-first-line-letter-spacing",
    property: "letter-spacing",
    read: ({ chapter }) => written(chapter.firstLineLetterSpacing),
    write: ({ chapter }, value) => {
      const spacing = asLength(value);
      if (spacing !== undefined) chapter.firstLineLetterSpacing = spacing;
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
    key: "header-position",
    property: "content",
    read: ({ headers }) => headers.position,
    write: ({ headers }, value) => {
      const position = asWord(value, HEAD_POSITIONS);
      if (position !== undefined) headers.position = position;
    },
  },
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
    key: "header-caps",
    property: CAPS_PROPERTIES,
    read: ({ headers }) => headers.caps,
    write: ({ headers }, value) => {
      const caps = asWord(value, CAPS);
      if (caps !== undefined) headers.caps = caps;
    },
  },
  {
    key: "header-letter-spacing",
    property: "letter-spacing",
    read: ({ headers }) => written(headers.letterSpacing),
    write: ({ headers }, value) => {
      const spacing = asLength(value);
      if (spacing !== undefined) headers.letterSpacing = spacing;
    },
  },
  {
    key: "header-italic",
    property: "font-style",
    read: ({ headers }) => headers.italic,
    write: ({ headers }, value) => {
      const flag = asFlag(value);
      if (flag !== undefined) headers.italic = flag;
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
  ...new Set(FIELDS.flatMap((field) => field.property)),
];

/** The properties one key sets, and nothing for a key the schema does not have. */
export function propertiesOf(key: string): readonly string[] {
  const field = FIELDS.find((each) => each.key === key);
  return field === undefined ? [] : [field.property].flat();
}

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
 * Merges two designs field by field. `over` wins wherever it sets a
 * field, so a book's own keys win over the defaults.
 */
export function mergeDesign(under: Design, over: Design): Design {
  const headings = emptyDesign().headings;
  for (const level of LEVELS) {
    headings[level] = { ...under.headings[level], ...over.headings[level] };
  }
  return {
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

/** A value the panel cannot read. `kind` is the reason. */
export class ValueError extends Error {
  readonly kind: "number" | "unit" | "negative" | "whole";

  constructor(kind: ValueError["kind"], text: string) {
    super(`${JSON.stringify(text)} is ${REASONS[kind]}`);
    this.name = "ValueError";
    this.kind = kind;
  }
}

const REASONS: Readonly<Record<ValueError["kind"], string>> = {
  number: "not a number",
  unit: `not in ${UNITS.join(", ")}`,
  negative: "below zero",
  whole: "not a whole number",
};

/**
 * Reads a length as an author types it. A bare number is in `bare`,
 * which is points by default. A space can sit between the number and
 * its unit. It throws a `ValueError` on text it cannot read.
 */
export function parseLength(text: string, bare: Unit = UNIT): Length {
  const found = TYPED.exec(text.trim());
  if (found === null) throw new ValueError("number", text);
  const [, minus, digits = "", word = ""] = found;
  const unit = word === "" ? bare : word.toLowerCase();
  if (!isUnit(unit)) throw new ValueError("unit", text);
  const value = Number(digits);
  if (minus !== undefined && value > 0) throw new ValueError("negative", text);
  return { value, unit };
}

/**
 * Converts a length to another unit, rounded to three decimal places.
 * An em depends on the font size, so a length in em, or a conversion
 * to em, comes back unchanged.
 */
export function convertLength(length: Length, unit: Unit): Length {
  if (length.unit === unit || length.unit === "em" || unit === "em") return length;
  const inches = length.value / PER_INCH[length.unit];
  return { value: Number((inches * PER_INCH[unit]).toFixed(3)), unit };
}

/** The count of each absolute unit in one inch. */
const PER_INCH: Readonly<Record<Exclude<Unit, "em">, number>> = {
  in: 1,
  pt: 72,
  pc: 6,
  mm: 25.4,
  cm: 2.54,
};

/** Reads a count as an author types it. It throws a `ValueError` on text it cannot read. */
export function parseCount(text: string): number {
  const found = TYPED.exec(text.trim());
  const [, minus, digits = "", word = ""] = found ?? [];
  if (found === null || word !== "") throw new ValueError("number", text);
  const count = Number(digits);
  if (minus !== undefined && count > 0) throw new ValueError("negative", text);
  if (!Number.isInteger(count)) throw new ValueError("whole", text);
  return count;
}

/** The distance one step moves a length, in the length's own unit. */
export const STEPS: Readonly<Record<Unit, number>> = {
  pt: 0.5,
  pc: 0.5,
  in: 0.05,
  mm: 1,
  cm: 0.1,
  em: 0.1,
};

/**
 * Moves a length by `times` steps of its unit. It stops at 0 and
 * rounds the result, so a step of 0.1 leaves no float noise.
 */
export function stepLength(length: Length, by: 1 | -1, times = 1): Length {
  const value = length.value + by * times * STEPS[length.unit];
  return { value: rounded(Math.max(0, value)), unit: length.unit };
}

/** Moves a count by `times`. It stops at 0. */
export function stepCount(count: number, by: 1 | -1, times = 1): number {
  return Math.max(0, count + by * times);
}

const ALIGNS: readonly Align[] = ["justify", "left"];
const ALIGNMENTS: readonly Alignment[] = ["left", "center", "right"];
const BEGINS: readonly Begins[] = ["right-page", "next-page", "same-page"];
export const CAPS: readonly Caps[] = ["normal", "small-caps", "all-caps"];

const MARKS: readonly SceneMark[] = ["space", "ornament", "word"];
const SLOTS: readonly HeaderSlot[] = [
  "none",
  "author",
  "book-title",
  "chapter-title",
];
const HEAD_POSITIONS: readonly HeaderPosition[] = ["outside", "center"];
const POSITIONS: readonly PageNumberPosition[] = ["top", "bottom", "outside"];
const FORMATS: readonly NumberFormat[] = ["arabic", "roman"];

/** The unit a length written as a bare number is given. */
const UNIT: Unit = "pt";

/** A number with its sign in a separate group, then an optional unit. */
const TYPED = /^(-)?(\d+(?:\.\d+)?|\.\d+)\s*([a-z]*)$/i;

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
      key: `heading-${level}-font-variant`,
      property: "font-family",
      read: ({ headings }) => headings[level].fontVariant,
      write: ({ headings }, value) => {
        const variant = asText(value);
        if (variant !== undefined) headings[level].fontVariant = variant;
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
  return length === undefined ? undefined : `${rounded(length.value)}${length.unit}`;
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function isUnit(word: string): word is Unit {
  return (UNITS as readonly string[]).includes(word);
}

function asLength(value: unknown): Length | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? { value, unit: UNIT } : undefined;
  }
  return typeof value === "string" ? readable(() => parseLength(value)) : undefined;
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
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  return typeof value === "string" ? readable(() => parseCount(value)) : undefined;
}

/** The value read, or nothing where the text is one the schema cannot read. */
function readable<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if (error instanceof ValueError) return undefined;
    throw error;
  }
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
