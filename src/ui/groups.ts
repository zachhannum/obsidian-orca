/**
 * The controls the design panel offers, group by group.
 *
 * The panel is the short list of decisions a book designer makes. Each
 * group holds the decisions made with the same things on screen, so the
 * table is written by hand here and not derived from the keys.
 *
 * Every control writes one design key, and every design key sets a
 * property the pinned engine reads. So no control can produce an engine
 * warning.
 */

import type { Variant } from "@/assets/variants";
import {
  LEVELS,
  STEPS,
  ValueError,
  convertLength,
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
  type PageUnit,
  type Unit,
  type Written,
} from "@/style/design";
import { ROLES, type Role } from "@/book/roles";
import type { RuleFrom } from "@/style/generated";
import type { Override } from "@/style/overrides";

/** One word a select or a segment offers, and the value it writes. */
export interface Choice {
  value: string;
  label: string;
}

/** The control kinds the panel draws. */
export type Kind =
  | "trim"
  | "font"
  | "variant"
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
   * group has `N` in place of its level, and `atLevel` fills it in.
   */
  key?: string;
  /** The words a select or a segment offers. */
  choices?: readonly Choice[];
  /** The word after the control, such as a unit or the meaning of a switch. */
  said?: string;
  /** When true, the value is a length on the page, drawn in the unit the author measures pages in. */
  page?: boolean;
}

/** One row of the panel. */
export interface Row {
  label: string;
  /** The controls beside the label. */
  of: readonly Control[];
  /** The controls sit two to a line, each with its word under it. */
  grid?: boolean;
}

export interface Group {
  name: string;
  rows: readonly Row[];
}

const ALIGN: readonly Choice[] = [
  { value: "justify", label: "Justified" },
  { value: "left", label: "Ragged right" },
];

const BEGINS: readonly Choice[] = [
  { value: "next-page", label: "Next page" },
  { value: "right-page", label: "Right-hand page" },
  { value: "same-page", label: "Same page" },
];

const DROP_CAPS: readonly Choice[] = [
  { value: "0", label: "None" },
  { value: "2", label: "2 lines" },
  { value: "3", label: "3 lines" },
  { value: "4", label: "4 lines" },
];

const CAPITALS: readonly Choice[] = [
  { value: "normal", label: "Normal" },
  { value: "small-caps", label: "Small caps" },
  { value: "all-caps", label: "All caps" },
];

/** Tracking is a select of named amounts, since a length steps an em too far. */
const TRACKING: readonly Choice[] = [
  { value: "0em", label: "None" },
  { value: "0.04em", label: "Slight" },
  { value: "0.08em", label: "Open" },
  { value: "0.12em", label: "Wide" },
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

const HEADS: readonly Choice[] = [
  { value: "outside", label: "Outside" },
  { value: "center", label: "Center" },
];

const POSITIONS: readonly Choice[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "outside", label: "Outside" },
];

/** The label of a folio format shows how its numbers look. */
const FORMATS: readonly Choice[] = [
  { value: "arabic", label: "1, 2, 3" },
  { value: "roman", label: "i, ii, iii" },
];

/** The heading levels, which the Headings group sets one at a time. */
export const LEVEL_CHOICES: readonly Choice[] = LEVELS.map((level) => ({
  value: String(level),
  label: `H${String(level)}`,
}));

/**
 * The trims the panel offers by name. Each label measures the trim in
 * the unit the author measures pages in. Each value is the trim as
 * written in the note.
 */
export function trims(unit: PageUnit): Choice[] {
  return BOOK_SIZES.map(({ name, trim }) => {
    const width = convertLength(trim.width, unit);
    const height = convertLength(trim.height, unit);
    return {
      value: `${written(trim.width)} ${written(trim.height)}`,
      label: `${name} (${measured(width)} × ${measured(height)} ${unit})`,
    };
  });
}

/** The ornaments the glyph picker offers. */
export const GLYPHS: readonly string[] = ["❧", "⁂", "§", "✦"];

/** The part of a Headings key that the chosen level replaces. */
const LEVELED = "heading-N-";

