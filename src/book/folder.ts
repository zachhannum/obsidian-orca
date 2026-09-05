/**
 * A book's own folder: where its chapters live, and which notes in it
 * the reading order does not have.
 *
 * The folder is derived from the book rather than declared, so moving
 * the chapters moves it and nothing in the note goes stale.
 */

import type { Section } from "@/book/order";

/** The folder a book's chapters are in, and its new ones are made in. */
export function chapterFolder(sections: Section[], note: string): string {
  const counted = new Map<string, number>();
  for (const section of sections) {
    if (section.kind !== "note" || section.entry.role !== "chapter") continue;
    const folder = folderOf(section.path);
    counted.set(folder, (counted.get(folder) ?? 0) + 1);
  }

  let home: string | undefined;
  let most = 0;
  for (const [folder, count] of counted) {
    if (count > most) {
      home = folder;
      most = count;
    }
  }
  return home ?? folderOf(note);
}

/**
 * The notes directly in a folder that the book does not read, in the
 * order a listing has them. The book note itself is not one of them.
 */
export function loose(
  folder: string,
  paths: Iterable<string>,
  sections: Section[],
  note: string,
): string[] {
  const read = new Set(
    sections.flatMap((section) => (section.kind === "note" ? [section.path] : [])),
  );
  return [...paths].filter(
    (path) =>
      path !== note &&
      path.endsWith(".md") &&
      folderOf(path) === folder &&
      !read.has(path),
  );
}

/** The folder a path is in, which is empty for a note at the top of the vault. */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** A path under a folder, which is the name itself at the top of the vault. */
export function under(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}
