import { ViewPlugin } from "@codemirror/view";
import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  editorInfoField,
  normalizePath,
  type Menu,
  type TAbstractFile,
  type ViewState,
} from "obsidian";
import type { FontIndex } from "@/assets/fonts";
import type { VaultAdapter } from "@/assets/vault";
import { startEngine } from "@/engine/bootstrap";
import { EngineError } from "@/engine/errors";
import { readModule } from "@/engine/module";
import { Pool, type Engine } from "@/engine/pool";
import { documentFaces, serialized } from "@/engine/session";
import { BOOK_VIEW, BookView } from "@/ui/book";
import { books, isBook, type NoteIndex } from "@/ui/books";
import { Edits } from "@/ui/edits";
import { bookFromFolder, emptyBook } from "@/ui/make";
import type { Face } from "@/book/plan";
import { byteOf, offsetOf, writtenAt } from "@/book/place";
import { membership, type Member } from "@/ui/member";
import {
  documentPreviews,
  familyFaces,
  fontPlaces,
  previewFaces,
  readFontIndex,
  type FontPlaces,
} from "@/ui/fonts";
import { LIMITS, readLimits, type Limits } from "@/ui/limits";
import { NAVIGATOR_VIEW, NavigatorView } from "@/ui/navigator";
import { PANEL_VIEW, DesignPanelView, type Designing } from "@/ui/panel";
import { cacheLinks, noteIndex } from "@/ui/notes";
import { pick } from "@/ui/pick";
import {
  PREVIEW_VIEW,
  PreviewView,
  type PreviewState,
} from "@/ui/preview";
import { OrcaSettingTab, type Limited } from "@/ui/settings";
import { Composer, type Composing, type Typeset } from "@/ui/composer";
import type { Opened } from "@/ui/shelf";

/** The view a book note is handed back to. */
const MARKDOWN_VIEW = "markdown";

/** The signature of `setViewState`, which orca wraps to answer first. */
type SetViewState = (
  this: WorkspaceLeaf,
  state: ViewState,
  ...rest: unknown[]
) => Promise<void>;

/** The place a leaf left each side of the toggle, so a swap back lands on it. */
interface Place {
  at: string;
  state: unknown;
  /** The line at the top of the pane, counting from 0. */
  line?: number | undefined;
  /** The page the book was left turned to, counting from 1. */
  folio?: number | undefined;
}

/**
 * The plugin entry point. It owns the engines, one per book, and every
 * view of a book borrows the same session.
 */
export default class OrcaPlugin extends Plugin implements Limited {
  /** The settings orca saves beside the plugin. */
  limits: Limits = { ...LIMITS };
  /** The engines orca runs, one per book. */
  private engines: Pool | undefined;
  /** The engine module, read once and kept for every worker. */
  private bytes: Promise<ArrayBuffer> | undefined;
  /** Every edit to a book, routed to the note's one writer. */
  private readonly edits = new Edits(this.app, (path) => this.opened(path));
  /** Sets a book on the engine. Every preview reads the pages it typesets. */
  private composer: Composer | undefined;
  /** The families the machine has, read once and held for the session. */
  private families: Promise<FontIndex> | undefined;
  /** The directories and adapters the index is read through. */
  private fonts: FontPlaces | undefined;
  /** Every note the vault's books read, which is what carries the toggle. */
  private members = new Map<string, Member>();
  private indexing: number | undefined;
  private unloaded = false;
  /** The status bar item the folio being read is written into. */
  private folio: HTMLElement | undefined;
  /** The leaves an author has asked to keep in markdown, and for which note. */
  private readonly asMarkdown = new WeakMap<WorkspaceLeaf, string>();
  /** The place each leaf left the manuscript it toggled away from. */
  private readonly manuscript = new WeakMap<WorkspaceLeaf, Place>();
  /** The icon on each note that belongs to a book, and where it leads. */
  private readonly back = new WeakMap<
    MarkdownView,
    { at: string; icon: HTMLElement }
  >();

