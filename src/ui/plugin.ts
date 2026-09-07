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
import {
  documentFaces,
  serialized,
  type EngineClient,
} from "@/engine/session";
import { BOOK_VIEW, BookView } from "@/ui/book";
import { books, isBook, type NoteIndex } from "@/ui/books";
import { Edits } from "@/ui/edits";
import { bookFromFolder, emptyBook } from "@/ui/make";
import { membership, type Member } from "@/ui/member";
import { NAVIGATOR_VIEW, NavigatorView } from "@/ui/navigator";
import { cacheLinks, noteIndex } from "@/ui/notes";
import { pick } from "@/ui/pick";
import {
  PREVIEW_VIEW,
  PreviewView,
  type PreviewState,
} from "@/ui/preview";
import { Setter, type Setting } from "@/ui/setter";
import type { Opened } from "@/ui/shelf";

/** The view a book note is handed back to. */
const MARKDOWN_VIEW = "markdown";

/** The signature of `setViewState`, which orca wraps to answer first. */
type SetViewState = (
  this: WorkspaceLeaf,
  state: ViewState,
  ...rest: unknown[]
) => Promise<void>;

/** The place a leaf left the manuscript, so a toggle back lands on it. */
interface Held {
  at: string;
  state: unknown;
}

/**
 * The plugin entry point. It owns the engine, and every view borrows
 * the same session.
 */
export default class OrcaPlugin extends Plugin {
  private engine: EngineHandle | undefined;
  /** Every edit to a book, routed to the note's one writer. */
  private readonly edits = new Edits(this.app, (path) => this.opened(path));
  /** Sets a book on the engine. Every preview reads the pages it lays out. */
  private setter: Setter | undefined;
  /** Every note the vault's books read, which is what carries the toggle. */
  private members = new Map<string, Member>();
  private indexing: number | undefined;
  private unloaded = false;
  /** The status bar item the folio being read is written into. */
  private folio: HTMLElement | undefined;
  /** The leaves an author has asked to keep in markdown, and for which note. */
  private readonly asMarkdown = new WeakMap<WorkspaceLeaf, string>();
  /** The place each leaf left the manuscript it toggled away from. */
  private readonly manuscript = new WeakMap<WorkspaceLeaf, Held>();
  /** The icon on each note that belongs to a book, and where it leads. */
  private readonly back = new WeakMap<
    MarkdownView,
    { at: string; icon: HTMLElement }
  >();

