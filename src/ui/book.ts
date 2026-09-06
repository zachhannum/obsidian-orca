import type { Page } from "fleuron";
import { FileView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import { readModel, type Model } from "@/book/model";
import { BookError } from "@/book/note";
import { resolve } from "@/book/order";
import { sendBook } from "@/book/plan";
import { countWords } from "@/book/words";
import type { EngineClient } from "@/engine/session";
import { BUNDLED_THEME } from "@/style/theme";
import { Changed } from "@/ui/changed";
import { save, type Edits } from "@/ui/edits";
import { cacheLinks } from "@/ui/notes";
import { report, setField } from "@/ui/report";
import { mountPage, type Mounted } from "@/ui/reports";
import { Writer } from "@/ui/writer";

/** The type the book note is registered under. */
export const BOOK_VIEW = "orca-book";

/** The plugin, as much of it as the view reaches: it owns the other leaves. */
export interface Handoff {
  /** Gives the leaf back to the editor. */
  asMarkdown(view: BookView): void;
  /** Reveals the navigator and focuses one entry of a book there. */
  locate(book: string, at: number): void;
}

/**
 * The view for a book note, and the only writer on the note while it
 * is open. Every other surface edits the book through `edit`, and
 * `Open as markdown` hands the leaf back to the editor.
 *
 * The page reports on the book: its properties, edited here, and its
 * reading order with a word count and a folio range beside each note.
 * The counts are read from the vault as the page needs them and kept
 * until the note changes, so a repaint costs no reads. The folio
 * ranges come from a run of the book through the engine, which the
 * view sends again once an edit to the order or a note it reads
 * settles.
 */
export class BookView extends FileView {
  private writer: Writer | undefined;
  private mounted: Mounted | undefined;
  /** The note as orca last read it from disk. */
  private disk = "";
  /** Number of orca's own saves in flight. */
  private saving = 0;
  /** The model the page shows, and the generation it is at. */
  private held: { model: Model; generation: number } | undefined;
  /** The word count of each note the book reads, once counted. */
  private readonly counts = new Map<string, number>();
  /** The reads still counting, so a note is read once however often the page paints. */
  private readonly counting = new Map<string, Promise<number>>();
  /** The pages the last run through the engine came back with. */
  private pages: Page[] = [];
  /** Counts the runs sent, so a run a later one overtakes is dropped rather than painted. */
  private laying = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly edits: Edits,
    private readonly client: Promise<EngineClient>,
    private readonly handoff: Handoff,
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
      this.handoff.asMarkdown(this);
    });
    this.mounted = mountPage(this.contentEl, {
      set: (key, value) => {
        this.edit((model) => setField(model, key, value));
      },
      locate: (at) => {
        if (this.file !== null) this.handoff.locate(this.file.path, at);
      },
      asMarkdown: () => {
        this.handoff.asMarkdown(this);
      },
    });

    const { vault, metadataCache } = this.app;
    this.registerEvent(
      vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        if (file.path === this.file?.path) {
          void this.arrived(file);
          return;
        }
        // A note the book reads has changed, so its count and its
        // pages are both stale.
        if (this.forget(file.path)) {
          this.repaint();
          void this.relay();
        }
      }),
    );
    // The note is gone, so an unwritten edit has nowhere to settle.
    this.registerEvent(
      vault.on("delete", (file) => {
        if (file.path === this.file?.path) {
          this.writer?.stop();
          this.writer = undefined;
          return;
        }
        this.forget(file.path);
        this.repaint();
        void this.relay();
      }),
    );
    this.registerEvent(
      vault.on("rename", (_file, was) => {
        this.forget(was);
        this.repaint();
        void this.relay();
      }),
    );
    // A new note or a resolved cache can only change what this book
    // draws when an entry is missing, so the two events that fire for
    // every note in the vault are gated on that rather than repainting
    // the whole order on each one.
    this.registerEvent(
      vault.on("create", () => {
        if (this.hasMissing()) {
          this.repaint();
          void this.relay();
        }
      }),
    );
    this.registerEvent(
      metadataCache.on("resolved", () => {
        if (this.hasMissing()) {
          this.repaint();
          void this.relay();
        }
      }),
    );
    return Promise.resolve();
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.hold(file, await this.app.vault.cachedRead(file));
  }

  override async onUnloadFile(): Promise<void> {
    // The leaf is closing or opening another note, so the model is
    // written first.
    await this.settle();
    this.writer = undefined;
    this.held = undefined;
    this.mounted?.paint({ kind: "none" });
  }

  override async onClose(): Promise<void> {
    await this.settle();
    this.writer = undefined;
    this.mounted?.unmount();
    this.mounted = undefined;
  }

  /** The book as the view paints it, the unwritten edits included. */
  get model(): Model | undefined {
    return this.writer?.model;
  }

  /**
   * Applies one edit to the book. The view is the only writer while it
   * is open, so every surface that changes the book comes through here.
   */
  edit(change: (model: Model) => Model): void {
    this.writer?.edit(change);
  }

  /** Reads the model from the note, makes the writer and paints the book. */
  private hold(file: TFile, text: string): void {
    this.disk = text;
    this.writer = undefined;
    this.pages = [];
    const model = this.opened(text);
    if (model === undefined) return;
    this.writer = new Writer(model, {
      paint: (held, generation) => {
        this.show(held, generation);
        this.edits.changed();
      },
      save: (held) => this.write(file, held),
    });
    this.show(model, 0);
    void this.relay();
  }

  /** The book in the note, or nothing when orca refused it. */
  private opened(text: string): Model | undefined {
    try {
      return readModel(text);
    } catch (cause) {
      if (!(cause instanceof BookError)) throw cause;
      this.held = undefined;
      this.mounted?.paint({ kind: "refused", said: cause.message });
      return undefined;
    }
  }

  /**
   * Handles a write on the note that orca did not make: the note edited
   * in another leaf, or a sync writing over it.
   */
  private async arrived(file: TFile): Promise<void> {
    if (this.saving > 0) return;
    const text = await this.app.vault.read(file);
    if (text === this.disk) return;

    // A refused book has no writer, and a change that fixes its
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
    // The settle would otherwise write the unwritten edit over the note
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
    if (model !== undefined) {
      this.writer?.take(model);
      void this.relay();
    }
  }

  /** Writes the model, and reports a write that failed. */
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

  private async write(file: TFile, model: Model): Promise<void> {
    // A settle still running when the note was deleted writes nothing: the
    // vault no longer holds the file the writer was made for.
    if (this.app.vault.getFileByPath(file.path) !== file) return;
    this.saving += 1;
    try {
      this.disk = await save(this.app, file, this.disk, model);
    } finally {
      this.saving -= 1;
    }
    // The edit that just settled may have reordered the book or
    // changed what a note holds, so its pages are sent again.
    void this.relay();
  }

  /** Paints the book page from a model at the generation it is at. */
  private show(model: Model, generation: number): void {
    this.held = { model, generation };
    this.repaint();
  }

  /**
   * Paints the page again from the model it already holds, with the
   * generation it already carries. The counts, the pages and the
   * links may have changed; the book has not.
   */
  private repaint(): void {
    const file = this.file;
    if (this.held === undefined || file === null) return;
    this.mounted?.paint({
      kind: "book",
      generation: this.held.generation,
      report: report(
        { path: file.path, name: file.basename, model: this.held.model },
        { links: cacheLinks(this.app), words: (path) => this.words(path) },
        this.pages,
      ),
    });
  }

  /**
   * Sends the book through the engine again and paints the pages it
   * comes back with. A run a later one overtakes before it lands is
   * dropped rather than painted.
   */
  private async relay(): Promise<void> {
    const file = this.file;
    const held = this.held;
    if (file === null || held === undefined) return;
    const generation = (this.laying += 1);
    let pages = this.pages;
    try {
      const client = await this.client;
      const ops = await sendBook(
        held.model.book,
        held.model.order,
        cacheLinks(this.app),
        file.path,
        (path) => this.readNote(path),
      );
      const output = await client.preview([
        ...ops,
        { op: "style", css: BUNDLED_THEME },
      ]);
      pages = output?.pages ?? pages;
    } catch (cause) {
      console.error(`Orca: ${file.path} did not lay out.`, cause);
    }
    if (generation !== this.laying) return;
    this.pages = pages;
    this.repaint();
  }

  /** Reads a note a section names, for the run `relay` sends. */
  private readNote(path: string): Promise<string> {
    const note = this.app.vault.getFileByPath(path);
    return note === null
      ? Promise.reject(new Error(`${path} is gone`))
      : this.app.vault.cachedRead(note);
  }

  /**
   * A note's word count, or nothing while it is still being read. The
   * first ask starts the read, and the page is painted again once it
   * lands. A read that fails counts as zero, so a note orca cannot
   * read is not read again on every vault event until it changes.
   */
  private words(path: string): number | undefined {
    const counted = this.counts.get(path);
    if (counted !== undefined) return counted;
    if (this.counting.has(path)) return undefined;
    const file = this.app.vault.getFileByPath(path);
    if (file === null) return undefined;
    const reading = this.app.vault.cachedRead(file).then(
      (text) => countWords(text),
      (cause: unknown) => {
        console.error(`Orca: ${path} was not counted.`, cause);
        return 0;
      },
    );
    reading.then((count) => {
      // A change while the read was out has already dropped this one.
      if (this.counting.get(path) !== reading) return;
      this.counting.delete(path);
      this.counts.set(path, count);
      this.repaint();
    });
    this.counting.set(path, reading);
    return undefined;
  }

  /** Whether the order has an entry with no note to read. */
  private hasMissing(): boolean {
    const file = this.file;
    if (this.held === undefined || file === null) return false;
    const { sections } = resolve(
      this.held.model.order,
      cacheLinks(this.app),
      file.path,
    );
    return sections.some((section) => section.kind === "missing");
  }

  /** Drops what is known of a note's count. Whether anything was. */
  private forget(path: string): boolean {
    const known = this.counts.delete(path);
    const reading = this.counting.delete(path);
    return known || reading;
  }
}
