/**
 * The class and id each section crosses with. A sheet or the inspector
 * finds a section as `section.chapter` or `section#the-harbor`.
 *
 * The class is the role of the section. The id is a slug of the entry
 * name, and it is unique in the book. Ids go out by name and then by
 * path, never by the place of a section. A reorder changes no id, so a
 * selector that names an id still matches.
 */

import type { Attributes } from "fleuron";
import { entryName, type Section } from "@/book/order";
import type { Role } from "@/book/roles";

/**
 * Makes an id from a name. The id is lowercase with no accents, and each
 * run of other characters becomes one hyphen. If no letter or digit is
 * left, or the id starts with a digit, `fallback` goes in front. CSS
 * cannot read `#1984` as a selector.
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
 * The classes and id of each section that crosses, in reading order. A
 * section with no note is not sent and takes no name.
 */
export function sectionNames(sections: readonly Section[]): Attributes[] {
  return sectionIds(sections).map(({ role, id }) => ({ classes: [role], id }));
}

/**
 * The role and id of each section that crosses, in reading order. Every
 * sheet that names a section by its id gets the id from here.
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

  // If sections want the same slug, the first by path gets it with no
  // suffix. Sections that also tie on path are the same note twice, so
  // either one can take either id.
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

export interface Named {
  role: Role;
  id: string;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
