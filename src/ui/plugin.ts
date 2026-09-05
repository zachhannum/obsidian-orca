import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath,
  type Menu,
  type TAbstractFile,
  type ViewState,
} from "obsidian";
import { startEngine, type EngineHandle } from "@/engine/bootstrap";
import { EngineError } from "@/engine/errors";
import { readModule, type VaultFiles } from "@/engine/module";
import { Session, documentFaces } from "@/engine/session";
import { BOOK_VIEW, BookView } from "@/ui/book";
import { books, isBook, type NoteIndex } from "@/ui/books";
import { Edits } from "@/ui/edits";
import { bookFromFolder, emptyBook } from "@/ui/make";
import { NAVIGATOR_VIEW, NavigatorView } from "@/ui/navigator";
import { noteIndex } from "@/ui/notes";
import { pick } from "@/ui/pick";
import { PREVIEW_VIEW, PreviewView } from "@/ui/preview";

/** The view a book note is handed back to. */
const MARKDOWN_VIEW = "markdown";

/** How a leaf is put on a view, which is the call orca answers first. */
type SetViewState = (
  this: WorkspaceLeaf,
  state: ViewState,
  ...rest: unknown[]
) => Promise<void>;

/**
 * Orca, as Obsidian loads it. The plugin owns the engine, and every
 * view borrows the same session.
 */
export default class OrcaPlugin extends Plugin {
  private engine: EngineHandle | undefined;
  /** Every edit to a book, routed to the note's one writer. */
  private readonly edits = new Edits(this.app, (path) => this.opened(path));
  private unloaded = false;
  /** The leaves an author has asked to keep in markdown, and for which note. */
  private readonly asMarkdown = new WeakMap<WorkspaceLeaf, string>();
  /** The icon back to the book on each of those notes. */
  private readonly back = new WeakMap<
    MarkdownView,
    { at: string; icon: HTMLElement }
  >();

