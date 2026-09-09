/**
 * The source the engine calls a section by, and the section a source
 * was sent from.
 *
 * A section's folios are the engine's to answer, and are asked for when
 * they are wanted, so nothing here holds one.
 */

import type { Folios, NodeSource, Page } from "fleuron";
import { entryName, type Section } from "@/book/order";
import { GENERATED_ORIGIN } from "@/book/plan";

/** The first and last folio a section's content lands on. */
export interface Range {
  first: number;
  last: number;
}

/**
 * The name a section crossed under: a note's vault path, or the
 * generated name, which counts the sections `sendBook` sends. Nothing
 * for a section `resolve` dropped.
 */
export function sourceNamed(
  sections: Section[],
  at: number,
): string | undefined {
  const section = sections[at];
  if (section === undefined || section.kind === "missing") return undefined;
  if (section.kind === "note") return section.path;
  const sent = sections
    .slice(0, at)
    .filter((before) => before.kind !== "missing").length;
  return `${GENERATED_ORIGIN}:${String(sent)}`;
}

/**
 * The place in the reading order a source the engine named was sent
 * from. A note two entries read is found at the first of them, which is
 * where a toggle from it opens.
 */
export function placeOf(
  sections: Section[],
  source: string,
): number | undefined {
  for (let at = 0; at < sections.length; at += 1) {
    if (sourceNamed(sections, at) === source) return at;
  }
  return undefined;
}

/** The engine, as much of it as placing a run of pages takes. */
export interface Placing {
  sourceOf(node: number): Promise<NodeSource | null>;
  foliosOf(nodes: number[]): Promise<(Folios | null)[]>;
}

/**
 * Every section's folio range, by its place in the reading order. The
 * engine answers which entry a run belongs to and where the entry
 * landed; neither is worked out by pairing ids with entries by ordinal.
 */
export async function sectionRanges(
  sections: Section[],
  pages: Page[],
  engine: Placing,
): Promise<Map<number, Range>> {
  const ids = [...new Set(pages.flatMap((page) => page.sections))];
  const [sources, folios] = await Promise.all([
    Promise.all(ids.map((id) => engine.sourceOf(id))),
    engine.foliosOf(ids),
  ]);
  const ranges = new Map<number, Range>();
  ids.forEach((_id, index) => {
    const source = sources[index];
    const set = folios[index];
    if (source == null || set == null) return;
    const at = placeOf(sections, source.source);
    if (at !== undefined) ranges.set(at, { first: set.first, last: set.last });
  });
  return ranges;
}

/** The section ids the pages of a span name, smallest first. */
export function sectionsOn(pages: Page[]): number[] {
  return [...new Set(pages.flatMap((page) => page.sections))].sort(
    (a, b) => a - b,
  );
}

/**
 * The section a run of pages reads as: the last of the ones they name
 * to open. A chapter that ends mid-page is followed there by the next
 * one, and the page belongs to the chapter the reader is now in.
 *
 * A chapter the reader turned to wins wherever on the span it opens, so
 * a screenful holding several is still named for the one they asked
 * for. Nothing for pages that name no section, such as a blank verso,
 * which read as whatever opened before them.
 */
export function sectionOn(
  pages: Page[],
  places: Map<number, number>,
  turned?: number,
): number | undefined {
  const found = pages.flatMap((page) =>
    page.sections.flatMap((id) => {
      const at = places.get(id);
      return at === undefined ? [] : [at];
    }),
  );
  if (turned !== undefined && found.includes(turned)) return turned;
  return found.length === 0 ? undefined : Math.max(...found);
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

/** A chapter a reader can turn to: what it is called, and where it sits. */
export interface Chapter {
  /** Its place in the reading order. */
  at: number;
  name: string;
}

/**
 * Every section a reader can turn to, in reading order. A section
 * `resolve` dropped is left out, so what a reader is offered is what
 * the book set.
 */
export function chapters(sections: Section[]): Chapter[] {
  return sections.flatMap((section, at) =>
    section.kind === "missing" ? [] : [{ at, name: entryName(section.entry) }],
  );
}

/**
 * The chapter `step` places along from the one at `at`, or nothing at
 * either end of the book, which is where the turn commands go quiet.
 */
export function stepChapter(
  chapters: Chapter[],
  at: number | undefined,
  step: number,
): Chapter | undefined {
  const here = chapters.findIndex((chapter) => chapter.at === at);
  if (here < 0) return undefined;
  return chapters[here + step];
}
