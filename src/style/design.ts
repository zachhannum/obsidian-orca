/**
 * The design a book is set by: a closed schema whose every field sets
 * one property the pinned engine supports.
 *
 * A field the design leaves unset is left to the layer under it, so a
 * book that points at a shared design note holds only what it changes.
 *
 * The schema is serialised flat, one key per line, because a novelist
 * who opens Obsidian's properties panel finds `leading` there rather
 * than a nested object.
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

/** A page's margins. Inner is the gutter side and outer the fore-edge. */
export interface Margins {
  inner?: Length;
  outer?: Length;
  top?: Length;
  bottom?: Length;
}

export interface PageDesign {
  trim?: Trim;
  margins: Margins;
  /** Inner and outer swap sides on a verso page. */
  mirrored?: boolean;
}

export type Align = "justify" | "left";

export interface TextDesign {
  /** The family the book is set in. */
  face?: string;
  size?: Length;
  leading?: Length;
  align?: Align;
  /** The first-line indent. */
  indent?: Length;
  hyphens?: boolean;
  hanging?: boolean;
}

export interface BreaksDesign {
  orphans?: number;
  widows?: number;
}

export type Weight = "regular" | "medium" | "semibold" | "bold";

export type Slope = "roman" | "italic";

export type Alignment = "left" | "center" | "right";

/** The type a chapter title is set in. */
export interface TypeSpec {
  face?: string;
  size?: Length;
  weight?: Weight;
  slope?: Slope;
  align?: Alignment;
}

export type OpensOn = "recto" | "next" | "same";

export interface ChapterDesign {
  opensOn?: OpensOn;
  /** The sink above a chapter title, in lines of body text. */
  sink?: number;
  heading: TypeSpec;
  /** The lines a drop cap falls over. */
  dropCap?: number;
}

export interface SceneDesign {
  /** The mark between two scenes, as the glyph itself. */
  ornament?: string;
}

export type RunningSlot = "none" | "author" | "book" | "chapter";

export type Folio = "top" | "foot" | "outer";

export type Numerals = "arabic" | "roman";

export interface RunningDesign {
  verso?: RunningSlot;
  recto?: RunningSlot;
  folio?: Folio;
  numerals?: Numerals;
}

/** The whole design, group by group. Every field in a group is optional. */
export interface Design {
  page: PageDesign;
  text: TextDesign;
  breaks: BreaksDesign;
  chapter: ChapterDesign;
  scene: SceneDesign;
  running: RunningDesign;
}

/** A design that sets nothing. */
export function emptyDesign(): Design {
  return {
    page: { margins: {} },
    text: {},
    breaks: {},
    chapter: { heading: {} },
    scene: {},
    running: {},
  };
}

/** One scalar a design key is written as. */
export type Written = string | number | boolean;

interface Field {
  key: string;
  /** The CSS property this field sets. `subset.css` declares it. */
  property: string;
  read(design: Design): Written | undefined;
  write(design: Design, value: unknown): void;
}