  override async onload(): Promise<void> {
    // The engine is started before anything is registered, so the views
    // Obsidian restores at startup all wait on the one module.
    const opening = this.open();
    const setter = new Setter(this.setting(opening));
    this.setter = setter;

    this.registerView(
      PREVIEW_VIEW,
      (leaf) =>
        new PreviewView(
          leaf,
          setter,
          {
            asMarkdown: (view, note) => {
              void this.openAsMarkdown(view.leaf, note);
            },
            follows: (view, note) => {
              void this.follows(view, note);
            },
          },
          (text) => {
            this.reading(leaf, text);
          },
        ),
    );
    this.registerView(
      BOOK_VIEW,
      (leaf) =>
        new BookView(leaf, this.edits, opening, {
          asMarkdown: (view) => {
            if (view.file !== null) {
              this.asMarkdown.set(view.leaf, view.file.path);
              void this.openAsMarkdown(view.leaf, view.file.path);
            }
          },
          locate: (book, at) => {
            void this.locate(book, at);
          },
        }),
    );
    this.registerView(
      NAVIGATOR_VIEW,
      (leaf) => new NavigatorView(leaf, this.edits),
    );
    this.catchOpening();
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
      id: "preview-to-the-right",
      name: "Open preview to the right",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        const member =
          file === null || file === undefined
            ? undefined
            : this.members.get(file.path);
        if (member === undefined || file === null || file === undefined) {
          return false;
        }
        if (!checking) void this.splitPreview(file, member);
        return true;
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
      this.index();
      void this.app.workspace.ensureSideLeaf(NAVIGATOR_VIEW, "left", {
        reveal: false,
      });
    });
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.swap();
      }),
    );
    // A writer moving between panes has opened no file, so the linked
    // book follows the leaf rather than the note.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const view = leaf?.view;
        if (view instanceof MarkdownView && view.file !== null) {
          this.turned(view.file);
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.swap();
        if (file === null) return;
        // A book nobody can reorder is what a collapsed sidebar would
        // otherwise mean.
        if (isBook(this.notes(), file)) void this.show();
        this.turned(file);
      }),
    );
    this.watchBooks();
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
        this.offer(menu, file, leaf);
      }),
    );

    await opening;
  }

  /**
   * Wraps `setViewState` so a book note goes straight to the book view,
   * before the editor is ever mounted. The explorer, the switcher, a
   * link and the navigator all reach a leaf through `setViewState`, and
   * a swap made after the fact is a frame of raw markdown the author
   * sees.
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
    if (this.indexing !== undefined) window.clearTimeout(this.indexing);
    this.indexing = undefined;
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW)) {
      if (leaf.view instanceof MarkdownView) this.release(leaf.view);
    }
    this.engine?.stop();
    this.engine = undefined;
  }

  /**
   * Writes the folio being read into the window's status bar, and takes
   * the item down with the leaf that was reading.
   */
  private reading(from: WorkspaceLeaf, text: string | undefined): void {
    if (text === undefined) {
      // The bar is the window's, not the leaf's, so a split that leaves
      // another preview reading keeps it.
      const reading = this.app.workspace
        .getLeavesOfType(PREVIEW_VIEW)
        .some((leaf) => leaf !== from);
      if (reading) return;
      this.folio?.remove();
      this.folio = undefined;
      return;
    }
    this.folio ??= this.addStatusBarItem();
    this.folio.dataset["testid"] = "orca-status";
    this.folio.setText(text);
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
   * Reads every book note again, so the toggle knows which notes belong
   * to a book. One read answers however many events arrived.
   */
  private index(): void {
    if (this.indexing !== undefined) return;
    this.indexing = window.setTimeout(() => {
      this.indexing = undefined;
      void this.reindex();
    }, 0);
  }

  private async reindex(): Promise<void> {
    const index = this.notes();
    const shelf: Opened[] = [];
    for (const note of books(index)) {
      // One note orca cannot read leaves the rest of the shelf standing.
      const model = await this.edits.model(note.path).catch(() => undefined);
      if (model === undefined) continue;
      shelf.push({ path: note.path, name: note.basename, model });
    }
    if (this.unloaded) return;
    this.members = membership(shelf, cacheLinks(this.app));
    this.swap();
  }

  /**
   * Watches the vault for what changes membership, and for what leaves
   * a book on the engine older than the notes it was set from.
   */
  private watchBooks(): void {
    const { vault, metadataCache } = this.app;
    const changed = (path: string): void => {
      const book = this.members.get(path)?.book;
      this.setter?.forget(book ?? path);
      this.index();
    };
    this.registerEvent(
      vault.on("modify", (file) => {
        changed(file.path);
      }),
    );
    this.registerEvent(
      vault.on("create", (file) => {
        changed(file.path);
      }),
    );
    this.registerEvent(
      vault.on("delete", (file) => {
        changed(file.path);
      }),
    );
    this.registerEvent(
      vault.on("rename", (file, was) => {
        changed(was);
        changed(file.path);
      }),
    );
    // A note that gains or loses the key is a book more or fewer, and
    // Obsidian has already parsed the frontmatter by the time this
    // arrives.
    this.registerEvent(
      metadataCache.on("changed", () => {
        this.index();
      }),
    );
  }

  /**
   * Swaps every leaf showing a book note as markdown to orca's view,
   * and puts the way to the book on every note that belongs to one. A
   * leaf the author has asked for markdown keeps the manuscript and
   * gets the icon back to the book, until it shows another note.
   */
  private swap(): void {
    const index = this.notes();
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW)) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const file = view.file;
      if (file === null) {
        this.release(view);
        continue;
      }
      if (isBook(index, file)) {
        if (this.asMarkdown.get(leaf) === file.path) {
          this.attach(view, `book:${file.path}`, () => {
            void this.openAsBook(leaf, file);
          });
          continue;
        }
        this.release(view);
        void leaf.setViewState({ type: BOOK_VIEW, state: { file: file.path } });
        continue;
      }
      const member = this.members.get(file.path);
      if (member === undefined) {
        this.release(view);
        continue;
      }
      this.attach(view, `page:${file.path}`, () => {
        void this.openAsPreview(leaf, file, member);
      });
    }
  }

  /**
   * Adds the "open as book" icon to the markdown view's header, beside
   * Obsidian's own reading toggle. `addAction` is the API for adding an
   * icon to a view orca does not own.
   */
  private attach(view: MarkdownView, at: string, opens: () => void): void {
    const existing = this.back.get(view);
    if (existing?.at === at) return;
    existing?.icon.remove();
    const icon = view.addAction("book", "Open as book", opens);
    this.back.set(view, { at, icon });
  }

  private release(view: MarkdownView): void {
    const existing = this.back.get(view);
    if (existing === undefined) return;
    existing.icon.remove();
    this.back.delete(view);
  }

  /**
   * Adds orca's items to a file's context menu: a folder becomes a
   * book, a note joins one, and a book note opens as markdown or back
   * as a book.
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
          if (asBook) {
            void this.openAsBook(shown, file);
            return;
          }
          this.asMarkdown.set(shown, file.path);
          void this.openAsMarkdown(shown, file.path);
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

  /** Creates an empty book and opens it. */
  private async newBook(): Promise<void> {
    await this.opening(await emptyBook(this.app));
  }

  /** Creates a book from a folder of notes and opens it. */
  private async bookFrom(folder: TFolder): Promise<void> {
    await this.opening(await bookFromFolder(this.app, folder));
  }

  private async opening(book: TFile): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(book);
  }

  /** Reveals the navigator in its sidebar. */
  private async show(): Promise<WorkspaceLeaf> {
    return this.app.workspace.ensureSideLeaf(NAVIGATOR_VIEW, "left", {
      reveal: true,
    });
  }

  /** Reveals the navigator and focuses one entry of a book in it. */
  private async locate(book: string, at: number): Promise<void> {
    const leaf = await this.show();
    // A leaf Obsidian restored in the background is deferred until
    // something asks for it, and the view underneath is not this one
    // until it has.
    await leaf.loadIfDeferred();
    if (leaf.view instanceof NavigatorView) leaf.view.focus(book, at);
  }

  /**
   * Hands a leaf back to the editor, at the place in the manuscript it
   * was left. Nothing else puts a writer back where they were: the
   * ephemeral state is the leaf's, and the swap makes a new view.
   */
  private async openAsMarkdown(
    leaf: WorkspaceLeaf,
    path: string,
  ): Promise<void> {
    await leaf.setViewState({
      type: MARKDOWN_VIEW,
      state: { file: path, mode: "source" },
      active: true,
    });
    const held = this.manuscript.get(leaf);
    if (held?.at === path) leaf.setEphemeralState(held.state);
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

  /**
   * Swaps a manuscript for the book it belongs to, turned to this
   * chapter's first page. Where the writer was in the note is kept, so
   * the toggle back lands on the same line.
   */
  private async openAsPreview(
    leaf: WorkspaceLeaf,
    file: TFile,
    member: Member,
  ): Promise<void> {
    this.manuscript.set(leaf, {
      at: file.path,
      state: leaf.getEphemeralState(),
    });
    await leaf.setViewState({
      type: PREVIEW_VIEW,
      state: { book: member.book, note: file.path } satisfies PreviewState,
      active: true,
    });
  }

  /**
   * Splits the pane and ties the two: the manuscript where it was, the
   * book beside it. Moving through one moves the other, chapter by
   * chapter, which is as fine as a page-through can be.
   */
  private async splitPreview(file: TFile, member: Member): Promise<void> {
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({
      type: PREVIEW_VIEW,
      state: {
        book: member.book,
        note: file.path,
        linked: true,
      } satisfies PreviewState,
      active: false,
    });
  }

  /** Turns every linked preview of this note's book to the chapter it is. */
  private turned(file: TFile): void {
    const member = this.members.get(file.path);
    if (member === undefined) return;
    for (const leaf of this.app.workspace.getLeavesOfType(PREVIEW_VIEW)) {
      const view = leaf.view;
      if (!(view instanceof PreviewView)) continue;
      if (view.linked && view.book === member.book) view.turnTo(file.path);
    }
  }

  /**
   * Turns the manuscript tied to a preview to the note its pages read
   * as. The pane is the one already reading that book, which is what a
   * split left beside it.
   */
  private async follows(view: PreviewView, note: string): Promise<void> {
    const book = view.book;
    const file = this.app.vault.getFileByPath(note);
    if (book === undefined || file === null) return;
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW)) {
      const shown = leaf.view;
      if (!(shown instanceof MarkdownView) || shown.file === null) continue;
      if (shown.file.path === note) return;
      if (this.members.get(shown.file.path)?.book !== book) continue;
      await leaf.openFile(file, { active: false });
      return;
    }
  }

  private async open(): Promise<EngineClient> {
    try {
      const handle = await startEngine(
        await readModule(this.files(), this.directory()),
      );
      // Obsidian does not await `onload`, so an unload can land while
      // the module is still being read.
      if (this.unloaded) handle.stop();
      else this.engine = handle;
      // Every view that renders shares this client, so its renders are
      // serialized: the engine holds one document, and two in flight at
      // once would race it.
      return serialized(handle.client);
    } catch (cause) {
      new Notice(
        cause instanceof EngineError
          ? `Orca: ${cause.message}`
          : "Orca: the engine did not start",
      );
      throw cause;
    }
  }

  /** The vault and the engine, as the setter reaches them. */
  private setting(client: Promise<EngineClient>): Setting {
    return {
      model: (path) => this.edits.model(path),
      read: (path) => {
        const note = this.app.vault.getFileByPath(path);
        return note === null
          ? Promise.reject(new Error(`${path} is gone`))
          : this.app.vault.cachedRead(note);
      },
      name: (path) => this.app.vault.getFileByPath(path)?.basename ?? path,
      links: cacheLinks(this.app),
      client,
      faces: documentFaces(document),
    };
  }

  /** Opens the book the workspace is on, and reveals one already open. */
  private async reveal(): Promise<void> {
    const { workspace } = this.app;
    const open: WorkspaceLeaf | undefined =
      workspace.getLeavesOfType(PREVIEW_VIEW)[0];
    if (open !== undefined) {
      await workspace.revealLeaf(open);
      return;
    }
    const on = this.onBook();
    if (on !== undefined) {
      await this.openPreview(on);
      return;
    }
    const shelf = books(this.notes());
    const one = shelf[0];
    if (one === undefined) {
      new Notice("Orca: this vault has no book yet");
      return;
    }
    if (shelf.length === 1) {
      await this.openPreview({ book: one.path });
      return;
    }
    pick(this.app, {
      items: shelf,
      label: (book) => book.basename,
      placeholder: "Open which book",
      chose: (book) => {
        void this.openPreview({ book: book.path });
      },
    });
  }

  /** The book the workspace is on, whether by one of its notes or its own. */
  private onBook(): PreviewState | undefined {
    const active = this.app.workspace.getActiveFile();
    if (active === null) return undefined;
    if (isBook(this.notes(), active)) return { book: active.path };
    const member = this.members.get(active.path);
    return member === undefined
      ? undefined
      : { book: member.book, note: active.path };
  }

  private async openPreview(state: PreviewState): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: PREVIEW_VIEW, state: { ...state }, active: true });
    await this.app.workspace.revealLeaf(leaf);
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
