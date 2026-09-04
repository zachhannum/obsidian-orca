/**
 * The book note's own view, reached by the test ids its markup carries.
 * The way back to the manuscript is Obsidian's own chrome, so it goes
 * through the page object that holds those class names.
 */

import type { Locator } from "@playwright/test";
import type { Obsidian } from "./obsidian";

/** The type the book note is registered under. */
export const BOOK = "orca-book";

/** The type a book note is handed back to. */
export const MARKDOWN = "markdown";

/** The way back to the manuscript, in the view's header and the file menu. */
export const AS_MARKDOWN = "Open as markdown";

export class Note {
  /** The page orca draws for the book note. */
  readonly page: Locator;
  /** The state a book from a newer orca stops at. */
  readonly refused: Locator;
  /** The note as the editor shows it. */
  readonly markdown: Locator;

  constructor(private readonly obsidian: Obsidian) {
    this.page = obsidian.view(BOOK).getByTestId("orca-book");
    this.refused = this.page.getByTestId("orca-book-refused");
    this.markdown = obsidian.view(MARKDOWN);
  }

  /** Opens a note in the active pane. */
  async open(path: string): Promise<void> {
    await this.obsidian.open(path);
  }

  /** One property orca keeps, as the page reports it. */
  metadata(key: string): Locator {
    return this.page.getByTestId(`orca-metadata-${key}`);
  }

  /** The action in the view's header, which hands the leaf back. */
  async asMarkdown(): Promise<void> {
    await this.obsidian.action(AS_MARKDOWN).click();
  }

  async close(): Promise<void> {
    await this.obsidian.detach(BOOK);
    await this.obsidian.detach(MARKDOWN);
  }
}
