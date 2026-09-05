import { FileView, setIcon, type TFile, type WorkspaceLeaf } from "obsidian";
import { readFrontmatter } from "@/book/frontmatter";
import {
  BOOK_KEY,
  BookError,
  FIELD_KEYS,
  readBook,
  type Book,
} from "@/book/note";

/** The type the book note is registered under. */
export const BOOK_VIEW = "orca-book";

/**
 * The book note's own page. The view reads the note and writes nothing,
 * and `Open as markdown` hands the leaf back to the editor.
 */
export class BookView extends FileView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly asMarkdown: (view: BookView) => void,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return BOOK_VIEW;
  }

  override getIcon(): string {
    return "book";
  }

  override onOpen(): Promise<void> {
    this.addAction("file-text", "Open as markdown", () => {
      this.asMarkdown(this);
    });
    return Promise.resolve();
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.show(await this.app.vault.cachedRead(file));
  }

  override onUnloadFile(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }

  private show(text: string): void {
    const pane = this.contentEl;
    pane.empty();
    pane.addClass("orca-book");
    pane.dataset["testid"] = "orca-book";
    const { properties } = readFrontmatter(text);
    try {
      this.page(pane, readBook(properties));
    } catch (cause) {
      if (!(cause instanceof BookError)) throw cause;
      this.refuse(pane, cause.message);
    }
  }

  /** What the book note reports about the book. */
  private page(pane: HTMLElement, book: Book): void {
    const page = pane.createDiv({ cls: "orca-book-page" });
    const head = page.createDiv({ cls: "orca-book-head" });
    head.createDiv({
      cls: "orca-book-name",
      text: book.metadata.title ?? this.file?.basename ?? "",
    });
    head.createDiv({
      cls: "orca-book-format",
      text: `${BOOK_KEY}: ${book.format}`,
    });

    const rows = page.createDiv({ cls: "orca-book-metadata" });
    for (const key of FIELD_KEYS) {
      const value = book.metadata[key];
      if (value === undefined) continue;
      const row = rows.createDiv({ cls: "orca-book-row" });
      row.dataset["testid"] = `orca-metadata-${key}`;
      row.createDiv({ cls: "orca-book-label", text: key });
      row.createDiv({ cls: "orca-book-value", text: value });
    }
  }

  /** A book this orca cannot read, and the way back to the editor. */
  private refuse(pane: HTMLElement, said: string): void {
    const state = pane.createDiv({ cls: "orca-book-refused" });
    state.dataset["testid"] = "orca-book-refused";
    setIcon(state.createDiv({ cls: "orca-book-icon" }), "lock");
    state.createDiv({
      cls: "orca-book-said",
      text: "This book was made by a newer version of orca than this one.",
    });
    state.createDiv({ cls: "orca-book-versions", text: said });
    state.createDiv({
      cls: "orca-book-hint",
      text: "Update the plugin to open it",
    });
    const button = state.createEl("button", { text: "Open as markdown" });
    this.registerDomEvent(button, "click", () => {
      this.asMarkdown(this);
    });
  }
}
