import {
  FileView,
  Notice,
  TFile,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import { readFrontmatter, type Properties } from "@/book/frontmatter";
import { readModel, withOrder, type Model } from "@/book/model";
import {
  BOOK_KEY,
  BookError,
  FIELD_KEYS,
  applyBook,
  type Book,
} from "@/book/note";
import { writeOrder } from "@/book/order";
import { Changed } from "@/ui/changed";
import { Writer } from "@/ui/writer";

/** The type the book note is registered under. */
export const BOOK_VIEW = "orca-book";

/**
 * The book note's own page, and the one writer on the note while it is
 * open. Every other surface edits the book through `edit`, and
 * `Open as markdown` hands the leaf back to the editor.
 */
export class BookView extends FileView {
  private writer: Writer | undefined;
  /** The note as orca last read it from disk. */
  private disk = "";
  /** How many saves of orca's own are out. */
  private saving = 0;

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
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.path === this.file?.path) {
          void this.arrived(file);
        }
      }),
    );
    return Promise.resolve();
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.hold(file, await this.app.vault.cachedRead(file));
  }

  override async onUnloadFile(): Promise<void> {
    // The leaf is closing or taking another note, so what the model
    // holds is written before it goes.
    await this.settle();
    this.writer = undefined;
    this.contentEl.empty();
  }

  override async onClose(): Promise<void> {
    await this.settle();
    this.writer = undefined;
  }

  /**
   * One edit to the book. The view is the only writer while it is
   * open, so every surface that changes the book comes through here.
   */
  edit(change: (model: Model) => Model): void {
    this.writer?.edit(change);
  }

  /** The note opened: the book on the page, and the writer over it. */
  private hold(file: TFile, text: string): void {
    this.disk = text;
    this.writer = undefined;
    const model = this.opened(text);
    if (model === undefined) return;
    this.writer = new Writer(model, {
      paint: (held, generation) => {
        this.show(held.book, generation);
      },
      save: (held) => this.write(file, held),
    });
    this.show(model.book, 0);
  }

  /** The book the note holds, or nothing when orca refused it. */
  private opened(text: string): Model | undefined {
    try {
      return readModel(text);
    } catch (cause) {
      if (!(cause instanceof BookError)) throw cause;
      this.refuse(this.pane(), cause.message);
      return undefined;
    }
  }

  /**
   * A write on the note that orca did not make: the note edited in
   * another leaf, or a sync writing over it.
   */
  private async arrived(file: TFile): Promise<void> {
    if (this.saving > 0) return;
    const text = await this.app.vault.read(file);
    if (text === this.disk) return;

    // A refused book holds no writer, and a change that fixes its
    // format opens it.
    const writer = this.writer;
    if (writer === undefined) {
      this.hold(file, text);
      return;
    }
    this.disk = text;

    if (writer.arrived() === "reload") {
      this.reload(text);
      return;
    }
    // The settle would otherwise write the held edit over the note
    // while the author is still reading the question.
    writer.stop();
    new Changed(this.app, {
      keep: () => {
        void this.settle();
      },
      reload: () => {
        this.reload(text);
      },
    }).open();
  }

  private reload(text: string): void {
    const model = this.opened(text);
    if (model !== undefined) this.writer?.take(model);
  }

  /** Writes what the model holds, and reports a write that failed. */
  private async settle(): Promise<void> {
    try {
      await this.writer?.flush();
    } catch (cause) {
      new Notice(
        `Orca: the book note was not written. ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  /**
   * The note, written in two halves. The properties go through
   * Obsidian's frontmatter API, which leaves the author's own alone,
   * and the body is replaced under them. The half an edit did not
   * touch is not written, so a settled edit is one revision.
   */
  private async write(file: TFile, model: Model): Promise<void> {
    this.saving += 1;
    try {
      const held = readFrontmatter(this.disk);
      const after = structuredClone(held.properties);
      applyBook(after, model.book);
      if (JSON.stringify(after) !== JSON.stringify(held.properties)) {
        await this.app.fileManager.processFrontMatter(
          file,
          (properties: Properties) => {
            applyBook(properties, model.book);
          },
        );
      }
      if (writeOrder(model.order) !== held.body) {
        await this.app.vault.process(file, (text) =>
          withOrder(text, model.order),
        );
      }
      this.disk = await this.app.vault.read(file);
    } finally {
      this.saving -= 1;
    }
  }

  private pane(): HTMLElement {
    const pane = this.contentEl;
    pane.empty();
    pane.addClass("orca-book");
    pane.dataset["testid"] = "orca-book";
    return pane;
  }

  /**
   * What the book note reports about the book, with the number of
   * changes the model has taken, which a test waits on rather than a
   * clock.
   */
  private show(book: Book, generation: number): void {
    const pane = this.pane();
    pane.dataset["generation"] = String(generation);
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
      const held = book.metadata[key];
      if (held === undefined) continue;
      const row = rows.createDiv({ cls: "orca-book-row" });
      row.dataset["testid"] = `orca-metadata-${key}`;
      row.createDiv({ cls: "orca-book-label", text: key });
      row.createDiv({ cls: "orca-book-value", text: held });
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
