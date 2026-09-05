/**
 * The book note's own view, reached by the test ids in its markup.
 * The way back to the manuscript is Obsidian's own chrome, so it goes
 * through the page object that has those class names.
 */

import { expect, type Locator } from "@playwright/test";
import type { TFile } from "obsidian";
import type { Model } from "@/book/model";
import type { Obsidian } from "./obsidian";

/** The type the book note is registered under. */
export const BOOK = "orca-book";

/** The type a book note is handed back to. */
export const MARKDOWN = "markdown";

/** The way to the manuscript and back, in each view's header and the file menu. */
export const AS_MARKDOWN = "Open as markdown";
export const AS_BOOK = "Open as book";

/** The view method every edit to the book goes through. */
interface Editing {
  edit(change: (model: Model) => Model): void;
}

export class Note {
  /** The page orca draws for the book note, carrying the model it was painted from. */
  readonly page: Locator;
  /** The state a book from a newer orca stops at. */
  readonly refused: Locator;
  /** What the author answers when the note changed under an edit. */
  readonly changed: Locator;
  /** The note as the editor shows it. */
  readonly markdown: Locator;

  constructor(private readonly obsidian: Obsidian) {
    this.page = obsidian.view(BOOK).getByTestId("orca-book");
    this.refused = this.page.getByTestId("orca-book-refused");
    this.changed = obsidian.page.getByTestId("orca-book-changed");
    this.markdown = obsidian.view(MARKDOWN);
  }

  /** How many times the model the page shows has changed. */
  async painted(): Promise<number> {
    await expect(this.page).toHaveAttribute("data-generation", /\d+/);
    return Number(await this.page.getAttribute("data-generation"));
  }

  /** One edit, through the view the book is open in. */
  async edit(title: string): Promise<void> {
    await this.drag(title, 1);
  }

  /**
   * A dragged control: one edit a frame, in one turn of the renderer,
   * so the frames land inside the settle rather than around it.
   */
  async drag(title: string, frames: number): Promise<void> {
    await this.obsidian.page.evaluate(
      ({ name, count, type }) => {
        const leaf = window.app.workspace.getLeavesOfType(type)[0];
        const view = leaf?.view as unknown as Editing | undefined;
        if (view === undefined) throw new Error("no book view is open");
        for (let frame = 0; frame < count; frame += 1) {
          const held = count === 1 ? name : `${name} ${frame}`;
          view.edit((model) => ({
            ...model,
            book: {
              ...model.book,
              metadata: { ...model.book.metadata, title: held },
            },
          }));
        }
      },
      { name: title, count: frames, type: BOOK },
    );
  }

  /**
   * One edit, and the note trashed in the same turn of the renderer, so
   * the settle the edit armed is still waiting when the note goes.
   */
  async editAndDelete(title: string): Promise<void> {
    await this.obsidian.page.evaluate(
      async ({ name, type }) => {
        const leaf = window.app.workspace.getLeavesOfType(type)[0];
        const view = leaf?.view as unknown as (Editing & { file: TFile | null }) | undefined;
        if (view === undefined) throw new Error("no book view is open");
        view.edit((model) => ({
          ...model,
          book: {
            ...model.book,
            metadata: { ...model.book.metadata, title: name },
          },
        }));
        const held = view.file;
        if (held === null) throw new Error("the view has no note");
        await window.app.fileManager.trashFile(held);
      },
      { name: title, type: BOOK },
    );
  }

  /** Opens a note in the active pane. */
  async open(path: string): Promise<void> {
    await this.obsidian.open(path);
  }

  /** One property orca keeps, as the page reports it. */
  metadata(key: string): Locator {
    return this.page.getByTestId(`orca-metadata-${key}`);
  }

  /** The action in the book page's header, which hands the leaf to the editor. */
  async asMarkdown(): Promise<void> {
    await this.obsidian.action(AS_MARKDOWN).click();
  }

  /** The action in the note's own header, which hands it back to the book. */
  async asBook(): Promise<void> {
    await this.obsidian.action(AS_BOOK).click();
  }

  async close(): Promise<void> {
    await this.obsidian.detach(BOOK);
    await this.obsidian.detach(MARKDOWN);
  }
}
