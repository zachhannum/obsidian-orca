import {
  paintPage,
  type Inspection,
  type NodeSource,
  type Page,
  type Warning,
} from "fleuron";
import {
  ItemView,
  setIcon,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { BookError } from "@/book/note";
import { entryName, type Section } from "@/book/order";
import {
  chapters,
  placeOf,
  sectionOf,
  sectionOn,
  sectionsOn,
  stepChapter,
  type Chapter,
} from "@/book/pages";
import {
  anchorOf,
  heldOn,
  opensOn,
  pagesOf,
  type Landed,
  type Shown,
  type Written,
} from "@/book/place";
import { isGenerated } from "@/book/plan";
import { EngineDead, EngineError } from "@/engine/errors";
import type { Reading, Session } from "@/engine/session";
import { ACTIONS } from "@/ui/actions";
import { copiedText, type SelectionLine } from "@/ui/copy";
import { PREVIEW_ICON } from "@/ui/icon";
import {
  fits,
  isViewMode,
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
import { headingOn, headingsOf, outline, type Showing } from "@/ui/outline";
import {
  INSPECT_OFF,
  clicked,
  escape,
  mapAnchor,
  pointOn,
  sameBox,
  stillPinned,
  targetKey,
  targetOf,
  type InspectState,
  type Pin,
  type Target,
} from "@/ui/inspect";
import { mountOverlay, type MountedOverlay } from "@/ui/overlay";
import type { PageUnit } from "@/style/design";
import type { Place } from "@/style/origin";
import { groupTitle, issueGroups, routeOf, type IssueGroup } from "@/ui/warnings";

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
  /** The view the book is being read in. */
  view?: ViewMode;
  /**
   * The blocks the manuscript is showing. They say where a book opens
   * rather than where it is, so the workspace never keeps them: a leaf
   * restored at startup opens at the folio instead.
   */
  over?: Shown[];
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
  /**
   * Opens the place a warning named with the caret on it: a note in a
   * manuscript pane, or the author's CSS in the design panel.
   */
  opens(view: PreviewView, route: IssueGroup["route"], place: Place): void;
  /**
   * Told when a box is pinned, when a paint finds the pin again, and
   * with nothing when the pin comes off. A pin found again is
   * `refreshed`, so the author's own click is the one that opens a panel.
   */
  inspected(view: PreviewView, pin: Pin | undefined, refreshed: boolean): void;
  /** The unit the author measures pages in, which the inspect tag sizes a box in. */
  unit(): PageUnit;
  /** The view a preview opens in, which is the one the last switch chose. */
  view(): ViewMode;
  /** Told which view the author switched to, so the next preview opens in it. */
  viewed(mode: ViewMode): void;
  /** Opens the export dialog on the book this view reads. */
  exports(book: string): void;
  /** Adds a new chapter at the end of the book's body. */
  adds(book: string): void;
  /** Whether a navigator lists headings, which is the only reason to ask where they are. */
  outlined(): boolean;
  /**
   * Told the entry and the heading the painted span falls under, and
   * nothing when the view closes.
   */
  showing(view: PreviewView, showing: Showing | undefined): void;
}

/** A box the pointer found, and the generation the answer is from. */
interface Probed {
  target: Target;
  inspection: Inspection;
  generation: number;
}

/** A pin found again after a paint. */
interface Refound {
  target: Target;
  anchor: NodeSource | undefined;
  inspection: Inspection;
  /** The note's text the new anchor counts bytes in. */
  text: string | undefined;
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
  /** The blocks the manuscript was showing when it handed over. */
  private over: Shown[] | undefined;
  /** The note the pages on screen read as, which the manuscript follows. */
  private showing: string | undefined;
  /** Counts the books opened here, so a book the author left is dropped. */
  private opening = 0;
  /** The view the book is being read in. */
  private mode: ViewMode;
  /** The chapters the book set, in reading order. */
  private turns: Chapter[] = [];
  /** The chapter the control names, by its place in the reading order. */
  private named: number | undefined;
  /** The chapter the reader last turned to, which the span it opens on is named for. */
  private turnedTo: number | undefined;
  /** The line of the heading the reader last turned to, which wins a page it shares. */
  private askedLine: number | undefined;
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
   * The page the reader turned to, counting from 0. A spread pairs that
   * page with the one facing it, so this is the page they asked for
   * rather than the page the span opens at.
   */
  private asked = 0;
  /**
   * The blocks that page set, and the bytes of each the page carried.
   * After a render the engine is asked where those blocks went, and the
   * page setting the most of their lines is the one the reader comes
   * back to.
   */
  private blocks: Written[] = [];
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
  /** The overlay inspect mode draws, beside the surface in the well. */
  private overlay: MountedOverlay | undefined;
  /** The header action that turns inspect mode on and off. */
  private inspectAction: HTMLElement | undefined;
  private exportAction: HTMLElement | undefined;
  private inspecting: InspectState = INSPECT_OFF;
  /** The box under the pointer. */
  private hovered: Probed | undefined;
  /** The text of the note the pin's anchor counts bytes in. */
  private pinText: string | undefined;
  /** The turn the next hover answer has to be, so a slow one is dropped. */
  private hovering = 0;
  /**
   * The same, for a click. A click keeps its own turn, so the hover the
   * pointer's move queued ahead of it cannot drop the pin it asked for.
   */
  private clicking = 0;
  /** The same, for finding the pin again after a paint. */
  private pinning = 0;
  /** The last pointer position, which the next animation frame asks about. */
  private pointer: { x: number; y: number } | undefined;
  private framing = false;
  /** The trim of each painted page, counting from 0, in points. */
  private trims = new Map<number, Box>();
  /** Raised on each paint and resize, so the overlay measures the pages again. */
  private measured = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly composer: Composer,
    private readonly handoff: PreviewHandoff,
    /** Writes the pages being read into the window's status bar. */
    private readonly reading: (text: string | undefined) => void,
  ) {
    super(leaf);
    this.mode = handoff.view();
  }

  override getViewType(): string {
    return PREVIEW_VIEW;
  }

  override getDisplayText(): string {
    return this.composed?.name ?? "Book";
  }

  override getIcon(): string {
    return PREVIEW_ICON;
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), ...this.state, view: this.mode };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    const wanted = readState(state);
    const changed = wanted.book !== this.state.book;
    const reviewed = wanted.view !== undefined && wanted.view !== this.mode;
    if (wanted.view !== undefined) this.mode = wanted.view;
    this.over = wanted.over;
    this.state = kept(wanted);
    this.attach();
    if (reviewed) this.marksView();
    if (changed) await this.compose();
    else if (wanted.folio !== undefined) await this.turn(wanted.folio - 1);
    else if (wanted.note !== undefined) await this.turnTo(wanted.note, wanted.over);
    else if (reviewed) await this.turn(this.at);
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
   * The place in the manuscript the page the reader is on opens at: the
   * first block that begins on that page, taken back to the note it was
   * read from. A paragraph carried over from the page before begins on
   * the page before, so a sliver of one at the top of a page leads
   * nowhere. Nothing for a page orca wrote itself.
   */
  async opensIn(): Promise<Opens | undefined> {
    const session = this.session;
    const node = opensOn(this.blocks);
    if (session === undefined || node === undefined) return undefined;
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
    this.exportAction ??= this.addAction(ACTIONS.export.icon, ACTIONS.export.label, () => {
      const book = this.state.book;
      if (book !== undefined) this.handoff.exports(book);
    });
    this.inspectAction ??= this.addAction(ACTIONS.inspect.icon, ACTIONS.inspect.label, () => {
      this.toggleInspect();
    });
    this.inspectAction.setAttribute("aria-pressed", "false");
    this.ordersActions();
    // The workspace may have handed this leaf its state before the
    // chrome existed to draw it on, and a paint into a pane with no
    // surface is a paint nobody sees.
    if (this.state.book !== undefined) await this.compose();
  }

  override onClose(): Promise<void> {
    this.setInspecting(INSPECT_OFF);
    this.overlay?.unmount();
    this.overlay = undefined;
    this.inspectAction?.remove();
    this.inspectAction = undefined;
    this.exportAction?.remove();
    this.exportAction = undefined;
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
    this.askedLine = undefined;
    this.reading(undefined);
    this.handoff.showing(this, undefined);
    this.back = undefined;
    this.on = undefined;
    this.edit?.remove();
    this.edit = undefined;
    this.switches.clear();
    // The session belongs to the book, not to this leaf, so closing the
    // leaf costs the next one no second layout. The pane drops the book
    // here. Its engine stops one grace later unless another pane holds
    // it.
    this.holding?.();
    this.holding = undefined;
    this.session = undefined;
    this.composed = undefined;
    // A book still setting lands on a closed pane. The pane drops it
    // rather than watch it, or it would set the book again each time the
    // book is dropped.
    this.opening += 1;
    this.contentEl.empty();
    return Promise.resolve();
  }

  /**
   * Turns to the page a manuscript showing these blocks is showing most
   * of, or to the note's first page where the engine read them into no
   * node. A note the book does not list turns nothing.
   */
  async turnTo(note: string, over?: Shown[]): Promise<void> {
    const typeset = this.composed;
    if (typeset === undefined) return;
    const section = sectionOf(typeset.sections, note);
    if (section === undefined) return;
    const following = (this.following += 1);
    // A note showing nothing orca set turns to where its section opens,
    // and so does one whose blocks the engine read into no node.
    const page =
      (over === undefined ? undefined : await this.pageOver(note, over)) ??
      (await this.opensSection(section));
    if (following !== this.following) return;
    // The span being read is already that page, so the reader is looking
    // at it and the pane has nowhere to turn. This is also what keeps a
    // manuscript the book itself scrolled from turning it back.
    if (page === undefined || this.shows(page)) return;
    this.showing = note;
    this.state = { ...this.state, note };
    await this.turn(page, true);
  }

  /**
   * The page a manuscript showing these blocks is showing most of,
   * counting from 0. Each block is taken back to the page it is set on,
   * and the page carrying the most of the pane wins, so a sliver of a
   * heading at the top does not outweigh the page filling the rest of
   * it.
   *
   * Nothing where the engine read none of them into a node, or will not
   * answer: it has its own reasons to refuse a question, and none of
   * them are worth a page the reader did not ask for.
   */
  private async pageOver(
    note: string,
    over: Shown[],
  ): Promise<number | undefined> {
    const session = this.session;
    if (session === undefined || over.length === 0) return undefined;
    const shown = new Map<number, number>();
    for (const block of over) {
      shown.set(block.at, (shown.get(block.at) ?? 0) + block.pixels);
    }
    const weighed: Landed[] = [];
    for (const [at, pixels] of shown) {
      const node = await this.nodeIn(note, at);
      if (node !== undefined) weighed.push({ at: node, holds: pixels });
    }
    if (weighed.length === 0) return undefined;
    try {
      const runs = await session.foliosOf(weighed.map((one) => one.at));
      const landed: Landed[] = [];
      for (const [index, one] of weighed.entries()) {
        const on = runs[index];
        if (on !== undefined) landed.push({ at: on.at, holds: one.holds });
      }
      return anchorOf(landed);
    } catch {
      return undefined;
    }
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

  /**
   * The chapter `step` places along from the one on screen, or nothing
   * at either end of the book.
   */
  chapterBy(step: number): Chapter | undefined {
    return stepChapter(this.turns, this.named, step);
  }

  /**
   * Turns to the page a chapter opens on now, and answers whether it
   * turned. Where it opens is asked of the engine at the turn, so a
   * reflow since the book was set is already in the answer. A chapter
   * the book set to no page turns nothing.
   */
  async turnToChapter(chapter: Chapter): Promise<boolean> {
    return await this.turnToPlace(chapter);
  }

  /**
   * Turns to where a section opens, by its place in the reading order,
   * and answers whether it turned. A section the book did not set
   * turns nothing.
   */
  async turnToSection(at: number, line?: number): Promise<boolean> {
    const chapter = this.turns.find((turn) => turn.at === at);
    if (chapter === undefined) return false;
    const page = line === undefined ? undefined : await this.opensLine(at, line);
    if (line === undefined || page === undefined) return await this.turnToPlace(chapter);
    this.turnedTo = at;
    this.askedLine = line;
    this.namesAt(at);
    await this.turn(page);
    return true;
  }

  /** The page a line of a section's note opens on, or nothing where the engine set it on none. */
  private async opensLine(at: number, line: number): Promise<number | undefined> {
    try {
      return (await this.composed?.linesOpen(at, [line]))?.[0];
    } catch {
      return undefined;
    }
  }

  private async turnToPlace(chapter: Chapter): Promise<boolean> {
    const at = await this.opensSection(chapter.at);
    if (at === undefined) return false;
    // The chapter is kept from the turn, so a spread or a screenful
    // that also carries the one before it is still named for the one
    // the reader asked for, and the next turn command steps from it.
    this.turnedTo = chapter.at;
    this.askedLine = undefined;
    this.namesAt(chapter.at);
    await this.turn(at);
    return true;
  }

  /** Draws the toolbar, the well the pages sit in, and the status line. */
  private chrome(pane: HTMLElement): void {
    const bar = pane.createDiv({ cls: "orca-preview-bar" });
    const views = bar.createDiv({ cls: "orca-preview-views" });
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", "View");
    for (const view of VIEWS) this.switchesTo(views, view);
    this.marksView();
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
    this.overlay = mountOverlay(surface);
    this.inspects(surface);

    this.registerDomEvent(folio, "change", () => {
      this.typed(folio.value);
    });
    this.registerDomEvent(chapter, "change", () => {
      const to = this.turns.find((turn) => String(turn.at) === chapter.value);
      if (to === undefined) return;
      // A chapter the book set to no page leaves the reader where they
      // are, so the control goes back to the chapter on screen rather
      // than name one the pane is not showing.
      const named = this.named;
      void this.turnToChapter(to).then((turned) => {
        if (!turned && named !== undefined) this.namesAt(named);
      });
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

  /** Puts the way to markdown in the view's header. */
  private attach(): void {
    this.edit ??= this.addAction(ACTIONS.markdown.icon, ACTIONS.markdown.label, () => {
      void this.toMarkdown();
    });
    this.ordersActions();
  }

  /**
   * Hands the pane to the note the page being read opens in. A page orca
   * wrote alone goes to the note read last, and a book read no further
   * than its generated matter goes to the nearest note in the reading
   * order. Only a book that lists no note goes to the book note.
   */
  private async toMarkdown(): Promise<void> {
    const opens = await this.opensIn().catch(() => undefined);
    const at = opens?.note ?? this.state.note ?? this.nearestNote() ?? this.state.book;
    if (at === undefined) return;
    this.setInspecting(INSPECT_OFF);
    this.handoff.asMarkdown(this, at);
  }

  /** The first note at or after the section on screen, or else the last one before it. */
  private nearestNote(): string | undefined {
    const sections = this.composed?.sections ?? [];
    const from = this.named ?? 0;
    let before: string | undefined;
    for (const [at, section] of sections.entries()) {
      if (section.kind !== "note") continue;
      if (at >= from) return section.path;
      before = section.path;
    }
    return before;
  }

  /** Puts the inspect action left of the way back to the manuscript, as the artboard draws them. */
  private ordersActions(): void {
    const inspect = this.inspectAction;
    const edit = this.edit;
    if (inspect === undefined || edit === undefined) return;
    if (edit.previousElementSibling !== inspect) edit.before(inspect);
  }

  /** Turns inspect mode on, or off with the pin and the hover. */
  toggleInspect(): void {
    this.setInspecting(this.inspecting.on ? INSPECT_OFF : { on: true, pin: undefined });
  }

  /** Takes the pin off, and leaves inspect mode as it was. */
  unpin(): void {
    if (this.inspecting.pin === undefined) return;
    this.setInspecting({ on: this.inspecting.on, pin: undefined });
  }

  /**
   * Pins the box one node names, for the pane's crumb for the element a
   * pinned pseudo-element belongs to. Nothing where the engine no
   * longer answers for that node.
   */
  async pinNode(node: number): Promise<void> {
    const session = this.session;
    if (session === undefined || !this.inspecting.on) return;
    const turn = (this.clicking += 1);
    const generation = session.generation;
    let inspection;
    try {
      inspection = await session.inspect(node);
    } catch {
      return;
    }
    if (inspection === undefined || turn !== this.clicking || !this.inspecting.on) return;
    const anchor = await this.anchorOf(node);
    if (turn !== this.clicking || !this.inspecting.on) return;
    const pin: Pin = { target: { kind: "node", node }, inspection, generation };
    if (anchor !== undefined) pin.anchor = anchor;
    this.pinning += 1;
    this.inspecting = { on: true, pin };
    this.pinText = anchor === undefined ? undefined : this.composed?.textOf(anchor.source);
    this.drawsOverlay();
    this.handoff.inspected(this, pin, true);
  }

  /** Whether inspect mode is on. */
  get inspectOn(): boolean {
    return this.inspecting.on;
  }

  private setInspecting(next: InspectState): void {
    const unpinned = this.inspecting.pin !== undefined && next.pin === undefined;
    this.inspecting = next;
    if (!next.on) {
      this.hovering += 1;
      this.clicking += 1;
      this.hovered = undefined;
      this.pointer = undefined;
    }
    if (next.pin === undefined) {
      this.pinning += 1;
      this.pinText = undefined;
    }
    this.inspectAction?.toggleClass("is-active", next.on);
    this.inspectAction?.setAttribute("aria-pressed", String(next.on));
    this.drawsOverlay();
    if (unpinned) this.handoff.inspected(this, undefined, false);
  }

  private drawsOverlay(): void {
    const { on, pin } = this.inspecting;
    const hovered = this.hovered;
    this.overlay?.draw({
      on,
      hovered:
        hovered === undefined
          ? undefined
          : { key: targetKey(hovered.target), inspection: hovered.inspection },
      pinned:
        pin === undefined
          ? undefined
          : {
              key: targetKey(pin.target),
              inspection: pin.inspection,
              generation: pin.generation,
            },
      unit: this.handoff.unit(),
      trims: this.trims,
      measured: this.measured,
    });
  }

  /**
   * Listens for the pointer on the surface and for Escape on the view.
   * A hover is asked about at most once an animation frame, and a click
   * pins what is under it.
   */
  private inspects(surface: HTMLElement): void {
    this.registerDomEvent(surface, "pointermove", (event) => {
      if (!this.inspecting.on) return;
      this.pointer = { x: event.clientX, y: event.clientY };
      if (this.framing) return;
      this.framing = true;
      const view = surface.ownerDocument.defaultView ?? window;
      view.requestAnimationFrame(() => {
        this.framing = false;
        const at = this.pointer;
        if (at !== undefined) void this.hovers(at);
      });
    });
    this.registerDomEvent(surface, "pointerleave", () => {
      if (!this.inspecting.on) return;
      this.hovering += 1;
      this.pointer = undefined;
      this.hovered = undefined;
      this.drawsOverlay();
    });
    this.registerDomEvent(surface, "click", (event) => {
      if (!this.inspecting.on) return;
      event.preventDefault();
      void this.pins({ x: event.clientX, y: event.clientY });
    });
    // The warnings panel shuts on its own Escape first, and marks the
    // key taken.
    this.registerDomEvent(this.containerEl, "keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const next = escape(this.inspecting);
      if (next === this.inspecting) return;
      event.preventDefault();
      this.setInspecting(next);
    });
  }

  private async hovers(at: { x: number; y: number }): Promise<void> {
    const turn = (this.hovering += 1);
    const found = await this.probe(at);
    if (turn !== this.hovering || !this.inspecting.on) return;
    this.hovered = found;
    this.drawsOverlay();
  }

  /** Pins the box under a click, and hands the pin to the plugin. */
  private async pins(at: { x: number; y: number }): Promise<void> {
    const turn = (this.clicking += 1);
    // A hover still out is older than the click, and its answer is dropped.
    this.hovering += 1;
    const found = await this.probe(at);
    if (turn !== this.clicking || !this.inspecting.on) return;
    this.hovered = found;
    if (clicked(this.inspecting, found?.target) === "unpin") {
      this.setInspecting({ on: true, pin: undefined });
      return;
    }
    if (found === undefined) {
      this.drawsOverlay();
      return;
    }
    const anchor =
      found.target.kind === "node" ? await this.anchorOf(found.target.node) : undefined;
    if (turn !== this.clicking || !this.inspecting.on) return;
    const pin: Pin = {
      target: found.target,
      inspection: found.inspection,
      generation: found.generation,
    };
    if (anchor !== undefined) pin.anchor = anchor;
    // A refind still running is for the pin this one replaces.
    this.pinning += 1;
    this.inspecting = { on: true, pin };
    this.pinText = anchor === undefined ? undefined : this.composed?.textOf(anchor.source);
    this.drawsOverlay();
    this.handoff.inspected(this, pin, false);
  }

  /** The bytes of a note a node was read from. Nothing for matter orca wrote itself. */
  private async anchorOf(node: number): Promise<NodeSource | undefined> {
    try {
      const source = await this.session?.sourceOf(node);
      return source === undefined || isGenerated(source.source) ? undefined : source;
    } catch {
      return undefined;
    }
  }

  /**
   * The box at a point on the screen: the painted page under it, the
   * element the engine hits there, and the margin box where it hits none.
   */
  private async probe(at: { x: number; y: number }): Promise<Probed | undefined> {
    const session = this.session;
    const surface = this.surface;
    if (session === undefined || surface === undefined) return undefined;
    for (const sheet of surface.querySelectorAll<HTMLElement>(".orca-page[data-page]")) {
      const page = Number(sheet.dataset["page"]) - 1;
      const trim = this.trims.get(page);
      if (trim === undefined) continue;
      const point = pointOn(sheet.getBoundingClientRect(), trim, at.x, at.y);
      if (point === undefined) continue;
      const generation = session.generation;
      try {
        const node = await session.hit(page, point.x, point.y);
        const held = this.hovered;
        if (
          node !== undefined &&
          held?.generation === generation &&
          held.target.kind === "node" &&
          held.target.node === node
        ) {
          return held;
        }
        const inspection =
          node === undefined
            ? await session.marginBoxAt(page, point.x, point.y)
            : await session.inspect(node);
        const target = inspection === undefined ? undefined : targetOf(inspection, page);
        if (inspection === undefined || target === undefined) return undefined;
        return { target, inspection, generation };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Finds the pin again once a paint has landed a new generation, and
   * takes it off where the box is gone. A node id names a node only
   * until the next edit, so the pin is found by the bytes it was read
   * from, carried through the edit.
   */
  private async refinds(session: Session): Promise<void> {
    const pin = this.inspecting.pin;
    if (pin === undefined || pin.generation === session.generation) return;
    const pinning = (this.pinning += 1);
    const generation = session.generation;
    let found: Refound | undefined;
    try {
      found = await this.refound(session, pin);
    } catch {
      found = undefined;
    }
    if (pinning !== this.pinning || this.inspecting.pin !== pin) return;
    if (found === undefined) {
      this.setInspecting({ on: this.inspecting.on, pin: undefined });
      return;
    }
    const next: Pin = { target: found.target, inspection: found.inspection, generation };
    if (found.anchor !== undefined) next.anchor = found.anchor;
    this.inspecting = { ...this.inspecting, pin: next };
    this.pinText = found.text;
    this.drawsOverlay();
    this.handoff.inspected(this, next, true);
  }

  private async refound(session: Session, pin: Pin): Promise<Refound | undefined> {
    const { target, anchor } = pin;
    if (target.kind === "margin") {
      const inspection = await session.inspectMarginBox(target.page, target.box);
      return inspection === undefined
        ? undefined
        : { target, anchor: undefined, inspection, text: undefined };
    }
    if (anchor === undefined) {
      const inspection = await session.inspect(target.node);
      return inspection !== undefined && sameBox(inspection, pin.inspection)
        ? { target, anchor: undefined, inspection, text: undefined }
        : undefined;
    }
    const text = this.composed?.textOf(anchor.source);
    const before = this.pinText;
    const moved =
      text === undefined || before === undefined ? anchor : mapAnchor(anchor, before, text);
    if (moved === undefined) return undefined;
    const node = await session.nodeAt(moved.source, moved.start);
    const inspection = node === undefined ? undefined : await session.inspect(node);
    if (inspection === undefined) return undefined;
    // The first byte of a box can be read into an element inside it
    // that starts there too, so the box is looked for up the chain.
    const chain = [inspection.node ?? node, ...[...inspection.ancestors].reverse().map((up) => up.node)];
    for (const candidate of chain) {
      if (candidate === null || candidate === undefined) continue;
      const source = await session.sourceOf(candidate);
      if (source === undefined || !stillPinned(moved, source)) {
        if (source !== undefined && source.start < moved.start) return undefined;
        continue;
      }
      const found =
        candidate === inspection.node ? inspection : await session.inspect(candidate);
      if (found === undefined || !sameBox(found, pin.inspection)) continue;
      return { target: { kind: "node", node: candidate }, anchor: source, inspection: found, text };
    }
    return undefined;
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
    // A pin names a box in the book being dropped.
    if (this.inspecting.pin !== undefined) {
      this.setInspecting({ on: this.inspecting.on, pin: undefined });
    }
    // The pane drops the book it holds.
    this.holding?.();
    this.holding = undefined;
    if (book === undefined) {
      this.report("No book is open");
      return;
    }
    // The pane holds the book before it sets the book, so the hold
    // starts with the engine rather than with the render that comes
    // back.
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
      // The engine of this book died more times than orca sets it
      // again, so the pages already painted are the ones there are.
      if (cause instanceof EngineDead) {
        this.held(cause);
        return;
      }
      this.report(
        cause instanceof EngineError || cause instanceof BookError
          ? cause.message
          : "The book did not set",
      );
    }
  }

  /**
   * The page the book opens at: the one the manuscript is showing most
   * of, then the one the reader was left on, then the first of the
   * chapter it was toggled from.
   */
  private async opensAt(typeset: Typeset): Promise<number> {
    const folio = this.state.folio;
    const note = this.state.note;
    const over = this.over;
    const showing =
      note === undefined || over === undefined
        ? undefined
        : await this.pageOver(note, over);
    // The page the book was left on stands while the manuscript is
    // still showing most of it. Once it has moved off, the book opens at
    // the page the manuscript is showing most of.
    if (folio !== undefined && (showing === undefined || showing === folio - 1)) {
      return folio - 1;
    }
    if (showing !== undefined) return showing;
    const section =
      note === undefined ? undefined : sectionOf(typeset.sections, note);
    const found =
      section === undefined ? undefined : await this.opensSection(section);
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

  /**
   * Reads the book in `mode`, from the page it is already open at. The
   * view is the leaf's and the machine's both, so the pane keeps it
   * across a restart and the next preview opens in it.
   */
  private async show(mode: ViewMode): Promise<void> {
    if (mode === this.mode) return;
    this.mode = mode;
    this.marksView();
    this.handoff.viewed(mode);
    this.app.workspace.requestSaveLayout();
    this.measure();
    await this.turn(this.at);
  }

  /** Marks the switch of the view the book is being read in. */
  private marksView(): void {
    for (const [mode, button] of this.switches) {
      button.toggleClass("is-on", mode === this.mode);
      button.setAttribute("aria-pressed", String(mode === this.mode));
    }
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
    if (this.inspecting.on) {
      this.measured += 1;
      this.drawsOverlay();
    }
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
    const wanted = Math.max(at, 0);
    const turn = (this.turning += 1);
    let reading: Reading | undefined;
    try {
      reading = await session.read(span.at, span.count);
    } catch {
      // The engine stopped under the read. The pages already painted
      // stay while the book is set again on a new engine.
      return;
    }
    if (turn !== this.turning || this.surface === undefined) return;
    if (reading === undefined) {
      this.empty();
      return;
    }
    this.message?.remove();
    this.message = undefined;
    this.paint(session, reading, wanted, led);
  }

  private paint(
    session: Session,
    reading: Reading,
    wanted: number,
    led: boolean,
  ): void {
    const surface = this.surface;
    if (surface === undefined) return;
    const drawn = this.composed?.assets;
    const leaves: Leaf[] = reading.pages.map((page, index) => ({
      markup: paintPage(page, {
        fonts: reading.fonts,
        assets: reading.assets,
        // The bytes that crossed, decoded here rather than in layout.
        asset: (image) => drawn?.imageUrl(image.url),
      }),
      // A page's own number is the folio it prints, which restarts where
      // the body begins. A view turns by place in the book.
      page: reading.at + index + 1,
      folio: page.number,
      side: page.side,
    }));
    const first = reading.pages[0];
    if (first !== undefined) {
      this.trim = { width: first.width, height: first.height };
    }
    // The book can be shorter than the page asked for, and the read
    // lands on the pages it has.
    const on = Math.min(
      Math.max(wanted - reading.at, 0),
      Math.max(reading.pages.length - 1, 0),
    );
    this.asked = reading.at + on;
    const read = reading.pages[on];
    this.blocks = read === undefined ? [] : heldOn(read);
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
    this.trims = new Map(
      reading.pages.map((page, index) => [
        reading.at + index,
        { width: page.width, height: page.height },
      ]),
    );
    this.measured += 1;
    if (this.hovered?.generation !== session.generation) this.hovered = undefined;
    this.drawsOverlay();
    void this.refinds(session);
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
   * and the warnings themselves under it, one group per note. A warning
   * is routed, never re-worded, so each card carries the engine's own
   * line, and the place it named is a link that opens the note there.
   *
   * A warning against matter orca generated, or against a sheet orca
   * wrote, is orca's own defect. The author has nothing to do about
   * either, so those go to the console. One against the author's CSS
   * is listed here and also drawn on its line in the panel's editor.
   */
  private warns(session: Session): void {
    const chip = this.warnings;
    const issues = this.issues;
    if (chip === undefined || issues === undefined) return;
    const said: Warning[] = [];
    for (const warning of session.warnings) {
      const route = routeOf(warning);
      if (route === "orca") console.warn(`Orca: ${warning.message}`, warning.origin);
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
    for (const group of issueGroups(said)) {
      const set = issues.createDiv({ cls: "orca-preview-issue-group" });
      set.dataset["testid"] = "orca-issue-group";
      const head = set.createDiv({ cls: "orca-preview-issue-head" });
      head.createSpan({ cls: "orca-preview-issue-title", text: groupTitle(group) });
      head.createSpan({
        cls: "orca-preview-issue-count",
        text: String(group.issues.length),
      });
      for (const issue of group.issues) {
        const card = set.createDiv({ cls: "orca-preview-issue" });
        card.createDiv({ cls: "orca-preview-issue-said", text: issue.message });
        const place = issue.place;
        if (place === undefined) continue;
        const at = card.createDiv({ cls: "orca-preview-issue-at" });
        const open = at.createEl("button", {
          cls: "orca-preview-issue-open",
          text: `${place.sheet}:${String(place.line)}:${String(place.column)}`,
        });
        open.dataset["testid"] = "orca-issue-open";
        // The cards are drawn again on every run, so the listener goes
        // with the card rather than onto the view.
        open.addEventListener("click", () => {
          this.handoff.opens(this, group.route, place);
        });
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
    this.marksView();
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
    await this.marksShown(typeset, reading, naming);
  }

  /**
   * Tells the navigator the entry the span is named for, and the
   * heading in it the span falls under. The engine answers where each
   * heading was set.
   */
  private async marksShown(typeset: Typeset, reading: Reading, naming: number): Promise<void> {
    const book = this.book;
    const at = this.named;
    if (book === undefined || at === undefined) return;
    const section = typeset.sections[at];
    const cached =
      this.handoff.outlined() && section?.kind === "note"
        ? outline(headingsOf(this.app, section.path), entryName(section.entry))
        : [];
    const lines = cached.map((heading) => heading.line);
    const pages =
      lines.length === 0
        ? []
        : await typeset.linesOpen(at, lines).catch(() => lines.map(() => undefined));
    if (naming !== this.naming) return;
    const span = { first: reading.at, last: reading.at + reading.pages.length - 1 };
    const line = headingOn(pages, lines, span, this.askedLine);
    this.handoff.showing(this, { book, at, line });
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
   * Turns to where the page on screen went. A render repaginates the
   * book, so the page the reader was on now carries other words. The
   * blocks that page set are asked for again, and the reader comes back
   * to whichever page now sets the most of their lines. A page the
   * engine wrote alone set no blocks of its own, and stays where it is.
   */
  private async reflowed(): Promise<void> {
    await this.turn((await this.anchored()) ?? this.asked);
  }

  /**
   * The page setting the most of what the reader's page set, counting
   * from 0. Nothing where that page set no blocks of its own, or where
   * the engine will not say where they went: it has its own reasons to
   * refuse a question, and none of them are worth a page the reader did
   * not ask for.
   */
  private async anchored(): Promise<number | undefined> {
    const session = this.session;
    const held = this.blocks;
    if (session === undefined || held.length === 0) return undefined;
    try {
      const runs = await session.foliosOf(held.map((block) => block.node));
      const landed: Landed[] = [];
      for (const [index, block] of held.entries()) {
        const on = runs[index];
        if (on === undefined) continue;
        landed.push(...(await pagesOf(block, on, (page) => this.pageAt(page))));
      }
      return anchorOf(landed);
    } catch {
      return undefined;
    }
  }

  /** One page of the book as it stands, counting from 0. */
  private async pageAt(at: number): Promise<Page | undefined> {
    return (await this.session?.read(at, 1))?.pages[0];
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
    // A book being set for the first time has no pages yet. One being
    // set again has the pages from before, and they stay under it.
    if (progress.again) banner.addClass("mod-again");
    setIcon(
      banner.createDiv({ cls: "orca-preview-setting-icon" }),
      progress.again ? "rotate-cw" : "book",
    );
    const name = banner.createDiv({ cls: "orca-preview-setting-name" });
    name.append("Setting ", name.createEl("i", { text: progress.name }));
    if (progress.again) name.append(" again");
    const bar = banner.createDiv({ cls: "orca-preview-progress" });
    const fill = bar.createDiv({ cls: "orca-preview-progress-fill" });
    const done = progress.of === 0 ? 0 : progress.read / progress.of;
    fill.style.width = `${String(Math.round(done * 100))}%`;
    const note = banner.createDiv({ cls: "orca-preview-setting-note" });
    if (progress.again) {
      note.append("nothing you wrote was lost");
      note.createEl("br");
      note.append(`you will come back to page ${String(this.at + 1)}`);
    } else {
      note.append(`${String(progress.read)} chapters of ${String(progress.of)}`);
      if (progress.opening !== undefined) {
        note.createEl("br");
        note.append(`it will open at ${progress.opening}`);
      }
    }
    well.prepend(banner);
    this.message = banner;
  }

  /**
   * The pages, held. The engine of this book died more times than orca
   * sets the book again, so orca starts no third one. Opening the book
   * again is the reader's own try. The report is what each death said,
   * for an author who has one to send on.
   */
  private held(dead: EngineDead): void {
    const well = this.well;
    if (well === undefined) return;
    this.message?.remove();
    const banner = well.createDiv({ cls: "orca-preview-setting mod-held" });
    banner.dataset["testid"] = "orca-held";
    setIcon(
      banner.createDiv({ cls: "orca-preview-setting-icon" }),
      "alert-triangle",
    );
    const name = banner.createDiv({ cls: "orca-preview-setting-name" });
    name.append("Orca could not set the book again");
    const note = banner.createDiv({ cls: "orca-preview-setting-note" });
    note.append("the pages here are the ones from before");
    note.createEl("br");
    note.append("open the book again to try once more");
    const report = banner.createEl("button", {
      cls: "orca-preview-report",
      text: "Copy the report",
    });
    report.dataset["testid"] = "orca-report";
    this.registerDomEvent(report, "click", () => {
      void navigator.clipboard.writeText(dead.log.join("\n"));
    });
    well.prepend(banner);
    this.message = banner;
  }

  /**
   * Draws a book that set to no pages, which is a book with nothing in
   * it yet, and offers the chapter it is missing.
   */
  private empty(): void {
    const well = this.well;
    const book = this.book;
    if (well === undefined || book === undefined) return;
    this.message?.remove();
    const state = well.createDiv({ cls: "orca-preview-setting mod-empty" });
    state.dataset["testid"] = "orca-empty";
    setIcon(state.createDiv({ cls: "orca-preview-setting-icon" }), "book");
    const name = state.createDiv({ cls: "orca-preview-setting-name" });
    name.append(name.createEl("i", { text: this.getDisplayText() }), " has no pages yet");
    const adding = state.createEl("button", { cls: "mod-cta", text: "New chapter" });
    adding.dataset["testid"] = "orca-new-chapter";
    this.registerDomEvent(adding, "click", () => {
      this.handoff.adds(book);
    });
    well.prepend(state);
    this.message = state;
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
  const raw = state as Record<string, unknown>;
  const made: PreviewState = {};
  if (typeof raw["book"] === "string") made.book = raw["book"];
  if (typeof raw["note"] === "string") made.note = raw["note"];
  if (raw["linked"] === true) made.linked = true;
  if (typeof raw["folio"] === "number") made.folio = raw["folio"];
  if (isViewMode(raw["view"])) made.view = raw["view"];
  const over = raw["over"];
  if (Array.isArray(over)) made.over = over as Shown[];
  return made;
}

/** The state the workspace keeps: where a book opens is not part of it. */
function kept({ over, ...state }: PreviewState): PreviewState {
  return state;
}
