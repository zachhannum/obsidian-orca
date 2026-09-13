/**
 * The layers a book is styled by: the theme orca bundles, the faces a
 * book registers, the layer a design generates, and the author's own
 * sheet. They cross in that order, and source order decides which one
 * wins. A later layer beats an earlier one without a specificity trick.
 */

import type { Sheet } from "fleuron";
import { mergeDesign, type Design } from "@/style/design";
import { faceCss, type Registered } from "@/style/faces";
import { generatedCss, type Setting } from "@/style/generated";
import { BUNDLED_THEME, DEFAULTS, THEME_SHEET } from "@/style/theme";

/** The sheet the registered faces are sent under, which a warning names. */
export const FACES_SHEET = "faces.css";

/** The sheet the generated layer is sent under, which a warning names. */
export const DESIGN_SHEET = "design.css";

/** The sheet the author's own CSS is sent under, which a warning names. */
export const OWN_SHEET = "book.css";

/**
 * The generated layer as one sheet, with the defaults under the design.
 * It merges the two before it generates the CSS, because a generated
 * rule reads other fields. A sink, for example, is counted in lines of
 * the line spacing.
 */
export function designSheet(
  design: Design,
  setting: Setting,
  registered: readonly Registered[] = [],
): Sheet {
  return {
    name: DESIGN_SHEET,
    css: generatedCss(mergeDesign(DEFAULTS, design), setting, registered),
  };
}

/**
 * The sheets a book is styled by, in cascade order. The author's own
 * CSS is last, and is empty until the note's css fence is read.
 */
export function designSheets(
  design: Design,
  setting: Setting,
  own = "",
  registered: readonly Registered[] = [],
): Sheet[] {
  return [
    { name: THEME_SHEET, css: BUNDLED_THEME },
    { name: FACES_SHEET, css: faceCss(registered) },
    designSheet(design, setting, registered),
    { name: OWN_SHEET, css: own },
  ];
}
