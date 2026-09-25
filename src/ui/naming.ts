/**
 * Names a note in the vault: a title made fit for a file name, and the
 * first path in a folder that no other file holds.
 */

import { under } from "@/book/folder";

/**
 * Characters a file name cannot hold on some system Obsidian runs on,
 * and the ones a link to the note cannot carry.
 */
const UNFIT = /[\\/:*?"<>|#^[\]]/g;

/**
 * A title as a note's name, without the characters a file name cannot
 * hold. A leading dot is dropped too, because it hides the file. Empty
 * when nothing of the title is left.
 */
export function fileName(title: string): string {
  return title
    .replace(UNFIT, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
}

/**
 * The first path in a folder for a name that no other file holds,
 * numbered the way Obsidian numbers one. `own` is the note being
 * named, whose path counts as free.
 */
export function free(
  folder: string,
  name: string,
  taken: (path: string) => boolean,
  own?: string,
): string {
  for (let next = 0; ; next += 1) {
    const path = under(folder, `${name}${next === 0 ? "" : ` ${next}`}.md`);
    if (path === own || !taken(path)) return path;
  }
}
