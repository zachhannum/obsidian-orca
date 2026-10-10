import {
  ItemView,
  Keymap,
  MarkdownView,
  Menu,
  Notice,
  TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type { MouseEvent as Pointed } from "react";
import { linksIn } from "@/book/links";
import type { Model } from "@/book/model";
import { bookFormat } from "@/book/note";
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
  rename,
  renameGroup,
  retag,
  NEW_GROUP,
  type Place,
} from "@/book/order";
import { ROLES, customOf, type Role } from "@/book/roles";
import { ACTIONS } from "@/ui/actions";
import { isBook } from "@/ui/books";
import { confirm } from "@/ui/confirm";
import { device } from "@/ui/desktop";
import type { Edits } from "@/ui/edits";
import { createChapter, emptyBook } from "@/ui/make";
import { cacheLinks, noteIndex } from "@/ui/notes";
import { pick } from "@/ui/pick";
import { readFolds, type Folds } from "@/ui/folds";
import { headingsOf, type Headed, type Showing } from "@/ui/outline";
import {
  entryItems,
  headingItems,
  menuPlace,
  menuTitle,
  type EntryItem,
  type HeadingItem,
  type Point,
} from "@/ui/rowmenu";
import { members, readSort, SORT_LABELS, SORT_ORDERS, shelve, type Row, type Shelved, type SortOrder } from "@/ui/shelf";
import { mountShelf, type Mounted } from "@/ui/shelves";

/** The type the navigator is registered under. */
export const NAVIGATOR_VIEW = "orca-navigator";

/** The plugin, as much of it as the navigator reaches: it owns the main area. */
export interface Handoff {
  /** Opens the preview of a book, or reveals one already reading it. */
  preview(book: string): void;
  /**
   * Turns the preview in the main area's most recent tab to a section,
   * by its place in the reading order, or to the heading on `line` of
   * its note. It answers false, and turns nothing, where that tab is
   * not a preview of the book, or where the book set that section to
   * no page. A heading set on no page turns to the section. On mobile
   * a turn shuts a drawer that is not pinned, as an opened note does.
   */
  turn(book: string, at: number, line?: number): Promise<boolean>;
  /**
   * The deepest heading level the navigator lists inside each entry of
   * a book, or nothing when it lists none. `own` is the level the book
   * note holds.
   */
  headings(own: number | undefined): number | undefined;
  /** Writes the level a book lists into its note. No level takes the key out. */
  lists(book: string, headings: number | undefined): void;
  /** The level a book lists when its note holds none. */
  fallback(): number | undefined;
}

