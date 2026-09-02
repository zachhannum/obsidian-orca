import { Plugin } from "obsidian";

/** Frontmatter key that makes a note a book, and says which format it is written in. */
export const BOOK_KEY = "orca-book";

export default class OrcaPlugin extends Plugin {
  override async onload(): Promise<void> {
    console.log("orca loaded");
  }

  override onunload(): void {
    console.log("orca unloaded");
  }
}
