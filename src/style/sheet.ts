/**
 * The sheet a design generates, which cascades over the theme orca
 * bundles. The theme is constant and the design is not, so the two
 * cross as separate sheets.
 */

import type { Sheet } from "fleuron";
import type { Design } from "@/style/design";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";

/** The sheet a design is sent under, which a warning names. */
export const DESIGN_SHEET = "design.css";

/** The design as one sheet. A design with no font generates an empty sheet. */
export function designSheet(design: Design): Sheet {
  const font = design.body.font;
  return {
    name: DESIGN_SHEET,
    css: font === undefined ? "" : `book { font-family: ${quoted(font)}, serif; }\n`,
  };
}

/** The sheets a book is styled by, in cascade order. */
export function designSheets(design: Design): Sheet[] {
  return [{ name: THEME_SHEET, css: BUNDLED_THEME }, designSheet(design)];
}

/**
 * A font name as a CSS string. The name comes from a font file's own
 * name table, so a quote or a backslash in it is escaped.
 */
function quoted(font: string): string {
  return `"${font.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}
