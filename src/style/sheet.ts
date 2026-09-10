/**
 * The three layers a book is styled by: the theme orca bundles, the
 * layer a design generates, and the author's own sheet. They cross in
 * that order, and source order decides which one wins. A later layer
 * beats an earlier one without a specificity trick.
 */

import type { Sheet } from "fleuron";
import type { Design } from "@/style/design";
import { generatedCss, type Setting } from "@/style/generated";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";

/** The sheet the generated layer is sent under, which a warning names. */
export const DESIGN_SHEET = "design.css";

/** The sheet the author's own CSS is sent under, which a warning names. */
export const OWN_SHEET = "your.css";

/**
 * The generated layer as one sheet. The page names come from the
 * reading order, so a design that settles nothing still generates
 * them.
 */
export function designSheet(design: Design, setting: Setting): Sheet {
  return { name: DESIGN_SHEET, css: generatedCss(design, setting) };
}

/**
 * The sheets a book is styled by, in cascade order. The author's own
 * CSS is last, and is empty until the note's css fence is read.
 */
export function designSheets(
  design: Design,
  setting: Setting,
  own = "",
): Sheet[] {
  return [
    { name: THEME_SHEET, css: BUNDLED_THEME },
    designSheet(design, setting),
    { name: OWN_SHEET, css: own },
  ];
}
