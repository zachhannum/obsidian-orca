/**
 * Obsidian's vault and metadata cache, as the two halves the rest of
 * orca reads them through.
 */

import type { App, TFile } from "obsidian";
import type { Links } from "@/book/links";
import { target } from "@/book/links";
import type { NoteIndex } from "@/ui/books";

/** Every markdown note, and its properties as the metadata cache has them. */
export function noteIndex(app: App): NoteIndex<TFile> {
  const { vault, metadataCache } = app;
  return {
    notes: () => vault.getMarkdownFiles(),
    properties: (note) => metadataCache.getFileCache(note)?.frontmatter,
  };
}

/**
 * Links resolved the way Obsidian resolves them, so a renamed or moved
 * note keeps its entry with no path of orca's own.
 */
export function cacheLinks(app: App): Links {
  return {
    find: (link, from) =>
      app.metadataCache.getFirstLinkpathDest(target(link), from)?.path,
  };
}