export const GROUPS: readonly Group[] = [
  {
    name: "Page",
    rows: [
      { label: "Trim", of: [{ kind: "trim", key: "trim", page: true }] },
      {
        label: "Margins",
        grid: true,
        of: [
          { kind: "length", key: "margin-inside", said: "inside", page: true },
          { kind: "length", key: "margin-outside", said: "outside", page: true },
          { kind: "length", key: "margin-top", said: "top", page: true },
          { kind: "length", key: "margin-bottom", said: "bottom", page: true },
        ],
      },
      {
        label: "",
        of: [
          {
            kind: "flag",
            key: "mirrored",
            said: "Mirror the margins on facing pages",
          },
        ],
      },
    ],
  },
  {
    name: "Text",
    rows: [
      { label: "Font", of: [{ kind: "font", key: "body-font" }] },
      { label: "Variant", of: [{ kind: "variant", key: "body-font-variant" }] },
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
      { label: "Variant", of: [{ kind: "variant", key: `${LEVELED}font-variant` }] },
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
        label: "Begins on",
        of: [{ kind: "select", key: "chapter-begins", choices: BEGINS }],
      },
      {
        label: "Space above",
        of: [{ kind: "count", key: "chapter-space-above", said: "lines" }],
      },
      {
        label: "Space below",
        of: [{ kind: "count", key: "chapter-space-below", said: "lines" }],
      },
      {
        label: "Capitals",
        of: [{ kind: "select", key: "chapter-opening-caps", choices: CAPITALS }],
      },
      {
        label: "Tracking",
        of: [
          { kind: "select", key: "chapter-opening-letter-spacing", choices: TRACKING },
        ],
      },
      {
        label: "Drop cap",
        of: [{ kind: "select", key: "chapter-drop-cap", choices: DROP_CAPS }],
      },
      {
        label: "First line",
        grid: true,
        of: [
          {
            kind: "select",
            key: "chapter-first-line-caps",
            choices: CAPITALS,
            said: "capitals",
          },
          {
            kind: "select",
            key: "chapter-first-line-letter-spacing",
            choices: TRACKING,
            said: "tracking",
          },
        ],
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
        label: "Space above",
        of: [{ kind: "count", key: "scene-break-space-above", said: "lines" }],
      },
      {
        label: "Space below",
        of: [{ kind: "count", key: "scene-break-space-below", said: "lines" }],
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
        label: "Header position",
        of: [{ kind: "segment", key: "header-position", choices: HEADS }],
      },
      {
        label: "Page number",
        of: [
          { kind: "segment", key: "page-number-position", choices: POSITIONS },
        ],
      },
      {
        label: "Number format",
        of: [{ kind: "segment", key: "page-number-format", choices: FORMATS }],
      },
      {
        label: "Capitals",
        of: [{ kind: "select", key: "header-caps", choices: CAPITALS }],
      },
      {
        label: "Tracking",
        of: [{ kind: "select", key: "header-letter-spacing", choices: TRACKING }],
      },
      {
        label: "",
        of: [
          {
            kind: "flag",
            key: "header-italic",
            said: "Set the running heads in italic",
          },
        ],
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

/** The key a font's variant is written under. Setting or clearing the font clears it. */
export function variantKey(fontKey: string): string {
  return `${fontKey}-variant`;
}

/**
 * Returns the design with a font key set, or cleared when `font` is
 * undefined. The variant picked for the old font goes with it, so a new
 * font sets in its default variant.
 */
export function withFont(design: Design, key: string, font: string | undefined): Design {
  return withKey(withKey(design, variantKey(key), undefined), key, font);
}

/** Returns the design with a variant picked. The default variant is written as absent. */
export function withVariant(design: Design, key: string, variant: Variant): Design {
  return withKey(design, key, variant.isDefault ? undefined : variant.name);
}

/** Returns a control's key at one heading level. A key with no level comes back unchanged. */
export function atLevel(key: string, level: Level): string {
  return key.replace(LEVELED, `heading-${String(level)}-`);
}

/**
 * The declarations of the author's CSS that override a row, in row order,
 * one for each place and property. The first key the CSS overrides names
 * the row, and its declaration comes first.
 */
export function overriddenAt(
  keys: readonly string[],
  overridden: ReadonlyMap<string, Override>,
): { key: string; overrides: readonly Override[] } | undefined {
  const overrides: Override[] = [];
  let first: string | undefined;
  for (const key of keys) {
    const found = overridden.get(key);
    if (found === undefined) continue;
    first ??= key;
    const same = overrides.some(
      (each) =>
        each.sheet === found.sheet &&
        each.line === found.line &&
        each.column === found.column &&
        each.property === found.property,
    );
    if (!same) overrides.push(found);
  }
  return first === undefined ? undefined : { key: first, overrides };
}

/** Every design key a group can write, with a Headings key at every level. */
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

/** The control a generated rule came from, which a click in the inspect pane opens. */
export interface Owner {
  group: string;
  /** The row, when every key the rule read is in one row. A row with no label uses the words of its switch. */
  row?: string;
  /** The heading level, for a rule a Headings key wrote. */
  level?: Level;
  /** A key the rule read, at its level, which the row carries in `data-keys`. */
  key?: string;
  /** The layout of a rule no control wrote, which opens nothing. */
  layout?: Role;
}

/** The group, row and level of one design key in the panel. */
interface Placed {
  group: Group;
  row: Row;
  level: Level | undefined;
}

function placeOf(key: string): Placed | undefined {
  const leveled = /^heading-(\d)-(.+)$/.exec(key);
  const level = LEVELS.find((each) => String(each) === leveled?.[1]);
  const listed = level === undefined ? key : `${LEVELED}${leveled?.[2] ?? ""}`;
  for (const group of GROUPS) {
    for (const row of group.rows) {
      if (row.of.some((control) => control.key === listed)) {
        return { group, row, level };
      }
    }
  }
  return undefined;
}

/**
 * The control that wrote a generated rule. One row's keys name that
 * row, and keys across rows name the group of the first. A rule that
 * reads no key the panel writes, but was written for a role, names that
 * role's layout. Anything else names nothing.
 */
export function controlOf(from: RuleFrom): Owner | undefined {
  const placed = from.keys.flatMap((key) => {
    const found = placeOf(key);
    return found === undefined ? [] : [{ key, ...found }];
  });
  const first = placed[0];
  if (first === undefined) {
    return from.role === undefined
      ? undefined
      : { group: ROLES[from.role].name, layout: from.role };
  }
  const level = first.level;
  const levels = level === undefined ? {} : { level };
  const oneRow = placed.every((each) => each.row === first.row);
  if (oneRow) {
    const said = first.row.of.find((control) => control.said !== undefined)?.said;
    const row = first.row.label === "" ? said : first.row.label;
    return {
      group: first.group.name,
      ...(row === undefined ? {} : { row }),
      ...levels,
      key: first.key,
    };
  }
  return { group: first.group.name, ...levels, key: first.key };
}

/** The words the pane names a control by, as `Headings, H1` or `Size, H2`. */
export function ownerSaid(owner: Owner): string {
  if (owner.layout !== undefined) return owner.group.toLowerCase();
  const name = owner.row ?? owner.group;
  return owner.level === undefined ? name : `${name}, H${String(owner.level)}`;
}

/** Every design key the panel writes, in the order the panel offers them. */
export const PANEL_KEYS: readonly string[] = GROUPS.flatMap(keysOf);

/** A trim's side, to the hundredth of an inch or the tenth of a millimeter or point. */
function measured(length: Length): string {
  return String(Number(length.value.toFixed(length.unit === "in" ? 2 : 1)));
}

/**
 * Returns the design with one key set to a value as written in the
 * note. If the schema cannot read the value, the design comes back
 * unchanged.
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

/** The value a number field writes, or the message shown when it writes nothing. */
export type Typed = { value: Written } | { wrong: string };

/**
 * Reads a number field's text. A length comes back as written in the
 * note. A bare number takes `unit`, so `12` goes into the note as
 * `12pt` by default.
 */
export function typed(measure: Measure, text: string, unit: Unit = "pt"): Typed {
  try {
    return measure === "length"
      ? { value: noted(parseLength(text, unit)) }
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
 * steps. Text the field cannot read gives nothing.
 */
export function stepped(
  measure: Measure,
  text: string,
  by: 1 | -1,
  times = 1,
  unit: Unit = "pt",
): Written | undefined {
  const read = typed(measure, text, unit);
  if ("wrong" in read) return undefined;
  return measure === "length"
    ? noted(stepLength(parseLength(String(read.value)), by, times))
    : stepCount(Number(read.value), by, times);
}

/** The tooltip on a stepper button, which names the step. */
export function stepSaid(
  measure: Measure,
  text: string,
  by: 1 | -1,
  unit: Unit = "pt",
): string {
  const verb = by === 1 ? "Increase" : "Decrease";
  if (measure === "count") return `${verb} by 1 line`;
  const read = typed(measure, text, unit);
  const stepUnit = "wrong" in read ? unit : parseLength(String(read.value)).unit;
  return `${verb} by ${noted({ value: STEPS[stepUnit], unit: stepUnit })}`;
}

/**
 * Converts a length to the unit the author measures pages in, for a
 * page control. Text that is not a length comes back unchanged.
 */
export function inUnit(text: string, unit: PageUnit): string {
  const read = typed("length", text);
  if ("wrong" in read) return text;
  return noted(convertLength(parseLength(String(read.value)), unit));
}

/** Names a value in the words the control draws it with. The reset names its default this way. */
export function defaultSaid(
  control: Control,
  value: Written | undefined,
  unit: PageUnit,
): string {
  if (value === undefined) return "none";
  if (control.kind === "flag") return value === true ? "on" : "off";
  if (control.page === true && control.kind === "length") {
    return inUnit(String(value), unit);
  }
  const choices = control.kind === "trim" ? trims(unit) : (control.choices ?? []);
  return choices.find((choice) => choice.value === String(value))?.label ?? String(value);
}

function noted(length: Length): string {
  return written(length) ?? "";
}
