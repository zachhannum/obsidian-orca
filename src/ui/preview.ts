import { paintPage, type Warning } from "fleuron";
import {
  ItemView,
  setIcon,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { BookError } from "@/book/note";
import type { Section } from "@/book/order";
import {
  chapters,
  placeOf,
  sectionOf,
  sectionOn,
  sectionsOn,
  stepChapter,
  type Chapter,
} from "@/book/pages";
import { nodesOn, type Nodes } from "@/book/place";
import { isGenerated } from "@/book/plan";
import { EngineError } from "@/engine/errors";
import type { Reading, Session } from "@/engine/session";
import { THEME_SHEET } from "@/style/theme";
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
import type { Composer, Progress, Typeset } from "@/ui/composer";

/** The type the preview is registered under. */
export const PREVIEW_VIEW = "orca-book-preview";

/** The note a page nobody wrote leads the manuscript to. */
const NOWHERE = "-";

/** The narrowest the warnings are worth hanging under the count, in pixels. */
const NARROW = 240;

/** The place in the manuscript a page opens at. */
export interface Opens {
  note: string;
  /** The byte of that note the page's first paragraph begins at. */
  at: number;
}

/**
 * The book a preview reads, the note and page it opened at, and
 * whether a manuscript pane is tied to it. The workspace keeps all of
 * it but {@link PreviewState.at}, so a leaf restored at startup opens
 * the same book at the same page.
 */
export interface PreviewState {
  book?: string;
  note?: string;
  linked?: boolean;
  /** The page being read, counting from 1. */
  folio?: number;
  /**
   * The byte of the note the manuscript is scrolled to. It says where a
   * book opens rather than where it is, so the workspace never keeps
   * it: a leaf restored at startup opens at the folio instead.
   */
  at?: number;
}

/** The plugin, as much of it as the preview reaches: it owns the other leaves. */
export interface PreviewHandoff {
  /** Gives the leaf back to the manuscript, where the writer left it. */
  asMarkdown(view: PreviewView, note: string): void;
  /**
   * Puts the manuscript pane tied to this one on the line a page opens
   * at, `at` bytes into the note.
   */
  follows(view: PreviewView, note: string, at: number): void;
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
 * A chapter typeset by itself is a different chapter, so a preview
 * opened from a note is the whole book turned to that chapter's first
 * page.
 */
export class PreviewView extends ItemView {
  private well: HTMLElement | undefined;
  private surface: HTMLElement | undefined;
  private message: HTMLElement | undefined;
  private warnings: HTMLButtonElement | undefined;
  private issues: HTMLElement | undefined;
  private folio: HTMLInputElement | undefined;
  private total: HTMLElement | undefined;
  private chapter: HTMLSelectElement | undefined;
  private back: HTMLButtonElement | undefined;
  private on: HTMLButtonElement | undefined;
  private edit: HTMLElement | undefined;
  private session: Session | undefined;
  private composed: Typeset | undefined;
  private readonly switches = new Map<ViewMode, HTMLButtonElement>();
  private watching: ResizeObserver | undefined;
  /** The book note this preview reads, and the note it opened at. */
  private state: PreviewState = {};
  /** The byte of the note the manuscript was scrolled to when it handed over. */
  private caret: number | undefined;
  /** The note the pages on screen read as, which the manuscript follows. */
  private showing: string | undefined;
  /** Counts the books opened here, so a book the author left is dropped. */
  private opening = 0;
  /** The view the book is being read in. */
  private mode: ViewMode = "single";
  /** The chapters the book set, in reading order. */
  private turns: Chapter[] = [];
  /** The chapter the control names, by its place in the reading order. */
  private named: number | undefined;
  /** The chapter the reader last turned to, which the span it opens on is named for. */
  private turnedTo: number | undefined;
  /** The first page being read, counting from 0. */
  private at = 0;
  /** The pages the painted span put on screen. */
  private count = 1;
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
  /** The same, for the searches a moving caret starts. */
  private following = 0;
  /** The same, for the questions a page turn asks on the way back. */
  private leading = 0;
  /** The same, for the question that names the chapter on screen. */
  private naming = 0;
  /** The span the manuscript was last led to, so a repaint moves no caret. */
  private ledAt: number | undefined;
  /**
   * The nodes each page of the painted span names, read off the pages
   * already on screen. After a render the engine is asked where the
   * first of them went, and no page crosses to answer it.
   */
  private painted: Nodes[] = [];
  /** The folio the book opened at here, so a swap back knows it moved. */
  private openedAt: number | undefined;
  /** Stops watching this pane's book for renders. */
  private unwatch: (() => void) | undefined;
  /** Drops this pane's hold on its book, so the book's engine can stop. */
  private holding: (() => void) | undefined;
  /**
   * Whether the author has the warnings open. The count on the bar is
   * what a run that warns puts on screen; the panel opens over the
   * page being read, so nothing opens it but the author.
   */
  private opened = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly composer: Composer,
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
    return this.composed?.name ?? "Book";
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
    this.caret = wanted.at;
    this.state = kept(wanted);
    this.attach();
    if (changed) await this.compose();
    else if (wanted.folio !== undefined) await this.turn(wanted.folio - 1);
    else if (wanted.note !== undefined) await this.turnTo(wanted.note, wanted.at);
  }

  /** The page this preview is turned to, counting from 1, once it has one. */
  get turned(): number | undefined {
    return this.state.folio;
  }

  /** Whether the reader has paged away from where the book opened here. */
  get paged(): boolean {
    return this.openedAt !== undefined && this.state.folio !== this.openedAt;
  }

  /**
   * The place in the manuscript the page being read opens at: the
   * earliest node the page's runs name, taken back to the note it was
   * read from. Nothing for a page orca wrote itself.
   */
  async opensIn(): Promise<Opens | undefined> {
    const session = this.session;
    if (session === undefined) return undefined;
    const reading = await session.read(this.at, 1);
    const page = reading?.pages[0];
    const node = page === undefined ? undefined : nodesOn(page)?.first;
    if (node === undefined) return undefined;
    const source = await session.sourceOf(node);
    if (source === undefined || isGenerated(source.source)) return undefined;
    return { note: source.source, at: source.start };
  }

  /** The book this preview reads, for a plugin pairing it with a manuscript. */
  get book(): string | undefined {
    return this.state.book;
  }

  /**
   * The book this preview is reading, once it is set. The panel designs
   * this one, because a book the composer dropped is still the book on
   * screen.
   */
  get typeset(): Typeset | undefined {
    return this.composed;
  }

  /** Whether a manuscript pane is tied to this one, both ways. */
  get linked(): boolean {
    return this.state.linked === true;
  }

  /** The note this preview's pages read as, for a folio one covers. */
  get note(): string | undefined {
    return this.state.note;
  }

  /** Ties a manuscript pane to this one, for a split made from this side. */
  link(): void {
    this.state = { ...this.state, linked: true };
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
    if (this.state.book !== undefined) await this.compose();
  }

  override onClose(): Promise<void> {
    this.watching?.disconnect();
    this.watching = undefined;
    this.unwatch?.();
    this.unwatch = undefined;
    this.well = undefined;
    this.surface = undefined;
    this.message = undefined;
    this.warnings = undefined;
    this.issues = undefined;
    this.opened = false;
    this.folio = undefined;
    this.total = undefined;
    this.chapter = undefined;
    this.turns = [];
    this.named = undefined;
    this.reading(undefined);
    this.back = undefined;
    this.on = undefined;
    this.edit?.remove();
    this.edit = undefined;
    this.switches.clear();
    // The session belongs to the book, not to this leaf, so closing the
    // leaf costs the next one no second layout. The book is let go of
    // here, and its engine stops a grace later if no other pane holds
    // it.
    this.holding?.();
    this.holding = undefined;
    this.session = undefined;
    this.composed = undefined;
    this.contentEl.empty();
    return Promise.resolve();
  }

  /**
   * Turns to the page the caret `at` bytes into a note is set on, or to
   * the note's first page where the engine read that byte into no node.
   * A note the book does not list turns nothing.
   */
  async turnTo(note: string, at?: number): Promise<void> {
    const typeset = this.composed;
    if (typeset === undefined) return;
    const section = sectionOf(typeset.sections, note);
    if (section === undefined) return;
    const following = (this.following += 1);
    const node = at === undefined ? undefined : await this.nodeIn(note, at);
    if (following !== this.following) return;
    // The span being read already sets that node, so the reader is
    // looking at it and the pane has nowhere to turn. This is also what
    // keeps a manuscript the book itself scrolled from turning it back.
    if (node !== undefined && this.sets(node)) return;
    // A note with no caret in it turns to where its section now opens,
    // and so does one whose caret the engine read into no node.
    const page =
      (node === undefined ? undefined : await this.folioOfNode(node)) ??
      (await this.opensSection(section));
    if (following !== this.following) return;
    if (page === undefined || this.shows(page)) return;
    this.showing = note;
    this.state = { ...this.state, note };
    await this.turn(page, true);
  }

  /** Whether the span being read holds this page. */
  private shows(page: number): boolean {
    return page >= this.at && page < this.at + this.count;
  }

  /**
   * The node `byte` bytes into a note was read into. Nothing where the
   * engine read that byte into none, or cannot answer at all: it has
   * its own reasons to refuse a question, and none of them are worth a
   * page the reader did not ask for.
   */
  private async nodeIn(note: string, byte: number): Promise<number | undefined> {
    try {
      return await this.session?.nodeAt(note, byte);
    } catch {
      return undefined;
    }
  }

  /**
   * The page a node is set on now, counting from 0. The engine answers
   * it off the book as it stands, so a reflow since the last paint is
   * already in the answer.
   */
  private async folioOfNode(node: number): Promise<number | undefined> {
    const session = this.session;
    if (session === undefined) return undefined;
    try {
      const [folios] = await session.foliosOf([node]);
      return folios?.at;
    } catch {
      return undefined;
    }
  }

  /**
   * The page a section opens on now. Nothing where the engine will not
   * answer: it has its own reasons to refuse a question, and none of
   * them are worth the book reporting that it did not set.
   */
  private async opensSection(at: number): Promise<number | undefined> {
    try {
      return await this.composed?.opens(at);
    } catch {
      return undefined;
    }
  }

  /** Whether the runs on the span being read name the node. */
  private sets(node: number): boolean {
    return this.painted.some(
      (nodes) => node >= nodes.first && node <= nodes.last,
    );
  }

  /** Whether the runs on the page at `at` name the node. */
  private async holds(at: number, node: number): Promise<boolean> {
    const session = this.session;
    if (session === undefined) return false;
    try {
      const page = (await session.read(at, 1))?.pages[0];
      const nodes = page === undefined ? undefined : nodesOn(page);
      return nodes !== undefined && node >= nodes.first && node <= nodes.last;
    } catch {
      return false;
    }
  }

  /**
   * The chapter `step` places along from the one on screen, or nothing
   * at either end of the book.
   */
  chapterBy(step: number): Chapter | undefined {
    return stepChapter(this.turns, this.named, step);
  }

  /**
   * Turns to the page a chapter opens on now. Where it opens is asked
   * of the engine at the turn, so a reflow since the book was set is
   * already in the answer.
   */
  async turnToChapter(chapter: Chapter): Promise<void> {
    const at = await this.opensSection(chapter.at);
    if (at === undefined) return;
    // The chapter is kept from the turn, so a spread or a screenful
    // that also carries the one before it is still named for the one
    // the reader asked for, and the next turn command steps from it.
    this.turnedTo = chapter.at;
    this.namesAt(chapter.at);
    await this.turn(at);
  }

  /** Draws the toolbar, the well the pages sit in, and the status line. */
  private chrome(pane: HTMLElement): void {
    const bar = pane.createDiv({ cls: "orca-preview-bar" });
    const views = bar.createDiv({ cls: "orca-preview-views" });
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", "View");
    for (const view of VIEWS) this.switchesTo(views, view);
    bar.createDiv({ cls: "orca-preview-spacer" });

    const warnings = bar.createEl("button", { cls: "orca-preview-warnings" });
    warnings.dataset["testid"] = "orca-warnings";
    warnings.toggleVisibility(false);
    this.warnings = warnings;
    this.registerDomEvent(warnings, "click", () => {
      this.opened = !this.opened;
      this.showsIssues();
    });

    const issues = bar.createDiv({ cls: "orca-preview-issues" });
    issues.dataset["testid"] = "orca-issues";
    issues.toggleVisibility(false);
    this.issues = issues;

    this.shuts(pane, warnings, issues);

    const chapter = bar.createEl("select", {
      cls: "dropdown orca-preview-chapter",
    });
    chapter.setAttribute("aria-label", "Chapter");
    chapter.dataset["testid"] = "orca-chapter";
    this.chapter = chapter;
    bar.createDiv({ cls: "orca-preview-divider" });

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
    this.registerDomEvent(chapter, "change", () => {
      const to = this.turns.find((turn) => String(turn.at) === chapter.value);
      if (to !== undefined) void this.turnToChapter(to);
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
  private async compose(): Promise<void> {
    const book = this.state.book;
    this.unwatch?.();
    this.unwatch = undefined;
    this.session = undefined;
    this.composed = undefined;
    this.named = undefined;
    this.ledAt = undefined;
    this.showing = this.state.note;
    // The pane lets go of the book it was reading. That book's engine
    // stops a grace later, unless another pane holds it.
    this.holding?.();
    this.holding = undefined;
    if (book === undefined) {
      this.report("No book is open");
      return;
    }
    // The book is held before it is set, so its engine is held from the
    // moment it starts rather than from the render that lands.
    this.holding = this.composer.hold(book);
    const opening = (this.opening += 1);
    try {
      const typeset = await this.composer.open(book, {
        note: this.state.note,
        told: (at) => {
          if (opening === this.opening) this.setting(at);
        },
      });
      if (opening !== this.opening) return;
      this.composed = typeset;
      this.session = typeset.session;
      // A render repaginates the book under the reader, so the pane
      // follows the content it was on rather than the page number it
      // was on.
      this.unwatch = typeset.watch(() => {
        void this.reflowed();
      });
      this.offers(chapters(typeset.sections));
      // The book opens where the note asked it to, so the note is
      // already there and the opening turn leads it nowhere.
      await this.turn(await this.opensAt(typeset), true);
      this.openedAt = this.state.folio;
    } catch (cause) {
      if (opening !== this.opening) return;
      this.report(
        cause instanceof EngineError || cause instanceof BookError
          ? cause.message
          : "The book did not set",
      );
    }
  }

  /**
   * The page the book opens at: the one the reader was left on, then
   * the one holding what the manuscript is scrolled to, then the first
   * of the chapter it was toggled from.
   */
  private async opensAt(typeset: Typeset): Promise<number> {
    const folio = this.state.folio;
    const note = this.state.note;
    const at = this.caret;
    const node =
      note === undefined || at === undefined
        ? undefined
        : await this.nodeIn(note, at);
    // The page the book was left on stands while the manuscript is
    // still scrolled inside it. Once it has moved off, the book opens
    // at the page holding what the pane is scrolled to.
    if (folio !== undefined) {
      if (node === undefined || (await this.holds(folio - 1, node))) {
        return folio - 1;
      }
    }
    const section =
      note === undefined ? undefined : sectionOf(typeset.sections, note);
    const found =
      (node === undefined ? undefined : await this.folioOfNode(node)) ??
      (section === undefined ? undefined : await this.opensSection(section));
    if (found !== undefined) return found;
    return folio === undefined ? 0 : folio - 1;
  }

  /**
   * Fills the chapter control with what the book set. A book of one
   * section has nowhere to turn to, so the control goes quiet.
   */
  private offers(turns: Chapter[]): void {
    this.turns = turns;
    const chapter = this.chapter;
    if (chapter === undefined) return;
    chapter.empty();
    for (const turn of turns) {
      chapter.createEl("option", { text: turn.name, value: String(turn.at) });
    }
    chapter.disabled = turns.length < 2;
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
    this.showsIssues();
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
  private async turn(at: number, led = false): Promise<void> {
    // The book's engine stopped to make room for another book. The pane
    // sets the book again, and the reader comes back to the page they
    // asked for.
    if (this.composed?.dropped === true) {
      this.state = { ...this.state, folio: at + 1 };
      await this.compose();
      return;
    }
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
    this.paint(session, reading, led);
  }

  private paint(session: Session, reading: Reading, led: boolean): void {
    const surface = this.surface;
    if (surface === undefined) return;
    const drawn = this.composed?.assets;
    const leaves: Leaf[] = reading.pages.map((page) => ({
      markup: paintPage(page, {
        fonts: reading.fonts,
        assets: reading.assets,
        // The bytes that crossed, decoded here rather than in layout.
        asset: (image) => drawn?.imageUrl(image.url),
      }),
      page: page.number,
      side: page.side,
    }));
    const first = reading.pages[0];
    if (first !== undefined) {
      this.trim = { width: first.width, height: first.height };
    }
    this.painted = reading.pages.flatMap((page) => nodesOn(page) ?? []);
    showPages(surface, {
      mode: this.mode,
      leaves,
      generation: session.generation,
      stages: session.stages,
      pages: reading.length,
      note: this.showing ?? "",
      columns: SEATS[this.mode] ?? this.columns,
      rows: this.mode === "grid" ? this.rows : 1,
    });
    this.settle(reading.at, reading.length, leaves.length);
    this.warns(session);
    void this.namesSpan(reading);
    // A repaint of the span already being read is not a page turn, and
    // neither is one the manuscript asked for.
    if (this.ledAt === reading.at) return;
    this.ledAt = reading.at;
    if (led || !this.linked) return;
    surface.dataset["led"] = "";
    void this.leads();
  }

  /**
   * Draws what the last run had to complain about: a count on the bar,
   * and the warnings themselves under it. A warning is routed, never
   * re-worded, so each card carries the engine's own line and the
   * place it named.
   *
   * A warning against matter orca generated, or against the sheet orca
   * generated, is orca's own defect. The author has nothing to do
   * about either, so those go to the console.
   */
  private warns(session: Session): void {
    const chip = this.warnings;
    const issues = this.issues;
    if (chip === undefined || issues === undefined) return;
    const said: Warning[] = [];
    for (const warning of session.warnings) {
      if (ours(warning)) console.warn(`Orca: ${warning.message}`, warning.origin);
      else said.push(warning);
    }

    chip.toggleVisibility(said.length > 0);
    issues.empty();
    if (said.length === 0) {
      this.opened = false;
      this.showsIssues();
      return;
    }

    const count = said.length === 1 ? "1 warning" : `${String(said.length)} warnings`;
    chip.empty();
    chip.createSpan({ text: count });
    setIcon(chip.createSpan({ cls: "orca-preview-opens" }), "chevron-down");
    chip.setAttribute("aria-label", count);
    for (const warning of said) {
      const card = issues.createDiv({ cls: "orca-preview-issue" });
      card.createDiv({ cls: "orca-preview-issue-said", text: warning.message });
      if (warning.origin !== null) {
        card.createDiv({ cls: "orca-preview-issue-at", text: warning.origin });
      }
    }
    this.showsIssues();
  }

  /**
   * Shuts the warnings on Escape, and on a click in the pane that is
   * neither the panel nor the count that opens it.
   *
   * The pane's own element rather than the window's: an author who
   * goes to the manuscript to fix the note a warning names comes back
   * to the panel as they left it.
   */
  private shuts(
    pane: HTMLElement,
    count: HTMLElement,
    issues: HTMLElement,
  ): void {
    const shut = (): void => {
      this.opened = false;
      this.showsIssues();
    };
    this.registerDomEvent(pane, "pointerdown", (event) => {
      const at = event.target;
      const inside =
        at instanceof Node && (issues.contains(at) || count.contains(at));
      // The count's own click toggles it; a pointer down on it here
      // would shut the panel before that ran.
      if (this.opened && !inside) shut();
    });
    this.registerDomEvent(pane, "keydown", (event) => {
      if (!this.opened || event.key !== "Escape") return;
      event.preventDefault();
      // Focus goes back to the control the panel opened from, and only
      // from inside the panel: a reader paging with the keyboard keeps
      // the well.
      const held = issues.contains(pane.ownerDocument.activeElement);
      shut();
      if (held) count.focus();
    });
  }

  /** Opens or shuts the warnings, and says which on the bar. */
  private showsIssues(): void {
    const issues = this.issues;
    if (issues === undefined) return;
    const open = this.opened && issues.childElementCount > 0;
    if (open) this.placesIssues();
    issues.toggleVisibility(open);
    this.warnings?.setAttribute("aria-expanded", String(open));
    this.warnings?.toggleClass("is-on", open);
  }

  /**
   * Hangs the panel under the count it opens from, and bounds it to
   * the room left of there. The count sits where the bar's own widths
   * put it, so where that is has to be measured rather than written
   * into the sheet. A pane too narrow to hang it there spans the bar
   * instead.
   */
  private placesIssues(): void {
    const issues = this.issues;
    const chip = this.warnings;
    if (issues === undefined || chip === undefined) return;
    const bar = chip.parentElement;
    if (bar === null) return;
    const edge = bar.getBoundingClientRect();
    const count = chip.getBoundingClientRect();
    const gutter = Number.parseFloat(getComputedStyle(bar).paddingLeft) || 0;
    const room = count.right - edge.left - gutter;
    const under = room >= NARROW;
    issues.style.right = `${String(under ? edge.right - count.right : gutter)}px`;
    issues.style.maxWidth = `${String(
      under ? room : Math.max(edge.width - gutter * 2, 0),
    )}px`;
  }

  /**
   * Says where the page turn left the manuscript, so a test waits on
   * the answer rather than on a clock. `NOWHERE` is a page nobody
   * wrote.
   */
  private ledTo(note: string): void {
    if (this.surface !== undefined) this.surface.dataset["led"] = note;
  }

  /**
   * Puts the manuscript tied to this pane on the line the page opens
   * at: the earliest node its runs name, taken back to the note it was
   * read from. Matter orca generated was written by nobody, so a page
   * of it moves no caret.
   */
  private async leads(): Promise<void> {
    const leading = (this.leading += 1);
    const opens = await this.opensIn().catch(() => undefined);
    if (leading !== this.leading) return;
    if (opens === undefined) {
      this.ledTo(NOWHERE);
      return;
    }
    this.handoff.follows(this, opens.note, opens.at);
    this.ledTo(opens.note);
  }

  /** Puts the chrome on the span that is painted. */
  private settle(at: number, pages: number, count: number): void {
    this.at = at;
    this.pages = pages;
    this.count = Math.max(count, 1);
    const first = at + 1;
    // The page being read is the leaf's, so a workspace restored at
    // startup opens the book where it was closed.
    this.state = { ...this.state, folio: first };
    this.app.workspace.requestSaveLayout();
    const last = at + this.count;
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
   * Names the chapter the painted span is at, and the note it reads as,
   * from the sections the pages themselves name. A span that names
   * none, such as a blank verso, keeps the chapter that opened before
   * it.
   */
  private async namesSpan(reading: Reading): Promise<void> {
    const typeset = this.composed;
    const session = this.session;
    if (typeset === undefined || session === undefined) return;
    const naming = (this.naming += 1);
    const places = await this.placesOf(session, typeset, sectionsOn(reading.pages));
    if (naming !== this.naming) return;
    const at = sectionOn(reading.pages, places, this.turnedTo);
    if (at !== undefined) this.namesAt(at);
    // The note the pane reads as is the one the span opens in, and a
    // way back to the manuscript leads there. A spread that opens the
    // next chapter on its recto is still read from the one on the
    // verso.
    const opens = sectionOn(reading.pages.slice(0, 1), places);
    if (opens !== undefined) this.reads(typeset.sections[opens]);
  }

  /** Puts the chapter control on one section of the reading order. */
  private namesAt(at: number): void {
    this.named = at;
    if (this.chapter !== undefined) this.chapter.value = String(at);
  }

  /**
   * The place in the reading order each of these section ids was sent
   * from. The engine answers which source a run was read from, so
   * nothing here pairs an id with an entry by counting.
   */
  private async placesOf(
    session: Session,
    typeset: Typeset,
    ids: number[],
  ): Promise<Map<number, number>> {
    const sources = await Promise.all(
      ids.map((id) => session.sourceOf(id).catch(() => undefined)),
    );
    const places = new Map<number, number>();
    ids.forEach((id, index) => {
      const source = sources[index];
      if (source === undefined) return;
      const at = placeOf(typeset.sections, source.source);
      if (at !== undefined) places.set(id, at);
    });
    return places;
  }

  /**
   * Names the note the painted span reads as, so a leaf restored at
   * startup opens where the reader left the book and the way back to
   * the manuscript leads to the chapter on screen.
   */
  private reads(section: Section | undefined): void {
    const note = section?.kind === "note" ? section.path : undefined;
    if (note === undefined || note === this.showing) return;
    this.showing = note;
    this.state = { ...this.state, note };
    if (this.surface !== undefined) this.surface.dataset["note"] = note;
    this.attach();
  }

  /**
   * Turns to where the content on screen went. A render repaginates the
   * book, so the page the reader was on now carries other words, and
   * the earliest node the span named is the one they were reading. A
   * span that opens on a page the engine wrote alone has no content of
   * its own, and follows the nearest that has.
   */
  private async reflowed(): Promise<void> {
    const node = this.painted[0]?.first;
    const at = node === undefined ? undefined : await this.folioOfNode(node);
    await this.turn(at ?? this.at);
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
   * Draws what the book is waiting on. A whole book has to be typeset
   * before any page of it is right, and the first one has nothing
   * cached, so the wait gets a state rather than an empty pane.
   */
  private setting(progress: Progress): void {
    const well = this.well;
    if (well === undefined) return;
    this.message?.remove();
    const banner = well.createDiv({ cls: "orca-preview-setting" });
    banner.dataset["testid"] = "orca-setting";
    setIcon(banner.createDiv({ cls: "orca-preview-setting-icon" }), "book");
    const name = banner.createDiv({ cls: "orca-preview-setting-name" });
    name.append("Setting ", name.createEl("i", { text: progress.name }));
    const bar = banner.createDiv({ cls: "orca-preview-progress" });
    const fill = bar.createDiv({ cls: "orca-preview-progress-fill" });
    const done = progress.of === 0 ? 0 : progress.read / progress.of;
    fill.style.width = `${String(Math.round(done * 100))}%`;
    const note = banner.createDiv({ cls: "orca-preview-setting-note" });
    note.append(`${String(progress.read)} chapters of ${String(progress.of)}`);
    if (progress.opening !== undefined) {
      note.createEl("br");
      note.append(`it will open at ${progress.opening}`);
    }
    well.prepend(banner);
    this.message = banner;
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

/**
 * A warning orca raised against its own work rather than the author's.
 * The generated matter and the generated sheet are both orca's, and an
 * author has nothing to do about either.
 */
function ours(warning: Warning): boolean {
  const origin = warning.origin;
  return (
    origin !== null && (isGenerated(origin) || origin.startsWith(THEME_SHEET))
  );
}

/** The state a leaf was opened with, as much of it as a preview reads. */
function readState(state: unknown): PreviewState {
  if (typeof state !== "object" || state === null) return {};
  const raw = state as Record<string, unknown>;
  const made: PreviewState = {};
  if (typeof raw["book"] === "string") made.book = raw["book"];
  if (typeof raw["note"] === "string") made.note = raw["note"];
  if (raw["linked"] === true) made.linked = true;
  if (typeof raw["folio"] === "number") made.folio = raw["folio"];
  if (typeof raw["at"] === "number") made.at = raw["at"];
  return made;
}

/** The state the workspace keeps: where a book opens is not part of it. */
function kept({ at, ...state }: PreviewState): PreviewState {
  return state;
}
