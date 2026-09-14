/**
 * The class and id each section crosses with, so a sheet or the
 * inspector reaches it as `section.chapter` or `section#the-harbor`.
 *
 * The class is the section's role. The id is a slug of the entry's
 * name, made unique within the book. Ids are handed out by name and
 * then by path, never by where a section sits, so a reorder moves no
 * id and a selector written against one still holds.
 */

import type { Attributes } from "fleuron";
import { entryName, type Section } from "@/book/order";
import type { Role } from "@/book/roles";

/**
 * A name as an id: lowercase, accents dropped, every run of other
 * characters one hyphen. A slug with no letter or digit left, or one
 * that opens on a digit, takes `fallback` in front, because `#1984` is
 * not a selector CSS can read.
 */
export function slug(name: string, fallback: string): string {
  const made = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (made === "") return fallback;
  return /^\p{N}/u.test(made) ? `${fallback}-${made}` : made;
}

/**
 * The classes and id of each section that crosses, in the order the
 * engine counts them, the same order `sentRoles` gives. A section with
 * no note is not sent and takes no name.
 */
export function sectionNames(sections: readonly Section[]): Attributes[] {
  return sectionIds(sections).map(({ role, id }) => ({ classes: [role], id }));
}

/**
 * The id of each section that crosses, in the order `sectionNames`
 * gives. This is the one rule a sheet that names a section by its id
 * reads.
 */
export function sectionIds(sections: readonly Section[]): Named[] {
  const sent = sections.flatMap((section) =>
    section.kind === "missing" ? [] : [section],
  );
  const wanted = sent.map((section, at) => ({
    at,
    role: section.entry.role,
    base: slug(entryName(section.entry), section.entry.role),
    key: section.kind === "note" ? section.path : "",
  }));

  // Among sections that want the same slug, the one first by path takes
  // it bare. Sections that tie on both are the same note twice, and it
  // does not matter which of the two takes which id.
  const ranked = [...wanted].sort(
    (a, b) => compare(a.base, b.base) || compare(a.key, b.key),
  );
  const taken = new Set<string>();
  const ids = new Map<number, string>();
  for (const want of ranked) {
    if (taken.has(want.base)) continue;
    taken.add(want.base);
    ids.set(want.at, want.base);
  }
  for (const want of ranked) {
    if (ids.has(want.at)) continue;
    let count = 2;
    while (taken.has(`${want.base}-${count}`)) count += 1;
    const id = `${want.base}-${count}`;
    taken.add(id);
    ids.set(want.at, id);
  }
  return wanted.map((want) => ({ role: want.role, id: ids.get(want.at) ?? want.base }));
}

/** One sent section's role and the id it crosses with. */
export interface Named {
  role: Role;
  id: string;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
