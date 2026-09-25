/**
 * The books, entries and headings folded in the navigator, as its view
 * state saves them.
 *
 * A heading is found by its words under the headings above it, never
 * by its line, so text written anywhere else in the note keeps its
 * fold. Only folded branches are kept: the note's outline is Obsidian's
 * cache, and a copy of it here would go stale.
 */

import type { Headed } from "@/ui/outline";
import type { Row, Shelved } from "@/ui/shelf";

/** The folds on the shelf, by book note path. */
export type Folds = Record<string, BookFolds>;

export interface BookFolds {
  collapsed?: true;
  /** The notes the book lists, by path. */
  notes?: Record<string, Fold>;
}

/** One note, or one heading inside it. */
export interface Fold {
  collapsed?: true;
  /**
   * The headings under this one, by their words. The nth sibling with
   * those words is the nth item, and `null` holds the place of one
   * that has nothing folded.
   */
  children?: Record<string, (Fold | null)[]>;
}

export function bookCollapsed(folds: Folds, book: string): boolean {
  return folds[book]?.collapsed === true;
}

export function entryCollapsed(folds: Folds, book: string, note: string): boolean {
  return folds[book]?.notes?.[note]?.collapsed === true;
}

/** The lines of the headings folded inside the entry `row` of `book`. */
export function collapsedLines(folds: Folds, book: string, row: Row): ReadonlySet<number> {
  const note = row.path === undefined ? undefined : folds[book]?.notes?.[row.path];
  const lines = new Set<number>();
  for (const heading of row.headings ?? []) {
    if (at(note, heading.trail)?.collapsed === true) lines.add(heading.line);
  }
  return lines;
}

export function withBook(folds: Folds, book: string, collapsed: boolean): Folds {
  const { collapsed: _, ...rest } = folds[book] ?? {};
  return withBookFolds(folds, book, collapsed ? { ...rest, collapsed: true } : rest);
}

/** Folds or opens an entry, or the heading `heading` inside it when one is named. */
export function withNote(
  folds: Folds,
  book: string,
  note: string,
  collapsed: boolean,
  heading?: Headed,
): Folds {
  const kept = folds[book] ?? {};
  const notes = { ...kept.notes };
  const fold = set(notes[note], heading?.trail ?? [], collapsed);
  if (fold === undefined) delete notes[note];
  else notes[note] = fold;
  const { notes: _, ...rest } = kept;
  return withBookFolds(folds, book, Object.keys(notes).length === 0 ? rest : { ...rest, notes });
}

/** Whether any entry on the shelf lists headings, which is when `Collapse all` shows. */
export function foldable(shelf: readonly Shelved[]): boolean {
  return shelf.some((book) => notesWithHeadings(book).length > 0);
}

/** Whether every entry that lists headings is folded, which turns the button to `Expand all`. */
export function allCollapsed(folds: Folds, shelf: readonly Shelved[]): boolean {
  return shelf.every((book) =>
    notesWithHeadings(book).every((note) => entryCollapsed(folds, book.path, note)),
  );
}

/** Folds every entry that lists headings, and keeps every other fold. */
export function collapseAll(folds: Folds, shelf: readonly Shelved[]): Folds {
  let next = folds;
  for (const book of shelf) {
    for (const note of notesWithHeadings(book)) next = withNote(next, book.path, note, true);
  }
  return next;
}

/** Opens every entry and every heading. A folded book stays folded. */
export function expandAll(folds: Folds): Folds {
  const next: Folds = {};
  for (const [book, kept] of Object.entries(folds)) {
    if (kept.collapsed === true) next[book] = { collapsed: true };
  }
  return next;
}

/** The folds a saved navigator state holds. A part that is not a fold is dropped. */
export function readFolds(state: unknown): Folds {
  const folds: Folds = {};
  const saved = isObject(state) ? state["folds"] : undefined;
  if (!isObject(saved)) return folds;
  for (const [book, kept] of Object.entries(saved)) {
    if (!isObject(kept)) continue;
    const read: BookFolds = {};
    if (kept["collapsed"] === true) read.collapsed = true;
    const notes = kept["notes"];
    if (isObject(notes)) {
      const readNotes: Record<string, Fold> = {};
      for (const [note, fold] of Object.entries(notes)) {
        const one = readFold(fold);
        if (one !== undefined) readNotes[note] = one;
      }
      if (Object.keys(readNotes).length > 0) read.notes = readNotes;
    }
    if (Object.keys(read).length > 0) folds[book] = read;
  }
  return folds;
}

function readFold(saved: unknown): Fold | undefined {
  if (!isObject(saved)) return undefined;
  const fold: Fold = {};
  if (saved["collapsed"] === true) fold.collapsed = true;
  const children = saved["children"];
  if (isObject(children)) {
    const read: Record<string, (Fold | null)[]> = {};
    for (const [words, list] of Object.entries(children)) {
      if (!Array.isArray(list)) continue;
      const items = list.map((item: unknown) => readFold(item) ?? null);
      while (items.length > 0 && items.at(-1) === null) items.pop();
      if (items.length > 0) read[words] = items;
    }
    if (Object.keys(read).length > 0) fold.children = read;
  }
  return Object.keys(fold).length === 0 ? undefined : fold;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function notesWithHeadings(book: Shelved): string[] {
  return book.groups.flatMap((group) =>
    group.rows.flatMap((row) =>
      row.path !== undefined && (row.headings ?? []).length > 0 ? [row.path] : [],
    ),
  );
}

function withBookFolds(folds: Folds, book: string, kept: BookFolds): Folds {
  const next = { ...folds };
  if (Object.keys(kept).length === 0) delete next[book];
  else next[book] = kept;
  return next;
}

/** The fold at the end of `trail`, if the tree holds one. */
function at(fold: Fold | undefined, trail: Headed["trail"]): Fold | undefined {
  let here = fold;
  for (const { words, nth } of trail) here = here?.children?.[words]?.[nth] ?? undefined;
  return here;
}

/**
 * The fold with the node at the end of `trail` folded or opened. A
 * branch left with nothing folded is taken off, and nothing at all
 * answers undefined.
 */
function set(fold: Fold | undefined, trail: Headed["trail"], collapsed: boolean): Fold | undefined {
  const node: Fold = { ...fold };
  const [step, ...rest] = trail;
  if (step === undefined) {
    if (collapsed) node.collapsed = true;
    else delete node.collapsed;
  } else {
    const children = { ...node.children };
    const list = [...(children[step.words] ?? [])];
    while (list.length <= step.nth) list.push(null);
    list[step.nth] = set(list[step.nth] ?? undefined, rest, collapsed) ?? null;
    while (list.length > 0 && list.at(-1) === null) list.pop();
    if (list.length === 0) delete children[step.words];
    else children[step.words] = list;
    if (Object.keys(children).length === 0) delete node.children;
    else node.children = children;
  }
  return node.collapsed === undefined && node.children === undefined ? undefined : node;
}
