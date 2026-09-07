import { paintPage } from "fleuron";
import {
  ItemView,
  setIcon,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { BookError } from "@/book/note";
import { sectionAt, sectionOf } from "@/book/pages";
import { EngineError } from "@/engine/errors";
import type { Reading, Session } from "@/engine/session";
import { copiedText, type SelectionLine } from "@/ui/copy";
import {
  fits,
  nextPage,
  previousPage,
  showPages,
  spanAt,
  turnedTo,
  type Box,
  type Leaf,
  type ViewMode,
  type Viewing,
} from "@/ui/page";
import type { Laid, Progress, Setter } from "@/ui/setter";

/** The type the preview is registered under. */
export const PREVIEW_VIEW = "orca-book-preview";

/**
 * The book a preview reads, the note it opened at, and whether a
 * manuscript pane is tied to it. The workspace keeps this, so a leaf
 * restored at startup opens the same book at the same chapter.
 */
export interface PreviewState {
  book?: string;
  note?: string;
  linked?: boolean;
}

/** The plugin, as much of it as the preview reaches: it owns the other leaves. */
export interface PreviewHandoff {
  /** Gives the leaf back to the manuscript, where the writer left it. */
  asMarkdown(view: PreviewView, note: string): void;
  /** Turns the manuscript pane tied to this one to the note a page reads as. */
  follows(view: PreviewView, note: string): void;
}

/**
 * The sheets a view seats across, where that is the view's own rather
 * than the well's. A spread is always two, so a lone recto sits on the
 * right of the spine and a lone verso on the left.
 */
const SEATS: Partial<Record<ViewMode, number>> = { single: 1, spread: 2 };

/** The three views, in the order the switcher offers them. */
const VIEWS: { mode: ViewMode; icon: string; label: string }[] = [
  { mode: "single", icon: "rectangle-vertical", label: "Single page" },
  { mode: "spread", icon: "columns-2", label: "Spread" },
  { mode: "grid", icon: "layout-grid", label: "Grid" },
];

/**
 * The book, and the chrome to page through it: a view to read it in,
 * previous, next, and a folio you can type. All three views are
 * page-throughs, each turning by what it shows. The painter settles
 * what is on a page, so its markup goes into the surface in one write.
 *
 * A chapter laid out by itself is a different chapter, so a preview
 * opened from a note is the whole book turned to that chapter's first
 * page.
 */
export class PreviewView extends ItemView {
  private well: HTMLElement | undefined;
  private surface: HTMLElement | undefined;
  private message: HTMLElement | undefined;
  private folio: HTMLInputElement | undefined;
  private total: HTMLElement | undefined;
  private back: HTMLButtonElement | undefined;
  private on: HTMLButtonElement | undefined;
  private edit: HTMLElement | undefined;
  private session: Session | undefined;
  private laid: Laid | undefined;
  private readonly switches = new Map<ViewMode, HTMLButtonElement>();
  private watching: ResizeObserver | undefined;
  /** The book note this preview reads, and the note it opened at. */
  private state: PreviewState = {};
  /** The note the pages on screen read as, which the manuscript follows. */
  private showing: string | undefined;
  /** Counts the books opened here, so a book the author left is dropped. */
  private opening = 0;
  /** The view the book is being read in. */
  private mode: ViewMode = "single";
  /** The first page being read, counting from 0. */
  private at = 0;
  /** The book's length in pages, as the last painted span counted it. */
  private pages = 0;
  /** The pages the grid fits on screen, as the well was last measured. */
  private screenful = 1;
  /** The trim the last painted page drew, which sizes the grid. */
  private trim: Box = { width: 0, height: 0 };
  /** The grid the well last measured out, which only the grid view uses. */
  private columns = 1;
  private rows = 1;
  /** The turn the next painted span has to be, so a slow one is dropped. */
  private turning = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly setter: Setter,
    private readonly handoff: PreviewHandoff,
    /** Writes the pages being read into the window's status bar. */
    private readonly reading: (text: string | undefined) => void,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PREVIEW_VIEW;
  }

  override getDisplayText(): string {
    return this.laid?.name ?? "Book";
  }

  override getIcon(): string {
    return "book";
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), ...this.state };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    const wanted = readState(state);
    const changed = wanted.book !== this.state.book;
    this.state = wanted;
    this.attach();
    if (changed) await this.lay();
    else if (wanted.note !== undefined) this.turnTo(wanted.note);
  }

  /** The book this preview reads, for a plugin pairing it with a manuscript. */
  get book(): string | undefined {
    return this.state.book;
  }

  /** Whether a manuscript pane is tied to this one, both ways. */
  get linked(): boolean {
    return this.state.linked === true;
  }

  override async onOpen(): Promise<void> {
    const pane = this.contentEl;
    pane.empty();
    pane.addClass("orca-preview");
    pane.dataset["testid"] = "orca-preview";
    this.chrome(pane);
    // The workspace may have handed this leaf its state before the
    // chrome existed to draw it on, and a paint into a pane with no
    // surface is a paint nobody sees.
    if (this.state.book !== undefined) await this.lay();
  }

  override onClose(): Promise<void> {
    this.watching?.disconnect();
    this.watching = undefined;
    this.well = undefined;
    this.surface = undefined;
    this.message = undefined;
    this.folio = undefined;
    this.total = undefined;
    this.reading(undefined);
    this.back = undefined;
    this.on = undefined;
    this.edit?.remove();
    this.edit = undefined;
    this.switches.clear();
    // The session belongs to the book, not to this leaf, so closing the
    // leaf costs the next one no second layout.
    this.session = undefined;
    this.laid = undefined;
    this.contentEl.empty();
    return Promise.resolve();
  }

  /**
   * Turns to a note's first page, unless the pages on screen already
   * read as that note. A page is the smallest thing a manuscript can
   * name here, so the link is chapter by chapter.
   */
  turnTo(note: string): void {
    const laid = this.laid;
    if (laid === undefined) return;
    const at = sectionOf(laid.sections, note);
    if (at === undefined) return;
    const range = laid.ranges.get(at);
    if (range === undefined) return;
    if (sectionAt(laid.ranges, this.at + 1) === at) return;
    this.showing = note;
    this.state = { ...this.state, note };
    void this.turn(range.first - 1);
  }

  /** Draws the toolbar, the well the pages sit in, and the status line. */
  private chrome(pane: HTMLElement): void {
    const bar = pane.createDiv({ cls: "orca-preview-bar" });
    const views = bar.createDiv({ cls: "orca-preview-views" });
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", "View");
    for (const view of VIEWS) this.switchesTo(views, view);
    bar.createDiv({ cls: "orca-preview-spacer" });

    this.back = this.turnsTo(bar, "chevron-left", "Previous page", () =>
      previousPage(this.viewing()),
    );
    const folio = bar.createEl("input", { cls: "orca-preview-folio" });
    folio.type = "text";
    folio.inputMode = "numeric";
    folio.setAttribute("aria-label", "Page");
    folio.dataset["testid"] = "orca-folio";
    this.folio = folio;
    this.total = bar.createSpan({ cls: "orca-preview-total" });
    this.on = this.turnsTo(bar, "chevron-right", "Next page", () =>
      nextPage(this.viewing()),
    );

    const well = pane.createDiv({ cls: "orca-preview-well" });
    // The pane pages through from the keyboard, so the well the pages
    // sit in is what a Tab or a click on a page reaches.
    well.tabIndex = 0;
    this.well = well;
    this.report("Setting the book");
    const surface = well.createDiv({ cls: "orca-preview-sheets" });
    surface.dataset["testid"] = "orca-sheets";
    this.surface = surface;

    this.registerDomEvent(folio, "change", () => {
      this.typed(folio.value);
    });
    this.registerDomEvent(this.containerEl, "keydown", (event) => {
      // The folio is a field, so Home and End belong to its caret.
      if (event.target === folio) return;
      const to = turnedTo(event.key, this.viewing());
      if (to === undefined) return;
      event.preventDefault();
      void this.turn(to);
    });
    this.registerDomEvent(this.containerEl, "copy", (event) => {
      this.copy(event);
    });

    // The grid asks for as many pages as the well fits, so a well that
    // changes size is a different screenful and a fresh request.
    const watching = new ResizeObserver(() => {
      this.measure();
    });
    watching.observe(surface);
    this.watching = watching;
  }

  /**
   * Puts the way back to the manuscript in the view's header, for a
   * preview the author toggled into from a note. One opened from the
   * ribbon has no manuscript to go back to.
   */
  private attach(): void {
    const note = this.state.note;
    if (note === undefined) {
      this.edit?.remove();
      this.edit = undefined;
      return;
    }
    this.edit ??= this.addAction("file-text", "Open as markdown", () => {
      const at = this.state.note;
      if (at !== undefined) this.handoff.asMarkdown(this, at);
    });
  }

  /** Sets the book this preview was opened on, reporting what it waits for. */
  private async lay(): Promise<void> {
    const book = this.state.book;
    this.session = undefined;
    this.laid = undefined;
    this.showing = this.state.note;
    if (book === undefined) {
      this.report("No book is open");
      return;
    }
    const opening = (this.opening += 1);
    try {
      const laid = await this.setter.open(book, {
        note: this.state.note,
        told: (at) => {
          if (opening === this.opening) this.setting(at);
        },
      });
      if (opening !== this.opening) return;
      this.laid = laid;
      this.session = laid.session;
      await this.turn(this.opensAt(laid));
    } catch (cause) {
      if (opening !== this.opening) return;
      this.report(
        cause instanceof EngineError || cause instanceof BookError
          ? cause.message
          : "The book did not set",
      );
    }
  }

  /** The page the book opens at: the first of the chapter it was toggled from. */
  private opensAt(laid: Laid): number {
    const note = this.state.note;
    const at = note === undefined ? undefined : sectionOf(laid.sections, note);
    const range = at === undefined ? undefined : laid.ranges.get(at);
    return range === undefined ? 0 : range.first - 1;
  }

  /** A button that reads the book in one of the three views. */
  private switchesTo(
    views: HTMLElement,
    view: { mode: ViewMode; icon: string; label: string },
  ): void {
    const button = views.createEl("button", { cls: "clickable-icon" });
    button.setAttribute("aria-label", view.label);
    button.dataset["view"] = view.mode;
    setIcon(button, view.icon);
    this.switches.set(view.mode, button);
    this.registerDomEvent(button, "click", () => {
      void this.show(view.mode);
    });
  }

  /** A button that turns to the page `to` names. */
  private turnsTo(
    bar: HTMLElement,
    icon: string,
    label: string,
    to: () => number,
  ): HTMLButtonElement {
    const button = bar.createEl("button", { cls: "clickable-icon" });
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    this.registerDomEvent(button, "click", () => {
      void this.turn(to());
    });
    return button;
  }

  /** Reads the book in `mode`, from the page it is already open at. */
  private async show(mode: ViewMode): Promise<void> {
    if (mode === this.mode) return;
    this.mode = mode;
    this.measure();
    await this.turn(this.at);
  }

  /** The reader's place in the book, which a turn is worked out from. */
  private viewing(): Viewing {
    return {
      mode: this.mode,
      at: this.at,
      pages: this.pages,
      screenful: this.screenful,
    };
  }

  /**
   * Reads how many pages the grid fits, and turns again when that has
   * changed, since the span it asks for is the span it shows.
   */
  private measure(): void {
    const surface = this.surface;
    if (surface === undefined) return;
    const grid = fits(
      { width: surface.clientWidth, height: surface.clientHeight },
      this.trim,
    );
    this.columns = grid.columns;
    this.rows = grid.rows;
    const screenful = grid.columns * grid.rows;
    if (screenful === this.screenful) return;
    this.screenful = screenful;
    if (this.mode === "grid") void this.turn(this.at);
  }

  /** Reads a typed folio, and puts the span being read back when it is not one. */
  private typed(value: string): void {
    const folio = Number.parseInt(value, 10);
    if (Number.isNaN(folio)) {
      this.settle(this.at, this.pages, 1);
      return;
    }
    void this.turn(spanAt(this.mode, folio - 1, this.screenful).at);
  }

  /**
   * Paints the span at `at`. A turn the reader has already typed past
   * is dropped rather than painted behind the one they are on.
   */
  private async turn(at: number): Promise<void> {
    const session = this.session;
    if (session === undefined) return;
    const span = spanAt(this.mode, at, this.screenful);
    const turn = (this.turning += 1);
    const reading = await session.read(span.at, span.count);
    if (turn !== this.turning || this.surface === undefined) return;
    if (reading === undefined) {
      this.report("The book set to no pages");
      return;
    }
    this.message?.remove();
    this.message = undefined;
    this.paint(session, reading);
  }

  private paint(session: Session, reading: Reading): void {
    const surface = this.surface;
    if (surface === undefined) return;
    const leaves: Leaf[] = reading.pages.map((page) => ({
      markup: paintPage(page, { fonts: reading.fonts, assets: reading.assets }),
      page: page.number,
      side: page.side,
    }));
    const first = reading.pages[0];
    if (first !== undefined) {
      this.trim = { width: first.width, height: first.height };
    }
    showPages(surface, {
      mode: this.mode,
      leaves,
      generation: session.generation,
      stages: session.stages,
      pages: reading.length,
      columns: SEATS[this.mode] ?? this.columns,
      rows: this.mode === "grid" ? this.rows : 1,
    });
    this.settle(reading.at, reading.length, leaves.length);
  }

  /** Puts the chrome on the span that is painted. */
  private settle(at: number, pages: number, count: number): void {
    this.at = at;
    this.pages = pages;
    const first = at + 1;
    const last = at + Math.max(count, 1);
    if (this.folio !== undefined) this.folio.value = String(first);
    this.total?.setText(`of ${String(pages)}`);
    this.reading(
      last > first
        ? `pages ${String(first)}–${String(last)} of ${String(pages)}`
        : `page ${String(first)} of ${String(pages)}`,
    );
    for (const [mode, button] of this.switches) {
      button.toggleClass("is-on", mode === this.mode);
      button.setAttribute("aria-pressed", String(mode === this.mode));
    }
    if (this.back !== undefined) this.back.disabled = at === 0;
    if (this.on !== undefined) this.on.disabled = last >= pages;
    this.reads(first);
  }

  /**
   * Names the chapter the painted span reads as, and turns a manuscript
   * tied to this pane to it. The note is kept either way, so a leaf
   * restored at startup opens where the reader left the book.
   */
  private reads(folio: number): void {
    const laid = this.laid;
    if (laid === undefined) return;
    const at = sectionAt(laid.ranges, folio);
    const section = at === undefined ? undefined : laid.sections[at];
    if (section?.kind !== "note") return;
    if (section.path === this.showing) return;
    this.showing = section.path;
    this.state = { ...this.state, note: section.path };
    this.attach();
    if (this.linked) this.handoff.follows(this, section.path);
  }

  /**
   * Answers a copy off the pages with the painter's own selection
   * layer, so what lands on the clipboard is what the author wrote,
   * in reading order, rather than what the browser makes of a run of
   * SVG text elements.
   */
  private copy(event: ClipboardEvent): void {
    const surface = this.surface;
    if (surface === undefined) return;
    const selection = this.containerEl.ownerDocument.getSelection();
    if (selection === null || selection.isCollapsed) return;
    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!surface.contains(range.commonAncestorContainer)) return;
    const lines: SelectionLine[] = [
      ...surface.querySelectorAll("text[data-selection-line]"),
    ];
    const text = copiedText(lines, range);
    if (text === undefined) return;
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
  }

  /**
   * Draws what the book is waiting on. A whole book has to be laid out
   * before any page of it is right, and the first one has nothing
   * cached, so the wait gets a state rather than an empty pane.
   */
  private setting(progress: Progress): void {
    const well = this.well;
    if (well === undefined) return;
    this.message?.remove();
    const held = well.createDiv({ cls: "orca-preview-setting" });
    held.dataset["testid"] = "orca-setting";
    setIcon(held.createDiv({ cls: "orca-preview-setting-icon" }), "book");
    const name = held.createDiv({ cls: "orca-preview-setting-name" });
    name.append("Setting ", name.createEl("i", { text: progress.name }));
    const bar = held.createDiv({ cls: "orca-preview-progress" });
    const fill = bar.createDiv({ cls: "orca-preview-progress-fill" });
    const done = progress.of === 0 ? 0 : progress.read / progress.of;
    fill.style.width = `${String(Math.round(done * 100))}%`;
    const note = held.createDiv({ cls: "orca-preview-setting-note" });
    note.append(`${String(progress.read)} chapters of ${String(progress.of)}`);
    if (progress.opening !== undefined) {
      note.createEl("br");
      note.append(`it will open at ${progress.opening}`);
    }
    well.prepend(held);
    this.message = held;
  }

  /** Puts a message in the well in place of the pages. */
  private report(text: string): void {
    this.message?.remove();
    const message = this.well?.createDiv({
      cls: "orca-preview-message",
      text,
    });
    if (message !== undefined) this.well?.prepend(message);
    this.message = message;
  }
}

/** The state a leaf was opened with, as much of it as a preview reads. */
function readState(state: unknown): PreviewState {
  if (typeof state !== "object" || state === null) return {};
  const held = state as Record<string, unknown>;
  const made: PreviewState = {};
  if (typeof held["book"] === "string") made.book = held["book"];
  if (typeof held["note"] === "string") made.note = held["note"];
  if (held["linked"] === true) made.linked = true;
  return made;
}
