import { FileView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import { readModel, type Model } from "@/book/model";
import { BookError } from "@/book/note";
import { resolve, type Section } from "@/book/order";
import type { Range } from "@/book/pages";
import { countWords } from "@/book/words";
import type { PageUnit } from "@/style/design";
import { ACTIONS } from "@/ui/actions";
import { Changed } from "@/ui/changed";
import type { Composer, Typeset } from "@/ui/composer";
import { save, type Edits } from "@/ui/edits";
import { cacheLinks } from "@/ui/notes";
import { report, setField } from "@/ui/report";
import { mountPage, type Mounted } from "@/ui/reports";
import { summary } from "@/ui/summary";
import { Writer } from "@/ui/writer";

/** The type the book note is registered under. */
export const BOOK_VIEW = "orca-book";

/** The plugin, as much of it as the view reaches: it owns the other leaves. */
export interface Handoff {
  /** Gives the leaf back to the editor. */
  asMarkdown(view: BookView): void;
  /** Reveals the navigator and focuses one entry of a book there. */
  locate(book: string, at: number): void;
  /** Opens the preview of a book. */
  preview(book: string): void;
  /** The unit the author measures pages in, from orca's settings. */
  unit(): PageUnit;
  /** Opens the export dialog on a book. */
  exports(book: string): void;
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
 * ranges are read from the book's one session, which the preview and
 * the export read too. The page sends the engine nothing, so it cannot
 * set the book under sheets other than the session's.
 */
export class BookView extends FileView {
  private writer: Writer | undefined;
  private mounted: Mounted | undefined;
  /** The note as orca last read it from disk. */
  private disk = "";
  /** Number of orca's own saves in flight. */
  private saving = 0;
  /** The model the page shows, and the generation it is at. */
  private shown: { model: Model; generation: number } | undefined;
  /** The word count of each note the book reads, once counted. */
  private readonly counts = new Map<string, number>();
  /** The reads still counting, so a note is read once however often the page paints. */
  private readonly counting = new Map<string, Promise<number>>();
  /** Every entry's folio range, as the book's session last placed it. */
  private folios = new Map<number, Range>();
  /** The book whose renders the page follows. */
  private following: Typeset | undefined;
  private unwatch: (() => void) | undefined;
  /** The read of the folios in flight. */
  private reading: Promise<void> | undefined;
  /** Whether a render landed while a read was out, so one more read follows it. */
  private again = false;
  /** Counts the times the page stopped following, so a read out at the time is dropped. */
  private unfollowed = 0;
  /** Drops this page's hold on its book, so the book's engine can stop. */
  private holding: (() => void) | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly edits: Edits,
    private readonly composer: Composer,
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
    this.addAction(ACTIONS.markdown.icon, ACTIONS.markdown.label, () => {
      this.handoff.asMarkdown(this);
    });
    this.addAction(ACTIONS.preview.icon, ACTIONS.preview.label, () => {
      if (this.file !== null) this.handoff.preview(this.file.path);
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
      exports: () => {
        if (this.file !== null) this.handoff.exports(this.file.path);
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
        // A note the book reads has changed, so its count is stale. The
        // session sets the change, and its render moves the folios.
        if (this.forget(file.path)) this.repaint();
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
        if (this.forget(file.path)) this.repaint();
      }),
    );
    this.registerEvent(
      vault.on("rename", (file, was) => {
        if (file.path === this.file?.path) {
          // The book's own note, whose displayed name follows it.
          this.repaint();
          return;
        }
        if (this.forget(was)) this.repaint();
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
          this.stale();
        }
      }),
    );
    this.registerEvent(
      metadataCache.on("resolved", () => {
        if (this.hasMissing()) {
          this.repaint();
          this.stale();
        }
      }),
    );
    return Promise.resolve();
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.holding?.();
    this.holding = this.composer.hold(file.path);
    this.hold(file, await this.app.vault.cachedRead(file));
  }

  override async onUnloadFile(): Promise<void> {
    // The leaf is closing or opening another note, so the model is
    // written first.
    await this.settle();
    this.unfollow();
    this.holding?.();
    this.holding = undefined;
    this.writer = undefined;
    this.shown = undefined;
    this.mounted?.paint({ kind: "none" });
  }

  override async onClose(): Promise<void> {
    await this.settle();
    this.unfollow();
    this.holding?.();
    this.holding = undefined;
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
    this.folios = new Map();
    const model = this.opened(text);
    if (model === undefined) return;
    this.writer = new Writer(model, {
      paint: (model, generation) => {
        this.show(model, generation);
        this.edits.changed();
      },
      save: (model) => this.write(file, model),
    });
    this.show(model, 0);
    this.follow();
  }

  /** The book in the note, or nothing when orca refused it. */
  private opened(text: string): Model | undefined {
    try {
      return readModel(text);
    } catch (cause) {
      if (!(cause instanceof BookError)) throw cause;
      this.shown = undefined;
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
    if (model !== undefined) this.writer?.take(model);
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
  }

  /** Paints the page again with the settings as they are now. */
  refresh(): void {
    this.repaint();
  }

  /** Paints the book page from a model at the generation it is at. */
  private show(model: Model, generation: number): void {
    this.shown = { model, generation };
    this.repaint();
  }

  /**
   * Paints the page again from the model it already holds, with the
   * generation it already carries. The counts, the pages and the
   * links may have changed; the book has not.
   */
  private repaint(): void {
    const file = this.file;
    if (this.shown === undefined || file === null) return;
    this.mounted?.paint({
      kind: "book",
      generation: this.shown.generation,
      designed: summary(this.shown.model.book.design, this.handoff.unit()),
      report: report(
        { path: file.path, name: file.basename, model: this.shown.model },
        { links: cacheLinks(this.app), words: (path) => this.words(path) },
        this.folios,
      ),
    });
  }

  /**
   * Reads the folio ranges again. A render that lands while a read is
   * out is followed by one more read, so a burst of renders reads the
   * whole book once rather than once each.
   */
  private follow(): void {
    if (this.reading !== undefined) {
      this.again = true;
      return;
    }
    this.reading = this.ranges().finally(() => {
      this.reading = undefined;
      if (!this.again) return;
      this.again = false;
      this.follow();
    });
  }

  /**
   * Reads the folio ranges from the book's session, which sets the book
   * if nothing has, and paints them. A read an edit overtook keeps the
   * ranges already painted, and the render that overtook it reads again.
   */
  private async ranges(): Promise<void> {
    const file = this.file;
    // A page with no hold is closed or between notes, and a closed page
    // that opened the book would open it ahead of the preview.
    if (file === null || this.shown === undefined || this.holding === undefined) return;
    const at = this.unfollowed;
    try {
      const typeset = await this.composer.reading(file.path);
      // A closed page that watched the book would open it again each
      // time the book is dropped.
      if (this.file !== file || at !== this.unfollowed) return;
      this.watching(typeset);
      const folios = await typeset.ranges();
      if (this.file !== file || at !== this.unfollowed || folios === undefined) return;
      this.folios = folios;
      this.repaint();
    } catch (cause) {
      console.error(`Orca: ${file.path} did not typeset.`, cause);
    }
  }

  /** Follows the renders of a book, in place of the one it followed. */
  private watching(typeset: Typeset): void {
    if (typeset === this.following) return;
    this.unwatch?.();
    this.following = typeset;
    this.unwatch = typeset.watch(() => {
      this.follow();
    });
  }

  private unfollow(): void {
    this.unfollowed += 1;
    this.unwatch?.();
    this.unwatch = undefined;
    this.following = undefined;
  }

  /**
   * Drops the book from the composer when a new note fills an entry the
   * session set as missing. The vault event names the new note, which
   * no book reads yet, so nothing else drops the book.
   */
  private stale(): void {
    const file = this.file;
    const following = this.following;
    if (file === null || this.shown === undefined || following === undefined) return;
    const { sections } = resolve(this.shown.model.order, cacheLinks(this.app), file.path);
    const same =
      sections.length === following.sections.length &&
      sections.every((section, at) => {
        const was = following.sections[at];
        return was !== undefined && sameSection(section, was);
      });
    if (!same) this.composer.forget(file.path);
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
    if (this.shown === undefined || file === null) return false;
    const { sections } = resolve(
      this.shown.model.order,
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

/** Whether two sections set the same thing: the same kind, from the same note. */
function sameSection(one: Section, other: Section): boolean {
  const pathOf = (section: Section): string | undefined =>
    "path" in section ? section.path : undefined;
  return one.kind === other.kind && pathOf(one) === pathOf(other);
}
