/**
 * A section's folio range, from the pages the engine laid the book
 * out to.
 *
 * fleuron assigns a section its content-tree id before any node
 * inside it, and ids run in document order, so the section ids a run
 * names are exactly as many, and in the same order, as the sections
 * `sendBook` sent: the Nth smallest id is the Nth section.
 */

import type { Page } from "fleuron";
import type { Section } from "@/book/order";

/** The first and last folio a section's content lands on. */
export interface Range {
  first: number;
  last: number;
}

/**
 * Every section's range, keyed by its place in the reading order. A
 * section `resolve` dropped, or one a run has not reached yet, has no
 * entry.
 */
export function pageRanges(sections: Section[], pages: Page[]): Map<number, Range> {
  const present = sections
    .map((section, at) => ({ section, at }))
    .filter(({ section }) => section.kind !== "missing")
    .map(({ at }) => at);

  const ids = [...new Set(pages.flatMap((page) => page.sections))].sort(
    (a, b) => a - b,
  );
  const at = new Map<number, number>();
  ids.forEach((id, index) => {
    const raw = present[index];
    if (raw !== undefined) at.set(id, raw);
  });

  const ranges = new Map<number, Range>();
  for (const page of pages) {
    for (const id of page.sections) {
      const raw = at.get(id);
      if (raw === undefined) continue;
      const found = ranges.get(raw);
      if (found === undefined) {
        ranges.set(raw, { first: page.number, last: page.number });
      } else {
        found.first = Math.min(found.first, page.number);
        found.last = Math.max(found.last, page.number);
      }
    }
  }
  return ranges;
}

/**
 * The place in the reading order of the section that reads this note,
 * or nothing when no section does. A note two entries read is found at
 * the first of them, which is where a toggle from it opens.
 */
export function sectionOf(
  sections: Section[],
  path: string,
): number | undefined {
  const at = sections.findIndex(
    (section) => section.kind === "note" && section.path === path,
  );
  return at < 0 ? undefined : at;
}

/**
 * The section a folio reads as: the last one to open on or before it.
 * A chapter that ends mid-page is followed there by the next one, and
 * the page belongs to the chapter the reader is now in.
 */
export function sectionAt(
  ranges: Map<number, Range>,
  folio: number,
): number | undefined {
  let found: number | undefined;
  let opened = 0;
  for (const [at, range] of ranges) {
    if (range.first > folio) continue;
    if (found !== undefined && range.first < opened) continue;
    found = at;
    opened = range.first;
  }
  return found;
}
