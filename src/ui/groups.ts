/**
 * The controls the design panel offers, group by group.
 *
 * The panel is not the schema with friendlier labels. It is the short
 * list of decisions a book designer makes, grouped by what is on screen
 * when the decision is made, so the table is written here rather than
 * derived from the keys.
 *
 * Every control writes one design key, and every design key sets a
 * property the pinned engine reads. That is what keeps a control from
 * becoming a warning the author has to read.
 */

import {
  LEVELS,
  STEPS,
  ValueError,
  parseCount,
  parseLength,
  readDesign,
  stepCount,
  stepLength,
  writeDesign,
  written,
  BOOK_SIZES,
  type Design,
  type Length,
  type Level,
  type Written,
} from "@/style/design";

/** One word a select or a segment offers, and the value it writes. */
export interface Choice {
  value: string;
  label: string;
}

/** The control kinds the panel draws. */
export type Kind =
  | "trim"
  | "font"
  | "styles"
  | "length"
  | "count"
  | "flag"
  | "select"
  | "segment"
  | "glyph"
  | "word"
  | "level";

/** One control, and the design key it writes. */
export interface Control {
  kind: Kind;
  /**
   * The design key, which `DESIGN_KEYS` holds. A key in the Headings
   * group names its level `N`, and `atLevel` fills it in.
   */
  key?: string;
  /** The words a select or a segment offers. */
  choices?: readonly Choice[];
  /** The word after the control: a unit, or what a switch means. */
  said?: string;
}

/** One row of the panel: a label, and the controls beside it. */
export interface Row {
  label: string;
  of: readonly Control[];
  /** The line under the row, in the panel's faint type. */
  said?: string;
  /** The controls sit two to a line, each with its word under it. */
  grid?: boolean;
}

export interface Group {
  name: string;
  hint?: string;
  rows: readonly Row[];
}

const ALIGN: readonly Choice[] = [
  { value: "justify", label: "Justified" },
  { value: "left", label: "Ragged right" },
];

const BEGINS: readonly Choice[] = [
  { value: "right-page", label: "Right-hand page" },
  { value: "next-page", label: "Next page" },
  { value: "same-page", label: "Same page" },
];

const ALIGNMENTS: readonly Choice[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const MARKS: readonly Choice[] = [
  { value: "space", label: "Space" },
  { value: "ornament", label: "Ornament" },
  { value: "word", label: "Word" },
];

const SLOTS: readonly Choice[] = [
  { value: "none", label: "Nothing" },
  { value: "author", label: "Author" },
  { value: "book-title", label: "Book title" },
  { value: "chapter-title", label: "Chapter title" },
];

const POSITIONS: readonly Choice[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "outside", label: "Outside" },
];

const FORMATS: readonly Choice[] = [
  { value: "arabic", label: "Arabic" },
  { value: "roman", label: "Roman" },
];

/** The heading levels, which the Headings group sets one at a time. */
export const LEVEL_CHOICES: readonly Choice[] = LEVELS.map((level) => ({
  value: String(level),
  label: `H${String(level)}`,
}));

/** The trims the panel offers by name, and the custom pair under them. */
export const TRIMS: readonly Choice[] = BOOK_SIZES.map(({ name, trim }) => ({
  value: `${written(trim.width)} ${written(trim.height)}`,
  label: `${name} — ${measured(trim.width.value)} × ${measured(trim.height.value)} ${trim.width.unit}`,
}));

/** The ornaments the glyph picker offers. */
export const GLYPHS: readonly string[] = ["❧", "⁂", "§", "✦"];

/** The part of a Headings key that the chosen level replaces. */
const LEVELED = "heading-N-";

