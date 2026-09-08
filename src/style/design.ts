/**
 * The sheet a design generates, which cascades over the theme orca
 * bundles. The theme is constant and the design is not, so the two
 * cross as separate sheets.
 */

import type { Sheet } from "fleuron";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";

/** The sheet a design is sent under, which a warning names. */
export const DESIGN_SHEET = "design.css";

export interface Design {
  /** The family the book is set in, or nothing for the theme's face. */
  face?: string | undefined;
}

/** The design as one sheet. A design with no face generates an empty sheet. */
export function designSheet(design: Design): Sheet {
  const face = design.face;
  return {
    name: DESIGN_SHEET,
    css: face === undefined ? "" : `book { font-family: ${quoted(face)}, serif; }\n`,
  };
}

/** The sheets a book is styled by, in cascade order. */
export function designSheets(design: Design): Sheet[] {
  return [{ name: THEME_SHEET, css: BUNDLED_THEME }, designSheet(design)];
}

/**
 * A family name as a CSS string. The name comes from a font file's own
 * name table, so a quote or a backslash in it is escaped.
 */
function quoted(family: string): string {
  return `"${family.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}
