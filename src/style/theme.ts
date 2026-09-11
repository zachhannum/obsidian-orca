/**
 * The theme orca bundles and the defaults a design sits over. Together
 * they are what a book that sets nothing gets: the engine's own page
 * and break rules, with the book set in EB Garamond, the one font the
 * engine carries today.
 */

import {
  LEVELS,
  mergeDesign,
  type Design,
  type Length,
  type TypeSpec,
} from "@/style/design";

/** The sheet orca sends its own styling under, which a warning names. */
export const THEME_SHEET = "orca.css";

/**
 * The bundled theme's CSS, sent as one `style` op. It holds only what
 * the schema cannot say. A heading takes a line height of its own,
 * since the body's line spacing is a length a larger heading would
 * inherit.
 */
export const BUNDLED_THEME = `
:is(h1, h2, h3, h4, h5, h6) {
  font-weight: 400;
  line-height: 1.5;
}
`;

/**
 * The design a book that sets nothing gets. A heading level sets no
 * font, so it is set in the body font. It is frozen, since every
 * design merged over it shares its lengths.
 */
export const DEFAULTS: Design = frozen({
  page: {
    trim: { width: inches(6), height: inches(9) },
    margins: {
      inside: points(54),
      outside: points(42),
      top: points(54),
      bottom: points(54),
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
  chapter: { begins: "right-page", spaceAbove: 0, spaceBelow: 0, dropCap: 0 },
  scene: { mark: "ornament", ornament: "❧", spaceAbove: 1, spaceBelow: 1 },
  headers: {
    leftPage: "none",
    rightPage: "none",
    pageNumber: "bottom",
    pageNumberFormat: "arabic",
    suppressOnOpenings: true,
  },
});

/**
 * The design a book is set in, with every default filled in. A heading
 * level with no font of its own takes the body font.
 */
export function effective(design: Design): Design {
  const merged = mergeDesign(structuredClone(DEFAULTS), design);
  const { font } = merged.body;
  if (font !== undefined) {
    for (const level of LEVELS) merged.headings[level].font ??= font;
  }
  return merged;
}

function heading(): TypeSpec {
  return { size: points(19), align: "left" };
}

function points(value: number): Length {
  return { value, unit: "pt" };
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