  override async onload(): Promise<void> {
    // The session is opened before anything is registered, so the views
    // Obsidian restores at startup all wait on the one engine.
    const opening = this.open();

    this.catchOpening();

    this.registerView(PREVIEW_VIEW, (leaf) => new PreviewView(leaf, opening));
    this.registerView(
      BOOK_VIEW,
      (leaf) =>
        new BookView(leaf, this.edits, (view) => {
          void this.openAsMarkdown(view.leaf, view.file);
        }),
    );
    this.registerView(
      NAVIGATOR_VIEW,
      (leaf) => new NavigatorView(leaf, this.edits),
    );
    this.addRibbonIcon("book", "Open the book", () => {
      void this.reveal();
    });
    this.addCommand({
      id: "open-book",
      name: "Open the book",
      callback: () => {
        void this.reveal();
      },
    });
    this.addCommand({
      id: "new-book",
      name: "New book",
      callback: () => {
        void this.newBook();
      },
    });

    this.app.workspace.onLayoutReady(() => {
      this.swap();
      void this.app.workspace.ensureSideLeaf(NAVIGATOR_VIEW, "left", {
        reveal: false,
      });
    });
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.swap();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.swap();
        // A book nobody can reorder is what a collapsed sidebar would
        // otherwise mean.
        if (file !== null && isBook(this.notes(), file)) void this.show();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
        this.offer(menu, file, leaf);
      }),
    );

    await opening;
  }

  /**
   * A book note goes straight to the book view, before the editor is
   * ever mounted. The explorer, the switcher, a link and the navigator
   * all reach a leaf through `setViewState`, and a swap made after the
   * fact is a frame of raw markdown the author sees.
   */
  private catchOpening(): void {
    const held = WorkspaceLeaf.prototype.setViewState as SetViewState;
    const plugin = this;
    const caught: SetViewState = function (state, ...rest) {
      return held.call(this, plugin.asBook(this, state), ...rest);
    };
    WorkspaceLeaf.prototype.setViewState = caught;
    this.register(() => {
      // Another plugin may have wrapped this one since. Its wrapper
      // stays, because taking it off would take that plugin with it.
      if (WorkspaceLeaf.prototype.setViewState === caught) {
        WorkspaceLeaf.prototype.setViewState = held;
      }
    });
  }

  /** The state a leaf is really put on: the book view, for a book note. */
  private asBook(leaf: WorkspaceLeaf, state: ViewState): ViewState {
    // Another plugin's wrapper keeps this one installed after orca
    // unloads, and the book view is no longer registered by then.
    if (this.unloaded || state.type !== MARKDOWN_VIEW) return state;
    const path = state.state?.["file"];
    if (typeof path !== "string") return state;
    if (this.asMarkdown.get(leaf) === path) return state;
    const file = this.app.vault.getFileByPath(path);
    if (file === null || !isBook(this.notes(), file)) return state;
    return { ...state, type: BOOK_VIEW, state: { file: path } };
  }

  override onunload(): void {
    this.unloaded = true;
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW)) {
      if (leaf.view instanceof MarkdownView) this.release(leaf.view);
    }
    this.engine?.stop();
    this.engine = undefined;
  }

  /** Every markdown note, and its properties as the metadata cache has them. */
  private notes(): NoteIndex<TFile> {
    return noteIndex(this.app);
  }

  /** The view a book note is open in, which is its only writer while it is. */
  private opened(path: string): BookView | undefined {
    for (const leaf of this.app.workspace.getLeavesOfType(BOOK_VIEW)) {
      const view = leaf.view;
      if (view instanceof BookView && view.file?.path === path) return view;
    }
    return undefined;
  }

  /**
   * Every leaf showing a book note as markdown, swapped to orca's view.
   * A leaf the author has asked for markdown keeps the manuscript and
   * gets the icon back to the book, until it shows another note.
   */
  private swap(): void {
    const index = this.notes();
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW)) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const file = view.file;
      if (file === null || !isBook(index, file)) {
        this.release(view);
        continue;
      }
      if (this.asMarkdown.get(leaf) === file.path) {
        this.attach(view, file);
        continue;
      }
      void leaf.setViewState({ type: BOOK_VIEW, state: { file: file.path } });
    }
  }

  /**
   * The way back, as an icon in the note's own header. Obsidian's own
   * reading toggle sits in that corner, and `addAction` is how a view
   * orca does not own takes one.
   */
  private attach(view: MarkdownView, file: TFile): void {
    const existing = this.back.get(view);
    if (existing?.at === file.path) return;
    existing?.icon.remove();
    const icon = view.addAction("book", "Open as book", () => {
      void this.openAsBook(view.leaf, file);
    });
    this.back.set(view, { at: file.path, icon });
  }

  private release(view: MarkdownView): void {
    const existing = this.back.get(view);
    if (existing === undefined) return;
    existing.icon.remove();
    this.back.delete(view);
  }

  /**
   * What a file's own context menu offers: a folder becomes a book, a
   * note joins one, and a book note opens as markdown and back.
   */
  private offer(
    menu: Menu,
    file: TAbstractFile,
    leaf: WorkspaceLeaf | undefined,
  ): void {
    if (file instanceof TFolder) {
      menu.addItem((item) =>
        item
          .setTitle("Create book from these notes")
          .setIcon("book")
          .onClick(() => {
            void this.bookFrom(file);
          }),
      );
      return;
    }
    if (!(file instanceof TFile)) return;
    if (!isBook(this.notes(), file)) {
      this.offerAdding(menu, file);
      return;
    }
    const shown = leaf ?? this.app.workspace.getLeaf(false);
    // The way back is offered by the leaf this note is already open in
    // as markdown; every other leaf is offered the way out.
    const asBook =
      shown.view instanceof MarkdownView && shown.view.file?.path === file.path;
    menu.addItem((item) =>
      item
        .setTitle(asBook ? "Open as book" : "Open as markdown")
        .setIcon(asBook ? "book" : "file-text")
        .onClick(() => {
          void (asBook
            ? this.openAsBook(shown, file)
            : this.openAsMarkdown(shown, file));
        }),
    );
  }

  /** `Add to book`, which asks which book when the vault has several. */
  private offerAdding(menu: Menu, note: TFile): void {
    const shelf = books(this.notes());
    if (shelf.length === 0 || note.extension !== "md") return;
    menu.addItem((item) =>
      item
        .setTitle("Add to book")
        .setIcon("book-plus")
        .onClick(() => {
          const one = shelf[0];
          if (shelf.length === 1 && one !== undefined) {
            void this.edits.addNote(one.path, note);
            return;
          }
          pick(this.app, {
            items: shelf,
            label: (book) => book.basename,
            placeholder: `Add ${note.basename} to which book`,
            chose: (book) => {
              void this.edits.addNote(book.path, note);
            },
          });
        }),
    );
  }

  /** An empty book, made and opened. */
  private async newBook(): Promise<void> {
    await this.opening(await emptyBook(this.app));
  }

  /** The book a folder of notes becomes, made and opened. */
  private async bookFrom(folder: TFolder): Promise<void> {
    await this.opening(await bookFromFolder(this.app, folder));
  }

  private async opening(book: TFile): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(book);
  }

  /** The navigator, revealed in the sidebar it lives in. */
  private async show(): Promise<void> {
    await this.app.workspace.ensureSideLeaf(NAVIGATOR_VIEW, "left", {
      reveal: true,
    });
  }

  private async openAsMarkdown(
    leaf: WorkspaceLeaf,
    file: TFile | null,
  ): Promise<void> {
    if (file === null) return;
    this.asMarkdown.set(leaf, file.path);
    await leaf.setViewState({
      type: MARKDOWN_VIEW,
      state: { file: file.path, mode: "source" },
      active: true,
    });
    this.swap();
  }

  private async openAsBook(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    this.asMarkdown.delete(leaf);
    await leaf.setViewState({
      type: BOOK_VIEW,
      state: { file: file.path },
      active: true,
    });
  }

  private async open(): Promise<Session> {
    try {
      const handle = await startEngine(
        await readModule(this.files(), this.directory()),
      );
      // Obsidian does not await `onload`, so an unload can land while
      // the module is still being read.
      if (this.unloaded) handle.stop();
      else this.engine = handle;
      return new Session(handle.client, documentFaces(document));
    } catch (cause) {
      new Notice(
        cause instanceof EngineError
          ? `Orca: ${cause.message}`
          : "Orca: the engine did not start",
      );
      throw cause;
    }
  }

  private async reveal(): Promise<void> {
    const { workspace } = this.app;
    const open: WorkspaceLeaf | undefined =
      workspace.getLeavesOfType(PREVIEW_VIEW)[0];
    const leaf = open ?? workspace.getLeaf(true);
    if (open === undefined) {
      await leaf.setViewState({ type: PREVIEW_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  private files(): VaultFiles {
    const adapter = this.app.vault.adapter;
    return { readBinary: (path) => adapter.readBinary(normalizePath(path)) };
  }

  private directory(): string {
    const dir = this.manifest.dir;
    if (dir === undefined) {
      throw new EngineError("the plugin has no install directory");
    }
    return dir;
  }
}
