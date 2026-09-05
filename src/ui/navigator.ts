import { ItemView, Menu, type WorkspaceLeaf } from "obsidian";
import { linksIn } from "@/book/links";
import type { Model } from "@/book/model";
import {
  add,
  addGenerated,
  addGroup,
  groups,
  insert,
  move,
  moveGroup,
  relink,
  remove,
  removeGroup,
  renameGroup,
  retag,
  NEW_GROUP,
  type Place,
} from "@/book/order";
import { ROLES, type Role } from "@/book/roles";
import { isBook } from "@/ui/books";
import { confirm } from "@/ui/confirm";
import type { Edits } from "@/ui/edits";
import { createChapter, emptyBook } from "@/ui/make";
import { cacheLinks, noteIndex } from "@/ui/notes";
import { pick } from "@/ui/pick";
import { shelve, type Row, type Shelved } from "@/ui/shelf";
import { mountShelf, type Mounted } from "@/ui/shelves";

/** The type the navigator is registered under. */
export const NAVIGATOR_VIEW = "orca-navigator";

/**
 * Every book in the vault, and the reading order of each.
 *
 * Membership, order and roles are edited here and nowhere else, and
 * every edit goes to the book note through the one writer. The list is
 * read again from the vault after each, so nothing here is a second
 * copy of the book.
 */
