/**
 * A new book: the note a folder of chapters becomes, and the empty one
 * the palette makes.
 */

import type { Model } from "@/book/model";
import { FORMAT, type BookMetadata } from "@/book/note";
import { readOrder } from "@/book/order";

/** The groups a new book is written with, in reading order. */
export const MATTER: readonly string[] = [
  "Front matter",
  "Body",
  "Back matter",
];

/** The group an import lands in. */
const IMPORTED = "Body";

/**
 * Orders an import's notes by name. This is the only place alphabetical
 * order decides what the author sees; elsewhere it only breaks ties.
 */
export function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * A new book, with these notes as its body in the order they are
 * given. The groups are written empty, so the author can drag into
 * each of them.
 */
export function newBook(
  metadata: BookMetadata,
  links: Iterable<string>,
): Model {
  const lines = ["", ""];
  for (const heading of MATTER) {
    lines.push(`# ${heading}`);
    const under = heading === IMPORTED ? [...links] : [];
    if (under.length > 0)
      lines.push("", ...under.map((link) => `- [[${link}]]`));
    lines.push("");
  }
  return {
    book: { format: FORMAT, metadata, own: {} },
    order: readOrder(lines.join("\n")),
  };
}