export const GROUPS: readonly Group[] = [
  {
    name: "Page",
    rows: [
      { label: "Trim", of: [{ kind: "trim", key: "trim" }] },
      {
        label: "Margins",
        grid: true,
        of: [
          { kind: "length", key: "margin-inside", said: "inside" },
          { kind: "length", key: "margin-outside", said: "outside" },
          { kind: "length", key: "margin-top", said: "top" },
          { kind: "length", key: "margin-bottom", said: "bottom" },
        ],
      },
      {
        label: "Mirrored",
        of: [
          {
            kind: "flag",
            key: "mirrored",
            said: "the inside margin follows the gutter",
          },
        ],
      },
    ],
  },
  {
    name: "Text",
    rows: [
      { label: "Font", of: [{ kind: "font", key: "body-font" }] },
      {
        label: "Styles",
        of: [{ kind: "styles" }],
        said: "the styles the engine registered",
      },
      { label: "Size", of: [{ kind: "length", key: "body-size" }] },
      {
        label: "Line spacing",
        of: [{ kind: "length", key: "body-line-spacing" }],
      },
      { label: "Setting", of: [{ kind: "segment", key: "body-align", choices: ALIGN }] },
      {
        label: "First-line indent",
        of: [{ kind: "length", key: "body-first-line-indent" }],
      },
      {
        label: "Hyphenate",
        of: [{ kind: "flag", key: "body-hyphens" }],
      },
      {
        label: "",
        of: [
          {
            kind: "flag",
            key: "body-indent-after-break",
            said: "Indent again after a scene break",
          },
        ],
      },
      {
        label: "",
        of: [
          {
            kind: "flag",
            key: "body-hanging-punctuation",
            said: "Hanging punctuation",
          },
        ],
      },
    ],
  },
  {
    name: "Headings",
    rows: [
      { label: "", of: [{ kind: "level", choices: LEVEL_CHOICES }] },
      { label: "Font", of: [{ kind: "font", key: `${LEVELED}font` }] },
      { label: "Size", of: [{ kind: "length", key: `${LEVELED}size` }] },
      {
        label: "Alignment",
        of: [{ kind: "segment", key: `${LEVELED}align`, choices: ALIGNMENTS }],
      },
    ],
  },
  {
    name: "Chapter openings",
    rows: [
      {
        label: "Begins",
        of: [{ kind: "segment", key: "chapter-begins", choices: BEGINS }],
        said: "a right-hand start leaves the odd blank page behind it",
      },
      {
        label: "Space above",
        of: [{ kind: "count", key: "chapter-space-above", said: "lines" }],
        said: "keeps the baselines below it",
      },
      {
        label: "Space below",
        of: [{ kind: "count", key: "chapter-space-below", said: "lines" }],
      },
      {
        label: "Drop cap",
        of: [{ kind: "count", key: "chapter-drop-cap", said: "lines" }],
      },
    ],
  },
  {
    name: "Scene breaks",
    rows: [
      {
        label: "Mark",
        of: [{ kind: "segment", key: "scene-break-mark", choices: MARKS }],
      },
      { label: "Glyph", of: [{ kind: "glyph", key: "scene-break-ornament" }] },
      { label: "Word", of: [{ kind: "word", key: "scene-break-word" }] },
      {
        label: "Space",
        of: [
          { kind: "count", key: "scene-break-space-above", said: "lines above" },
          { kind: "count", key: "scene-break-space-below", said: "lines below" },
        ],
      },
    ],
  },
  {
    name: "Heads & folios",
    rows: [
      {
        label: "Left-page header",
        of: [{ kind: "select", key: "header-left-page", choices: SLOTS }],
      },
      {
        label: "Right-page header",
        of: [{ kind: "select", key: "header-right-page", choices: SLOTS }],
      },
      {
        label: "Page number",
        of: [
          { kind: "segment", key: "page-number-position", choices: POSITIONS },
        ],
      },
      {
        label: "Number format",
        of: [{ kind: "select", key: "page-number-format", choices: FORMATS }],
      },
      {
        label: "",
        of: [
          {
            kind: "flag",
            key: "suppress-head-on-openings",
            said: "Hide the running head and page number on openings",
          },
        ],
      },
    ],
  },
  {
    name: "Page breaks",
    rows: [
      {
        label: "Orphans",
        of: [{ kind: "count", key: "body-orphans", said: "lines" }],
      },
      {
        label: "Widows",
        of: [{ kind: "count", key: "body-widows", said: "lines" }],
      },
      {
        label: "",
        of: [
          {
            kind: "flag",
            key: "keep-heading-with-text",
            said: "Keep a heading with what follows it",
          },
        ],
      },
    ],
  },
];

