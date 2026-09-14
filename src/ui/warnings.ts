import type { Warning } from "fleuron";
import { isGenerated } from "@/book/plan";
import { readOrigin, type Place } from "@/style/origin";
import { DESIGN_SHEET, FACES_SHEET, OWN_SHEET } from "@/style/sheet";
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
  if (sheet === THEME_SHEET || sheet === FACES_SHEET || sheet === DESIGN_SHEET) {
    return "orca";
  }
  if (sheet === OWN_SHEET) return "css";
  return "note";
}

/** A warning an author can act on, at the place it named if it named one. */
export interface Issue {
  message: string;
  place: Place | undefined;
}

/**
 * The warnings in one note, or in the author's CSS. `source` is null
 * for the warnings that name no place.
 */
export interface IssueGroup {
  route: Exclude<Route, "orca">;
  source: string | null;
  issues: Issue[];
}

/**
 * The author's warnings, one group per note or sheet. The groups come
 * in the order the run first named each one, and a group keeps the
 * order of its warnings.
 */
export function issueGroups(warnings: readonly Warning[]): IssueGroup[] {
  const groups = new Map<string | null, IssueGroup>();
  for (const warning of warnings) {
    const route = routeOf(warning);
    if (route === "orca") continue;
    const place = warning.origin === null ? undefined : readOrigin(warning.origin);
    const source = place?.sheet ?? warning.origin;
    let group = groups.get(source);
    if (group === undefined) {
      group = { route, source, issues: [] };
      groups.set(source, group);
    }
    group.issues.push({ message: warning.message, place });
  }
  return [...groups.values()];
}

/** The name a group is listed under: a note by its title. */
export function groupTitle(group: IssueGroup): string {
  if (group.route === "css") return "The book's CSS";
  if (group.source === null) return "No place named";
  const name = group.source.slice(group.source.lastIndexOf("/") + 1);
  return name.endsWith(".md") ? name.slice(0, -".md".length) : name;
}

/** The warnings against the author's CSS, each at the line and column it named. */
export function cssFlags(warnings: readonly Warning[]): Flag[] {
  return warnings.flatMap((warning) => {
    if (routeOf(warning) !== "css" || warning.origin === null) return [];
    const place = readOrigin(warning.origin);
    return place === undefined ? [] : [{ ...place, message: warning.message }];
  });
}