export class NavigatorView extends ItemView {
  /** The books the last read found, which a write does not take off the shelf. */
  private shelved = new Set<string>();
  /** The book the list has focus in, which a paste adds to. */
  private focused: string | undefined;
  private mounted: Mounted | undefined;
  private queued: number | undefined;
  private generation = 0;
  private painting = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly edits: Edits,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return NAVIGATOR_VIEW;
  }

  override getDisplayText(): string {
    return "Books";
  }

  override getIcon(): string {
    return "library";
  }

  override onOpen(): Promise<void> {
    const { vault, metadataCache, workspace } = this.app;
    const again = (): void => {
      this.refresh();
    };
    this.registerEvent(vault.on("create", again));
    this.registerEvent(vault.on("delete", again));
    this.registerEvent(vault.on("rename", again));
    this.registerEvent(vault.on("modify", again));
    this.registerEvent(metadataCache.on("resolved", again));
    // The highlight follows the active note. Nothing else here does:
    // the navigator never folds, unfolds or scrolls itself.
    this.registerEvent(workspace.on("file-open", again));
    this.register(this.edits.watch(again));

    this.registerDomEvent(this.containerEl, "paste", (event) => {
      this.pasted(event);
    });

    this.mounted = mountShelf(this.contentEl, {
      open: (path) => {
        void this.openNote(path);
      },
      bookMenu: (event, book) => {
        this.bookMenu(event.nativeEvent, book);
      },
      entryMenu: (event, book, row, after) => {
        this.entryMenu(event.nativeEvent, book, row, after);
      },
      groupMenu: (event, book, heading) => {
        this.groupMenu(event.nativeEvent, book, heading);
      },
      addMenu: (event, book) => {
        this.addMenu(event.nativeEvent, book, undefined);
      },
      newBook: () => {
        void this.newBook();
      },
      locate: (book, row) => {
        this.locate(book, row);
      },
      removeEntry: (book, row) => {
        this.change(book.path, (model) => ({
          ...model,
          order: remove(model.order, row.at),
        }));
      },
      moveEntry: (book, from, to) => {
        this.change(book.path, (model) => ({
          ...model,
          order: move(model.order, from, to),
        }));
      },
      moveGroup: (book, heading, at) => {
        this.change(book.path, (model) => ({
          ...model,
          order: moveGroup(model.order, heading, at),
        }));
      },
      renameGroup: (book, heading, named) => {
        this.change(book.path, (model) => ({
          ...model,
          order: renameGroup(model.order, heading, free(model, named)),
        }));
      },
      focused: (path) => {
        this.focused = path;
      },
    });

    this.refresh();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    if (this.queued !== undefined) window.clearTimeout(this.queued);
    this.queued = undefined;
    this.mounted?.unmount();
    this.mounted = undefined;
    return Promise.resolve();
  }

  /** Draws the shelf again, once, however many events arrived. */
  private refresh(): void {
    if (this.queued !== undefined) return;
    this.queued = window.setTimeout(() => {
      this.queued = undefined;
      void this.repaint();
    }, 0);
  }

  private async repaint(): Promise<void> {
    const run = (this.painting += 1);
    const shelf = await this.read();
    // The notes are read one at a time, so a later refresh can finish
    // first; the last one asked for is the one painted.
    if (run !== this.painting) return;
    this.generation += 1;
    this.mounted?.paint(shelf, this.generation);
  }

  /** Every book in the vault, resolved against it. */
  private async read(): Promise<Shelved[]> {
    const notes = this.app.vault.getMarkdownFiles();
    const index = noteIndex(this.app);
    const vault = {
      links: cacheLinks(this.app),
      active: this.app.workspace.getActiveFile()?.path,
    };

    const shelf: Shelved[] = [];
    for (const note of notes) {
      // A note is uncached for as long as a write to it takes, and a
      // book already on the shelf would otherwise blink out of the
      // list while orca itself is writing it. What the note reads as
      // settles it.
      if (!isBook(index, note) && !this.shelved.has(note.path)) continue;
      const model = await this.edits.model(note.path);
      if (model === undefined) continue;
      shelf.push(shelve({ path: note.path, name: note.basename, model }, vault));
    }
    this.shelved = new Set(shelf.map((book) => book.path));
    return shelf;
  }

  private bookMenu(event: MouseEvent, book: Shelved): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Open the book note")
        .setIcon("book")
        .onClick(() => {
          void this.openNote(book.path);
        }),
    );
    this.offerAdding(menu, book, undefined);
    menu.addSeparator();
    // The book note is orca's own. Every note it lists is borrowed, so
    // this is the one delete the navigator offers.
    menu.addItem((item) =>
      item
        .setTitle("Delete book…")
        .setIcon("trash-2")
        .onClick(() => {
          this.deleteBook(book);
        }),
    );
    menu.showAtMouseEvent(event);
  }

  /** What the `+` on a book row offers, and every menu here repeats. */
  private addMenu(
    event: MouseEvent,
    book: Shelved,
    heading: string | undefined,
  ): void {
    const menu = new Menu();
    this.offerAdding(menu, book, heading);
    menu.showAtMouseEvent(event);
  }

  private offerAdding(
    menu: Menu,
    book: Shelved,
    heading: string | undefined,
  ): void {
    menu.addItem((item) =>
      item
        .setTitle("New chapter")
        .setIcon("file-plus")
        .onClick(() => {
          void this.newChapter(book, heading);
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Add an existing note…")
        .setIcon("book-plus")
        .onClick(() => {
          this.pickNote(book, heading);
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("New generated section…")
        .setIcon("wand-sparkles")
        .onClick(() => {
          this.pickGenerated(book, heading);
        }),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("New section")
        .setIcon("folder-plus")
        .onClick(() => {
          this.change(book.path, (model) => ({
            ...model,
            order: addGroup(model.order, free(model, NEW_GROUP)),
          }));
        }),
    );
  }

  /** A section is organisational, so its menu never mentions a role. */
  private groupMenu(event: MouseEvent, book: Shelved, heading: string): void {
    const menu = new Menu();
    this.offerAdding(menu, book, heading);
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Rename section")
        .setIcon("pencil")
        .onClick(() => {
          this.mounted?.rename(book.path, heading);
        }),
    );
    // The entries under it stay in the book and join the section above.
    menu.addItem((item) =>
      item
        .setTitle("Remove section")
        .setIcon("minus")
        .onClick(() => {
          this.change(book.path, (model) => ({
            ...model,
            order: removeGroup(model.order, heading),
          }));
        }),
    );
    menu.showAtMouseEvent(event);
  }

  private entryMenu(
    event: MouseEvent,
    book: Shelved,
    row: Row,
    after: Place,
  ): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("New chapter here")
        .setIcon("file-plus")
        .onClick(() => {
          void this.newChapter(book, after);
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Role for this entry…")
        .setIcon("tag")
        .onClick(() => {
          this.reroleEntry(book, row);
        }),
    );
    if (row.kind === "missing") {
      menu.addItem((item) =>
        item
          .setTitle("Locate the note…")
          .setIcon("search")
          .onClick(() => {
            this.locate(book, row);
          }),
      );
    } else if (row.path !== undefined) {
      const path = row.path;
      menu.addItem((item) =>
        item
          .setTitle("Reveal the note")
          .setIcon("file-text")
          .onClick(() => {
            void this.openNote(path);
          }),
      );
    }
    // There is no delete here. Removing an entry takes it out of the
    // book, and the note stays in the vault.
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Remove from book")
        .setIcon("minus")
        .onClick(() => {
          this.change(book.path, (model) => ({
            ...model,
            order: remove(model.order, row.at),
          }));
        }),
    );
    menu.showAtMouseEvent(event);
  }

  /** A note picked out of the vault, added to the book. */
  private pickNote(book: Shelved, heading: string | undefined): void {
    const held = new Set(
      book.groups.flatMap((group) =>
        group.rows.flatMap((row) => (row.path === undefined ? [] : [row.path])),
      ),
    );
    held.add(book.path);
    pick(this.app, {
      items: this.app.vault
        .getMarkdownFiles()
        .filter((note) => !held.has(note.path)),
      label: (note) => note.path,
      placeholder: `Add a note to ${book.name}`,
      chose: (note) => {
        void this.edits.addNote(book.path, note, heading);
      },
    });
  }

  /**
   * A section orca sets in place of a note, picked by its role. The
   * text it is set from is the synthesis pass's, and the reading order
   * is where the author says one belongs.
   */
  private pickGenerated(book: Shelved, heading: string | undefined): void {
    const made = (Object.keys(ROLES) as Role[]).filter(
      (role) => ROLES[role].origin === "generated",
    );
    pick(this.app, {
      items: made,
      label: (role) => ROLES[role].name,
      placeholder: `Add a generated section to ${book.name}`,
      chose: (role) => {
        this.change(book.path, (model) => ({
          ...model,
          order: addGenerated(model.order, role, heading),
        }));
      },
    });
  }

  /**
   * The book note, in the trash. The notes it lists are borrowed and
   * stay in the vault.
   */
  private deleteBook(book: Shelved): void {
    confirm(this.app, {
      title: `Delete ${book.name}?`,
      said: "The book note goes to the trash. The notes it lists are borrowed, and stay in the vault.",
      verb: "Delete",
      done: () => {
        const note = this.app.vault.getFileByPath(book.path);
        if (note !== null) void this.app.fileManager.trashFile(note);
      },
    });
  }

  /** A wikilink pasted into a book's list, which is the third route in. */
  private pasted(event: ClipboardEvent): void {
    const path = this.focused;
    if (path === undefined) return;
    const links = linksIn(event.clipboardData?.getData("text/plain") ?? "");
    if (links.length === 0) return;
    event.preventDefault();
    this.change(path, (model) => ({
      ...model,
      order: links.reduce((order, link) => add(order, link), model.order),
    }));
  }

  /** A new chapter note, made in the book's folder and appended in one step. */
  private async newChapter(
    book: Shelved,
    to: Place | string | undefined,
  ): Promise<void> {
    const note = await createChapter(this.app, book.folder);
    const link = this.app.metadataCache.fileToLinktext(note, book.path, true);
    await this.edits.edit(book.path, (model) => ({
      ...model,
      order:
        typeof to === "object"
          ? insert(model.order, link, to)
          : add(model.order, link, to),
    }));
  }

  private async newBook(): Promise<void> {
    await this.openNote((await emptyBook(this.app)).path);
  }

  private reroleEntry(book: Shelved, row: Row): void {
    const roles = Object.keys(ROLES) as Role[];
    pick(this.app, {
      items: roles,
      label: (role) => ROLES[role].name,
      placeholder: `Role for ${row.name}`,
      chose: (role) => {
        this.change(book.path, (model) => ({
          ...model,
          order: retag(model.order, row.at, role),
        }));
      },
    });
  }

  /** The note a missing entry means, picked out of the vault. */
  private locate(book: Shelved, row: Row): void {
    pick(this.app, {
      items: this.app.vault.getMarkdownFiles(),
      label: (note) => note.path,
      placeholder: `Locate ${row.name}`,
      chose: (note) => {
        this.change(book.path, (model) => ({
          ...model,
          order: relink(
            model.order,
            row.at,
            this.app.metadataCache.fileToLinktext(note, book.path, true),
          ),
        }));
      },
    });
  }

  private change(path: string, made: (model: Model) => Model): void {
    void this.edits.edit(path, made);
  }

  /**
   * A note, opened in the pane the author is reading in. `open` is
   * Obsidian's own, and it is what puts this view in its leaf.
   */
  private async openNote(path: string): Promise<void> {
    const note = this.app.vault.getFileByPath(path);
    if (note === null) return;
    await this.app.workspace.getLeaf(false).openFile(note);
  }
}

/**
 * A heading no other section in the book has, numbered the way
 * Obsidian numbers a file. The reading order finds a group by its
 * heading, so two of one name would be one place.
 */
function free(model: Model, name: string): string {
  const taken = new Set(groups(model.order).map((group) => group.heading));
  for (let next = 0; ; next += 1) {
    const heading = next === 0 ? name : `${name} ${next}`;
    if (!taken.has(heading)) return heading;
  }
}
