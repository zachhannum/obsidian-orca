/**
 * Which notes in the vault are books.
 *
 * Obsidian parses every note's frontmatter into the metadata cache as
 * the vault loads, so the question is a lookup per note. A vault-wide
 * scan reads that cache and opens no file.
 */

import type { Properties } from "@/book/frontmatter";
import { bookFormat } from "@/book/note";

/** A note in the vault, by the path the cache holds it under. */
export interface Note {
  path: string;
}

/** The half of Obsidian a scan reads. */
export interface NoteIndex<T extends Note = Note> {
  /** Every markdown note in the vault. */
  notes(): T[];
  /** A note's properties, from the metadata cache, or nothing for a note that has none. */
  properties(note: T): Properties | undefined;
}

/** Whether a note carries the key that makes it a book. */
export function isBook<T extends Note>(index: NoteIndex<T>, note: T): boolean {
  const properties = index.properties(note);
  return properties !== undefined && bookFormat(properties) !== undefined;
}

/** Every book in the vault, in the order the vault lists its notes. */
export function books<T extends Note>(index: NoteIndex<T>): T[] {
  return index.notes().filter((note) => isBook(index, note));
}
