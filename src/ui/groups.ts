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
  readDesign,
  writeDesign,
  written,
  BOOK_SIZES,
  type Design,
  type Written,
} from "@/style/design";

/** One word a select or a segment offers, and the value it writes. */
export interface Choice {
  value: string;
  label: string;
}

/** The control kinds the panel draws. */
export type Kind =
  | "preset"
  | "trim"
  | "font"
  | "styles"
  | "length"
  | "count"
  | "flag"
  | "select"
  | "segment"
  | "glyph"
  | "word";

/** One control, and the design key it writes. */
export interface Control {
  kind: Kind;
  /** The design key, which `DESIGN_KEYS` holds. */
  key?: string;
  /** The words a select or a segment offers. */
  choices?: readonly Choice[];
  /** The word before the control, where a row holds more than one. */
  named?: string;
  /** The word after the control: a unit, or what a switch means. */
  said?: string;
}

/** One row of the panel: a label, and the controls beside it. */
export interface Row {
  label: string;
  of: readonly Control[];
  /** The line under the row, in the panel's faint type. */
  said?: string;
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

const WEIGHTS: readonly Choice[] = [
  { value: "regular", label: "Regular" },
  { value: "medium", label: "Medium" },
  { value: "semibold", label: "Semibold" },
  { value: "bold", label: "Bold" },
];

const SLOPES: readonly Choice[] = [
  { value: "roman", label: "Roman" },
  { value: "italic", label: "Italic" },
];

const ALIGNMENTS: readonly Choice[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centred" },
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

/** The trims the panel offers by name, and the custom pair under them. */
export const TRIMS: readonly Choice[] = BOOK_SIZES.map(({ name, trim }) => ({
  value: `${written(trim.width)} ${written(trim.height)}`,
  label: `${name} — ${measured(trim.width.value)} × ${measured(trim.height.value)} ${trim.width.unit}`,
}));

/** The ornaments the glyph picker offers. */
export const GLYPHS: readonly string[] = ["❧", "⁂", "§", "✦"];

/** The chapter's title is heading 1, and the panel sets that level. */
const TITLE = 1;

export const GROUPS: readonly Group[] = [
  {
    name: "Preset",
    hint: "a design opens on one, not on defaults",
    rows: [{ label: "Preset", of: [{ kind: "preset", key: "preset" }] }],
  },
  {
    name: "Page",
    rows: [
      { label: "Trim", of: [{ kind: "trim", key: "trim" }] },
      {
        label: "Margins",
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
      {
        label: "Size",
        of: [
          { kind: "length", key: "body-size" },
          { kind: "length", key: "body-line-spacing", named: "Line spacing" },
        ],
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
      { label: "Title face", of: [{ kind: "font", key: `heading-${TITLE}-font` }] },
      {
        label: "Title size",
        of: [{ kind: "length", key: `heading-${TITLE}-size` }],
      },
      {
        label: "Title weight",
        of: [
          { kind: "select", key: `heading-${TITLE}-weight`, choices: WEIGHTS },
        ],
      },
      {
        label: "Title slope",
        of: [{ kind: "segment", key: `heading-${TITLE}-slope`, choices: SLOPES }],
      },
      {
        label: "Title alignment",
        of: [
          { kind: "segment", key: `heading-${TITLE}-align`, choices: ALIGNMENTS },
        ],
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
          { kind: "count", key: "scene-break-space-above", said: "above" },
          { kind: "count", key: "scene-break-space-below", said: "below" },
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
            said: "Suppress the running head on openings",
          },
        ],
      },
    ],
  },
  {
    name: "Discipline",
    rows: [
      {
        label: "Orphans",
        of: [
          { kind: "count", key: "body-orphans", said: "lines" },
          { kind: "count", key: "body-widows", named: "Widows", said: "lines" },
        ],
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

/** Every design key the panel writes, in the order the panel offers them. */
export const PANEL_KEYS: readonly string[] = GROUPS.flatMap((group) =>
  group.rows.flatMap((row) => row.of.flatMap((control) => control.key ?? [])),
);

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
  return readDesign(properties);
}