/** A control's key at one heading level. A key that names no level is its own. */
export function atLevel(key: string, level: Level): string {
  return key.replace(LEVELED, `heading-${String(level)}-`);
}

/** Every design key a group can write. A Headings key is written at every level. */
export function keysOf(group: Group): string[] {
  return group.rows.flatMap((row) =>
    row.of.flatMap((control) => {
      const key = control.key;
      if (key === undefined) return [];
      return key.startsWith(LEVELED)
        ? LEVELS.map((level) => atLevel(key, level))
        : [key];
    }),
  );
}

/** Every design key the panel writes, in the order the panel offers them. */
export const PANEL_KEYS: readonly string[] = GROUPS.flatMap(keysOf);

function measured(value: number): string {
  return String(Number(value.toFixed(2)));
}

/**
 * The design with one key written into it, as the note writes that key.
 * A value the schema cannot read leaves the design as it was.
 */
export function withKey(
  design: Design,
  key: string,
  value: Written | undefined,
): Design {
  const properties: Record<string, Written> = writeDesign(design);
  if (value === undefined) {
    delete properties[key];
  } else {
    properties[key] = value;
  }
  const next = readDesign(properties);
  if (value !== undefined && writeDesign(next)[key] === undefined) {
    return design;
  }
  return next;
}

/** A number field holds a length with its unit, or a whole number of lines. */
export type Measure = "length" | "count";

/** The value a number field's text writes, or the line that says why it writes none. */
export type Typed = { value: Written } | { wrong: string };

/**
 * Reads a number field's text. A length is written back in the form the
 * note writes it, so `12` goes into the note as `12pt`.
 */
export function typed(measure: Measure, text: string): Typed {
  try {
    return measure === "length"
      ? { value: noted(parseLength(text)) }
      : { value: parseCount(text) };
  } catch (error) {
    if (!(error instanceof ValueError)) throw error;
    return {
      wrong:
        measure === "count" && error.kind === "number"
          ? WRONG.whole
          : WRONG[error.kind],
    };
  }
}

const WRONG: Readonly<Record<ValueError["kind"], string>> = {
  number: "Type a number and a unit, such as 12pt.",
  unit: "Use one of these units: pt, pc, in, mm, cm, em.",
  negative: "Use 0 or more.",
  whole: "Type a whole number of lines, such as 2.",
};

/**
 * Steps a number field's text by one step of its unit, or by `times`
 * steps. Text the field cannot read steps to nothing.
 */
export function stepped(
  measure: Measure,
  text: string,
  by: 1 | -1,
  times = 1,
): Written | undefined {
  const read = typed(measure, text);
  if ("wrong" in read) return undefined;
  return measure === "length"
    ? noted(stepLength(parseLength(String(read.value)), by, times))
    : stepCount(Number(read.value), by, times);
}

/** The tooltip on a stepper button, which names the step. */
export function stepSaid(measure: Measure, text: string, by: 1 | -1): string {
  const verb = by === 1 ? "Increase" : "Decrease";
  if (measure === "count") return `${verb} by 1 line`;
  const read = typed(measure, text);
  const unit = "wrong" in read ? "pt" : parseLength(String(read.value)).unit;
  return `${verb} by ${noted({ value: STEPS[unit], unit })}`;
}

/** The default a control draws, in the words the reset names it by. */
export function defaultSaid(control: Control, value: Written | undefined): string {
  if (value === undefined) return "none";
  if (control.kind === "flag") return value === true ? "on" : "off";
  const choices = control.kind === "trim" ? TRIMS : (control.choices ?? []);
  return choices.find((choice) => choice.value === String(value))?.label ?? String(value);
}

function noted(length: Length): string {
  return written(length) ?? "";
}
