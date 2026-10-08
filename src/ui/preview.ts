import {
  paintPage,
  type Inspection,
  type NodeSource,
  type Page,
  type Warning,
} from "fleuron";
import {
  ItemView,
  Scope,
  setIcon,
  type Modifier,
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
  sourceNamed,
  spinePlaces,
  stepChapter,
  type Chapter,
} from "@/book/pages";
import {
  anchorOf,
  heldOn,
  lineByte,
  opensOn,
  pagesOf,
  showsAny,
  topShown,
  type Landed,
  type Shown,
  type Span,
  type Written,
} from "@/book/place";
import { isGenerated } from "@/book/plan";
import { EngineDead, EngineError } from "@/engine/errors";
import type { Reading, Session } from "@/engine/session";
import { ACTIONS } from "@/ui/actions";
import { copiedText, type SelectionLine } from "@/ui/copy";
import { device } from "@/ui/desktop";
import { footPlace, liftFor, sheetCover, sheets, type Foot } from "@/ui/device";
import { PREVIEW_ICON } from "@/ui/icon";
import {
  fits,
  isViewMode,
  nextPage,
  previousPage,
  pressSheet,
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
  FIT,
  clampZoom,
  pinchZoom,
  scrollTo,
  shareOf,
  steppedIn,
  steppedOut,
  wheelZoom,
  zooms,
} from "@/ui/zoom";
import { mountZoom, type MountedZoom } from "@/ui/zoomed";
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
import { stepOf, type Anchor } from "@/ui/frame";
import { followAt, type Follow } from "@/ui/links";
import { mountOverlay, type MountedOverlay } from "@/ui/overlay";
import {
  mountReflow,
  type Finger,
  type MountedReflow,
  type Screen,
  type TouchPhase,
} from "@/ui/reflow";
import { openSheet, type Sheet } from "@/ui/sheet";
import type { PageUnit } from "@/style/design";
import type { ReaderStored } from "@/style/reader";
import type { Place } from "@/style/origin";
import {
  fontGroup,
  groupTitle,
  issueGroups,
  routeOf,
  tally,
  withEpub,
  type IssueGroup,
} from "@/ui/issues";

/** The type the preview is registered under. */
export const PREVIEW_VIEW = "orca-book-preview";

/** The note a page nobody wrote leads the manuscript to. */
const NOWHERE = "-";

/** The narrowest the warnings are worth hanging under the count, in pixels. */
const NARROW = 240;

/**
 * The pages that turn in the book drawn while it is laid out, by the
 * second each starts at. Each lands on the left page exactly, so the
 * loop back to the right is not seen.
 */
const BOOK_TURNS = [0, -0.6, -1.2];

/**
 * A place to turn to, as each view finds it. The page views ask the
 * engine for a page. The EPUB view asks for the node a byte of a source
 * was read into, because a byte outlives an edit and a node does not.
 */
interface Spot {
  /** The section's place in the reading order, which is where the frame turns when the byte was read into no node. */
  at?: number;
  /** A byte of a source the place is at. */
  from?: { source: string; byte: number };
  /** The page the place is on, counting from 0, or nothing where the page views have nowhere to turn. */
  page(): Promise<number | undefined>;
  /** Run once the place is found, before the view turns to it. */
  found?(): void;
}

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
  /** Set when the pane shows the EPUB view in place of that page view. */
  epub?: boolean;
  /**
   * The blocks the manuscript is showing. They say where a book opens
   * rather than where it is, so the workspace never keeps them: a leaf
   * restored at startup opens at the folio instead.
   */
  over?: Shown[];
  /**
   * The byte of the note the pane was left at when it was last swapped
   * for the manuscript. The EPUB view opens there while the manuscript
   * still shows the block, as the page left stands for a page view.
   * The workspace never keeps it.
   */
  left?: number;
  /**
   * Set when a click on a link asks for the folio. The turn goes into
   * the leaf's history, so Obsidian's back and forward return across it.
   * The workspace never keeps it.
   */
  followed?: boolean;
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
  /** Whether a preview opens in the EPUB view, which it does when the last switch chose it. */
  epub(): boolean;
  /** Told the author switched to the EPUB view, so the next preview opens in it. */
  epubbed(): void;
  /** The device and the reader settings the EPUB view opens with. */
  reader(): ReaderStored;
  /** Told the device and the reader settings after a change, so the plugin keeps them. */
  reads(reader: ReaderStored): void;
  /** Opens the export dialog on the book this view reads. */
  exports(book: string): void;
  /** Adds a new chapter at the end of the book's body. */
  adds(book: string): void;
  /**
   * The deepest heading level a navigator lists for the book, or
   * nothing when none lists its headings, which is the only reason to
   * ask where they are.
   */
  outlined(book: string): Promise<number | undefined>;
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
 * The fourth switch, which shows the book's EPUB in a frame. It is not
 * a page view: no page is laid out for it. It is kept beside the page
 * view, in the leaf and in the plugin's data, so a pane that leaves it
 * goes back to the page view it had.
 */
const EPUB = { view: "epub", icon: "tablet", label: "EPUB" };

/** The class the pane carries while it shows the EPUB view. */
const REFLOWING = "is-reflow";

/** The class of the controls that page through the page views alone. */
const PAGING = "orca-preview-paging";

/** The class the surface carries while a page is drawn larger than fit. */
const ZOOMED = "is-zoomed";

/** The class the well carries while it holds a focus the keyboard gave it. */
const TABBED = "is-tabbed";

/** The classes the surface carries while Space is held, and while a drag moves the page. */
const HAND = "is-hand";
const GRIPPED = "is-gripped";

/** A drag that moves the page: where the pointer and the scroll began. */
interface Grip {
  pointer: number;
  scroller: HTMLElement;
  x: number;
  y: number;
  left: number;
  top: number;
}

/** A point in the window, in pixels. */
interface Point {
  x: number;
  y: number;
}

/** A place on a sheet, as a share of its width and its height. */
interface Held {
  sheet: Element;
  x: number;
  y: number;
}

/**
 * The thing a zoom acts on: the pages, or the device of the EPUB view.
 * The EPUB view draws its room when it has a book, so a pane without
 * one has nothing to scroll.
 */
interface Stage {
  /** The element that carries the zoom, as a variable, a class and a data attribute. */
  marked: HTMLElement;
  /** The box the zoomed sheets scroll in. */
  scroller: HTMLElement | undefined;
  /** The selector of the sheets the zoom enlarges. */
  sheets: string;
}

