/**
 * The three layers a book is styled by: the theme orca bundles, the
 * layer a design generates, and the author's own sheet. They cross in
 * that order, and source order decides which one wins. A later layer
 * beats an earlier one without a specificity trick.
 */

import type { Sheet } from "fleuron";
import { mergeDesign, type Design } from "@/style/design";
import {
  generatedCss,
  generatedRules,
  type RuleFrom,
  type Setting,
} from "@/style/generated";
import { BUNDLED_THEME, DEFAULTS, THEME_SHEET } from "@/style/theme";

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
export function designSheet(design: Design, setting: Setting): Sheet {
  return {
    name: DESIGN_SHEET,
    css: generatedCss(mergeDesign(DEFAULTS, design), setting),
  };
}

/**
 * The origin of the rule in `designSheet` that spans a line, counting
 * from 1. It merges the defaults the same way, so a line the engine
 * reports against the design sheet maps back to what wrote it.
 */
export function designRuleAt(
  design: Design,
  setting: Setting,
  line: number,
): RuleFrom | undefined {
  return generatedRules(mergeDesign(DEFAULTS, design), setting).find(
    (rule) => line >= rule.line && line < rule.line + rule.lines,
  )?.from;
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
