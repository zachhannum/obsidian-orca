import { ViewPlugin, type EditorView } from "@codemirror/view";
import {
  MarkdownView,
  Notice,
  addIcon,
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
import type { Family, FontIndex } from "@/assets/fonts";
import type { VaultAdapter } from "@/assets/vault";
import { browserHost, startEngine } from "@/engine/bootstrap";
import { EngineError } from "@/engine/errors";
import { readModule } from "@/engine/module";
import { Pool, engineName, type Engine } from "@/engine/pool";
import { documentFaces, serialized } from "@/engine/session";
import { BOOK_VIEW, BookView } from "@/ui/book";
import { books, isBook, type NoteIndex } from "@/ui/books";
import { Edits } from "@/ui/edits";
import { openExport } from "@/ui/export";
import { PREVIEW_ICON } from "@/ui/icon";
import { bookFromFolder, emptyBook } from "@/ui/make";
import { bookCss, withCss } from "@/book/css";
import { writeDesign, type Design, type FontUse } from "@/style/design";
import { offsetOf, shownOver, type Seen, type Shown } from "@/book/place";
import type { Place as Warned } from "@/style/origin";
import { membership, type Member } from "@/ui/member";
import { runExtensions, type Marking, type Settled } from "@/ui/marks";
import { readingProcessor } from "@/ui/reading";
import { candidates, drawn } from "@/ui/runs";
import {
  documentPreviews,
  fontPlaces,
  previewFaces,
  previewVariants,
  readFontIndex,
  resolveUse,
  type FontPlaces,
  type Previews,
  type ResolvedUse,
} from "@/ui/fonts";
import type { Pin } from "@/ui/inspect";
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

/** The ribbon's icon, registered under this name. */
const ORCA_ICON = "orca";

/**
 * The orca tail from `design/orca-tail.svg`, fitted to the 100 by 100
 * box `addIcon` draws in. The tail is a fill, and Obsidian's icon rules
 * stroke, so the style on the group wins over them.
 */
const ORCA_SVG =
  '<g style="fill: currentColor; stroke: none" transform="translate(0 21.27) scale(0.1105) translate(-60 -244)">' +
  '<path d="M797.14 322.264C701.904 337.045 656.024 322.264 585.814 381.386C515.604 440.507 530.898 491.5 530.898 727.247C531.632 759.024 538.347 759.169 542.02 759.024C560.789 758.285 565.172 711.922 688.909 618.805C812.645 525.688 830.955 523.281 884.3 473.658C958.279 404.84 961.195 286.052 954.243 267.577C947.292 249.101 892.375 307.484 797.14 322.264Z"/>' +
  '<path d="M227.611 322.264C322.847 337.045 368.727 322.264 438.937 381.386C509.147 440.507 493.853 491.5 493.853 727.247C493.119 759.024 486.404 759.169 482.731 759.024C463.962 758.285 459.579 711.922 335.842 618.805C212.106 525.688 193.796 523.281 140.452 473.658C66.4723 404.84 63.5559 286.052 70.5077 267.577C77.4594 249.101 132.376 307.484 227.611 322.264Z"/>' +
  "</g>";

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
  /** The preview faces registered with the document, each family once. */
  private previews: Previews | undefined;
  /** Every note the vault's books read, which is what carries the toggle. */
  private members = new Map<string, Member>();

  /** The editors waiting to be told a note's book is known, or set again. */
  private readonly redraw = new Set<() => void>();

  /** The marks each note was last settled with, by the text they count bytes in. */
  private readonly marked = new Map<string, Settled>();
  /**
   * The book notes orca is writing a design into. The engine has the
   * sheet already, so the write is not a reason to set the book again,
   * and the render the pick asked for is not dropped under it.
   */
  private readonly designWrites = new Set<string>();
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
      start: (book) => this.startWorker(book),
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
              // A leaf is let into the editor on a book note only once
              // the author has asked for markdown there.
              if (note === view.book) this.asMarkdown.set(view.leaf, note);
              void this.openAsMarkdown(view.leaf, note);
            },
            follows: (view, note, at) => {
              void this.follows(view, note, at);
            },
            opens: (view, route, place) => {
              void (route === "css" ? this.opensCss(place) : this.opensNote(view, place));
            },
            inspected: (_view, pin, refreshed) => {
              void this.inspected(pin, refreshed);
            },
            unit: () => this.limits.unit,
            view: () => this.limits.view,
            viewed: (view) => {
              this.limit({ ...this.limits, view });
            },
            exports: (book) => {
              this.exportBook(book);
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
        new BookView(leaf, this.edits, composer, {
          asMarkdown: (view) => {
            if (view.file !== null) {
              this.asMarkdown.set(view.leaf, view.file.path);
              void this.openAsMarkdown(view.leaf, view.file.path);
            }
          },
          locate: (book, at) => {
            void this.locate(book, at);
          },
          preview: (book) => {
            void this.previewBook(book);
          },
          unit: () => this.limits.unit,
          exports: (book) => {
            this.exportBook(book);
          },
        }),
    );
    this.registerView(
      NAVIGATOR_VIEW,
      (leaf) =>
        new NavigatorView(leaf, this.edits, {
          preview: (book) => {
            void this.previewBook(book);
          },
          turn: (book, at) => this.turnPreview(book, at),
        }),
    );
    this.registerView(
      PANEL_VIEW,
      (leaf) => new DesignPanelView(leaf, this.designing()),
    );
    this.catchOpening();
    addIcon(ORCA_ICON, ORCA_SVG);
    this.addRibbonIcon(ORCA_ICON, "Open Orca", () => {
      void this.show();
    });
    this.addCommand({
      id: "open-book",
      name: "Open a book",
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
      id: "inspect-page",
      name: "Inspect the page",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(PreviewView);
        if (view === null) return false;
        if (!checking) view.toggleInspect();
        return true;
      },
    });
    this.addCommand({
      id: "export-pdf",
      name: "Export to PDF",
      checkCallback: (checking) => {
        const book = this.exportable();
        if (book === undefined) return false;
        if (!checking) this.exportBook(book);
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
        // A preview opened here is a book the editors can draw from.
        this.nudge();
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
    // The marks fleuron reads and Obsidian draws as prose, in both of
    // the views a note is read in.
    const marking = this.marking();
    this.registerEditorExtension(runExtensions(marking));
    this.registerMarkdownPostProcessor((element, context) => {
      void readingProcessor(marking)(element, context);
    });
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
   * Turns the preview being read a chapter along. The command goes gray
   * at either end of the book, and where no preview is open.
   */
  /** The book the active view reads: a preview's, a book note's, or the book a note belongs to. */
  private exportable(): string | undefined {
    const { workspace } = this.app;
    const preview = workspace.getActiveViewOfType(PreviewView);
    if (preview !== null) return preview.book;
    const page = workspace.getActiveViewOfType(BookView);
    if (page !== null) return page.file?.path;
    const file = workspace.getActiveViewOfType(MarkdownView)?.file;
    return file === null || file === undefined ? undefined : this.members.get(file.path)?.book;
  }

  private exportBook(book: string): void {
    const composer = this.composer;
    if (composer === undefined) return;
    openExport(this.app, {
      composer,
      book,
      files: this.files(),
      metadata: async () => (await this.edits.model(book))?.book.metadata,
      openPanel: () => {
        void this.openPanel();
      },
    });
  }

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

  /**
   * Tells every open note to draw its marks again. Reading view has no
   * editor to tell, so its panes are drawn again instead.
   */
  private remark(): void {
    this.marked.clear();
    this.nudge();
    this.reread();
  }

  /**
   * Asks every open note for its marks again. A book set since the
   * last ask is a book the notes in it can be drawn from now.
   */
  private nudge(): void {
    for (const ask of [...this.redraw]) ask();
  }

  /**
   * Draws every note a reader has open again. A section already drawn
   * keeps what it was drawn with, so this is how a note whose book
   * changed under it takes the new marks.
   */
  private reread(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.getMode() === "preview") {
        view.previewMode.rerender(true);
      }
    }
  }

  /**
   * The marks of a book's notes, as the engine settles them. A note
   * the book has not crossed yet takes none, and the editor asks
   * again when the render that carries it lands.
   */
  private marking(): Marking {
    return {
      marksNow: (note, against) => {
        const held = this.marked.get(note);
        return held?.against === against ? held : undefined;
      },
      marksIn: async (note, against) => {
        const held = this.marked.get(note);
        if (held?.against === against) return held;
        const typeset = await this.setting(note);
        if (typeset?.textOf(note) !== against) return undefined;
        const asked = candidates(against);
        const answers = await Promise.all(
          asked.map(async (candidate) => {
            const node = await typeset.session.nodeAt(note, candidate.byte);
            if (node === undefined) return undefined;
            return typeset.session.sourceOf(node);
          }),
        );
        const settled: Settled = { against, marks: drawn(against, asked, answers) };
        this.marked.set(note, settled);
        return settled;
      },
      watch: (note, parsed) => {
        // A note opened before the vault has been read belongs to no
        // book yet, so the editor is told when it does.
        this.redraw.add(parsed);
        let drop: (() => void) | undefined;
        let dropped = false;
        void this.setting(note).then((typeset) => {
          if (dropped) return;
          drop = typeset?.watch(parsed);
        });
        return () => {
          dropped = true;
          this.redraw.delete(parsed);
          drop?.();
        };
      },
    };
  }

  /**
   * The book a note belongs to, as the engine already holds it. The
   * marks are read off a book that is set rather than setting one, so
   * opening a chapter costs the engine nothing.
   */
  private async setting(note: string): Promise<Typeset | undefined> {
    const member = this.members.get(note);
    if (member === undefined) return undefined;
    // A book that will not set is the preview's report, not the
    // editor's: the note is drawn as Obsidian draws it.
    return this.composer?.opened(member.book)?.catch(() => undefined);
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
    this.remark();
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
        // The design orca just wrote is the one the engine holds.
        if (this.designWrites.delete(file.path)) return;
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
   * Adds the way to the book to the markdown view's header, beside
   * Obsidian's own reading toggle. `addAction` is the API for adding an
   * icon to a view orca does not own.
   */
  private attach(view: MarkdownView, at: string, opens: () => void): void {
    const existing = this.back.get(view);
    if (existing?.at === at) return;
    existing?.icon.remove();
    const page = at.startsWith("page:");
    const icon = view.addAction(
      page ? PREVIEW_ICON : "book",
      page ? "Open preview" : "Open as book page",
      opens,
    );
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
        .setTitle(asBook ? "Open as book page" : "Open as markdown")
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
        .setIcon(PREVIEW_ICON)
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
    // A pane that has no place in this note to go back to goes to the
    // page too.
    const opens =
      from instanceof PreviewView && (from.paged || left?.at !== path)
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
      // Obsidian puts the caret back centered, which leaves a different
      // line at the top of the pane. The book page follows the top line.
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
    const over = view instanceof MarkdownView ? scrolledOver(view) : undefined;
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
        over,
      } satisfies PreviewState,
      active: true,
    });
    await this.openPanel();
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
        over: from instanceof MarkdownView ? scrolledOver(from) : undefined,
      } satisfies PreviewState,
      active: false,
    });
    await this.openPanel();
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

  /** Turns every linked preview to the page this note is showing most of. */
  private turned(file: TFile): void {
    this.follow(file.path, this.readOver(file.path));
  }

  /**
   * A pane that scrolled, which every linked preview of that note's
   * book follows. A scroll the book itself asked for turns nothing: the
   * page it led to is the page that node is set on, and a pane already
   * showing it has nowhere to turn.
   */
  private scrolled(path: string): void {
    this.follow(path, this.readOver(path));
  }

  /**
   * Turns every linked preview of this note's book to the page the
   * pane is scrolled to. A note no book lists turns none of them.
   */
  private follow(path: string, over: Shown[] | undefined): void {
    const member = this.members.get(path);
    if (member === undefined) return;
    for (const leaf of this.app.workspace.getLeavesOfType(PREVIEW_VIEW)) {
      const view = leaf.view;
      if (!(view instanceof PreviewView)) continue;
      if (view.linked && view.book === member.book) {
        void view.turnTo(path, over);
      }
    }
  }

  /** The blocks of a note the pane showing it is showing. */
  private readOver(path: string): Shown[] | undefined {
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW)) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) {
        return scrolledOver(view);
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
   * Opens a note with the caret at the place a warning named. The pane
   * is one already showing the note, then one already reading the
   * book, and otherwise a split beside the preview, so the book stays
   * on screen while the author fixes the note.
   */
  private async opensNote(view: PreviewView, place: Warned): Promise<void> {
    const file = this.app.vault.getFileByPath(place.sheet);
    if (file === null) return;
    const { workspace } = this.app;
    const book = view.book;
    const panes = workspace
      .getLeavesOfType(MARKDOWN_VIEW)
      .filter((leaf) => leaf.view instanceof MarkdownView && leaf.view.file !== null);
    const pathOf = (leaf: WorkspaceLeaf): string | undefined =>
      leaf.view instanceof MarkdownView ? leaf.view.file?.path : undefined;
    const showing = panes.find((leaf) => pathOf(leaf) === place.sheet);
    const reading = panes.find((leaf) => {
      const path = pathOf(leaf);
      return book !== undefined && path !== undefined && this.members.get(path)?.book === book;
    });
    const leaf = showing ?? reading ?? workspace.getLeaf("split", "vertical");
    if (leaf !== showing) await leaf.openFile(file);
    await workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
    const shown = leaf.view;
    if (!(shown instanceof MarkdownView)) return;
    const pos = { line: place.line - 1, ch: Math.max(place.column - 1, 0) };
    shown.editor.setCursor(pos);
    shown.editor.scrollIntoView({ from: pos, to: pos }, true);
  }

  /** Opens the design panel on the author's CSS with the caret at the place a warning named. */
  private async opensCss(place: Warned): Promise<void> {
    await this.openPanel();
    const panel = this.app.workspace.getLeavesOfType(PANEL_VIEW)[0]?.view;
    if (panel instanceof DesignPanelView) await panel.reveal(place);
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
   * worker, and runs under the name of the book it holds.
   */
  private async startWorker(book: string): Promise<Engine> {
    try {
      const module = await this.module();
      const handle = await startEngine(
        module.slice(0),
        browserHost,
        engineName(book),
      );
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

  /**
   * Saves the limits, and applies them to the engines that already run.
   * After a change of unit, it paints the panel and every book page
   * again in the new unit.
   */
  limit(limits: Limits): void {
    const remeasured = limits.unit !== this.limits.unit;
    this.limits = limits;
    if (this.engines !== undefined) this.engines.ceiling = limits.books;
    void this.saveData(limits);
    if (!remeasured) return;
    for (const leaf of this.app.workspace.getLeavesOfType(PANEL_VIEW)) {
      if (leaf.view instanceof DesignPanelView) leaf.view.refresh();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(BOOK_VIEW)) {
      if (leaf.view instanceof BookView) leaf.view.refresh();
    }
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
      fonts: (uses) => this.resolved(uses),
      files: this.files(),
      links: cacheLinks(this.app),
      engines,
      faces: documentFaces(document),
    };
  }

  /**
   * The faces and rules of each font and variant, by the names a design
   * names them by. A book set again on a new engine sends them, because
   * a face is registered for one session and that session is gone.
   *
   * The bytes are read on every call. A face that crosses to the worker
   * transfers its buffer, and the transfer empties it.
   */
  private async resolved(uses: readonly FontUse[]): Promise<ResolvedUse[]> {
    const index = await this.fontIndex();
    return Promise.all(uses.map((use) => resolveUse(this.places(), index, use)));
  }

  /** Registers one face of each variant of a family with the document. */
  private previewVariants(family: Family): Promise<void> {
    return previewVariants(this.places(), family, this.documentPreviews());
  }

  private documentPreviews(): Previews {
    this.previews ??= documentPreviews(document);
    return this.previews;
  }

  /** The book being designed and the fonts the machine has. */
  private designing(): Designing {
    return {
      book: () => this.designed(),
      setDesign: (book, design) => this.setDesign(book, design),
      setCss: (book, css) => this.setCss(book, css),
      index: () => this.fontIndex(),
      fonts: (uses) => this.resolved(uses),
      preview: (family) => this.previewVariants(family),
      unit: () => this.limits.unit,
      unpin: () => {
        for (const leaf of this.app.workspace.getLeavesOfType(PREVIEW_VIEW)) {
          if (leaf.view instanceof PreviewView) leaf.view.unpin();
        }
      },
      pin: (node) => {
        for (const leaf of this.app.workspace.getLeavesOfType(PREVIEW_VIEW)) {
          if (leaf.view instanceof PreviewView) void leaf.view.pinNode(node);
        }
      },
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
   * The book the panel designs. It is the book of a preview on screen:
   * the active one, or another that is visible when the panel itself
   * has focus. A preview in a tab behind another one designs nothing.
   *
   * The pane answers with the book it is reading, rather than the
   * composer answering by path. A note the book reads, written from
   * outside Obsidian, takes the book off the composer, and the pane sets
   * it again from the notes as they now are. Until that lands, the book
   * the pane holds is the one on screen, and the one a pick has to
   * reach.
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
      .filter(
        (view): view is PreviewView =>
          view instanceof PreviewView && view.containerEl.isShown(),
      );
    const active = workspace.getActiveViewOfType(PreviewView);
    const view =
      drawn.find((pane) => pane === active) ??
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
    await previewFaces(places, index, this.documentPreviews());
    return index;
  }

  private places(): FontPlaces {
    this.fonts ??= fontPlaces(this.files());
    return this.fonts;
  }

  /**
   * Hands a pin in the preview to the design panel. A pin the author set
   * opens the panel; one a paint found again only updates a panel that
   * is open, so an author who turned the sidebar elsewhere stays there.
   */
  private async inspected(pin: Pin | undefined, refreshed: boolean): Promise<void> {
    if (pin !== undefined && !refreshed) await this.openPanel();
    const panel = this.app.workspace.getLeavesOfType(PANEL_VIEW)[0]?.view;
    if (panel instanceof DesignPanelView) panel.inspect(pin);
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
      await this.openPanel();
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

  /**
   * Writes the design into the book's own frontmatter. The engine
   * already has the sheets. This write keeps the edit after
   * the session ends.
   */
  private async setDesign(book: string, design: Design): Promise<void> {
    const model = await this.edits.model(book);
    // It skips a design the book already has, so no write waits to be
    // let through.
    if (model === undefined || same(model.book.design, design)) return;
    this.designWrites.add(book);
    await this.edits.edit(book, (current) => ({
      ...current,
      book: { ...current.book, design },
    }));
  }

  /**
   * Writes the author's own CSS into the book note's fence. The engine
   * already has the sheet, and the write settles like any other edit.
   */
  private async setCss(book: string, css: string): Promise<void> {
    const model = await this.edits.model(book);
    if (model === undefined || bookCss(model.order) === css) return;
    this.designWrites.add(book);
    await this.edits.edit(book, (current) => ({
      ...current,
      order: withCss(current.order, css),
    }));
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

  /** Reveals a preview already reading a book, and otherwise opens one in a new tab. */
  private async previewBook(book: string): Promise<void> {
    const { workspace } = this.app;
    // A deferred leaf has no preview under it yet, but its state names
    // the book it will read.
    const open = workspace
      .getLeavesOfType(PREVIEW_VIEW)
      .find((leaf) => leaf.getViewState().state?.["book"] === book);
    if (open === undefined) {
      await this.openPreview({ book });
      return;
    }
    await workspace.revealLeaf(open);
    workspace.setActiveLeaf(open, { focus: true });
    await this.openPanel();
  }

  private async turnPreview(book: string, at: number): Promise<boolean> {
    const { workspace } = this.app;
    const view = workspace.getMostRecentLeaf(workspace.rootSplit)?.view;
    if (!(view instanceof PreviewView) || view.book !== book) return false;
    return await view.turnToSection(at);
  }

  private async openPreview(state: PreviewState): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: PREVIEW_VIEW, state: { ...state }, active: true });
    await this.app.workspace.revealLeaf(leaf);
    await this.openPanel();
  }

  /** The vault, as the engine and the asset registry read it. */
  private files(): VaultAdapter {
    const { adapter } = this.app.vault;
    const at = (path: string): string => normalizePath(path);
    return {
      exists: (path) => adapter.exists(at(path)),
      read: (path) => adapter.read(at(path)),
      readBinary: (path) => adapter.readBinary(at(path)),
      writeBinary: async (path, bytes) => {
        const file = at(path);
        const folder = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
        if (folder !== "" && !(await adapter.exists(folder))) await adapter.mkdir(folder);
        await adapter.writeBinary(file, bytes.slice().buffer);
      },
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

/**
 * The blocks of its note a manuscript pane is showing, and how much of
 * each. What the panes follow is what is on screen, so this is the whole
 * pane rather than the line at the top of it.
 */
function scrolledOver(view: MarkdownView): Shown[] | undefined {
  const seen = seenLines(view);
  if (seen === undefined) return undefined;
  return shownOver(view.editor.getValue(), seen);
}

/**
 * The lines a manuscript pane is showing, with the pixels of each on
 * screen. Where a pane is scrolled to in pixels is CodeMirror's own
 * answer, and Obsidian does not name it in the editor it hands out, so a
 * pane that answers with none shows the one line orca can still ask for.
 */
function seenLines(view: MarkdownView): Seen[] | undefined {
  const top = scrolledLine(view);
  if (top === undefined) return undefined;
  const cm = (view.editor as unknown as { cm?: EditorView }).cm;
  if (cm === undefined) return [{ line: top, pixels: 1 }];
  const box = cm.scrollDOM.getBoundingClientRect();
  const from = cm.posAtCoords({ x: box.left + 1, y: box.top + 1 }, false);
  const to = cm.posAtCoords({ x: box.left + 1, y: box.bottom - 1 }, false);
  const seen: Seen[] = [];
  const last = Math.max(from, to);
  // A row that ends where the walk stands is an empty line, so the step
  // is always forward and the bound is what ends the walk.
  for (let at = Math.min(from, to); at <= last; ) {
    const row = cm.lineBlockAt(at);
    const pixels =
      Math.min(row.bottom + cm.documentTop, box.bottom) -
      Math.max(row.top + cm.documentTop, box.top);
    const line = cm.state.doc.lineAt(row.from).number - 1;
    if (pixels > 0) seen.push({ line, pixels });
    at = Math.max(row.to + 1, at + 1);
  }
  return seen.length === 0 ? [{ line: top, pixels: 1 }] : seen;
}

/** Compares two designs by the properties they write into a note. */
function same(one: Design, two: Design): boolean {
  return JSON.stringify(writeDesign(one)) === JSON.stringify(writeDesign(two));
}
