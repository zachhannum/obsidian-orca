/**
 * What the navigator draws: a book's reading order, group by group.
 *
 * Every row names its entry by the place it has in the reading order,
 * which is what an edit to the book is given.
 */

import { chapterFolder } from "@/book/folder";
import type { Links } from "@/book/links";
import type { Model } from "@/book/model";
import { entryName, groups, resolve, type Section } from "@/book/order";
import { DEFAULT_ROLE, type Role } from "@/book/roles";

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
  /** What the book is called: its title, or the note's name. */
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
}

/** One book on the shelf, resolved against the vault. */
export function shelve(book: Opened, vault: Shelving): Shelved {
  const { sections } = resolve(book.model.order, vault.links, book.path);
  return {
    path: book.path,
    name: book.model.book.metadata.title ?? book.name,
    groups: groups(book.model.order).map((group) => ({
      heading: group.heading,
      rows: group.entries.flatMap((at) => {
        const section = sections[at];
        return section === undefined ? [] : [row(section, at)];
      }),
    })),
    folder: chapterFolder(sections, book.path),
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
    named: entry.role !== DEFAULT_ROLE,
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
