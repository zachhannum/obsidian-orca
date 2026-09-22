/**
 * The theme orca bundles and the defaults a design sits over. A book
 * that sets nothing gets both. That book has the engine's own page and
 * break rules, with its text in EB Garamond, the one font the engine
 * carries today.
 */

import {
  LEVELS,
  mergeDesign,
  type Design,
  type Faced,
  type Length,
  type TypeSpec,
} from "@/style/design";

/** The sheet orca sends its own styling under, which a warning names. */
export const THEME_SHEET = "orca.css";

/**
 * The bundled theme's CSS, sent as one `style` op. It holds only what
 * the schema has no field for. A heading takes a line height of its
 * own, because otherwise a larger heading inherits the body's line
 * spacing as a fixed length.
 */
export const BUNDLED_THEME = `
:is(h1, h2, h3, h4, h5, h6) {
  font-weight: 400;
  line-height: 1.5;
}
`;

/**
 * The design a book that sets nothing gets. A heading level sets no
 * font, so it takes the body font. The object is frozen, because every
 * design merged over it shares its lengths.
 */
export const DEFAULTS: Design = frozen({
  page: {
    trim: { width: inches(6), height: inches(9) },
    margins: {
      inside: inches(0.75),
      outside: inches(0.6),
      top: inches(0.75),
      bottom: inches(0.75),
    },
    mirrored: true,
  },
  body: {
    font: "EB Garamond",
    size: points(11),
    lineSpacing: points(16.5),
    align: "justify",
    indent: { value: 1.2, unit: "em" },
    indentAfterBreak: false,
    hyphens: true,
    hangingPunctuation: false,
    orphans: 2,
    widows: 2,
    keepHeadings: true,
  },
  headings: {
    1: heading(),
    2: heading(),
    3: heading(),
    4: heading(),
    5: heading(),
    6: heading(),
  },
  chapter: {
    begins: "next-page",
    spaceAbove: 0,
    spaceBelow: 0,
    dropCap: 0,
    firstLineCaps: "normal",
    firstLineLetterSpacing: ems(0),
  },
  scene: { mark: "ornament", ornament: "❧", spaceAbove: 1, spaceBelow: 1 },
  // The engine's own sheet sets `blockquote { margin: 1em 2em }` and
  // `ul, ol { padding-left: 1.5em }`, and no margin on an item or an
  // image. These defaults repeat it, so a book that sets none of these
  // groups is set the same way as before the panel offered them.
  quote: {
    indentLeft: ems(2),
    indentRight: ems(2),
    spaceAbove: ems(1),
    spaceBelow: ems(1),
  },
  list: { marker: "disc", indent: ems(1.5), spaceBetween: ems(0) },
  image: { spaceAbove: ems(0), spaceBelow: ems(0) },
  headers: {
    leftPage: "none",
    rightPage: "none",
    position: "outside",
    pageNumber: "bottom",
    pageNumberFormat: "arabic",
    caps: "normal",
    letterSpacing: ems(0),
    italic: false,
    suppressOnOpenings: true,
  },
});

/**
 * Fills in every default under a design. A place with no font of its
 * own takes the body's font and variant as a pair. A place with its own
 * font and no variant keeps that font's default. A quote with no size
 * of its own takes the body's size, which is how it is set.
 */
export function effective(design: Design): Design {
  const merged = mergeDesign(structuredClone(DEFAULTS), design);
  merged.quote.size ??= merged.body.size;
  const { font, fontVariant } = merged.body;
  if (font === undefined) return merged;
  const faced: Faced[] = [...LEVELS.map((level) => merged.headings[level]), merged.quote];
  for (const type of faced) {
    if (type.font !== undefined) continue;
    type.font = font;
    if (fontVariant === undefined) delete type.fontVariant;
    else type.fontVariant = fontVariant;
  }
  return merged;
}

function heading(): TypeSpec {
  return { size: points(19), caps: "normal", letterSpacing: ems(0), align: "left" };
}

function points(value: number): Length {
  return { value, unit: "pt" };
}

function ems(value: number): Length {
  return { value, unit: "em" };
}

function inches(value: number): Length {
  return { value, unit: "in" };
}

function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const each of Object.values(value)) frozen(each);
    Object.freeze(value);
  }
  return value;
}