/** A name of the author's own, picked in place of a role. */
interface Custom {
  name: string;
}

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
  /** The notes the last read listed, whose headings the shelf draws. */
  private members = new Set<string>();
  /** The book the list has focus in, which a paste adds to. */
  private focused: string | undefined;
  private mounted: Mounted | undefined;
  /** The folds on the shelf, which Obsidian keeps with the workspace and gives back on a reload. */
  private folds: Folds = {};
  /** The order of the books, kept with the workspace like the folds. */
  private sort: SortOrder = "vault";
  private queued: number | undefined;
  private generation = 0;
  private painting = 0;
  /** The shelf as it was last painted, which an identical read skips. */
  private shown = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly edits: Edits,
    private readonly handoff: Handoff,
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

  override getState(): Record<string, unknown> {
    return { ...super.getState(), folds: this.folds, sort: this.sort };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    this.folds = readFolds(state);
    this.sort = readSort((state as { sort?: unknown } | null)?.sort);
    this.mounted?.fold(this.folds);
    this.mounted?.order(this.sort);
  }

  override onOpen(): Promise<void> {
    const { vault, metadataCache, workspace } = this.app;
    const again = (): void => {
      this.refresh();
    };
    this.registerEvent(vault.on("create", again));
    this.registerEvent(vault.on("delete", again));
    this.registerEvent(vault.on("rename", again));
    // Every note in the vault raises this, and a read costs every book
    // on the shelf, so it is worth one only for a note the shelf reads.
    this.registerEvent(
      vault.on("modify", (file) => {
        if (file instanceof TFile && this.reads(file)) again();
      }),
    );
    // Obsidian resolves the cache after any note is written, so the
    // filter is on this side too. A note that gains the key arrives
    // here, with the frontmatter it was just parsed with.
    this.registerEvent(
      metadataCache.on("changed", (file, _data, cache) => {
        const properties = cache.frontmatter;
        const isBookNote =
          properties !== undefined && bookFormat(properties) !== undefined;
        const outlined = this.members.has(file.path);
        if (isBookNote || outlined || this.shelved.has(file.path)) again();
      }),
    );
    // The highlight follows the active note. Nothing else here does:
    // the navigator never folds, unfolds or scrolls on its own, only
    // when the book page asks it to focus an entry.
    this.registerEvent(workspace.on("file-open", again));
    this.register(this.edits.watch(again));

    this.registerDomEvent(this.containerEl, "paste", (event) => {
      this.pasted(event);
    });

    this.mounted = mountShelf(this.contentEl, {
      open: (path) => {
        void this.openNote(path);
      },
      folded: (folds) => {
        this.folds = folds;
        this.app.workspace.requestSaveLayout();
      },
      preview: (book) => {
        this.handoff.preview(book.path);
      },
      openEntry: (book, row, event) => {
        void this.openEntry(book, row, event.nativeEvent);
      },
      openHeading: (book, row, heading, event) => {
        void this.openHeading(book, row, heading, event.nativeEvent);
      },
      bookMenu: (event, book) => {
        this.bookMenu(event, book);
      },
      entryMenu: (event, book, row, after) => {
        this.entryMenu(event, book, row, after);
      },
      groupMenu: (event, book, heading) => {
        this.groupMenu(event, book, heading);
      },
      addMenu: (event, book) => {
        this.addMenu(event.nativeEvent, book, undefined);
      },
      newBook: () => {
        void this.newBook();
      },
      sortMenu: (event, current, choose) => {
        const menu = new Menu();
        for (const order of SORT_ORDERS) {
          menu.addItem((item) =>
            item
              .setTitle(SORT_LABELS[order])
              .setChecked(order === current)
              .onClick(() => {
                choose(order);
              }),
          );
        }
        this.raise(menu, event);
      },
      sorted: (order) => {
        this.sort = order;
        this.app.workspace.requestSaveLayout();
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
    this.mounted.fold(this.folds);
    this.mounted.order(this.sort);

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

  /**
   * Focuses one entry of a book, by its place in the reading order.
   * The book page asks for this, since the order is edited here.
   */
  focus(book: string, at: number): void {
    this.mounted?.focus(book, at);
  }

  /** Marks the row for the page a preview shows. */
  show(showing: Showing | undefined): void {
    this.mounted?.show(showing);
  }

  /** Reads the shelf again and paints it even when it reads the same, after a setting changed. */
  redraw(): void {
    this.shown = "";
    this.refresh();
  }

  /** Repaints the shelf once, however many events arrived. */
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
    // One write raises several vault events, and each of them asks for
    // the shelf again. A shelf that reads the same is not painted
    // again, so the list does not move under the author's pointer.
    const read = JSON.stringify(shelf);
    if (read === this.shown) return;
    this.shown = read;
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
      // book already on the shelf would otherwise drop out of the list
      // while orca itself is writing it. A book stays on the shelf
      // until the note is read again.
      if (!isBook(index, note) && !this.shelved.has(note.path)) continue;
      // One note orca cannot read leaves the rest of the shelf standing.
      // A book note orca refuses reads as undefined; anything else here
      // is a read that failed for a reason orca does not have a name
      // for, and it leaves a trace rather than only a gap in the list.
      const model = await this.edits
        .model(note.path)
        .catch((cause: unknown) => {
          console.error(`Orca: ${note.path} was not read.`, cause);
          return undefined;
        });
      if (model === undefined) continue;
      const deepest = this.handoff.headings(model.book.headings);
      const headings =
        deepest === undefined
          ? undefined
          : (path: string) => headingsOf(this.app, path, deepest);
      shelf.push(
        shelve({ path: note.path, name: note.basename, model }, { ...vault, headings }),
      );
    }
    this.shelved = new Set(shelf.map((book) => book.path));
    this.members = members(shelf);
    return shelf;
  }

  /** Whether a note is one the shelf reads. */
  private reads(note: TFile): boolean {
    return this.shelved.has(note.path) || isBook(noteIndex(this.app), note);
  }

  /** Starts a row's menu. A phone's sheet opens under the row's name. */
  private rowMenu(name: string): Menu {
    const menu = new Menu();
    const title = menuTitle(device(), name);
    if (title !== undefined) {
      menu.addItem((item) => item.setTitle(title).setIsLabel(true));
    }
    return menu;
  }

  /** Shows a row's menu where the device puts one. */
  private raise(menu: Menu, event: Pointed): void {
    if (device() !== "tablet") {
      menu.showAtMouseEvent(event.nativeEvent);
      return;
    }
    // The browser's own menu would open over this one.
    event.preventDefault();
    const { point, doc } = this.placed(event);
    menu.showAtPosition(point, doc);
  }

  /**
   * The place the device puts a row's menu, and the document the row
   * is in. React clears the event's row once the handler returns, so a
   * menu shown later is placed from this.
   */
  private placed(event: Pointed): { point: Point; doc: Document } {
    const pointer = event.nativeEvent;
    const row = event.currentTarget;
    return {
      point: menuPlace(device(), row.getBoundingClientRect(), {
        x: pointer.clientX,
        y: pointer.clientY,
      }),
      doc: row.ownerDocument,
    };
  }

  /** Opens the menu that sets the heading level a book lists. */
  private headingsMenu(book: Shelved, place: { point: Point; doc: Document }): void {
    const menu = this.rowMenu(book.name);
    const [follows, ...levels] = headingItems(book.headings, this.handoff.fallback());
    const offer = (choice: HeadingItem): void => {
      menu.addItem((item) =>
        item
          .setTitle(choice.title)
          .setChecked(choice.checked)
          .onClick(() => {
            this.handoff.lists(book.path, choice.value);
          }),
      );
    };
    if (follows !== undefined) offer(follows);
    menu.addSeparator();
    levels.forEach(offer);
    menu.showAtPosition(place.point, place.doc);
  }

  private bookMenu(event: Pointed, book: Shelved): void {
    const menu = this.rowMenu(book.name);
    const place = this.placed(event);
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
    menu.addItem((item) =>
      item
        .setTitle("Show headings…")
        .setIcon("list-tree")
        .onClick(() => {
          this.headingsMenu(book, place);
        }),
    );
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
    this.raise(menu, event);
  }

  /**
   * Opens the add menu. The `+` on a book row shows it, and every other
   * menu here repeats its items.
   */
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

  /** A section is organizational, so its menu never mentions a role. */
  private groupMenu(event: Pointed, book: Shelved, heading: string): void {
    const menu = this.rowMenu(heading);
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
    this.raise(menu, event);
  }

  private entryMenu(
    event: Pointed,
    book: Shelved,
    row: Row,
    after: Place,
  ): void {
    const menu = this.rowMenu(row.name);
    const path = row.path;
    const offers: Record<
      EntryItem,
      { title: string; icon: string; run: () => void }
    > = {
      markdown: {
        title: ACTIONS.markdown.label,
        icon: ACTIONS.markdown.icon,
        run: () => {
          if (path !== undefined) void this.openNote(path, "tab");
        },
      },
      preview: {
        title: ACTIONS.preview.label,
        icon: ACTIONS.preview.icon,
        run: () => {
          void this.previewEntry(book, row);
        },
      },
      chapter: {
        title: "New chapter here",
        icon: "file-plus",
        run: () => {
          void this.newChapter(book, after);
        },
      },
      role: {
        title: "Role for this entry…",
        icon: "tag",
        run: () => {
          this.reroleEntry(book, row);
        },
      },
      locate: {
        title: "Locate the note…",
        icon: "search",
        run: () => {
          this.locate(book, row);
        },
      },
      reveal: {
        title: "Reveal the note",
        icon: "file-text",
        run: () => {
          if (path !== undefined) void this.openNote(path);
        },
      },
      // There is no delete here. Removing an entry takes it out of the
      // book, and the note stays in the vault.
      remove: {
        title: "Remove from book",
        icon: "minus",
        run: () => {
          this.change(book.path, (model) => ({
            ...model,
            order: remove(model.order, row.at),
          }));
        },
      },
    };
    entryItems(device(), row).forEach((group, at) => {
      if (at > 0) menu.addSeparator();
      for (const name of group) {
        const { title, icon, run } = offers[name];
        menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(run));
      }
    });
    this.raise(menu, event);
  }

  /**
   * Turns the preview in the most recent tab to an entry, or opens the
   * book's preview when that tab is no preview of it.
   */
  private async previewEntry(book: Shelved, row: Row): Promise<void> {
    if (await this.handoff.turn(book.path, row.at)) return;
    this.handoff.preview(book.path);
  }

  /** Picks a note from the vault and adds it to the book. */
  private pickNote(book: Shelved, heading: string | undefined): void {
    const members = new Set(
      book.groups.flatMap((group) =>
        group.rows.flatMap((row) => (row.path === undefined ? [] : [row.path])),
      ),
    );
    members.add(book.path);
    pick(this.app, {
      items: this.app.vault
        .getMarkdownFiles()
        .filter((note) => !members.has(note.path)),
      label: (note) => note.path,
      placeholder: `Add a note to ${book.name}`,
      chose: (note) => {
        void this.edits.addNote(book.path, note, heading);
      },
    });
  }

  /**
   * Picks a generated section by its role and adds it to the book. The
   * reading order is where the author says one belongs.
   */
  private pickGenerated(book: Shelved, heading: string | undefined): void {
    const made = (Object.keys(ROLES) as Role[]).filter(
      (role) => ROLES[role].origin === "generated",
    );
    pick(this.app, {
      items: made,
      label: (role) => ROLES[role].name,
      note: (role) => ROLES[role].effect,
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
   * Trashes the book note. The notes it lists are borrowed and stay in
   * the vault.
   */
  private deleteBook(book: Shelved): void {
    confirm(this.app, {
      title: `Delete ${book.name}?`,
      said: "Only the book note is deleted.",
      verb: "Delete",
      done: () => {
        const note = this.app.vault.getFileByPath(book.path);
        if (note === null) return;
        void this.app.fileManager.trashFile(note).catch((cause: unknown) => {
          new Notice(
            `Orca: could not delete the book. ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          );
        });
      },
    });
  }

  /** Handles a wikilink pasted into a book's list, the third way to add a note. */
  private pasted(event: ClipboardEvent): void {
    // A rename is an input inside this view, and what is pasted into
    // one is the section's name.
    // A leaf can be in a popout window, whose elements are that window's
    // and no instance of this one's. Both windows spell the tag name the
    // same way.
    const tag = (event.target as Partial<HTMLElement> | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
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

  /** Creates a chapter note in the book's folder and appends it, in one step. */
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
    // A generated role sets no note, so an entry with a link is not
    // offered one. `New generated section…` adds those.
    const roles = (Object.keys(ROLES) as Role[]).filter(
      (role) => row.kind === "generated" || ROLES[role].origin === "note",
    );
    pick<Role | Custom>(this.app, {
      items: roles,
      label: (role) => (typeof role === "string" ? ROLES[role].name : role.name),
      note: (role) =>
        typeof role === "string"
          ? ROLES[role].effect
          : `Your own role. Custom CSS styles it as section.${role.name}.`,
      typed: (query) => {
        const name = row.kind === "generated" ? undefined : customOf(query);
        return name === undefined ? undefined : { name };
      },
      placeholder: `Role for ${row.name}, or a name of your own`,
      chose: (role) => {
        this.change(book.path, (model) => ({
          ...model,
          order:
            typeof role === "string"
              ? retag(model.order, row.at, role)
              : rename(model.order, row.at, role.name),
        }));
      },
    });
  }

  /** Picks the note a missing entry should point at. */
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
   * Opens a note in the pane the author is reading in, or in a new tab.
   * `open` is Obsidian's own, and it is what puts this view in its leaf.
   */
  private async openNote(path: string, leaf: "tab" | false = false): Promise<void> {
    const note = this.app.vault.getFileByPath(path);
    if (note === null) return;
    await this.app.workspace.getLeaf(leaf).openFile(note);
  }

  /**
   * Opens an entry. A preview of the book in the most recent tab turns
   * to it, a generated section included. Otherwise a chapter opens as
   * markdown, and a click with the Mod key opens it in a new tab. A
   * chapter the preview cannot turn to opens as markdown as well.
   */
  private async openEntry(
    book: Shelved,
    row: Row,
    event: MouseEvent,
  ): Promise<void> {
    const note =
      row.path === undefined ? null : this.app.vault.getFileByPath(row.path);
    if (Keymap.isModEvent(event) !== false) {
      if (note !== null) await this.app.workspace.getLeaf("tab").openFile(note);
      return;
    }
    if ((await this.handoff.turn(book.path, row.at)) || note === null) return;
    await this.app.workspace.getLeaf(false).openFile(note);
  }

  /**
   * Opens a heading the way an entry opens: a preview of the book turns
   * to the page it opens on, and a click with the Mod key opens the
   * note as markdown at its line, in a new tab.
   */
  private async openHeading(
    book: Shelved,
    row: Row,
    heading: Headed,
    event: MouseEvent | KeyboardEvent,
  ): Promise<void> {
    const note =
      row.path === undefined ? null : this.app.vault.getFileByPath(row.path);
    const mod = Keymap.isModEvent(event) !== false;
    if (!mod && (await this.handoff.turn(book.path, row.at, heading.line))) return;
    if (note === null) return;
    const leaf = this.app.workspace.getLeaf(mod ? "tab" : false);
    await leaf.openFile(note, { active: true, eState: { line: heading.line } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const pos = { line: heading.line, ch: 0 };
    view.editor.setCursor(pos);
    view.editor.scrollIntoView({ from: pos, to: pos }, true);
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

