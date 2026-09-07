/**
 * A chapter as the writer has it: the editor pane, the icon that swaps
 * it for the book, and the caret a toggle back has to bring with it.
 */

import type { Locator } from "@playwright/test";
import type { MarkdownView } from "obsidian";
import { AS_BOOK, MARKDOWN } from "./note";
import type { Obsidian } from "./obsidian";

/** The caret in a manuscript, as the editor keeps it. */
export interface Caret {
  line: number;
  ch: number;
}

export class Manuscript {
  /** Every pane showing a note as markdown. */
  readonly pane: Locator;
  /** The icon in a note's header that swaps the pane for the book. */
  readonly asBook: Locator;

  constructor(private readonly obsidian: Obsidian) {
    this.pane = this.obsidian.view(MARKDOWN);
    this.asBook = this.obsidian.action(AS_BOOK);
  }

  /** Opens a note in the active pane. */
  async open(path: string): Promise<void> {
    await this.obsidian.open(path);
  }

  /**
   * Opens a note in the pane the manuscript is already in, which is
   * what moving through a book in a split pane is.
   */
  async moveTo(path: string): Promise<void> {
    await this.obsidian.page.evaluate(
      async ({ type, at }) => {
        const leaf = window.app.workspace.getLeavesOfType(type)[0];
        const file = window.app.vault.getFileByPath(at);
        if (leaf === undefined || file === null) {
          throw new Error(`no manuscript to open ${at} in`);
        }
        await leaf.openFile(file, { active: true });
      },
      { type: MARKDOWN, at: path },
    );
  }

  /** Puts the caret on a line of the note the first manuscript pane holds. */
  async place(at: Caret): Promise<void> {
    await this.obsidian.page.evaluate(
      ({ type, caret }) => {
        const view = window.app.workspace.getLeavesOfType(type)[0]?.view as
          | MarkdownView
          | undefined;
        if (view?.editor === undefined) throw new Error("no manuscript is open");
        view.editor.setCursor(caret);
      },
      { type: MARKDOWN, caret: at },
    );
  }

  /** The caret in the first manuscript pane, or nothing when none is open. */
  async caret(): Promise<Caret | undefined> {
    return this.obsidian.page.evaluate((type) => {
      const view = window.app.workspace.getLeavesOfType(type)[0]?.view as
        | MarkdownView
        | undefined;
      if (view?.editor === undefined) return undefined;
      const { line, ch } = view.editor.getCursor();
      return { line, ch };
    }, MARKDOWN);
  }

  /** The note each manuscript pane is showing, in the order the workspace has them. */
  async showing(): Promise<string[]> {
    return this.obsidian.page.evaluate(
      (type) =>
        window.app.workspace
          .getLeavesOfType(type)
          .map((leaf) => (leaf.view as MarkdownView).file?.path ?? ""),
      MARKDOWN,
    );
  }

  async close(): Promise<void> {
    await this.obsidian.detach(MARKDOWN);
  }
}
