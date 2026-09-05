/**
 * The notes orca creates: a book, and a chapter in a book's folder.
 *
 * A book borrows the notes it lists, so making one writes the book note
 * and nothing else.
 */

import { TFile, type App, type TFolder } from "obsidian";
import { byName, newBook } from "@/book/create";
import { under } from "@/book/folder";
import { writeModel } from "@/book/model";
import type { BookMetadata } from "@/book/note";

/** What a new chapter is called before the author names it. */
export const CHAPTER = "New chapter";

/** What a book is called before the author names it. */
export const UNTITLED = "Untitled book";

/** An empty book, made where a new note would be made. */
export async function emptyBook(app: App): Promise<TFile> {
  const active = app.workspace.getActiveFile();
  const parent = app.fileManager.getNewFileParent(active?.path ?? "");
  return createBook(app, pathOf(parent), UNTITLED, () => [], {});
}

/**
 * The book a folder of notes becomes: the note beside the folder, named
 * after it, listing what is in it in sorted order.
 */
export async function bookFromFolder(app: App, folder: TFolder): Promise<TFile> {
  const beside = folder.parent === null ? "" : pathOf(folder.parent);
  return createBook(
    app,
    beside,
    folder.name,
    // A link is written from the note that carries it, so the book's own
    // path is what it is resolved against.
    (path) =>
      sorted(folder).map((note) =>
        app.metadataCache.fileToLinktext(note, path, true),
      ),
    { title: folder.name },
  );
}

/** The book note for these links, made in a folder. */
async function createBook(
  app: App,
  folder: string,
  name: string,
  links: (path: string) => Iterable<string>,
  metadata: BookMetadata,
): Promise<TFile> {
  const path = free(app, folder, name);
  return app.vault.create(path, writeModel(newBook(metadata, links(path))));
}

/** A chapter note, made in the book's own folder. */
export async function createChapter(
  app: App,
  folder: string,
  name = CHAPTER,
): Promise<TFile> {
  const path = free(app, folder, name);
  const heading = path.slice(path.lastIndexOf("/") + 1, -".md".length);
  return app.vault.create(path, `# ${heading}\n`);
}

/**
 * The markdown notes directly in a folder, sorted. An import is the one
 * time orca trusts alphabetical order.
 */
function sorted(folder: TFolder): TFile[] {
  return folder.children
    .filter((child): child is TFile => child instanceof TFile && child.extension === "md")
    .sort((a, b) => byName(a.basename, b.basename));
}

/** A folder as a vault path, where the root's own path is a separator. */
function pathOf(folder: TFolder): string {
  return folder.isRoot() ? "" : folder.path;
}

/** A path in this folder that no file has, numbered the way Obsidian numbers one. */
function free(app: App, folder: string, name: string): string {
  for (let next = 0; ; next += 1) {
    const path = under(folder, `${name}${next === 0 ? "" : ` ${next}`}.md`);
    if (app.vault.getAbstractFileByPath(path) === null) return path;
  }
}
