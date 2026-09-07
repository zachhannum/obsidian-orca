import { paintPage } from "fleuron";
import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { SAMPLE, openBook } from "@/book/sample";
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

/** The type the preview is registered under. */
export const PREVIEW_VIEW = "orca-book-preview";

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
 */
export class PreviewView extends ItemView {
  private well: HTMLElement | undefined;
  private surface: HTMLElement | undefined;
  private message: HTMLElement | undefined;
  private folio: HTMLInputElement | undefined;
  private total: HTMLElement | undefined;
  private back: HTMLButtonElement | undefined;
  private on: HTMLButtonElement | undefined;
  private session: Session | undefined;
  private readonly switches = new Map<ViewMode, HTMLButtonElement>();
  private watching: ResizeObserver | undefined;
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
    private readonly opening: Promise<Session>,
    /** Writes the pages being read into the window's status bar. */
    private readonly reading: (text: string | undefined) => void,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PREVIEW_VIEW;
  }

  override getDisplayText(): string {
    return "Book";
  }

  override getIcon(): string {
    return "book";
  }

  override async onOpen(): Promise<void> {
    const pane = this.contentEl;
    pane.empty();
    pane.addClass("orca-preview");
    pane.dataset["testid"] = "orca-preview";
    this.chrome(pane);

    try {
      const session = await this.opening;
      await session.open(openBook(SAMPLE));
      this.session = session;
      await this.turn(0);
    } catch (cause) {
      this.report(
        cause instanceof EngineError ? cause.message : "The book did not set",
      );
    }
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
    this.switches.clear();
    this.session = undefined;
    this.contentEl.empty();
    return Promise.resolve();
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
    this.message = well.createDiv({
      cls: "orca-preview-message",
      text: "Setting the book",
    });
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

  /** Puts a message in the well in place of the pages. */
  private report(text: string): void {
    if (this.message !== undefined) {
      this.message.setText(text);
      return;
    }
    this.message = this.well?.createDiv({ cls: "orca-preview-message", text });
  }
}
