/**
 * What the navigator draws: a book's reading order group by group, and
 * the notes in its folder the book does not read.
 *
 * Every row names its entry by the place it has in the reading order,
 * which is what an edit to the book is given.
 */

import { chapterFolder, loose } from "@/book/folder";
import type { Links } from "@/book/links";
import type { Model } from "@/book/model";
import {
  defaultHeading,
  entryName,
  groups,
  resolve,
  type Section,
} from "@/book/order";
import type { Role } from "@/book/roles";

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
  /** Whether the entry names its own role rather than taking its heading's. */
  tagged: boolean;
}

/** One heading and the rows under it. */
export interface Grouped {
  heading: string;
  role: Role;
  rows: Row[];
}

/** One book, as the navigator lists it. */
export interface Shelved {
  path: string;
  /** What the book is called: its title, or the note's name. */
  name: string;
  groups: Grouped[];
  /** The heading a new chapter is appended under. */
  body: string;
  /** The notes in the book's folder the reading order does not have. */
  loose: string[];
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
  /** Every markdown note in the vault. */
  paths: readonly string[];
  links: Links;
  /** The note the workspace is on, if it is on one. */
  active?: string | undefined;
}

/** One book on the shelf, resolved against the vault. */
export function shelve(book: Opened, vault: Shelving): Shelved {
  const { sections } = resolve(book.model.order, vault.links, book.path);
  const folder = chapterFolder(sections, book.path);
  return {
    path: book.path,
    name: book.model.book.metadata.title ?? book.name,
    groups: groups(book.model.order).map((group) => ({
      heading: group.heading,
      role: group.role,
      rows: group.entries.flatMap((at) => {
        const section = sections[at];
        return section === undefined ? [] : [row(section, at)];
      }),
    })),
    body: defaultHeading(book.model.order),
    loose: loose(folder, vault.paths, sections, book.path),
    folder,
    holds: holds(book.path, sections, vault.active),
  };
}

function row(section: Section, at: number): Row {
  const { entry } = section;
  const made: Row = {
    at,
    name: entryName(entry),
    kind: section.kind,
    role: entry.role,
    tagged: entry.tag !== undefined,
  };
  if (section.kind === "note") made.path = section.path;
  return made;
}

/**
 * A book holds the active note when the note is one of its sections or
 * the book note itself. A note in two books is held by both.
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