  override async onload(): Promise<void> {
    // Orca reads the settings and the module while the views register,
    // because Obsidian restores a leaf as soon as `onload` returns.
    const settings = this.saved();
    const warmed = this.warmed();
    const engines = new Pool({
      start: () => this.startWorker(),
      // Orca drops the book on a stopped engine, so the pane sets the
      // book again rather than reads a session that is gone. A book
      // whose engine died is set again now, on the page it was on.
      gone: (book, why) => {
        if (why === "died") this.composer?.died(book);
        else this.composer?.discard(book);
      },
      ceiling: this.limits.books,
    });
    this.engines = engines;
    const composer = new Composer(this.composing(engines));
    this.composer = composer;
    this.addSettingTab(new OrcaSettingTab(this.app, this));

    this.registerView(
      PREVIEW_VIEW,
      (leaf) =>
        new PreviewView(
          leaf,
          composer,
          {
            asMarkdown: (view, note) => {
              void this.openAsMarkdown(view.leaf, note);
            },
            follows: (view, note, at) => {
              void this.follows(view, note, at);
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
        new BookView(leaf, this.edits, engines, {
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
    this.registerView(
      PANEL_VIEW,
      (leaf) => new DesignPanelView(leaf, this.designing()),
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
      id: "open-design",
      name: "Open the design panel",
      callback: () => {
        void this.openPanel();
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
      id: "manuscript-to-the-left",
      name: "Open manuscript to the left",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(PreviewView);
        const note = view?.note;
        if (view === null || view === undefined || note === undefined) {
          return false;
        }
        if (!checking) void this.splitManuscript(view, note);
        return true;
      },
    });
    this.addCommand({
      id: "next-chapter",
      name: "Next chapter",
      checkCallback: (checking) => this.turnsChapter(checking, 1),
    });
    this.addCommand({
      id: "previous-chapter",
      name: "Previous chapter",
      checkCallback: (checking) => this.turnsChapter(checking, -1),
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
      // The panel is a tab in the sidebar rather than a leaf a command
      // makes, so it can be opened without the command. It reads the
      // machine's faces only once it has a book, so a startup with no
      // book open scans nothing.
      void this.app.workspace.ensureSideLeaf(PANEL_VIEW, "right", {
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
    // Obsidian raises no event for a pane that scrolled, so the link
    // reads the editor's own scroller.
    this.registerEditorExtension(
      ViewPlugin.define((editor) => {
        const scrolled = (): void => {
          const path = editor.state.field(editorInfoField, false)?.file?.path;
          if (path !== undefined) this.scrolled(path);
        };
        editor.scrollDOM.addEventListener("scroll", scrolled, {
          passive: true,
        });
        return {
          destroy: () => {
            editor.scrollDOM.removeEventListener("scroll", scrolled);
          },
        };
      }),
    );
    this.watchBooks();
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
        this.offer(menu, file, leaf);
      }),
    );

    await Promise.all([settings, warmed]);
  }

  /**
   * Wraps `setViewState` so a book note goes straight to the book view,
   * before the editor is ever mounted. The explorer, the switcher, a
   * link and the navigator all reach a leaf through `setViewState`, and
   * a swap made after the fact is a frame of raw markdown the author
   * sees.
   */
  private catchOpening(): void {
    const original = WorkspaceLeaf.prototype.setViewState as SetViewState;
    const plugin = this;
    const caught: SetViewState = function (state, ...rest) {
      return original.call(this, plugin.asBook(this, state), ...rest);
    };
    WorkspaceLeaf.prototype.setViewState = caught;
    this.register(() => {
      // Another plugin may have wrapped this one since. Its wrapper
      // stays, because taking it off would take that plugin with it.
      if (WorkspaceLeaf.prototype.setViewState === caught) {
        WorkspaceLeaf.prototype.setViewState = original;
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
    this.engines?.close();
    this.engines = undefined;
  }

  /**
   * Turns the preview being read a chapter along. The command goes grey
   * at either end of the book, and where no preview is open.
   */
  private turnsChapter(checking: boolean, step: number): boolean {
    const view = this.app.workspace.getActiveViewOfType(PreviewView);
    if (view === null) return false;
    const to = view.chapterBy(step);
    if (to === undefined) return false;
    if (!checking) view.turnToChapter(to);
    return true;
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
    const { vault, metadataCache, workspace } = this.app;
    const changed = (path: string): void => {
      const book = this.members.get(path)?.book;
      this.composer?.forget(book ?? path);
      this.index();
    };
    // Every keystroke, which the loop in front of the engine coalesces
    // into one render.
    this.registerEvent(
      workspace.on("editor-change", (editor, info) => {
        const path = info.file?.path;
        if (path === undefined) return;
        const member = this.members.get(path);
        if (member === undefined) return;
        this.composer?.retype(member.book, path, editor.getValue());
      }),
    );
    this.registerEvent(
      vault.on("modify", (file) => {
        const member = this.members.get(file.path);
        // A chapter's words are an edit to a book already on the engine,
        // not a reason to set it again from nothing. A writer's own
        // keystrokes are on the engine already; this is how a change
        // from outside Obsidian gets there.
        if (member === undefined || !(file instanceof TFile)) {
          changed(file.path);
        } else this.retype(member.book, file);
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

  /** Sends a chapter as it now is on disk to the book that reads it. */
  private retype(book: string, note: TFile): void {
    void this.app.vault
      .cachedRead(note)
      .then((text) => {
        this.composer?.retype(book, note.path, text);
      })
      .catch(() => undefined);
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
      this.offerSplitting(menu, file);
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

  /** `Open preview to the right`, for a note that belongs to a book. */
  private offerSplitting(menu: Menu, note: TFile): void {
    const member = this.members.get(note.path);
    if (member === undefined) return;
    menu.addItem((item) =>
      item
        .setTitle("Open preview to the right")
        .setIcon("book")
        .onClick(() => {
          void this.splitPreview(note, member);
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
    const from = leaf.view;
    const left = this.manuscript.get(leaf);
    const folio = from instanceof PreviewView ? from.turned : undefined;
    // The page being read is asked for while the pane still holds it,
    // because the swap takes the view down with it.
    const opens =
      from instanceof PreviewView && from.paged
        ? await from.opensIn().catch(() => undefined)
        : undefined;
    await leaf.setViewState({
      type: MARKDOWN_VIEW,
      state: { file: path, mode: "source" },
      active: true,
    });
    // A reader who paged through the book comes back to the line the
    // page they stopped on opens at. One who only looked comes back to
    // the line they were writing on.
    const shown = leaf.view;
    if (opens?.note === path) {
      this.leadsTo(leaf, opens.at, true);
    } else if (left?.at === path) {
      leaf.setEphemeralState(left.state);
      // The caret is put back centred, which is a different line at the
      // top of the pane, and the top line is what the book reads.
      if (left.line !== undefined && shown instanceof MarkdownView) {
        shown.currentMode.applyScroll(left.line);
      }
    }
    this.manuscript.set(leaf, {
      at: path,
      state: leaf.getEphemeralState(),
      line: shown instanceof MarkdownView ? scrolledLine(shown) : undefined,
      folio,
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
    const view = leaf.view;
    const at = view instanceof MarkdownView ? scrolledTo(view) : undefined;
    const left = this.manuscript.get(leaf);
    // The book decides whether that page still stands: it is the side
    // that knows whether the pane is scrolled inside it.
    const folio = left?.at === file.path ? left.folio : undefined;
    this.manuscript.set(leaf, {
      at: file.path,
      state: leaf.getEphemeralState(),
      line: view instanceof MarkdownView ? scrolledLine(view) : undefined,
      folio,
    });
    await leaf.setViewState({
      type: PREVIEW_VIEW,
      state: {
        book: member.book,
        note: file.path,
        folio,
        at,
      } satisfies PreviewState,
      active: true,
    });
  }

  /**
   * Splits the pane and ties the two: the manuscript where it was, the
   * book beside it. Moving through one moves the other, chapter by
   * chapter, which is as fine as a page-through can be.
   */
  private async splitPreview(file: TFile, member: Member): Promise<void> {
    const beside = this.manuscriptOn(file.path) ?? (await this.openedIn(file));
    const leaf = this.app.workspace.createLeafBySplit(beside, "vertical");
    const from = beside.view;
    await leaf.setViewState({
      type: PREVIEW_VIEW,
      state: {
        book: member.book,
        note: file.path,
        linked: true,
        at: from instanceof MarkdownView ? scrolledTo(from) : undefined,
      } satisfies PreviewState,
      active: false,
    });
  }

  /**
   * Splits the other way: the book where it is, the manuscript beside
   * it on the left, which is the arrangement a split from the
   * manuscript leaves.
   */
  private async splitManuscript(
    view: PreviewView,
    note: string,
  ): Promise<void> {
    const file = this.app.vault.getFileByPath(note);
    if (file === null) return;
    view.link();
    const leaf = this.app.workspace.createLeafBySplit(
      view.leaf,
      "vertical",
      true,
    );
    await leaf.openFile(file);
  }

  /** The pane a note is open in as markdown, if one is. */
  private manuscriptOn(path: string): WorkspaceLeaf | undefined {
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW)) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) return leaf;
    }
    return undefined;
  }

  /** Opens a note in the active pane, and answers the pane it landed in. */
  private async openedIn(file: TFile): Promise<WorkspaceLeaf> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    return leaf;
  }

  /** Turns every linked preview to the page this note is scrolled to. */
  private turned(file: TFile): void {
    this.follow(file.path, this.readAt(file.path));
  }

  /**
   * A pane that scrolled, which every linked preview of that note's
   * book follows. A scroll the book itself asked for turns nothing: the
   * page it led to is the page that node is set on, and a pane already
   * showing it has nowhere to turn.
   */
  private scrolled(path: string): void {
    this.follow(path, this.readAt(path));
  }

  /**
   * Turns every linked preview of this note's book to the page the
   * pane is scrolled to. A note no book lists turns none of them.
   */
  private follow(path: string, byte: number | undefined): void {
    const member = this.members.get(path);
    if (member === undefined) return;
    for (const leaf of this.app.workspace.getLeavesOfType(PREVIEW_VIEW)) {
      const view = leaf.view;
      if (!(view instanceof PreviewView)) continue;
      if (view.linked && view.book === member.book) {
        void view.turnTo(path, byte);
      }
    }
  }

  /** The byte of a note the pane showing it is scrolled to. */
  private readAt(path: string): number | undefined {
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW)) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) {
        return scrolledTo(view);
      }
    }
    return undefined;
  }

  /**
   * Turns the manuscript tied to a preview to the line a page opens at,
   * `at` bytes into the note. The pane is the one already reading that
   * book, which is what a split left beside it.
   */
  private async follows(
    view: PreviewView,
    note: string,
    at: number,
  ): Promise<void> {
    const book = view.book;
    const file = this.app.vault.getFileByPath(note);
    if (book === undefined || file === null) return;
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW)) {
      const shown = leaf.view;
      if (!(shown instanceof MarkdownView) || shown.file === null) continue;
      const path = shown.file.path;
      if (path !== note && this.members.get(path)?.book !== book) continue;
      if (path !== note) await leaf.openFile(file, { active: false });
      this.leadsTo(leaf, at, false);
      return;
    }
  }

  /**
   * Puts the line `at` bytes into a note at the top of a manuscript
   * pane, and the caret on it for a pane being handed back to write in.
   */
  private leadsTo(leaf: WorkspaceLeaf, at: number, caret: boolean): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const { editor } = view;
    const pos = editor.offsetToPos(offsetOf(editor.getValue(), at));
    if (caret) editor.setCursor(pos);
    view.currentMode.applyScroll(pos.line);
    // Read back rather than assumed: a scroll near the end of a note
    // stops where the note stops.
    view.currentMode.applyScroll(pos.line);
  }

  /**
   * Starts one worker with the engine module in it. Each worker gets a
   * copy of the module, because the start transfers the bytes into the
   * worker.
   */
  private async startWorker(): Promise<Engine> {
    try {
      const module = await this.module();
      const handle = await startEngine(module.slice(0));
      // Every view of one book shares its client, so orca runs the
      // renders of the book one at a time. The engine holds one
      // document, and two renders at once race it.
      return {
        client: serialized(handle.client),
        dies: handle.dies,
        stop: handle.stop,
      };
    } catch (cause) {
      this.notice(cause);
      throw cause;
    }
  }

  /** Reads the settings, and applies the ceiling in them. */
  private async saved(): Promise<void> {
    this.limits = readLimits(await this.loadData());
    if (this.engines !== undefined) this.engines.ceiling = this.limits.books;
  }

  /** Reads the engine module at load, and reports an install without one. */
  private async warmed(): Promise<void> {
    try {
      await this.module();
    } catch (cause) {
      this.notice(cause);
    }
  }

  /**
   * Reads the engine module once, and gives the same bytes back after
   * that. Orca does not keep a read that fails.
   */
  private module(): Promise<ArrayBuffer> {
    this.bytes ??= readModule(this.files(), this.directory()).catch(
      (cause: unknown) => {
        this.bytes = undefined;
        throw cause;
      },
    );
    return this.bytes;
  }

  /** Shows the engine's own message to the author. */
  private notice(cause: unknown): void {
    new Notice(
      cause instanceof EngineError
        ? `Orca: ${cause.message}`
        : "Orca: the engine did not start",
    );
  }

  /** Saves the limits, and applies them to the engines that already run. */
  limit(limits: Limits): void {
    this.limits = limits;
    if (this.engines !== undefined) this.engines.ceiling = limits.books;
    void this.saveData(limits);
  }

  /** The vault and the engines, as the composer reaches them. */
  private composing(engines: Pool): Composing {
    return {
      model: (path) => this.edits.model(path),
      read: (path) => {
        const note = this.app.vault.getFileByPath(path);
        return note === null
          ? Promise.reject(new Error(`${path} is gone`))
          : this.app.vault.cachedRead(note);
      },
      name: (path) => this.app.vault.getFileByPath(path)?.basename ?? path,
      cuts: (family) => this.familyCuts(family),
      files: this.files(),
      links: cacheLinks(this.app),
      engines,
      faces: documentFaces(document),
    };
  }

  /**
   * Every cut of a family, by the name a design names it by. A book set
   * again on a new engine sends them, because a face is registered for
   * one session and that session is gone.
   */
  private async familyCuts(family: string): Promise<readonly Face[]> {
    const want = family.trim().toLowerCase();
    const { families } = await this.fontIndex();
    const found = families.find((known) => known.name.toLowerCase() === want);
    return found === undefined ? [] : familyFaces(this.places(), found);
  }

  /** The book being designed and the faces the machine has. */
  private designing(): Designing {
    return {
      book: () => this.designed(),
      index: () => this.fontIndex(),
      faces: (family) => familyFaces(this.places(), family),
      watch: (again) => {
        // The panel outlives the books it designs, so it follows the
        // workspace rather than any one of them. A leaf change is the
        // reader moving between books, and a layout change is a preview
        // arriving or going.
        const on = [
          this.app.workspace.on("active-leaf-change", again),
          this.app.workspace.on("layout-change", again),
        ];
        return () => {
          for (const ref of on) this.app.workspace.offref(ref);
        };
      },
    };
  }

  /**
   * The book the panel designs. It is the one the reader is in, or the
   * only one open when the panel itself has focus.
   *
   * The pane answers with the book it is reading, rather than the
   * composer answering by path. A note the book reads, written from
   * outside Obsidian, takes the book off the composer so the next open
   * sets it from the notes as they now are, and the pane goes on
   * reading the one it has. That book is the one on screen, and the one
   * a pick has to reach.
   */
  private async designed(): Promise<Typeset | undefined> {
    const { workspace } = this.app;
    // A pane in a background tab is deferred until something asks for
    // it, and until then its view is not the preview. Loading one would
    // typeset a book nobody is reading, so the panel passes over it and
    // designs a pane that is drawn.
    const drawn = workspace
      .getLeavesOfType(PREVIEW_VIEW)
      .map((leaf) => leaf.view)
      .filter((view): view is PreviewView => view instanceof PreviewView);
    const view =
      workspace.getActiveViewOfType(PreviewView) ??
      drawn.find((pane) => pane.typeset !== undefined) ??
      drawn[0];
    if (view === undefined) return undefined;
    const reading = view.typeset;
    if (reading !== undefined) return reading;
    // A pane still setting its book has none yet, so the run it is
    // waiting on is what the panel waits on too.
    const path = view.book;
    if (path === undefined || this.composer === undefined) return undefined;
    try {
      return await this.composer.opened(path);
    } catch {
      // The preview reports a book that will not set, not the panel.
      return undefined;
    }
  }

  /**
   * The families the machine has. The scan reads a header out of every
   * font file the platform installs, so it runs once and is held for
   * the session.
   */
  private fontIndex(): Promise<FontIndex> {
    this.families ??= this.scan().catch((cause: unknown) => {
      this.families = undefined;
      throw cause;
    });
    return this.families;
  }

  private async scan(): Promise<FontIndex> {
    const places = this.places();
    const index = await readFontIndex(places);
    await previewFaces(places, index, documentPreviews(document));
    return index;
  }

  private places(): FontPlaces {
    this.fonts ??= fontPlaces(this.files());
    return this.fonts;
  }

  /** Opens the design panel in the right sidebar, revealing one already there. */
  private async openPanel(): Promise<void> {
    const { workspace } = this.app;
    const open: WorkspaceLeaf | undefined =
      workspace.getLeavesOfType(PANEL_VIEW)[0];
    const leaf = open ?? workspace.getRightLeaf(false);
    if (leaf === null || leaf === undefined) return;
    if (open === undefined) {
      await leaf.setViewState({ type: PANEL_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
    // Revealing a sidebar leaf leaves the active leaf where it was, so
    // nothing the panel watches fires for it.
    if (leaf.view instanceof DesignPanelView) leaf.view.refresh();
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

  /** The vault, as the engine and the asset registry read it. */
  private files(): VaultAdapter {
    const { adapter } = this.app.vault;
    const at = (path: string): string => normalizePath(path);
    return {
      exists: (path) => adapter.exists(at(path)),
      read: (path) => adapter.read(at(path)),
      readBinary: (path) => adapter.readBinary(at(path)),
      list: (folder) => adapter.list(at(folder)),
    };
  }

  private directory(): string {
    const dir = this.manifest.dir;
    if (dir === undefined) {
      throw new EngineError("the plugin has no install directory");
    }
    return dir;
  }
}

/**
 * The line at the top of a manuscript pane, counting from 0. The scroll
 * is a fraction of a line, and the line it names is the first one whole
 * on screen, so it rounds rather than truncates.
 */
function scrolledLine(view: MarkdownView): number | undefined {
  const line = Math.round(view.currentMode.getScroll());
  return Number.isFinite(line) ? Math.max(line, 0) : undefined;
}

/** The byte of its note a manuscript pane is scrolled to. */
function scrolledTo(view: MarkdownView): number | undefined {
  const line = scrolledLine(view);
  if (line === undefined) return undefined;
  const { editor } = view;
  const text = editor.getValue();
  const at = { line: writtenAt(text, line), ch: 0 };
  return byteOf(text, editor.posToOffset(at));
}
