/**
 * One edit to a book, wherever the book is.
 *
 * A book open in a view is edited through it, because the view is the
 * note's only writer while it is open. A book with no view open is
 * read, changed and written in one go, so no second writer holds an
 * edit of its own.
 */

import { Notice, type App, type TFile } from "obsidian";
import { readFrontmatter, type Properties } from "@/book/frontmatter";
import { readModel, withOrder, type Model } from "@/book/model";
import { BookError, applyBook } from "@/book/note";
import { add, writeOrder } from "@/book/order";

/** A book open in a view, which is the note's only writer while it is. */
export interface Open {
  /** The model the view paints from, the edits waiting on the settle included. */
  readonly model: Model | undefined;
  edit(change: (model: Model) => Model): void;
}

/** What an edit changes a book into. */
export type Change = (model: Model) => Model;

export class Edits {
  private readonly watchers = new Set<() => void>();

  constructor(
    private readonly app: App,
    /** The view a book is open in, if one is. */
    private readonly opened: (path: string) => Open | undefined,
  ) {}

  /** One edit to the book at this path. */
  async edit(path: string, change: Change): Promise<void> {
    const open = this.opened(path);
    if (open !== undefined) {
      open.edit(change);
      this.changed();
      return;
    }
    const file = this.app.vault.getFileByPath(path);
    if (file === null) return;
    try {
      const disk = await this.app.vault.read(file);
      await save(this.app, file, disk, change(readModel(disk)));
    } catch (cause) {
      this.refused(cause);
      return;
    }
    this.changed();
  }

  /**
   * One note added to a book's reading order. The quick pick, the
   * note's own context menu and a wikilink pasted into the navigator
   * all come through here, so the three write the same line.
   */
  async addNote(book: string, note: TFile, heading?: string): Promise<void> {
    const link = this.app.metadataCache.fileToLinktext(note, book, true);
    await this.edit(book, (model) => ({
      ...model,
      order: add(model.order, link, heading),
    }));
  }

  /**
   * The book at this path: the model a view is painting from, or the
   * note as it is on disk. A note orca refuses has none.
   */
  async model(path: string): Promise<Model | undefined> {
    const open = this.opened(path)?.model;
    if (open !== undefined) return open;
    const file = this.app.vault.getFileByPath(path);
    if (file === null) return undefined;
    try {
      return readModel(await this.app.vault.cachedRead(file));
    } catch (cause) {
      if (cause instanceof BookError) return undefined;
      throw cause;
    }
  }

  /** Tells the watchers a book changed. A view calls this as it paints. */
  changed(): void {
    for (const watcher of this.watchers) watcher();
  }

  /** Watches every edit, until the way back is called. */
  watch(watcher: () => void): () => void {
    this.watchers.add(watcher);
    return () => {
      this.watchers.delete(watcher);
    };
  }

  private refused(cause: unknown): void {
    new Notice(
      `Orca: the book was not edited. ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

/**
 * The note, written in two halves. The properties go through
 * Obsidian's frontmatter API, which leaves the author's own alone, and
 * the body is replaced under them. The half an edit did not touch is
 * not written, so a settled edit is one revision. What comes back is
 * the note as it now is on disk.
 */
export async function save(
  app: App,
  file: TFile,
  disk: string,
  model: Model,
): Promise<string> {
  const held = readFrontmatter(disk);
  const after = structuredClone(held.properties);
  applyBook(after, model.book);
  if (JSON.stringify(after) !== JSON.stringify(held.properties)) {
    await app.fileManager.processFrontMatter(file, (properties: Properties) => {
      applyBook(properties, model.book);
    });
  }
  if (writeOrder(model.order) !== held.body) {
    await app.vault.process(file, (text) => withOrder(text, model.order));
  }
  return app.vault.read(file);
}
