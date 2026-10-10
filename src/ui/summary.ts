/**
 * The read-only summary of the design on the book note's page. It has
 * one line for each group of the panel, under the group's name and in
 * the words the panel draws. The author edits the design in the panel
 * in the right sidebar.
 */

import {
  LEVELS,
  emptyDesign,
  writeDesign,
  type Design,
  type PageUnit,
  type Written,
} from "@/style/design";
import { effective } from "@/style/theme";
import { GROUPS, defaultSaid, inUnit, keysOf, trims, type Group } from "@/ui/groups";

/** One line of the summary. */
export interface Summed {
  /** The name of the panel group the line sums up. */
  label: string;
  value: string;
  /** True when the book sets a key of the group to something other than its default. */
  set: boolean;
}

/** A design with every default filled in, and the words the panel has for a key's value. */
interface Reading {
  full: Readonly<Record<string, Written>>;
  /** The keys the book sets to something other than the default. */
  changed: ReadonlySet<string>;
  unit: PageUnit;
  said(key: string): string;
  lower(key: string): string;
}

/**
 * The sentence for each group of the panel, by the group's name. A
 * group with no entry here has an empty line, which a test refuses.
 */
const LINES: Readonly<Record<string, (reading: Reading) => string>> = {
  Page: ({ full, unit, said }) =>
    `${trimSaid(full["trim"], unit)}. Margins ${said("margin-inside")} inside, ${said("margin-outside")} outside, ${said("margin-top")} top, ${said("margin-bottom")} bottom.`,
  Text: ({ full, said, lower }) =>
    [
      said("body-font"),
      `${said("body-size")} on ${said("body-line-spacing")}`,
      lower("body-align"),
      `${said("body-first-line-indent")} indent`,
      full["body-hyphens"] === true ? "hyphenated" : "not hyphenated",
    ].join(", "),
  Headings: (reading) =>
    LEVELS.filter(
      (level) =>
        level === 1 ||
        [...reading.changed].some((key) => key.startsWith(`heading-${String(level)}-`)),
    )
      .map((level) => headingSaid(`heading-${String(level)}-`, reading))
      .join(". "),
  "Chapter openings": ({ full, said, lower }) => {
    const cap = Number(full["chapter-drop-cap"] ?? 0);
    const caps = full["chapter-first-line-caps"];
    return [
      said("chapter-begins"),
      cap < 2 ? "no drop cap" : `drop cap of ${lower("chapter-drop-cap")}`,
      ...(caps === undefined || caps === "normal"
        ? []
        : [`first line in ${lower("chapter-first-line-caps")}`]),
    ].join(", ");
  },
  "Scene breaks": ({ full }) =>
    full["scene-break-mark"] === "space"
      ? "A blank line"
      : String(full["scene-break-ornament"] ?? "An ornament"),
  "Headers & page numbers": ({ full, said, lower }) => {
    const none =
      full["header-left-page"] === "none" && full["header-right-page"] === "none";
    const heads = none
      ? "No headers"
      : `${said("header-left-page")} on left pages, ${lower("header-right-page")} on right pages`;
    return `${heads}. Page numbers at the ${lower("page-number-position")} (${said("page-number-format")}).`;
  },
  "Page breaks": ({ full, said }) =>
    [
      `Orphans ${said("body-orphans")} lines`,
      `widows ${said("body-widows")} lines`,
      full["keep-heading-with-text"] === true
        ? "a heading stays with what follows it"
        : "a heading can end a page",
    ].join(", "),
};

/** Sums up the design a book is set in, one line for each group of the panel, with every default filled in. */
export function summary(design: Design, unit: PageUnit): Summed[] {
  const full = writeDesign(effective(design));
  const defaults = writeDesign(effective(emptyDesign()));
  const changed = new Set(
    Object.entries(writeDesign(design))
      .filter(([key, value]) => value !== defaults[key])
      .map(([key]) => key),
  );
  const controls = GROUPS.flatMap((group) => group.rows).flatMap((row) => row.of);
  const said = (key: string): string => {
    const listed = key.replace(/^heading-\d-/, "heading-N-");
    const control = controls.find((each) => each.key === listed);
    return control === undefined
      ? String(full[key] ?? "")
      : defaultSaid(control, full[key], unit);
  };
  const reading: Reading = {
    full,
    changed,
    unit,
    said,
    lower: (key) => said(key).toLowerCase(),
  };
  return GROUPS.map((group: Group) => ({
    label: group.name,
    value: LINES[group.name]?.(reading) ?? "",
    set: keysOf(group).some((key) => changed.has(key)),
  }));
}

/** One heading level, as `H1 EB Garamond 19pt, left`, with its style and capitals when it has them. */
function headingSaid(prefix: string, { full, said, lower }: Reading): string {
  const plain = (key: string): string[] => {
    const value = full[`${prefix}${key}`];
    return value === undefined || value === "normal" ? [] : [lower(`${prefix}${key}`)];
  };
  return [
    `H${prefix.replace(/\D/g, "")} ${said(`${prefix}font`)} ${said(`${prefix}size`)}`,
    ...plain("style"),
    ...plain("caps"),
    lower(`${prefix}align`),
  ].join(", ");
}

/** A trim by the name the panel offers it under, or by its sides. */
function trimSaid(trim: Written | undefined, unit: PageUnit): string {
  if (trim === undefined) return "none";
  const named = trims(unit).find((choice) => choice.value === String(trim));
  if (named !== undefined) return named.label;
  return String(trim)
    .split(/\s+/)
    .map((side) => inUnit(side, unit))
    .join(" × ");
}
