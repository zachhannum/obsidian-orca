import { ItemView, Menu, setIcon, type WorkspaceLeaf } from "obsidian";
import { linksIn } from "@/book/links";
import type { Model } from "@/book/model";
import {
  add,
  insert,
  move,
  relink,
  remove,
  retag,
  type Place,
} from "@/book/order";
import { ROLES, type Role } from "@/book/roles";
import { isBook } from "@/ui/books";
import type { Edits } from "@/ui/edits";
import { createChapter, emptyBook } from "@/ui/make";
import { cacheLinks, noteIndex } from "@/ui/notes";
import { pick } from "@/ui/pick";
import { shelve, type Grouped, type Row, type Shelved } from "@/ui/shelf";

/** The type the navigator is registered under. */
export const NAVIGATOR_VIEW = "orca-navigator";

/** How far a pointer travels before a press becomes a drag, in pixels. */
const SLOP = 4;

/**
 * One listener on a node the next paint throws away, which is why it is
 * not registered against the view's own lifetime.
 */
function listen<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  of: K,
  heard: (event: HTMLElementEventMap[K]) => void,
): void {
  el.addEventListener(of, heard);
}

/** An entry on its way to another place in the reading order. */
interface Drag {
  book: Shelved;
  row: Row;
  at: { x: number; y: number };
  el: HTMLElement;
  ghost: HTMLElement | undefined;
  to: Place | undefined;
}

/**
 * Every book in the vault, and the reading order of each.
 *
 * Membership, order and roles are edited here and nowhere else, and
 * every edit goes to the book note through the one writer. The list is
 * drawn again from the vault after each, so nothing here is a second
 * copy of the book.
 */
export class NavigatorView extends ItemView {
  /** The books the author has folded, and the loose lines they have closed. */
  private readonly folded = new Set<string>();
  private readonly hidden = new Set<string>();
  /** The books the last read found, which a write does not take off the shelf. */
  private shelved = new Set<string>();
  /** The book the list has focus in, which a paste adds to. */
  private focused: string | undefined;
  private drag: Drag | undefined;
  private drop: HTMLElement | undefined;
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
    this.registerEvent(
      metadataCache.on("resolved", () => {
        this.refresh();
      }),
    );
    // The highlight follows the active note. Nothing else here does:
    // the navigator never folds, unfolds or scrolls itself.
    this.registerEvent(
      workspace.on("file-open", () => {
        this.refresh();
      }),
    );
    this.register(
      this.edits.watch(() => {
        this.refresh();
      }),
    );

    this.registerDomEvent(this.containerEl, "paste", (event) => {
      this.pasted(event);
    });
    this.registerDomEvent(window, "pointermove", (event) => {
      this.dragged(event);
    });
    this.registerDomEvent(window, "pointerup", () => {
      this.dropped();
    });

