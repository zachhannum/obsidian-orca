/**
 * The shelf as the navigator draws it: a book's reading order, group
 * by group.
 *
 * Every row names its entry by the place it has in the reading order,
 * which is what an edit to the book is given.
 */

import { chapterFolder } from "@/book/folder";
import type { Links } from "@/book/links";
import type { Model } from "@/book/model";
import { entryName, groups, resolve, type Section } from "@/book/order";
import { DEFAULT_ROLE, type Role } from "@/book/roles";
import { outline, type Cached, type Headed } from "@/ui/outline";

/** One entry, as a row under its heading. */
export interface Row {
  /** Its place in the reading order, which every edit names it by. */
  at: number;
  name: string;
  /** Whether the row has a note, generates its own text, or has lost one. */
  kind: Section["kind"];
  /** The note it reads, for a row that has one. */
  path?: string;
  role: Role;
  /** Whether the role is drawn as a chip, which the default role is not. */
  named: boolean;
  /** The headings inside its note, when the navigator lists them. */
  headings?: Headed[];
}

/** One heading and the rows under it. */
export interface Grouped {
  /** As the note writes it. The group above the first heading has none. */
  heading: string;
  rows: Row[];
}

/** One book, as the navigator lists it. */
export interface Shelved {
  path: string;
  /** The book's title, or the note's name when it has none. */
  name: string;
  groups: Grouped[];
  /** The folder a new chapter is made in. */
  folder: string;
  /** Whether the note the workspace is on is one of this book's. */
  holds: boolean;
}

/** A book note, read. */
export interface Opened {
  path: string;
  /** The note's own name, which titles the book when it has no title. */
  name: string;
  model: Model;
}

/** The vault, as much of it as the navigator reads. */
export interface Shelving {
  links: Links;
  /** The note the workspace is on, if it is on one. */
  active?: string | undefined;
  /** The headings a note holds. With none, the rows list no headings. */
  headings?: ((path: string) => readonly Cached[] | undefined) | undefined;
}

/** The book's title, or the note's name when it has none. */
export function bookName(book: Opened): string {
  return book.model.book.metadata.title ?? book.name;
}

/** One book on the shelf, resolved against the vault. */
export function shelve(book: Opened, vault: Shelving): Shelved {
  const { sections } = resolve(book.model.order, vault.links, book.path);
  return {
    path: book.path,
    name: bookName(book),
    groups: groups(book.model.order).map((group) => ({
      heading: group.heading,
      rows: group.entries.flatMap((at) => {
        const section = sections[at];
        return section === undefined ? [] : [row(section, at, vault.headings)];
      }),
    })),
    folder: chapterFolder(sections, book.path),
    holds: holds(book.path, sections, vault.active),
  };
}

/** One entry as a row, by its place in the reading order. */
export function row(
  section: Section,
  at: number,
  headings?: Shelving["headings"],
): Row {
  const { entry } = section;
  const made: Row = {
    at,
    name: entryName(entry),
    kind: section.kind,
    role: entry.role,
    named: entry.role !== DEFAULT_ROLE,
  };
  if (section.kind === "note") {
    made.path = section.path;
    if (headings !== undefined) {
      made.headings = outline(headings(section.path), made.name);
    }
  }
  return made;
}

/** The note paths a shelf's rows read. */
export function members(shelved: readonly Shelved[]): Set<string> {
  return new Set(
    shelved.flatMap((book) =>
      book.groups.flatMap((group) => group.rows.flatMap((row) => row.path ?? [])),
    ),
  );
}

/** The orders a shelf sorts its books in. Vault order is the order the vault lists them. */
export const SORT_ORDERS = ["vault", "name", "name-reverse"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const SORT_LABELS: Record<SortOrder, string> = {
  vault: "Vault order",
  name: "Name (A to Z)",
  "name-reverse": "Name (Z to A)",
};

/** A saved sort order, or the default when the value is not one. */
export function readSort(saved: unknown): SortOrder {
  return SORT_ORDERS.find((order) => order === saved) ?? "vault";
}

/** The books in the given order. Chapters keep the book's reading order. */
export function sortShelf(
  shelf: readonly Shelved[],
  order: SortOrder,
): Shelved[] {
  if (order === "vault") return [...shelf];
  const sign = order === "name" ? 1 : -1;
  return [...shelf].sort(
    (a, b) => sign * a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

/**
 * The places of the rows a query shows in a book, or nothing when it
 * shows every row. A book whose own name matches shows all its rows.
 * The places are those of the whole book, which a filtered list must
 * keep, since an edit and a preview name an entry by its place.
 */
export function visibleRows(
  book: Shelved,
  query: string,
): ReadonlySet<number> | undefined {
  const needle = query.trim().toLowerCase();
  if (needle === "" || book.name.toLowerCase().includes(needle)) return undefined;
  return new Set(
    book.groups.flatMap((group) =>
      group.rows.flatMap((row) =>
        row.name.toLowerCase().includes(needle) ? [row.at] : [],
      ),
    ),
  );
}

/** The books the query shows something of, each still whole. */
export function filterShelf(
  shelf: readonly Shelved[],
  query: string,
): Shelved[] {
  return shelf.filter((book) => {
    const shown = visibleRows(book, query);
    return shown === undefined || shown.size > 0;
  });
}

/**
 * A book holds the active note when the note is one of its sections or
 * the book note itself. A note in two books belongs to both.
 */
function holds(
  path: string,
  sections: Section[],
  active: string | undefined,
): boolean {
  if (active === undefined) return false;
  if (active === path) return true;
  return sections.some(
    (section) => section.kind === "note" && section.path === active,
  );
}
