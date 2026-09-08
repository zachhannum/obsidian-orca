/**
 * The sheet a design generates, over the theme orca bundles. The theme
 * is a constant and the design is not, so they cross as two sheets: an
 * author who picks a face and picks the bundled one again is back at
 * the theme rather than at a sheet that overrides it with itself.
 */

import type { Sheet } from "fleuron";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";

/** The sheet a design generates, which a warning names and which cascades over the theme. */
export const DESIGN_SHEET = "design.css";

/** A book's design, as much of it as a face is. */
export interface Design {
  /** The family the book is set in, or nothing for the theme's own. */
  face?: string | undefined;
}

/** The design as one sheet. A design that names no face generates an empty one. */
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
 * A family name as a CSS string. The name is read off a font file's
 * own table, so a quote or a backslash in it is escaped rather than
 * left to close the string early.
 */
function quoted(family: string): string {
  return `"${family.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}