    this.refresh();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    if (this.queued !== undefined) window.clearTimeout(this.queued);
    this.queued = undefined;
    this.drag?.ghost?.remove();
    this.drag = undefined;
    this.contentEl.empty();
    return Promise.resolve();
  }

  /**
   * Draws the shelf again, once, however many events arrived. A drag
   * holds the paint off until it lands, so the entry under the pointer
   * stays where the pointer left it.
   */
  private refresh(): void {
    if (this.queued !== undefined || this.drag !== undefined) return;
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
    if (run !== this.painting || this.drag !== undefined) return;
    this.generation += 1;
    this.paint(shelf);
  }

  /** Every book in the vault, resolved against it. */
  private async read(): Promise<Shelved[]> {
    const notes = this.app.vault.getMarkdownFiles();
    const index = noteIndex(this.app);
    const vault = {
      paths: notes.map((note) => note.path),
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

  private paint(shelf: Shelved[]): void {
    const pane = this.contentEl;
    pane.empty();
    pane.addClass("orca-navigator");
    pane.dataset["testid"] = "orca-navigator";
    pane.dataset["generation"] = String(this.generation);

    const header = pane.createDiv({ cls: "orca-nav-header" });
    header.createSpan({ cls: "orca-nav-title", text: "Books" });
    this.button(header, "search", "Add a note to a book", () => {
      this.addTo(shelf);
    });
    this.button(header, "plus", "New book", () => {
      void this.newBook();
    });

    const list = pane.createDiv({ cls: "orca-shelves" });
    if (shelf.length === 0) {
      list.createDiv({ cls: "orca-nav-quiet", text: "No books in this vault" });
    }
    for (const book of shelf) this.shelf(list, book);
  }

  private shelf(parent: HTMLElement, book: Shelved): void {
    const el = parent.createDiv({ cls: "orca-shelf" });
    el.dataset["testid"] = "orca-shelf";
    el.dataset["book"] = book.path;
    el.dataset["holds"] = String(book.holds);
    el.tabIndex = 0;
    listen(el, "focusin", () => {
      this.focused = book.path;
    });

    const folded = this.folded.has(book.path);
    const row = el.createDiv({ cls: "orca-nav-item orca-shelf-name" });
    if (book.holds) row.addClass("is-active");
    const fold = row.createSpan({ cls: "orca-fold" });
    setIcon(fold, folded ? "chevron-right" : "chevron-down");
    row.createSpan({ cls: "orca-label", text: book.name });
    listen(fold, "click", (event) => {
      event.stopPropagation();
      this.fold(this.folded, book.path);
    });
    listen(row, "click", () => {
      void this.openNote(book.path);
    });
    listen(row, "contextmenu", (event) => {
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
      menu.showAtMouseEvent(event);
    });

    if (folded) return;
    const children = el.createDiv({ cls: "orca-nav-children" });
    for (const group of book.groups) this.group(children, book, group);
    this.loose(children, book);
  }

  private group(parent: HTMLElement, book: Shelved, group: Grouped): void {
    const head = parent.createDiv({
      cls: "orca-nav-heading",
      text: group.heading === "" ? ROLES[group.role].name : group.heading,
    });
    head.dataset["testid"] = "orca-group";
    head.dataset["heading"] = group.heading;
    listen(head, "contextmenu", (event) => {
      const menu = new Menu();
      this.offerAdding(menu, book, group.heading);
      menu.showAtMouseEvent(event);
    });

    for (const [index, row] of group.rows.entries()) {
      this.entry(parent, book, group, row, index);
    }
    // One place a chapter is made: the group the book's chapters open
    // in, whatever else the author has headed the note with.
    if (group.heading !== book.body) return;
    const make = parent.createDiv({ cls: "orca-nav-make" });
    make.dataset["testid"] = "orca-new-chapter";
    setIcon(make.createSpan({ cls: "orca-nav-make-icon" }), "plus");
    make.createSpan({ text: `New chapter at the end of ${group.heading}` });
    listen(make, "click", () => {
      void this.newChapter(book, {
        heading: group.heading,
        at: group.rows.length,
      });
    });
  }

  private entry(
    parent: HTMLElement,
    book: Shelved,
    group: Grouped,
    row: Row,
    index: number,
  ): void {
    const el = parent.createDiv({ cls: "orca-nav-item orca-entry" });
    el.dataset["testid"] = "orca-entry";
    el.dataset["at"] = String(row.at);
    el.dataset["role"] = row.role;
    el.dataset["kind"] = row.kind;
    if (row.kind === "missing") {
      setIcon(el.createSpan({ cls: "orca-entry-warn" }), "triangle-alert");
    }
    el.createSpan({ cls: "orca-label", text: row.name });

    if (row.kind === "generated") {
      el.createSpan({ cls: "orca-chip mod-generated", text: "generated" });
    } else if (row.tagged) {
      el.createSpan({ cls: "orca-chip", text: row.role });
    }
    if (row.kind === "missing") {
      const fix = el.createDiv({ cls: "orca-entry-fix" });
      this.action(fix, "Locate", () => {
        this.locate(book, row);
      });
      this.action(fix, "Remove", () => {
        this.removeEntry(book, row);
      });
    }

    listen(el, "click", () => {
      if (row.path !== undefined) void this.openNote(row.path);
    });
    listen(el, "contextmenu", (event) => {
      this.entryMenu(event, book, group, row, index);
    });
    listen(el, "pointerdown", (event) => {
      if (event.button !== 0) return;
      this.drag = {
        book,
        row,
        at: { x: event.clientX, y: event.clientY },
        el,
        ghost: undefined,
        to: undefined,
      };
    });
  }

  /** The notes in the book's folder the reading order does not have. */
  private loose(parent: HTMLElement, book: Shelved): void {
    if (book.loose.length === 0 || this.hidden.has(book.path)) return;
    const el = parent.createDiv({ cls: "orca-loose" });
    el.dataset["testid"] = "orca-loose";
    const many = book.loose.length !== 1;
    const head = el.createDiv({ cls: "orca-loose-head" });
    const shown = !this.folded.has(`loose:${book.path}`);
    setIcon(
      head.createSpan({ cls: "orca-fold" }),
      shown ? "chevron-down" : "chevron-right",
    );
    head.createSpan({
      cls: "orca-loose-said",
      text: `${book.loose.length} ${many ? "notes" : "note"} in this book's folder ${
        many ? "aren't" : "isn't"
      } in the reading order`,
    });
    const close = head.createSpan({ cls: "orca-loose-close" });
    setIcon(close, "x");
    listen(head, "click", () => {
      this.fold(this.folded, `loose:${book.path}`);
    });
    listen(close, "click", (event) => {
      event.stopPropagation();
      this.fold(this.hidden, book.path);
    });

    if (!shown) return;
    const list = el.createDiv({ cls: "orca-loose-list" });
    for (const path of book.loose) {
      const row = list.createDiv({ cls: "orca-loose-note" });
      row.dataset["testid"] = "orca-loose-note";
      row.dataset["note"] = path;
      row.createSpan({
        cls: "orca-label",
        text: path.slice(path.lastIndexOf("/") + 1, -".md".length),
      });
      this.action(row, "Add", () => {
        this.addNote(book, path, undefined);
      });
    }
  }

  private entryMenu(
    event: MouseEvent,
    book: Shelved,
    group: Grouped,
    row: Row,
    index: number,
  ): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("New chapter here")
        .setIcon("plus")
        .onClick(() => {
          void this.newChapter(book, {
            heading: group.heading,
            at: index + 1,
          });
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
          this.removeEntry(book, row);
        }),
    );
    menu.showAtMouseEvent(event);
  }

  /** `New chapter` and `Add a note`, which every menu here offers. */
  private offerAdding(
    menu: Menu,
    book: Shelved,
    heading: string | undefined,
  ): void {
    menu.addItem((item) =>
      item
        .setTitle("Add a note…")
        .setIcon("search")
        .onClick(() => {
          this.pickNote(book, heading);
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("New chapter")
        .setIcon("plus")
        .onClick(() => {
          void this.newChapter(book, heading);
        }),
    );
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
        this.addNote(book, note.path, heading);
      },
    });
  }

  /** The search in the header, which asks for the book first. */
  private addTo(shelf: Shelved[]): void {
    const one = shelf.find((book) => book.holds) ?? shelf[0];
    if (one === undefined) return;
    if (shelf.length === 1) {
      this.pickNote(one, undefined);
      return;
    }
    pick(this.app, {
      items: shelf,
      label: (book) => book.name,
      placeholder: "Add a note to which book",
      chose: (book) => {
        this.pickNote(book, undefined);
      },
    });
  }

  private addNote(
    book: Shelved,
    path: string,
    heading: string | undefined,
  ): void {
    const note = this.app.vault.getFileByPath(path);
    if (note === null) return;
    void this.edits.addNote(book.path, note, heading);
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
      placeholder: `The note ${row.name} means`,
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

  /** The entry out of the book. The note it links stays in the vault. */
  private removeEntry(book: Shelved, row: Row): void {
    this.change(book.path, (model) => ({
      ...model,
      order: remove(model.order, row.at),
    }));
  }

  private dragged(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === undefined) return;
    if (drag.ghost === undefined) {
      const away = Math.hypot(
        event.clientX - drag.at.x,
        event.clientY - drag.at.y,
      );
      if (away < SLOP) return;
      drag.ghost = this.ghost(drag);
      drag.el.addClass("is-dragged");
    }
    drag.ghost.style.left = `${event.clientX + 12}px`;
    drag.ghost.style.top = `${event.clientY - 12}px`;
    drag.to = this.slot(drag, event);
    this.showRole(drag);
  }

  private dropped(): void {
    const drag = this.drag;
    this.drag = undefined;
    if (drag === undefined) return;
    drag.ghost?.remove();
    drag.el.removeClass("is-dragged");
    this.drop?.remove();
    this.drop = undefined;
    if (drag.ghost === undefined || drag.to === undefined) return;

    const to = drag.to;
    this.change(drag.book.path, (model) => ({
      ...model,
      order: move(model.order, drag.row.at, to),
    }));
  }

  /**
   * Where the entry would land: the place between two rows nearest the
   * pointer, in the book it was picked up from. A pointer outside the
   * navigator lands nowhere and the drag is dropped.
   */
  private slot(drag: Drag, event: PointerEvent): Place | undefined {
    const pane = this.contentEl.getBoundingClientRect();
    if (event.clientY < pane.top || event.clientY > pane.bottom) {
      this.drop?.remove();
      return undefined;
    }
    const shelf = this.contentEl.querySelector(
      `[data-book="${CSS.escape(drag.book.path)}"] .orca-nav-children`,
    );
    if (shelf === null) return undefined;

    let heading = "";
    let at = 0;
    let found: { place: Place; after: Element; away: number } | undefined;
    for (const el of shelf.querySelectorAll("[data-heading], [data-at]")) {
      // A heading's own line is the place above its first entry, and
      // an entry's is the place under it.
      const named = el.getAttribute("data-heading");
      if (named === null) at += 1;
      else {
        heading = named;
        at = 0;
      }
      const away = Math.abs(event.clientY - el.getBoundingClientRect().bottom);
      if (found === undefined || away < found.away) {
        found = { place: { heading, at }, after: el, away };
      }
    }
    if (found === undefined) return undefined;

    const mark = this.marker();
    found.after.insertAdjacentElement("afterend", mark);
    return found.place;
  }

  /** The line the entry would land on. */
  private marker(): HTMLElement {
    const held = this.drop ?? createDiv({ cls: "orca-drop" });
    this.drop = held;
    return held;
  }

  /** The entry under the pointer, and the role the place it is over gives it. */
  private ghost(drag: Drag): HTMLElement {
    const ghost = this.containerEl.ownerDocument.body.createDiv({
      cls: "orca-ghost",
    });
    setIcon(ghost.createSpan({ cls: "orca-ghost-grip" }), "grip-vertical");
    ghost.createSpan({ text: drag.row.name });
    ghost.createSpan({ cls: "orca-chip orca-ghost-role" });
    return ghost;
  }

  private showRole(drag: Drag): void {
    const chip = drag.ghost?.querySelector(".orca-ghost-role");
    if (chip === null || chip === undefined) return;
    const role =
      drag.to === undefined
        ? undefined
        : drag.book.groups.find((group) => group.heading === drag.to?.heading)
            ?.role;
    chip.textContent =
      role === undefined || role === drag.row.role
        ? ""
        : `${drag.row.role} → ${role}`;
  }

  private change(path: string, made: (model: Model) => Model): void {
    void this.edits.edit(path, made);
  }

  private fold(held: Set<string>, key: string): void {
    if (held.has(key)) held.delete(key);
    else held.add(key);
    this.refresh();
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

  private button(
    parent: HTMLElement,
    icon: string,
    label: string,
    clicked: () => void,
  ): void {
    const el = parent.createDiv({ cls: "orca-nav-button" });
    el.setAttribute("aria-label", label);
    setIcon(el, icon);
    listen(el, "click", clicked);
  }

  private action(parent: HTMLElement, said: string, clicked: () => void): void {
    const button = parent.createEl("button", {
      cls: "orca-nav-action",
      text: said,
    });
    listen(button, "click", (event) => {
      event.stopPropagation();
      clicked();
    });
  }
}