/** The design's fields, in the order the frontmatter writes them. */
const FIELDS: readonly Field[] = [
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
  margin("margin-inner", "inner", "margin-left"),
  margin("margin-outer", "outer", "margin-right"),
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
  {
    key: "face",
    property: "font-family",
    read: ({ text }) => text.face,
    write: ({ text }, value) => {
      const face = asText(value);
      if (face !== undefined) text.face = face;
    },
  },
  {
    key: "size",
    property: "font-size",
    read: ({ text }) => written(text.size),
    write: ({ text }, value) => {
      const size = asLength(value);
      if (size !== undefined) text.size = size;
    },
  },
  {
    key: "leading",
    property: "line-height",
    read: ({ text }) => written(text.leading),
    write: ({ text }, value) => {
      const leading = asLength(value);
      if (leading !== undefined) text.leading = leading;
    },
  },
  {
    key: "align",
    property: "text-align",
    read: ({ text }) => text.align,
    write: ({ text }, value) => {
      const align = asWord(value, ALIGNS);
      if (align !== undefined) text.align = align;
    },
  },
  {
    key: "indent",
    property: "text-indent",
    read: ({ text }) => written(text.indent),
    write: ({ text }, value) => {
      const indent = asLength(value);
      if (indent !== undefined) text.indent = indent;
    },
  },
  {
    key: "hyphens",
    property: "hyphens",
    read: ({ text }) => text.hyphens,
    write: ({ text }, value) => {
      const hyphens = asFlag(value);
      if (hyphens !== undefined) text.hyphens = hyphens;
    },
  },
  {
    key: "hanging",
    property: "hanging-punctuation",
    read: ({ text }) => text.hanging,
    write: ({ text }, value) => {
      const hanging = asFlag(value);
      if (hanging !== undefined) text.hanging = hanging;
    },
  },
  {
    key: "orphans",
    property: "orphans",
    read: ({ breaks }) => breaks.orphans,
    write: ({ breaks }, value) => {
      const orphans = asCount(value);
      if (orphans !== undefined) breaks.orphans = orphans;
    },
  },
  {
    key: "widows",
    property: "widows",
    read: ({ breaks }) => breaks.widows,
    write: ({ breaks }, value) => {
      const widows = asCount(value);
      if (widows !== undefined) breaks.widows = widows;
    },
  },
  {
    key: "chapter-opens",
    property: "break-before",
    read: ({ chapter }) => chapter.opensOn,
    write: ({ chapter }, value) => {
      const opensOn = asWord(value, OPENS_ON);
      if (opensOn !== undefined) chapter.opensOn = opensOn;
    },
  },
  {
    key: "chapter-sink",
    property: "margin-top",
    read: ({ chapter }) => chapter.sink,
    write: ({ chapter }, value) => {
      const sink = asCount(value);
      if (sink !== undefined) chapter.sink = sink;
    },
  },
  {
    key: "chapter-face",
    property: "font-family",
    read: ({ chapter }) => chapter.heading.face,
    write: ({ chapter }, value) => {
      const face = asText(value);
      if (face !== undefined) chapter.heading.face = face;
    },
  },
  {
    key: "chapter-size",
    property: "font-size",
    read: ({ chapter }) => written(chapter.heading.size),
    write: ({ chapter }, value) => {
      const size = asLength(value);
      if (size !== undefined) chapter.heading.size = size;
    },
  },
  {
    key: "chapter-weight",
    property: "font-weight",
    read: ({ chapter }) => chapter.heading.weight,
    write: ({ chapter }, value) => {
      const weight = asWord(value, WEIGHTS);
      if (weight !== undefined) chapter.heading.weight = weight;
    },
  },
  {
    key: "chapter-slope",
    property: "font-style",
    read: ({ chapter }) => chapter.heading.slope,
    write: ({ chapter }, value) => {
      const slope = asWord(value, SLOPES);
      if (slope !== undefined) chapter.heading.slope = slope;
    },
  },
  {
    key: "chapter-align",
    property: "text-align",
    read: ({ chapter }) => chapter.heading.align,
    write: ({ chapter }, value) => {
      const align = asWord(value, ALIGNMENTS);
      if (align !== undefined) chapter.heading.align = align;
    },
  },
  {
    key: "drop-cap",
    property: "initial-letter",
    read: ({ chapter }) => chapter.dropCap,
    write: ({ chapter }, value) => {
      const lines = asCount(value);
      if (lines !== undefined) chapter.dropCap = lines;
    },
  },
  {
    key: "ornament",
    property: "content",
    read: ({ scene }) => scene.ornament,
    write: ({ scene }, value) => {
      const ornament = asText(value);
      if (ornament !== undefined) scene.ornament = ornament;
    },
  },
  {
    key: "verso",
    property: "string-set",
    read: ({ running }) => running.verso,
    write: ({ running }, value) => {
      const slot = asWord(value, SLOTS);
      if (slot !== undefined) running.verso = slot;
    },
  },
  {
    key: "recto",
    property: "string-set",
    read: ({ running }) => running.recto,
    write: ({ running }, value) => {
      const slot = asWord(value, SLOTS);
      if (slot !== undefined) running.recto = slot;
    },
  },
  {
    key: "folio",
    property: "content",
    read: ({ running }) => running.folio,
    write: ({ running }, value) => {
      const folio = asWord(value, FOLIOS);
      if (folio !== undefined) running.folio = folio;
    },
  },
  {
    key: "folio-numerals",
    property: "content",
    read: ({ running }) => running.numerals,
    write: ({ running }, value) => {
      const numerals = asWord(value, NUMERALS);
      if (numerals !== undefined) running.numerals = numerals;
    },
  },
];

/** The design's frontmatter keys, in the order the format writes them. */
export const DESIGN_KEYS: readonly string[] = FIELDS.map((field) => field.key);

/** The CSS properties a design sets, each declared in `subset.css`. */
export const DESIGN_PROPERTIES: readonly string[] = [
  ...new Set(FIELDS.map((field) => field.property)),
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
 * a field, which is how a book overrides the design note it points at.
 */
export function mergeDesign(under: Design, over: Design): Design {
  return {
    page: {
      ...under.page,
      ...over.page,
      margins: { ...under.page.margins, ...over.page.margins },
    },
    text: { ...under.text, ...over.text },
    breaks: { ...under.breaks, ...over.breaks },
    chapter: {
      ...under.chapter,
      ...over.chapter,
      heading: { ...under.chapter.heading, ...over.chapter.heading },
    },
    scene: { ...under.scene, ...over.scene },
    running: { ...under.running, ...over.running },
  };
}

const ALIGNS: readonly Align[] = ["justify", "left"];
const ALIGNMENTS: readonly Alignment[] = ["left", "center", "right"];
const WEIGHTS: readonly Weight[] = ["regular", "medium", "semibold", "bold"];
const SLOPES: readonly Slope[] = ["roman", "italic"];
const OPENS_ON: readonly OpensOn[] = ["recto", "next", "same"];
const SLOTS: readonly RunningSlot[] = ["none", "author", "book", "chapter"];
const FOLIOS: readonly Folio[] = ["top", "foot", "outer"];
const NUMERALS: readonly Numerals[] = ["arabic", "roman"];

/** The unit a length written as a bare number is given. */
const UNIT: Unit = "pt";

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

function written(length: Length | undefined): string | undefined {
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
