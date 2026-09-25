/**
 * The headings inside an entry's note, as the navigator lists them
 * under the entry.
 *
 * A heading is text in a chapter's note, and the navigator writes only
 * the book note, so a heading row is a way through the book and never
 * a place its order is set. The headings are Obsidian's own cache of
 * the note, read rather than parsed again.
 */

import type { App } from "obsidian";
import { headingWords } from "@/book/marks";
import type { Row, Shelved } from "@/ui/shelf";

/** A heading as Obsidian's metadata cache holds it. */
export interface Cached {
  heading: string;
  level: number;
  position: { start: { line: number } };
}

/** One heading inside an entry's note. */
export interface Headed {
  /** The line of the note on disk it opens on, counted from 0. */
  line: number;
  words: string;
  /** Its depth under the entry. The shallowest heading in the note is 0. */
  depth: number;
}

/** The page a preview shows, as the navigator marks it. */
export interface Showing {
  book: string;
  /** The entry's place in the reading order. */
  at: number;
  /** The line of the heading the page falls under, when one does. */
  line?: number | undefined;
}

/**
 * The headings Obsidian's cache holds for the note at `path`, down to
 * the level `deepest`.
 */
export function headingsOf(
  app: App,
  path: string,
  deepest: number,
): readonly Cached[] | undefined {
  return levelsTo(app.metadataCache.getCache(path)?.headings, deepest);
}

/** The headings of `cached` at the level `deepest` or above. */
export function levelsTo(
  cached: readonly Cached[] | undefined,
  deepest: number,
): readonly Cached[] | undefined {
  return cached?.filter((heading) => heading.level <= deepest);
}

/**
 * An entry's headings, under the entry named `name`. A note that
 * opens on a heading with the entry's own name leaves it out, because
 * the entry's row already says it.
 */
export function outline(cached: readonly Cached[] | undefined, name: string): Headed[] {
  const read = (cached ?? []).map((heading) => ({
    line: heading.position.start.line,
    level: heading.level,
    words: headingWords(heading.heading.replace(/\s+/g, " ")),
  }));
  const kept = read[0]?.words === name ? read.slice(1) : read;
  const top = Math.min(...kept.map((heading) => heading.level));
  return kept.map(({ line, level, words }) => ({ line, words, depth: level - top }));
}

/**
 * The line of the heading a span of pages falls under: the last one
 * that opens on or before the span's first page. A heading `asked` for
 * wins while it opens inside the span, so a click on the second of two
 * headings on a page marks the one clicked. Otherwise a span the entry
 * `opens` in is the entry's. Nothing answered means the entry is the
 * row marked.
 */
export function headingOn(
  pages: readonly (number | undefined)[],
  lines: readonly number[],
  span: { first: number; last: number },
  asked?: number,
  opens?: number,
): number | undefined {
  const inside = (page: number | undefined): boolean =>
    page !== undefined && page >= span.first && page <= span.last;
  if (asked !== undefined && inside(pages[lines.indexOf(asked)])) return asked;
  if (inside(opens)) return undefined;
  let under: number | undefined;
  lines.forEach((line, index) => {
    const page = pages[index];
    if (page !== undefined && page <= span.first) under = line;
  });
  return under;
}

/** Whether the heading at `index` has deeper headings under it, which it folds. */
export function folds(headings: readonly Headed[], index: number): boolean {
  const heading = headings[index];
  const after = headings[index + 1];
  return heading !== undefined && after !== undefined && after.depth > heading.depth;
}

/** The line of the heading that the heading at `index` sits under, if one does. */
export function parentOf(headings: readonly Headed[], index: number): number | undefined {
  const depth = headings[index]?.depth;
  if (depth === undefined) return undefined;
  for (let at = index - 1; at >= 0; at--) {
    const heading = headings[at];
    if (heading !== undefined && heading.depth < depth) return heading.line;
  }
  return undefined;
}

/**
 * The headings drawn while the ones on the lines in `shut` are folded.
 * A folded heading keeps its row, and every heading under it has none.
 */
export function unfolded(headings: readonly Headed[], shut: ReadonlySet<number>): Headed[] {
  const drawn: Headed[] = [];
  let under: number | undefined;
  for (const heading of headings) {
    if (under !== undefined && heading.depth > under) continue;
    under = shut.has(heading.line) ? heading.depth : undefined;
    drawn.push(heading);
  }
  return drawn;
}

/**
 * The row a preview's page marks, for the entry `row` of `book`: the
 * entry itself, the line of one of its headings, or nothing. A folded
 * entry marks the entry. A heading folded away marks the folded
 * heading it sits under.
 */
export function markOf(
  showing: Showing | undefined,
  book: string,
  row: Row,
  folded: boolean,
  shut: ReadonlySet<number> = new Set(),
): "entry" | number | undefined {
  if (showing === undefined || showing.book !== book || showing.at !== row.at) {
    return undefined;
  }
  const { line } = showing;
  if (line === undefined || folded) return "entry";
  const headings = row.headings ?? [];
  const drawn = new Set(unfolded(headings, shut).map((heading) => heading.line));
  let index = headings.findIndex((heading) => heading.line === line);
  if (index === -1) return "entry";
  for (let at: number | undefined = line; at !== undefined; ) {
    if (drawn.has(at)) return at;
    at = parentOf(headings, index);
    index = headings.findIndex((heading) => heading.line === at);
  }
  return "entry";
}

/**
 * The fold key of an entry's note in a book. A path holds no newline,
 * so no two keys meet.
 */
export function entryKey(book: string, path: string): string {
  return `${book}\n${path}`;
}

/** The fold key of the heading on `line` of a note in a book. */
export function headingKey(book: string, path: string, line: number): string {
  return `${entryKey(book, path)}\n${String(line)}`;
}

/** The lines of the headings folded inside the entry `row` of `book`. */
export function shutIn(shut: ReadonlySet<string>, book: string, row: Row): ReadonlySet<number> {
  const { path } = row;
  if (path === undefined) return new Set();
  return new Set(
    (row.headings ?? [])
      .map((heading) => heading.line)
      .filter((line) => shut.has(headingKey(book, path, line))),
  );
}

/** The keys of every entry on the shelf that lists headings, which `Collapse all` folds. */
export function foldable(shelf: readonly Shelved[]): string[] {
  return shelf.flatMap((book) =>
    book.groups.flatMap((group) =>
      group.rows.flatMap((row) =>
        row.path !== undefined && (row.headings ?? []).length > 0
          ? [entryKey(book.path, row.path)]
          : [],
      ),
    ),
  );
}

/** The folds a saved navigator state holds. A state without them folds nothing. */
export function readFolds(state: unknown): string[] {
  if (typeof state !== "object" || state === null || !("folds" in state)) return [];
  const { folds } = state;
  if (!Array.isArray(folds)) return [];
  return folds.filter((fold): fold is string => typeof fold === "string");
}

/**
 * The row a key moves the focus to, of `count` rows in order, from the
 * row at `from`. A key that walks nowhere answers nothing, and the
 * walk stops at either end rather than wrapping.
 */
export function walk(count: number, from: number, key: string): number | undefined {
  if (count === 0) return undefined;
  switch (key) {
    case "ArrowDown":
      return Math.min(from + 1, count - 1);
    case "ArrowUp":
      return Math.max(from - 1, 0);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}
