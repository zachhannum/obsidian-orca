import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  normalizePath,
  type Menu,
  type TAbstractFile,
  type WorkspaceLeaf,
} from "obsidian";
import { startEngine, type EngineHandle } from "@/engine/bootstrap";
import { EngineError } from "@/engine/errors";
import { readModule, type VaultFiles } from "@/engine/module";
import { Session, documentFaces } from "@/engine/session";
import { BOOK_VIEW, BookView } from "@/ui/book";
import { isBook, type NoteIndex } from "@/ui/books";
import { PREVIEW_VIEW, PreviewView } from "@/ui/preview";

/** The view a book note is handed back to. */
const MARKDOWN_VIEW = "markdown";

/**
 * Orca, as Obsidian loads it. The plugin owns the engine, and every
 * view borrows the same session.
 */
export default class OrcaPlugin extends Plugin {
  private engine: EngineHandle | undefined;
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

    this.registerView(PREVIEW_VIEW, (leaf) => new PreviewView(leaf, opening));
    this.registerView(
      BOOK_VIEW,
      (leaf) =>
        new BookView(leaf, (view) => {
          void this.openAsMarkdown(view.leaf, view.file);
        }),
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

    this.app.workspace.onLayoutReady(() => {
      this.swap();
    });
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.swap();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.swap();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
        this.offer(menu, file, leaf);
      }),
    );

    await opening;
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
    const { vault, metadataCache } = this.app;
    return {
      notes: () => vault.getMarkdownFiles(),
      properties: (note) => metadataCache.getFileCache(note)?.frontmatter,
    };
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

  private offer(
    menu: Menu,
    file: TAbstractFile,
    leaf: WorkspaceLeaf | undefined,
  ): void {
    if (!(file instanceof TFile) || !isBook(this.notes(), file)) return;
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