/** A pinch in progress: the zoom and the place it began from. */
interface Pinch {
  zoom: number;
  apart: number;
  held: Held | undefined;
}

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
  private issuesCount: HTMLButtonElement | undefined;
  private issues: HTMLElement | undefined;
  private folio: HTMLInputElement | undefined;
  private total: HTMLElement | undefined;
  private chapter: HTMLSelectElement | undefined;
  private back: HTMLButtonElement | undefined;
  private on: HTMLButtonElement | undefined;
  private edit: HTMLElement | undefined;
  private bar: HTMLElement | undefined;
  private spacer: HTMLElement | undefined;
  /** The row under the page, which holds the folio where there is no status bar. */
  private foot: HTMLElement | undefined;
  private controls: HTMLElement | undefined;
  private placed: Foot | undefined;
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
  /** The sheet a phone opens the warnings in, while it is open. */
  private warned: Sheet | undefined;
  /** The overlay inspect mode draws, beside the surface in the well. */
  private overlay: MountedOverlay | undefined;
  /** The header action that turns inspect mode on and off. */
  private inspectAction: HTMLElement | undefined;
  /**
   * The element a phone keeps over the foot of the screen, which the
   * design panel draws the inspect pane in as a sheet.
   */
  private sheetHost: HTMLElement | undefined;
  private lifting: ResizeObserver | undefined;
  private sliding: MutationObserver | undefined;
  /** The distance the page is moved up so the sheet clears the pinned box, in pixels. */
  private lifted = 0;
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
  /** Each painted page, by its place in the book counting from 0. */
  private painted = new Map<number, Page>();
  /** Raised on each paint and resize, so the overlay measures the pages again. */
  private measured = 0;
  /** The EPUB view, beside the surface in the well. */
  private reflow: MountedReflow | undefined;
  private reflowSwitch: HTMLButtonElement | undefined;
  /** Whether the pane shows the EPUB view in place of the pages. */
  private reflowing = false;
  /** The ask the next EPUB has to answer, so a slow one is dropped. */
  private asking = 0;
  /** The size the pages are drawn at, as a multiple of the fitted size. */
  private zoom = FIT;
  private zoomer: MountedZoom | undefined;
  private pinch: Pinch | undefined;
  /** Whether Space is held over a zoomed page, so a drag moves it. */
  private hand = false;
  private grip: Grip | undefined;
  /** Whether the drag that just ended moved the page, so its click is dropped. */
  private gripped = false;
  /** The node the EPUB view sits in, which carries what the surface carries for the pages. */
  private host: HTMLElement | undefined;
  /** The generation the spine below was read from. */
  private spineOf: number | undefined;
  /** The place in the reading order of each document of the EPUB, by the node of its section. */
  private spine = new Map<number, number>();
  /** The same the other way, for a chapter the engine read no byte of into a node. */
  private sectionNodes = new Map<number, number>();
  /** The screen the frame last laid out. */
  private screen: Screen | undefined;
  /** The bytes of its source that screen holds. */
  private span: ({ source: string } & Span) | undefined;
  /** A turn the frame could not take yet, because it held another generation. */
  private wanted: { spot: Spot; led: boolean } | undefined;
  /** The same turn counter the page views keep, for a turn of the frame. */
  private seeking = 0;
  /** Whether the manuscript asked for the turn the frame is making, which then leads it nowhere. */
  private seekLed = false;
  /** Whether the reader turned the frame since the book opened here. */
  private strayed = false;
  /** The blocks a manuscript showed when it was swapped for this pane, until the frame has opened on them. */
  private arriving: Shown[] | undefined;
  /** The byte of the note the pane was left at before that swap. */
  private leftAt: number | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly composer: Composer,
    private readonly handoff: PreviewHandoff,
    /** Writes the pages being read into the window's status bar. */
    private readonly reading: (text: string | undefined) => void,
  ) {
    super(leaf);
    this.mode = handoff.view();
    this.reflowing = handoff.epub();
    // Obsidian binds these keys to the window's own zoom, and the pane's
    // scope sees a key first. A view that does not zoom lets it through.
    this.scope = new Scope(this.app.scope);
    const keys: [Modifier[], string, () => void][] = [
      [["Mod"], "=", () => this.zoomIn()],
      [["Mod"], "+", () => this.zoomIn()],
      [["Mod", "Shift"], "+", () => this.zoomIn()],
      [["Mod"], "-", () => this.zoomOut()],
      [["Mod"], "0", () => this.zoomFit()],
    ];
    for (const [modifiers, key, zoom] of keys) {
      this.scope.register(modifiers, key, () => {
        if (!this.zoomable) return undefined;
        zoom();
        return false;
      });
    }
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
    return { ...super.getState(), ...this.state, view: this.mode, epub: this.reflowing };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    const wanted = readState(state);
    const changed = wanted.book !== this.state.book;
    result.history =
      wanted.followed === true && !changed && wanted.folio !== this.state.folio;
    const reviewed = wanted.view !== undefined && wanted.view !== this.mode;
    if (wanted.view !== undefined) this.mode = wanted.view;
    // A state that names a page view is a whole one, so it also says
    // whether the pane shows the EPUB view in its place.
    const reflowed = wanted.view !== undefined && (wanted.epub === true) !== this.reflowing;
    if (reflowed) this.setReflowing(wanted.epub === true);
    this.over = wanted.over;
    this.arriving = wanted.over;
    this.leftAt = wanted.left;
    this.state = kept(wanted);
    this.attach();
    if (reviewed) this.marksView();
    if (changed) await this.compose();
    else if (wanted.folio !== undefined) await this.turn(wanted.folio - 1);
    else if (wanted.note !== undefined) await this.turnTo(wanted.note, wanted.over);
    else if (reviewed || reflowed) await this.turn(this.at);
    // The frame opens again on the place the state named.
    if (this.reflowing && !changed) {
      this.span = undefined;
      void this.reflows();
    }
  }

  /** The page this preview is turned to, counting from 1, once it has one. */
  get turned(): number | undefined {
    return this.state.folio;
  }

  /** Whether the reader has paged away from where the book opened here. */
  get paged(): boolean {
    return this.strayed || (this.openedAt !== undefined && this.state.folio !== this.openedAt);
  }

  /**
   * The place in the manuscript the page the reader is on opens at: the
   * first block that begins on that page, taken back to the note it was
   * read from. A paragraph carried over from the page before begins on
   * the page before, so a sliver of one at the top of a page leads
   * nowhere. Nothing for a page orca wrote itself.
   *
   * In the EPUB view the place is the one the screen opens at.
   */
  async opensIn(): Promise<Opens | undefined> {
    const session = this.session;
    if (this.reflowing) {
      const span = this.span;
      if (span === undefined || isGenerated(span.source)) return undefined;
      return { note: span.source, at: span.start };
    }
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
    // A pane that opens in the EPUB view never draws the page controls.
    pane.toggleClass(REFLOWING, this.reflowing);
    this.chrome(pane);
    // On mobile the artboard draws Export in the preview's bar.
    if (device() === "desktop") {
      this.exportAction ??= this.addAction(ACTIONS.export.icon, ACTIONS.export.label, () => {
        this.exports();
      });
    }
    this.inspectAction ??= this.addAction(ACTIONS.inspect.icon, ACTIONS.inspect.label, () => {
      this.toggleInspect();
    });
    this.inspectAction.setAttribute("aria-pressed", "false");
    if (this.reflowing) this.inspectAction.setAttribute("aria-disabled", "true");
    this.ordersActions();
    // The workspace may have handed this leaf its state before the
    // chrome existed to draw it on, and a paint into a pane with no
    // surface is a paint nobody sees.
    if (this.state.book !== undefined) await this.compose();
  }

  override onClose(): Promise<void> {
    this.warned?.close();
    this.setInspecting(INSPECT_OFF);
    this.overlay?.unmount();
    this.overlay = undefined;
    this.lifting?.disconnect();
    this.lifting = undefined;
    this.sliding?.disconnect();
    this.sliding = undefined;
    this.sheetHost?.remove();
    this.sheetHost = undefined;
    this.reflow?.unmount();
    this.reflow = undefined;
    this.zoomer?.unmount();
    this.zoomer = undefined;
    this.zoom = FIT;
    this.pinch = undefined;
    this.hand = false;
    this.grip = undefined;
    this.reflowSwitch = undefined;
    this.asking += 1;
    this.contentEl.removeClass(REFLOWING);
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
    this.issuesCount = undefined;
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
    this.bar = undefined;
    this.spacer = undefined;
    this.foot = undefined;
    this.placed = undefined;
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
    // The screen being read already holds a block the pane shows. This
    // is what keeps a manuscript the frame scrolled from turning it
    // back.
    const span = this.span;
    if (this.reflowing && over !== undefined && span?.source === note && showsAny(over, span)) {
      return;
    }
    // A pane shows more than a screen holds, so the frame goes to the
    // block at the top of the pane.
    const top = over === undefined ? undefined : topShown(over);
    const following = (this.following += 1);
    await this.goes(
      {
        at: section,
        ...(top === undefined ? {} : { from: { source: note, byte: top } }),
        page: async () => {
          // A note showing nothing orca set turns to where its section
          // opens, and so does one whose blocks the engine read into no
          // node.
          const page =
            (over === undefined ? undefined : await this.pageOver(note, over)) ??
            (await this.opensSection(section));
          if (following !== this.following) return undefined;
          // The span being read is already that page, so the reader is
          // looking at it and the pane has nowhere to turn. This is
          // also what keeps a manuscript the book itself scrolled from
          // turning it back.
          return page === undefined || this.shows(page) ? undefined : page;
        },
        found: () => {
          if (this.reflowing) return;
          this.showing = note;
          this.state = { ...this.state, note };
        },
      },
      true,
    );
  }

  /**
   * Turns the view that is on to a place, and answers whether it had
   * somewhere to turn: the frame in the EPUB view, and the pages in
   * any other. Every turn to a place ends here.
   */
  private async goes(spot: Spot, led = false): Promise<boolean> {
    if (this.reflowing) return await this.seeks(spot, led);
    const page = await spot.page();
    if (page === undefined) return false;
    spot.found?.();
    await this.turn(page, led);
    return true;
  }

  /**
   * Turns the frame to the screen that holds a place. A frame that
   * holds another generation than the session is on cannot find the
   * place yet, so the turn is kept for the screen it lays out next.
   */
  private async seeks(spot: Spot, led: boolean): Promise<boolean> {
    const session = this.session;
    const reflow = this.reflow;
    if (session === undefined || reflow === undefined) return false;
    const seeking = (this.seeking += 1);
    this.wanted = undefined;
    if (this.spineOf !== session.generation) {
      this.wanted = { spot, led };
      spot.found?.();
      return true;
    }
    const anchor = await this.anchorAt(session, spot);
    if (seeking !== this.seeking || !this.reflowing) return false;
    if (anchor === undefined) return false;
    spot.found?.();
    const sought = reflow.seek(anchor);
    if (sought === "missing") return false;
    if (sought === "early") this.wanted = { spot, led };
    else this.seekLed = led;
    return true;
  }

  /**
   * The section and the elements a place is in. The engine reads a
   * byte into a text node, which no document has an element for, so
   * the elements around the node are asked for. A section the engine
   * read the byte into no node of is found by its place in the reading
   * order.
   */
  private async anchorAt(session: Session, spot: Spot): Promise<Anchor | undefined> {
    const generation = this.spineOf;
    if (generation === undefined) return undefined;
    let nodes: number[] | undefined;
    try {
      const node =
        spot.from === undefined
          ? undefined
          : await session.nodeAt(spot.from.source, spot.from.byte);
      nodes = node === undefined ? undefined : await session.elementsOf(node);
    } catch {
      nodes = undefined;
    }
    const section =
      nodes?.find((node) => this.spine.has(node)) ??
      (spot.at === undefined ? undefined : this.sectionNodes.get(spot.at));
    if (section === undefined) return undefined;
    return { generation, section, nodes: nodes ?? [] };
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
    return await this.turnToPlace(chapter, line);
  }

  /** The page a line of a section's note opens on, or nothing where the engine set it on none. */
  private async opensLine(at: number, line: number): Promise<number | undefined> {
    try {
      return (await this.composed?.linesOpen(at, [line]))?.[0];
    } catch {
      return undefined;
    }
  }

  private async turnToPlace(chapter: Chapter, line?: number): Promise<boolean> {
    const typeset = this.composed;
    const source = typeset === undefined ? undefined : sourceNamed(typeset.sections, chapter.at);
    const text = source === undefined ? undefined : typeset?.textOf(source);
    // The frame finds a line by its byte. The pages find it by asking
    // which page it opens on, and a line set on none opens the chapter.
    let asked = this.reflowing ? line : undefined;
    return await this.goes({
      at: chapter.at,
      ...(line !== undefined && source !== undefined && text !== undefined
        ? { from: { source, byte: lineByte(text, line) } }
        : {}),
      page: async () => {
        const page = line === undefined ? undefined : await this.opensLine(chapter.at, line);
        if (page !== undefined) asked = line;
        return page ?? (await this.opensSection(chapter.at));
      },
      found: () => {
        // The chapter is kept from the turn, so a spread or a screenful
        // that also carries the one before it is still named for the
        // one the reader asked for, and the next turn command steps
        // from it.
        this.turnedTo = chapter.at;
        this.askedLine = asked;
        this.namesAt(chapter.at);
      },
    });
  }

  /** Whether the view on screen zooms: every view but the grid. */
  get zoomable(): boolean {
    return this.stage !== undefined && (this.reflowing || zooms(this.mode));
  }

  private get stage(): Stage | undefined {
    if (this.reflowing) {
      const host = this.host;
      if (host === undefined) return undefined;
      return {
        marked: host,
        scroller: host.querySelector<HTMLElement>(".orca-reflow-room") ?? undefined,
        sheets: ".orca-reflow-fit",
      };
    }
    const surface = this.surface;
    if (surface === undefined) return undefined;
    return { marked: surface, scroller: surface, sheets: ".orca-page" };
  }

  zoomIn(): void {
    this.zoomTo(steppedIn(this.zoom));
  }

  zoomOut(): void {
    this.zoomTo(steppedOut(this.zoom));
  }

  zoomFit(): void {
    this.zoomTo(FIT);
  }

  /**
   * Draws the pages or the device at `next`. The place on the sheet that `held` names
   * ends under `point`, and with neither the middle of the well keeps
   * what it shows. The sheet is laid out at the new size before the
   * scroll is read, so the scroll is exact at any zoom.
   */
  private zoomTo(next: number, point?: Point, held?: Held): void {
    const stage = this.stage;
    if (stage === undefined) return;
    const { marked, scroller } = stage;
    const zoom = this.zoomable ? clampZoom(next) : FIT;
    const box = (scroller ?? marked).getBoundingClientRect();
    const under = point ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const place = held?.sheet.isConnected === true ? held : this.holds(under);
    this.zoom = zoom;
    marked.style.setProperty("--orca-zoom", String(zoom));
    marked.toggleClass(ZOOMED, zoom > FIT);
    if (zoom === FIT) {
      if (scroller !== undefined) {
        scroller.scrollLeft = 0;
        scroller.scrollTop = 0;
      }
      this.setHand(false);
    } else if (place !== undefined && scroller !== undefined) {
      const sheet = place.sheet.getBoundingClientRect();
      scroller.scrollLeft += scrollTo({ start: sheet.left, size: sheet.width }, place.x, under.x);
      scroller.scrollTop += scrollTo({ start: sheet.top, size: sheet.height }, place.y, under.y);
    }
    this.moved();
  }

  /** The sheet nearest `point`, and the place on it that `point` is over. */
  private holds(point: Point): Held | undefined {
    let nearest: { sheet: Element; rect: DOMRect; away: number } | undefined;
    const stage = this.stage;
    for (const sheet of stage?.marked.querySelectorAll(stage.sheets) ?? []) {
      const rect = sheet.getBoundingClientRect();
      const away = Math.max(rect.left - point.x, point.x - rect.right, 0);
      if (nearest === undefined || away < nearest.away) nearest = { sheet, rect, away };
    }
    if (nearest === undefined) return undefined;
    const { sheet, rect } = nearest;
    return {
      sheet,
      x: shareOf({ start: rect.left, size: rect.width }, point.x),
      y: shareOf({ start: rect.top, size: rect.height }, point.y),
    };
  }

  /** Draws the zoom and the pan again, and the overlay where the pages moved to. */
  private moved(): void {
    this.drawsZoom();
    // The overlay's own box moves with the zoom, so it measures again
    // the next time it draws, even one it draws after inspect goes on.
    this.measured += 1;
    if (this.inspecting.on) this.drawsOverlay();
  }

  private drawsZoom(): void {
    const stage = this.stage;
    if (stage === undefined) return;
    this.zoomer?.draw({
      on: stage.marked,
      zoom: this.zoom,
      zooms: this.zoomable,
      pan: { x: stage.scroller?.scrollLeft ?? 0, y: stage.scroller?.scrollTop ?? 0 },
    });
  }

  /**
   * Listens for the gestures that zoom: a wheel with Ctrl or Cmd held,
   * which is also how Chromium sends a trackpad pinch, and two fingers
   * on a touch screen. One finger on a zoomed page scrolls it, which
   * the browser does alone.
   */
  private zoomsBy(well: HTMLElement, surface: HTMLElement, host: HTMLElement): void {
    this.registerDomEvent(
      well,
      "wheel",
      (event) => {
        if (!(event.ctrlKey || event.metaKey) || !this.zoomable) return;
        // Obsidian and Electron both zoom the window on the same wheel.
        event.preventDefault();
        event.stopPropagation();
        this.zoomTo(wheelZoom(this.zoom, event.deltaY), { x: event.clientX, y: event.clientY });
      },
      { passive: false },
    );
    this.registerDomEvent(surface, "scroll", () => {
      this.moved();
    });
    // The EPUB view draws the room its device scrolls in, and a scroll
    // does not bubble, so the host hears it on the way down.
    this.registerDomEvent(
      host,
      "scroll",
      () => {
        this.moved();
      },
      { capture: true },
    );
    this.registerDomEvent(well, "touchstart", (event) => {
      this.pinches("start", event.touches);
    });
    this.registerDomEvent(
      well,
      "touchmove",
      (event) => {
        // Two fingers that move together would scroll the page under
        // the zoom, and the zoom already follows the point between them.
        if (this.pinches("move", event.touches) && event.cancelable) event.preventDefault();
      },
      { passive: false },
    );
    const lifted = (event: TouchEvent): void => {
      this.pinches("end", event.touches);
    };
    this.registerDomEvent(well, "touchend", lifted);
    this.registerDomEvent(well, "touchcancel", lifted);
    this.grips(well);
  }

  /** Follows the fingers on the screen, and answers whether two of them zoomed. */
  private pinches(phase: TouchPhase, fingers: ArrayLike<Finger>): boolean {
    const pinched = pinchOf(fingers);
    if (phase === "end") {
      if (fingers.length < 2) this.pinch = undefined;
      return false;
    }
    if (pinched === undefined) return false;
    if (phase === "start") {
      if (!this.zoomable) return false;
      this.pinch = { zoom: this.zoom, apart: pinched.apart, held: this.holds(pinched.middle) };
      return false;
    }
    const pinch = this.pinch;
    if (pinch === undefined) return false;
    this.zoomTo(pinchZoom(pinch.zoom, pinch.apart, pinched.apart), pinched.middle, pinch.held);
    return true;
  }

  /**
   * Whether a Space pressed now takes the hand: the page is zoomed, the
   * key is not typed into a field, and the pointer or the focus is on
   * the pages.
   */
  private handed(event: KeyboardEvent): boolean {
    const well = this.well;
    if (well === undefined || this.zoom <= FIT || !this.zoomable) return false;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return false;
    return well.matches(":hover") || (target instanceof Node && well.contains(target));
  }

  private setHand(on: boolean): void {
    if (on === this.hand) return;
    this.hand = on;
    this.stage?.marked.toggleClass(HAND, on);
    if (!on) this.ungrips();
  }

  private ungrips(): void {
    const grip = this.grip;
    if (grip === undefined) return;
    this.grip = undefined;
    this.stage?.marked.removeClass(GRIPPED);
    if (this.well?.hasPointerCapture(grip.pointer) === true) {
      this.well.releasePointerCapture(grip.pointer);
    }
  }

  /**
   * Moves a zoomed page or device under a drag while Space is held. The
   * listeners are on the well and run first, so the drag selects no
   * text, follows no link and pins no box.
   */
  private grips(well: HTMLElement): void {
    this.registerDomEvent(this.containerEl.doc, "keyup", (event) => {
      if (event.key === " ") this.setHand(false);
    });
    // A key let go in another window sends no keyup here.
    this.registerDomEvent(this.containerEl.win, "blur", () => {
      this.setHand(false);
    });
    const capture = { capture: true };
    this.registerDomEvent(
      well,
      "pointerdown",
      (event) => {
        const stage = this.stage;
        const scroller = stage?.scroller;
        if (!this.hand || event.button !== 0 || scroller === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        this.gripped = false;
        this.grip = {
          pointer: event.pointerId,
          scroller,
          x: event.clientX,
          y: event.clientY,
          left: scroller.scrollLeft,
          top: scroller.scrollTop,
        };
        stage?.marked.addClass(GRIPPED);
        well.setPointerCapture(event.pointerId);
      },
      capture,
    );
    this.registerDomEvent(
      well,
      "pointermove",
      (event) => {
        const grip = this.grip;
        if (grip?.pointer !== event.pointerId) return;
        event.stopPropagation();
        this.gripped = true;
        grip.scroller.scrollLeft = grip.left - (event.clientX - grip.x);
        grip.scroller.scrollTop = grip.top - (event.clientY - grip.y);
      },
      capture,
    );
    const letGo = (event: PointerEvent): void => {
      if (this.grip?.pointer !== event.pointerId) return;
      event.stopPropagation();
      this.ungrips();
    };
    this.registerDomEvent(well, "pointerup", letGo, capture);
    this.registerDomEvent(well, "pointercancel", letGo, capture);
    for (const type of ["mousedown", "click"] as const) {
      this.registerDomEvent(
        well,
        type,
        (event) => {
          // The click that ends a drag comes after the key can be up.
          const dropped = type === "click" && this.gripped;
          if (type === "click") this.gripped = false;
          if (!this.hand && !dropped) return;
          event.preventDefault();
          event.stopPropagation();
        },
        capture,
      );
    }
  }

  /** Draws the toolbar, the well the pages sit in, and the status line. */
  private chrome(pane: HTMLElement): void {
    const bar = pane.createDiv({ cls: "orca-preview-bar" });
    bar.dataset["testid"] = "orca-preview-bar";
    this.bar = bar;
    const views = bar.createDiv({ cls: "orca-preview-views" });
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", "View");
    for (const view of VIEWS) this.switchesTo(views, view);
    const epub = views.createEl("button", { cls: "clickable-icon" });
    epub.setAttribute("aria-label", EPUB.label);
    epub.dataset["view"] = EPUB.view;
    setIcon(epub, EPUB.icon);
    this.reflowSwitch = epub;
    this.registerDomEvent(epub, "click", () => {
      this.showsEpub();
    });
    this.marksView();
    const zoom = bar.createDiv({ cls: "orca-zoom" });
    zoom.dataset["testid"] = "orca-zoom";
    const spacer = bar.createDiv({ cls: "orca-preview-spacer" });
    this.spacer = spacer;

    const count = bar.createEl("button", { cls: "orca-preview-issues-count" });
    count.dataset["testid"] = "orca-issues-count";
    count.toggleVisibility(false);
    this.issuesCount = count;
    this.registerDomEvent(count, "click", () => {
      this.opened = !this.opened;
      this.showsIssues();
    });

    const issues = bar.createDiv({ cls: "orca-preview-issues" });
    issues.dataset["testid"] = "orca-issues";
    issues.toggleVisibility(false);
    this.issues = issues;

    this.shuts(pane, count, issues);

    const chapter = bar.createEl("select", {
      cls: "dropdown orca-preview-chapter",
    });
    chapter.setAttribute("aria-label", "Chapter");
    chapter.dataset["testid"] = "orca-chapter";
    this.chapter = chapter;
    bar.createDiv({ cls: `orca-preview-divider ${PAGING}` });

    this.back = this.turnsTo(bar, "chevron-left", "Previous page", () =>
      previousPage(this.viewing()),
    );
    const folio = bar.createEl("input", { cls: `orca-preview-folio ${PAGING}` });
    folio.type = "text";
    folio.inputMode = "numeric";
    folio.setAttribute("aria-label", "Page");
    folio.dataset["testid"] = "orca-folio";
    this.folio = folio;
    this.total = bar.createSpan({ cls: `orca-preview-total ${PAGING}` });
    this.total.dataset["testid"] = "orca-total";
    this.on = this.turnsTo(bar, "chevron-right", "Next page", () =>
      nextPage(this.viewing()),
    );
    const controls = bar.createDiv({ cls: "orca-reflow-controls" });
    controls.dataset["testid"] = "orca-reflow-controls";
    this.controls = controls;

    // The mobile artboards draw the chapter beside the views and
    // Export at the end of the bar.
    if (device() !== "desktop") {
      spacer.before(chapter);
      const exporting = bar.createEl("button", {
        cls: "clickable-icon orca-preview-export",
      });
      exporting.setAttribute("aria-label", ACTIONS.export.label);
      exporting.dataset["testid"] = "orca-preview-export";
      setIcon(exporting, ACTIONS.export.icon);
      this.registerDomEvent(exporting, "click", () => {
        this.exports();
      });
    }

    const well = pane.createDiv({ cls: "orca-preview-well" });
    // The pane pages through from the keyboard, so the well the pages
    // sit in is what a Tab or a click on a page reaches.
    well.tabIndex = 0;
    this.well = well;
    this.registerDomEvent(well, "focus", () => {
      well.toggleClass(TABBED, well.matches(":focus-visible"));
    });
    this.registerDomEvent(well, "blur", () => {
      well.removeClass(TABBED);
    });
    this.report("Loading preview…");
    const surface = well.createDiv({ cls: "orca-preview-sheets" });
    surface.dataset["testid"] = "orca-sheets";
    this.surface = surface;
    this.overlay = mountOverlay(surface);
    if (sheets(device())) {
      // The sheet is over Obsidian's own bar, which no view reaches.
      const rising = well.doc.body.createDiv({ cls: "orca-inspect-sheet-host" });
      this.sheetHost = rising;
      this.lifting = new ResizeObserver(() => {
        this.lifts();
      });
      this.lifting.observe(rising);
      // A swipe that opens a drawer slides the main area aside. The
      // sheet is on the body and not under that area, so the sheet
      // takes each move the area makes. The API declares no element
      // for the area.
      const root = (this.app.workspace.rootSplit as unknown as { containerEl?: HTMLElement })
        .containerEl;
      if (root !== undefined) {
        const slides = (): void => {
          rising.style.setProperty("transform", root.style.transform);
          rising.style.setProperty("transition", root.style.transition);
        };
        slides();
        this.sliding = new MutationObserver(slides);
        this.sliding.observe(root, { attributes: true, attributeFilter: ["style"] });
      }
    }
    const host = well.createDiv({ cls: "orca-reflow-host" });
    host.dataset["testid"] = "orca-reflow-host";
    this.host = host;
    this.reflow = mountReflow(host, {
      controls,
      shows: (screen) => {
        void this.shown(screen);
      },
      reading: (text) => {
        if (this.reflowing) this.reading(text);
      },
      stored: this.handoff.reader(),
      keeps: (reader) => {
        this.handoff.reads(reader);
      },
      touched: (phase, fingers) => this.pinches(phase, fingers),
      ...(sheets(device()) ? { sheet: (closed) => this.sheetsReader(well, closed) } : {}),
    });
    this.zoomer = mountZoom(zoom, {
      control: device() === "desktop",
      in: () => {
        this.zoomIn();
      },
      out: () => {
        this.zoomOut();
      },
      fit: () => {
        this.zoomFit();
      },
    });
    this.drawsZoom();
    this.inspects(surface);
    this.followsLinks(surface);
    this.zoomsBy(well, surface, host);

    const foot = pane.createDiv({ cls: "orca-preview-foot" });
    foot.dataset["testid"] = "orca-preview-foot";
    this.foot = foot;
    this.places();

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
      if (event.key === " " && (this.hand || this.handed(event))) {
        // Space also scrolls a page and presses a button in focus.
        event.preventDefault();
        this.setHand(true);
        return;
      }
      if (this.reflowing) {
        // An arrow in a select picks an option, so it turns no screen.
        const step = event.target instanceof HTMLSelectElement ? undefined : stepOf(event.key);
        if (step === undefined) return;
        event.preventDefault();
        this.reflow?.turn(step);
        return;
      }
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
    // The EPUB view hides the surface, so the pane is what turning the
    // device moves.
    watching.observe(pane);
    this.watching = watching;
  }

  /**
   * Moves the count of issues, the arrows and the folio to where the
   * device has room for them: under the page on mobile, and in the bar
   * on a phone on its side. The pane says which once they are there.
   */
  private places(): void {
    const pane = this.contentEl;
    const { bar, spacer, foot, issuesCount: count, issues, back, folio, total, on } = this;
    if (bar === undefined || spacer === undefined || foot === undefined) return;
    if (count === undefined || issues === undefined) return;
    if (back === undefined || folio === undefined || total === undefined || on === undefined) {
      return;
    }
    const place = footPlace(device(), {
      width: pane.clientWidth,
      height: pane.clientHeight,
    });
    if (place === this.placed) return;
    this.placed = place;
    // An open sheet holds the list, which is about to move.
    this.warned?.close();
    const stepper = [back, folio, total, on];
    if (place === "under") foot.append(count, issues, ...stepper);
    else if (place === "bar") spacer.after(count, issues, ...stepper);
    else {
      spacer.after(count, issues);
      bar.append(...stepper);
    }
    foot.toggle(place === "under");
    // The EPUB view's controls go where the page's are: under the page
    // when the bar has no room for them, right of the count of issues.
    const controls = this.controls;
    if (controls !== undefined && place !== "status") {
      if (place === "under") issues.after(controls);
      else {
        const exporting = bar.querySelector(".orca-preview-export");
        if (exporting === null) bar.append(controls);
        else exporting.before(controls);
      }
    }
    // The stylesheet places the warnings over the page from the foot,
    // so what was measured for the bar comes off.
    issues.style.removeProperty("right");
    issues.style.removeProperty("max-width");
    pane.dataset["foot"] = place;
  }

  private exports(): void {
    const book = this.state.book;
    if (book !== undefined) this.handoff.exports(book);
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
    // The EPUB view sets no page, so it has no box to inspect.
    if (this.reflowing) return;
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

  /** The element a phone draws the inspect pane in, while this view holds a pin. */
  get sheet(): HTMLElement | undefined {
    return this.inspecting.pin === undefined ? undefined : this.sheetHost;
  }

  /**
   * Moves the page up when the sheet would cover the pinned box, and
   * back when the sheet or the pin goes.
   */
  private lifts(): void {
    const { well, surface, sheetHost } = this;
    if (well === undefined || surface === undefined || sheetHost === undefined) return;
    const sheet = sheetHost.getBoundingClientRect();
    const pin = this.inspecting.pin;
    let lift = 0;
    if (pin !== undefined && sheet.height > 0) {
      let top = Infinity;
      let bottom = -Infinity;
      for (const box of pin.inspection.boxes) {
        const trim = this.painted.get(box.page);
        const page = surface.querySelector(`.orca-page[data-page="${String(box.page + 1)}"]`);
        if (trim === undefined || trim.height === 0 || page === null) continue;
        const rect = page.getBoundingClientRect();
        const scale = rect.height / trim.height;
        // The page is read where it is drawn, which can be part of the
        // way through a move up or down.
        const from = rect.top - new DOMMatrix(getComputedStyle(surface).transform).f;
        top = Math.min(top, from + box.y * scale);
        bottom = Math.max(bottom, from + (box.y + box.height) * scale);
      }
      if (top < bottom) {
        lift = liftFor({ top, bottom }, well.getBoundingClientRect().top, sheet.top);
      }
    }
    if (lift === this.lifted) return;
    this.lifted = lift;
    well.style.setProperty("--orca-inspect-lift", `${String(lift)}px`);
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
    if (next.on) this.surface?.removeClass("is-on-link");
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
      trims: this.painted,
      measured: this.measured,
    });
    this.lifts();
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

  /**
   * Follows the link under a click, and shows the link cursor over one.
   * Inspect mode takes every click for itself, and a click that ends a
   * drag keeps the selection it made.
   */
  private followsLinks(surface: HTMLElement): void {
    this.registerDomEvent(surface, "pointermove", (event) => {
      const over =
        !this.inspecting.on && this.linkAt(event.clientX, event.clientY) !== undefined;
      surface.toggleClass("is-on-link", over);
    });
    this.registerDomEvent(surface, "pointerleave", () => {
      surface.removeClass("is-on-link");
    });
    this.registerDomEvent(surface, "click", (event) => {
      if (this.inspecting.on || event.defaultPrevented) return;
      if (surface.ownerDocument.getSelection()?.isCollapsed === false) return;
      const follow = this.linkAt(event.clientX, event.clientY);
      if (follow === undefined) return;
      event.preventDefault();
      // Obsidian hands a url the window opens to the system's browser.
      if (follow.kind === "open") surface.win.open(follow.url);
      else void this.follows(follow.page);
    });
  }

  /**
   * Turns to the page a link names through the leaf, which records the
   * turn. A leaf records history only for a navigation view, and one of
   * those is where Obsidian opens the next note, so the preview is one
   * only for this call.
   */
  private async follows(page: number): Promise<void> {
    this.navigation = true;
    try {
      await this.leaf.setViewState({
        type: PREVIEW_VIEW,
        state: { ...this.getState(), folio: page + 1, followed: true },
      });
    } finally {
      this.navigation = false;
    }
  }

  /** The link under a point on the screen, on whichever painted page is there. */
  private linkAt(x: number, y: number): Follow | undefined {
    const surface = this.surface;
    if (surface === undefined) return undefined;
    for (const sheet of surface.querySelectorAll<HTMLElement>(".orca-page[data-page]")) {
      const page = this.painted.get(Number(sheet.dataset["page"]) - 1);
      if (page === undefined) continue;
      const point = pointOn(sheet.getBoundingClientRect(), page, x, y);
      if (point !== undefined) return followAt(page, point.x, point.y);
    }
    return undefined;
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
      const trim = this.painted.get(page);
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
    this.strayed = false;
    this.forgets();
    this.showing = this.state.note;
    // A book opens at fit, whatever the last one was read at.
    this.zoomTo(FIT);
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
      const reflows = typeset.watch(() => {
        void this.reflowed();
      });
      // An EPUB runs no layout, so its warnings arrive with no render.
      const session = typeset.session;
      const exports = session.exports(() => {
        this.warns(session);
      });
      this.unwatch = () => {
        reflows();
        exports();
      };
      this.offers(chapters(typeset.sections));
      // The book opens where the note asked it to, so the note is
      // already there and the opening turn leads it nowhere.
      await this.turn(await this.opensAt(typeset), true);
      this.openedAt = this.state.folio;
      void this.reflows();
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
          ? sentence(cause.message)
          : "The preview could not load",
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
    const button = bar.createEl("button", { cls: `clickable-icon ${PAGING}` });
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
    const left = this.reflowing;
    // The page that holds what the screen opens with is asked for while
    // the frame still holds the screen.
    const page = left ? await this.pageOfScreen() : undefined;
    if (left) this.setReflowing(false);
    if (mode === this.mode && !left) return;
    this.mode = mode;
    this.marksView();
    this.handoff.viewed(mode);
    this.app.workspace.requestSaveLayout();
    // The grid does not zoom, so a zoomed page goes back to fit for it.
    this.zoomTo(this.zoom);
    this.measure();
    await this.turn(page ?? this.at);
  }

  /**
   * The page that holds what the screen being read opens with, counting
   * from 0. Nothing for a reader who turned no screen, because the page
   * they left stands.
   */
  private async pageOfScreen(): Promise<number | undefined> {
    const session = this.session;
    const screen = this.screen;
    if (!this.strayed || session === undefined || screen?.generation !== session.generation) {
      return undefined;
    }
    const node = screen.opens ?? screen.section;
    if (node === undefined) return undefined;
    try {
      return (await session.foliosOf([node]))[0]?.at;
    } catch {
      return undefined;
    }
  }

  /**
   * Shows the book's EPUB in place of its pages. The view is the
   * leaf's and the machine's both, as a page view is.
   */
  private showsEpub(): void {
    if (this.reflowing) return;
    this.setReflowing(true);
    this.handoff.epubbed();
    this.app.workspace.requestSaveLayout();
    void this.reflows();
  }

  /** Puts the pane in the EPUB view or takes it out, and keeps nothing. */
  private setReflowing(on: boolean): void {
    // A page and a device are zoomed apart, so the view that is left
    // goes back to fit and the one that is shown opens at it.
    this.zoomTo(FIT);
    this.reflowing = on;
    this.asking += 1;
    this.forgets();
    if (on) {
      this.setInspecting(INSPECT_OFF);
      this.inspectAction?.setAttribute("aria-disabled", "true");
    } else {
      // Drawing nothing releases every URL the frame was reading.
      this.reflow?.draw(undefined);
      this.inspectAction?.removeAttribute("aria-disabled");
    }
    this.contentEl.toggleClass(REFLOWING, on);
    this.marksView();
    this.moved();
  }

  /** Drops what the pane knew of the frame's place, which the next EPUB drawn tells it again. */
  private forgets(): void {
    this.seeking += 1;
    this.screen = undefined;
    this.span = undefined;
    this.wanted = undefined;
    this.seekLed = false;
    this.spineOf = undefined;
  }

  /**
   * Asks the session for its EPUB and draws it. The ask runs no layout
   * stage. An ask an edit overtook is dropped, because the render that
   * overtook it asks again.
   */
  private async reflows(): Promise<void> {
    if (!this.reflowing) return;
    if (this.composed?.dropped === true) {
      await this.compose();
      return;
    }
    const session = this.session;
    const typeset = this.composed;
    if (session === undefined || typeset === undefined) return;
    const asking = (this.asking += 1);
    try {
      const book = await session.epubFiles();
      if (asking !== this.asking || book === undefined) return;
      const spine = await spinePlaces(typeset.sections, book.spine, session);
      if (asking !== this.asking) return;
      this.spine = spine;
      this.sectionNodes = new Map();
      for (const [node, at] of spine) {
        if (!this.sectionNodes.has(at)) this.sectionNodes.set(at, node);
      }
      this.spineOf = book.generation;
      const landing = await this.landing(session);
      if (asking !== this.asking) return;
      this.reflow?.draw({ book, stages: session.stages, ...landing });
    } catch (cause) {
      if (asking !== this.asking) return;
      // The engine stopped under the ask. The screen already drawn
      // stays while the book is set again on a new engine.
      if (cause instanceof EngineDead) return;
      this.report(
        cause instanceof EngineError ? sentence(cause.message) : "The preview could not load",
      );
    }
  }

  /**
   * The place the next EPUB opens at. A turn the frame could not take
   * comes first. Then the place the last screen opened at, which an
   * edit moves the words of and not the reader. Then the block at the
   * top of the manuscript the pane was swapped for, and last the block
   * the page opens with.
   */
  private async landing(session: Session): Promise<{ at?: Anchor; sought?: boolean }> {
    const wanted = this.wanted;
    this.wanted = undefined;
    if (wanted !== undefined) {
      const at = await this.anchorAt(session, wanted.spot);
      if (at !== undefined) {
        this.seekLed = wanted.led;
        return { at, sought: true };
      }
    }
    const none = (): Promise<undefined> => Promise.resolve(undefined);
    const span = this.span;
    if (span !== undefined) {
      const at = await this.anchorAt(session, {
        from: { source: span.source, byte: span.start },
        page: none,
      });
      if (at !== undefined) return { at };
    }
    const note = this.state.note;
    const arriving = this.arriving;
    const left = this.leftAt;
    this.arriving = undefined;
    this.leftAt = undefined;
    // The place the pane was left at stands while the manuscript still
    // shows it. Obsidian settles a pane it hands back a line or two off
    // the line asked for, and the top of the pane is then a block of
    // the screen before.
    const stands =
      arriving !== undefined &&
      left !== undefined &&
      showsAny(arriving, { start: left, end: left + 1 });
    const top = stands ? left : arriving === undefined ? undefined : topShown(arriving);
    if (note !== undefined && top !== undefined) {
      const at = await this.anchorAt(session, { from: { source: note, byte: top }, page: none });
      if (at !== undefined) return { at };
    }
    const generation = this.spineOf;
    const node = opensOn(this.blocks);
    if (generation === undefined || node === undefined) return {};
    const nodes = await session.elementsOf(node).catch(() => undefined);
    const section = nodes?.find((each) => this.spine.has(each));
    return nodes === undefined || section === undefined ? {} : { at: { generation, section, nodes } };
  }

  /**
   * Takes a screen the frame laid out: names its chapter, tells the
   * navigator, keeps the bytes it holds, and puts a linked manuscript
   * on the line it opens at. A screen the reader did not turn to leads
   * the manuscript nowhere, and neither does one the manuscript asked
   * for.
   */
  private async shown(screen: Screen): Promise<void> {
    const typeset = this.composed;
    const session = this.session;
    const host = this.host;
    if (!this.reflowing || typeset === undefined || session === undefined) return;
    if (screen.generation !== this.spineOf || screen.generation !== session.generation) return;
    this.screen = screen;
    const turned = screen.cause !== "laid";
    const led = screen.cause === "seek" && this.seekLed;
    if (screen.cause !== "laid") this.seekLed = false;
    if (turned) this.strayed = true;
    if (screen.cause === "turn") this.askedLine = undefined;
    const at = screen.section === undefined ? undefined : this.spine.get(screen.section);
    if (at !== undefined) {
      this.namesAt(at);
      this.reads(typeset.sections[at]);
    }
    const wanted = this.wanted;
    if (wanted !== undefined) {
      this.wanted = undefined;
      void this.seeks(wanted.spot, wanted.led);
    }
    const opening = screen.opens ?? screen.section;
    if (opening === undefined) return;
    const leading = (this.leading += 1);
    const leads = this.linked && turned && !led;
    if (leads && host !== undefined) host.dataset["led"] = "";
    let opens: NodeSource | undefined;
    let closes: NodeSource | undefined;
    let page: number | undefined;
    try {
      [opens, closes] = await Promise.all([
        session.sourceOf(opening),
        session.sourceOf(screen.closes ?? opening),
      ]);
      if (turned) page = (await session.foliosOf([opening]))[0]?.at;
    } catch {
      return;
    }
    if (leading !== this.leading || !this.reflowing) return;
    if (opens !== undefined) {
      this.span = {
        source: opens.source,
        start: opens.start,
        end: closes?.source === opens.source ? Math.max(closes.end, opens.end) : opens.end,
      };
    }
    // The page that holds what the screen opens with is the leaf's, so
    // a workspace restored at startup opens the book there.
    if (page !== undefined) {
      this.state = { ...this.state, folio: page + 1 };
      this.app.workspace.requestSaveLayout();
    }
    if (at !== undefined) {
      await this.marksScreen(typeset, at, screen);
      if (leading !== this.leading || !this.reflowing) return;
    }
    // The e2e suite waits here for the pane to have taken the screen.
    if (host !== undefined && screen.section !== undefined) {
      host.dataset["taken"] = `${String(screen.section)}:${String(screen.screen + 1)}`;
    }
    if (!leads) return;
    if (opens === undefined || isGenerated(opens.source)) {
      this.ledTo(NOWHERE);
      return;
    }
    this.handoff.follows(this, opens.source, opens.start);
    this.ledTo(opens.source);
  }

  /**
   * Tells the navigator the entry the screen is in, and the heading in
   * it the screen falls under. A heading is placed by the byte its line
   * opens at, against the bytes the screen holds.
   */
  private async marksScreen(typeset: Typeset, at: number, screen: Screen): Promise<void> {
    const book = this.book;
    const span = this.span;
    if (book === undefined) return;
    const section = typeset.sections[at];
    const leading = this.leading;
    const deepest = await this.handoff.outlined(book);
    if (leading !== this.leading || !this.reflowing) return;
    const text = section?.kind === "note" ? typeset.textOf(section.path) : undefined;
    const lines =
      deepest !== undefined && section?.kind === "note" && text !== undefined && span !== undefined
        ? outline(headingsOf(this.app, section.path, deepest), entryName(section.entry)).map(
            (heading) => heading.line,
          )
        : [];
    const line =
      text === undefined || span === undefined
        ? undefined
        : headingOn(
            lines.map((each) => lineByte(text, each)),
            lines,
            { first: span.start, last: span.end - 1 },
            this.askedLine,
            screen.screen === 0 ? span.start : undefined,
          );
    this.handoff.showing(this, { book, at, line });
  }

  /** Marks the switch of the view the book is being read in. */
  private marksView(): void {
    for (const [mode, button] of this.switches) {
      const on = !this.reflowing && mode === this.mode;
      button.toggleClass("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
    this.reflowSwitch?.toggleClass("is-on", this.reflowing);
    this.reflowSwitch?.setAttribute("aria-pressed", String(this.reflowing));
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
    this.places();
    this.showsIssues();
    const surface = this.surface;
    // The EPUB view hides the surface, and a hidden surface fits no page.
    if (surface === undefined || this.reflowing) return;
    const grid = fits(
      { width: surface.clientWidth, height: surface.clientHeight },
      this.trim,
      device(),
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
    this.post(undefined, false);
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
    showPages(
      surface,
      {
        mode: this.mode,
        leaves,
        generation: session.generation,
        stages: session.stages,
        pages: reading.length,
        note: this.showing ?? "",
        columns: SEATS[this.mode] ?? this.columns,
        rows: this.mode === "grid" ? this.rows : 1,
        device: device(),
      },
      pressSheet,
    );
    this.painted = new Map(
      reading.pages.map((page, index) => [reading.at + index, page]),
    );
    this.measured += 1;
    if (this.hovered?.generation !== session.generation) this.hovered = undefined;
    this.drawsOverlay();
    void this.refinds(session);
    this.settle(reading.at, reading.length, leaves.length);
    this.warns(session);
    // The EPUB view is over the pages, and the frame names the chapter
    // and leads the manuscript there.
    if (this.reflowing) return;
    void this.namesSpan(reading);
    // A repaint of the span already being read is not a page turn, and
    // neither is one the manuscript asked for.
    if (this.ledAt === reading.at) return;
    this.ledAt = reading.at;
    // A turn keeps the zoom and shows the page from its top.
    surface.scrollTop = 0;
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
    const chip = this.issuesCount;
    const issues = this.issues;
    if (chip === undefined || issues === undefined) return;
    const said: Warning[] = [];
    for (const warning of withEpub(session.warnings, session.epubWarnings)) {
      const route = routeOf(warning);
      if (route === "orca") console.warn(`Orca: ${warning.message}`, warning.origin);
      else said.push(warning);
    }

    // The fonts the book asked for and did not get, as the composer
    // resolved them when it set the book.
    const fonts = this.composed?.unfonted ?? [];
    const total = said.length + fonts.length;
    chip.toggleVisibility(total > 0);
    issues.empty();
    if (total === 0) {
      this.opened = false;
      this.showsIssues();
      return;
    }

    const count = tally(fonts.length, said.length);
    chip.toggleClass("mod-error", fonts.length > 0);
    chip.empty();
    // The stylesheet shows one of the two forms: the words in the bar,
    // or an icon and the number where the EPUB view's controls leave no
    // room for words. On mobile the button is the touch target and the
    // pill inside it is what is tinted, so the pill is as wide as what
    // it holds.
    const pill = chip.createSpan({ cls: "orca-preview-pill" });
    const alert = pill.createSpan({ cls: "orca-preview-alert" });
    setIcon(alert, "alert-triangle");
    alert.createSpan({ cls: "orca-preview-number", text: String(total) });
    pill.createSpan({ cls: "orca-preview-said", text: count });
    setIcon(pill.createSpan({ cls: "orca-preview-opens" }), "chevron-down");
    chip.setAttribute("aria-label", count);
    chip.setAttribute("title", count);
    this.warned?.title(count);
    for (const group of [...issueGroups(said), ...fontGroup(fonts)]) {
      const set = issues.createDiv({ cls: "orca-preview-issue-group" });
      set.dataset["testid"] = "orca-issue-group";
      set.dataset["route"] = group.route;
      const head = set.createDiv({ cls: "orca-preview-issue-head" });
      head.createSpan({ cls: "orca-preview-issue-title", text: groupTitle(group) });
      head.createSpan({
        cls: "orca-preview-issue-count",
        text: String(group.issues.length),
      });
      for (const issue of group.issues) {
        const card = set.createDiv({
          cls: group.route === "fonts" ? "orca-preview-issue mod-error" : "orca-preview-issue",
        });
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
          // A sheet is over the whole screen, and the note opens under it.
          this.warned?.close();
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

  /**
   * Opens the warnings. A view that has not set its book yet opens them
   * when the run that sets it lists one.
   */
  openIssues(): void {
    this.opened = true;
    this.showsIssues();
  }

  /** Opens or shuts the warnings, and says which on the bar. */
  private showsIssues(): void {
    const issues = this.issues;
    if (issues === undefined) return;
    const open = this.opened && issues.childElementCount > 0;
    if (sheets(device())) this.sheetsIssues(issues, open);
    else {
      if (open) this.placesIssues();
      issues.toggleVisibility(open);
    }
    this.issuesCount?.setAttribute("aria-expanded", String(open));
    this.issuesCount?.toggleClass("is-on", open);
  }

  /**
   * Opens the sheet the reader settings are drawn in. Nothing is dimmed
   * behind it, and the well gives up what the sheet covers, so the
   * device is drawn whole above the sheet.
   */
  private sheetsReader(well: HTMLElement, closed: () => void): Sheet {
    const covered = "--orca-sheet-cover";
    const sheet = openSheet(this.app, {
      title: "Reader settings",
      testid: "orca-reader-sheet",
      cls: "orca-reader-sheet",
      clear: true,
      closed: () => {
        covering.disconnect();
        well.style.removeProperty(covered);
        closed();
      },
    });
    // The height the sheet is laid out at, which the slide that opens
    // it does not change.
    const covering = new ResizeObserver(() => {
      const cover = sheetCover(
        well.win.innerHeight,
        sheet.frame.offsetHeight,
        well.getBoundingClientRect().bottom,
      );
      well.style.setProperty(covered, `${String(cover)}px`);
    });
    covering.observe(sheet.frame);
    return sheet;
  }

  /**
   * Opens the warnings in a sheet, or closes the sheet they are in. The
   * list is the one element a run fills, so it moves into the sheet and
   * back beside its count.
   */
  private sheetsIssues(issues: HTMLElement, open: boolean): void {
    if (!open) {
      this.warned?.close();
      return;
    }
    if (this.warned !== undefined) return;
    const sheet = openSheet(this.app, {
      title: this.issuesCount?.getAttribute("aria-label") ?? "",
      testid: "orca-warnings",
      cls: "orca-warnings",
      closed: () => {
        this.warned = undefined;
        this.issuesCount?.after(issues);
        issues.toggleVisibility(false);
        this.opened = false;
        this.showsIssues();
      },
    });
    this.warned = sheet;
    sheet.el.append(issues);
    issues.toggleVisibility(true);
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
    const chip = this.issuesCount;
    if (issues === undefined || chip === undefined) return;
    if (this.placed === "under") return;
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
    const marked = this.reflowing ? this.host : this.surface;
    if (marked !== undefined) marked.dataset["led"] = note;
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
    // The mobile artboards name a screenful by its span, which is no
    // page to type over.
    const spans = this.mode === "grid" && last > first && device() !== "desktop";
    this.folio?.toggle(!spans);
    this.total?.setText(
      spans
        ? `${String(first)}–${String(last)} of ${String(pages)}`
        : `of ${String(pages)}`,
    );
    // The EPUB view writes its own place there.
    if (!this.reflowing) this.reading(
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
    const deepest = await this.handoff.outlined(book);
    if (naming !== this.naming) return;
    const cached =
      deepest !== undefined && section?.kind === "note"
        ? outline(headingsOf(this.app, section.path, deepest), entryName(section.entry))
        : [];
    const lines = cached.map((heading) => heading.line);
    const [pages, opens] =
      lines.length === 0
        ? [[], undefined]
        : await Promise.all([
            typeset.linesOpen(at, lines).catch(() => lines.map(() => undefined)),
            this.opensSection(at),
          ]);
    if (naming !== this.naming) return;
    const span = { first: reading.at, last: reading.at + reading.pages.length - 1 };
    const line = headingOn(pages, lines, span, this.askedLine, opens);
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
    if (note === undefined) return;
    if (this.host !== undefined) this.host.dataset["note"] = note;
    if (note === this.showing) return;
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
    // The EPUB view shows no page, so a render there asks for the
    // EPUB again and reads none.
    if (this.reflowing) {
      await this.reflows();
      return;
    }
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
    // The banner is drawn once a run and told each report after, so the
    // pages keep turning rather than start over with every chapter.
    const drawn = this.message;
    const banner =
      drawn?.dataset["testid"] === "orca-setting" && drawn.hasClass("mod-again") === progress.again
        ? drawn
        : this.settingBanner(well, progress);
    banner.dataset["phase"] = progress.phase;
    // The pages from before stay under a book set again, so only a
    // first setting says where the work is.
    const note = banner.querySelector(".orca-preview-setting-note");
    note?.setText(
      progress.phase === "laying"
        ? "Laying out pages"
        : `${String(progress.read)} of ${String(progress.of)} chapters`,
    );
  }

  /** The banner of a book being set, with the book whose pages turn. */
  private settingBanner(well: HTMLElement, progress: Progress): HTMLElement {
    const banner = well.createDiv({ cls: "orca-preview-setting" });
    banner.dataset["testid"] = "orca-setting";
    // A book being set for the first time has no pages yet. One being
    // set again has the pages from before, and they stay under it.
    if (progress.again) banner.addClass("mod-again");
    // The engine reports nothing while it lays the book out, so the
    // wait is a book whose pages turn rather than a bar that fills.
    const book = banner.createDiv({ cls: "orca-preview-book" });
    book.createDiv({ cls: "orca-preview-book-cover" });
    book.createDiv({ cls: "orca-preview-book-page mod-left" });
    book.createDiv({ cls: "orca-preview-book-page mod-right" });
    for (const delay of BOOK_TURNS) {
      const page = book.createDiv({ cls: "orca-preview-book-page mod-right mod-turn" });
      page.style.setProperty("--orca-turn-delay", `${String(delay)}s`);
    }
    const name = banner.createDiv({ cls: "orca-preview-setting-name" });
    name.append("Loading ", name.createEl("i", { text: progress.name }), "…");
    if (!progress.again) banner.createDiv({ cls: "orca-preview-setting-note" });
    this.post(banner, !progress.again);
    return banner;
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
    const banner = well.createDiv({ cls: "orca-preview-setting mod-held" });
    banner.dataset["testid"] = "orca-held";
    setIcon(
      banner.createDiv({ cls: "orca-preview-setting-icon" }),
      "alert-triangle",
    );
    const name = banner.createDiv({ cls: "orca-preview-setting-name" });
    name.append("The preview stopped");
    const note = banner.createDiv({ cls: "orca-preview-setting-note" });
    note.append("These are the last pages it made.");
    note.createEl("br");
    note.append("Reopen the book to try again.");
    const report = banner.createEl("button", {
      cls: "orca-preview-report",
      text: "Copy the report",
    });
    report.dataset["testid"] = "orca-report";
    this.registerDomEvent(report, "click", () => {
      void navigator.clipboard.writeText(dead.log.join("\n"));
    });
    this.post(banner, false);
  }

  /**
   * Draws a book that set to no pages, which is a book with nothing in
   * it yet, and offers the chapter it is missing.
   */
  private empty(): void {
    const well = this.well;
    const book = this.book;
    if (well === undefined || book === undefined) return;
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
    this.post(state, true);
  }

  /** Puts a message in the well in place of the pages. */
  private report(text: string): void {
    this.post(this.well?.createDiv({ cls: "orca-preview-message", text }), true);
  }

  /**
   * Puts a message at the top of the well in place of the one before,
   * and hides the pages under one that `covers` them.
   */
  private post(message: HTMLElement | undefined, covers: boolean): void {
    this.message?.remove();
    this.message = message;
    if (message !== undefined) this.well?.prepend(message);
    this.well?.toggleClass("is-covered", message !== undefined && covers);
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
  if (raw["epub"] === true) made.epub = true;
  const over = raw["over"];
  if (Array.isArray(over)) made.over = over as Shown[];
  if (typeof raw["left"] === "number") made.left = raw["left"];
  if (raw["followed"] === true) made.followed = true;
  return made;
}

/** The state the workspace keeps: where a book opens is not part of it. */
function kept({ over, left, followed, ...state }: PreviewState): PreviewState {
  return state;
}

/** A message from a lower module, capitalized to stand as a sentence. */
function sentence(said: string): string {
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** Two fingers on the screen: how far apart they are, and the point between them. */
function pinchOf(touches: ArrayLike<Finger>): { apart: number; middle: Point } | undefined {
  const [first, second] = [touches[0], touches[1]];
  if (touches.length !== 2 || first === undefined || second === undefined) return undefined;
  return {
    apart: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
    middle: {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    },
  };
}
