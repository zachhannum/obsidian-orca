import type { Warning } from "fleuron";
import { isGenerated } from "@/book/plan";
import { readOrigin } from "@/style/origin";
import { DESIGN_SHEET, OWN_SHEET } from "@/style/sheet";
import { THEME_SHEET } from "@/style/theme";
import type { Flag } from "@/ui/editor";

/**
 * The reader a warning goes to. The generated matter and the sheets orca writes
 * are orca's, and an author has no file to open for either, so a
 * warning against them is orca's defect and goes to the console. Any
 * other warning goes to the preview, and one against the author's CSS
 * also goes to the editor over it.
 */
export type Route = "orca" | "css" | "note";

export function routeOf(warning: Warning): Route {
  const origin = warning.origin;
  if (origin === null) return "note";
  if (isGenerated(origin)) return "orca";
  const sheet = readOrigin(origin)?.sheet;
  if (sheet === THEME_SHEET || sheet === DESIGN_SHEET) return "orca";
  if (sheet === OWN_SHEET) return "css";
  return "note";
}

/** The warnings against the author's CSS, each at the line and column it named. */
export function cssFlags(warnings: readonly Warning[]): Flag[] {
  return warnings.flatMap((warning) => {
    if (routeOf(warning) !== "css" || warning.origin === null) return [];
    const place = readOrigin(warning.origin);
    return place === undefined ? [] : [{ ...place, message: warning.message }];
  });
}
