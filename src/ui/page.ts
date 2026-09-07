import type { Side } from "fleuron";
import type { Stages } from "@/engine/session";

/** The three ways the preview shows a book. */
export type ViewMode = "single" | "spread" | "grid";

/** A box on screen, in CSS pixels. */
export interface Box {
  width: number;
  height: number;
}

/** The pages a view shows: where they start, counting from 0, and how many. */
export interface Span {
  at: number;
  count: number;
}

/** The widest a grid draws a sheet. */
const TILE = 132;

/**
 * The space between sheets, in CSS pixels. The spread's is the spine,
 * so it is nearly nothing; the maths that fits a grid and the rules
 * that draw one read the same number.
 */
export const GAP: Record<ViewMode, number> = { single: 0, spread: 2, grid: 12 };

/** The trim a view falls back to before a page has said what its is. */
const UNSET: Box = { width: 2, height: 3 };

/**
 * The span holding `at`.
 *
 * The three spans tile the book, so the page after a span is the next
 * span's first. A spread is a verso and the recto facing it, which
 * puts the book's first page, a recto, on a spread of its own.
 */
export function spanAt(mode: ViewMode, at: number, screenful: number): Span {
  const first = Math.max(at, 0);
  if (mode === "single") return { at: first, count: 1 };
  if (mode === "grid") {
    const count = Math.max(screenful, 1);
    return { at: Math.floor(first / count) * count, count };
  }
  if (first === 0) return { at: 0, count: 1 };
  return { at: first - ((first - 1) % 2), count: 2 };
}

/** The reader's place in the book, and what the view shows them. */
export interface Viewing {
  mode: ViewMode;
  /** The first page shown, counting from 0. */
  at: number;
  /** The book's length in pages. */
  pages: number;
  /** The pages a grid fits on screen. */
  screenful: number;
}

/** The first page of the span after the one being read. */
export function nextPage(viewing: Viewing): number {
  const span = spanAt(viewing.mode, viewing.at, viewing.screenful);
  return span.at + span.count;
}

/** The first page of the span before the one being read. */
export function previousPage(viewing: Viewing): number {
  const span = spanAt(viewing.mode, viewing.at, viewing.screenful);
  return spanAt(viewing.mode, span.at - 1, viewing.screenful).at;
}

/** The keys that turn a page, as the page each one turns to. */
const KEYS: Record<string, (viewing: Viewing) => number> = {
  PageDown: nextPage,
  PageUp: previousPage,
  Home: () => 0,
  End: (viewing) =>
    spanAt(viewing.mode, viewing.pages - 1, viewing.screenful).at,
};

/**
 * The page `key` turns to, counting from 0, or nothing for a key that
 * turns none. Every view turns by what it shows, so the answer is the
 * start of a span rather than a page inside one. It can be off the end
 * of the book, which the session holds inside it.
 */
export function turnedTo(key: string, viewing: Viewing): number | undefined {
  return KEYS[key]?.(viewing);
}

/**
 * The grid a well of this size fits, at sheets no wider than a tile.
 * Measured before the request rather than after the paint, because the
 * count is what the view asks the engine for.
 */
export function fits(well: Box, trim: Box): { columns: number; rows: number } {
  const shape = trim.width > 0 && trim.height > 0 ? trim : UNSET;
  const gap = GAP.grid;
  const tall = TILE * (shape.height / shape.width);
  return {
    columns: Math.max(Math.floor((well.width + gap) / (TILE + gap)), 1),
    rows: Math.max(Math.floor((well.height + gap) / (tall + gap)), 1),
  };
}

/** One sheet of a view: the page painted on it, and where it falls. */
export interface Leaf {
  markup: string;
  /** Folio, counting from 1. */
  page: number;
  side: Side;
}

/**
 * The sheets a view seats, left to right. A spread opening on a recto
 * leaves the slot beside it empty, so a verso and the recto facing it
 * always meet at the spine and their mirrored margins read as the
 * bound book has them.
 */
export function seated(mode: ViewMode, leaves: Leaf[]): (Leaf | undefined)[] {
  if (mode !== "spread") return leaves;
  const first = leaves[0];
  if (first === undefined || first.side === "verso") return leaves;
  return [undefined, ...leaves];
}

/** The node the pages are written into. */
export interface Surface {
  innerHTML: string;
  readonly dataset: DOMStringMap;
  readonly style: { setProperty: (name: string, value: string) => void };
  querySelectorAll(selectors: string): Iterable<Marked>;
}

/** A node the surface marks once the pages are written. */
export interface Marked {
  setAttribute(name: string, value: string): void;
}

/** The trim the painter drew, read off a page it drew. */
const TRIM = /viewBox="0 0 ([\d.]+) ([\d.]+)"/;

export interface Painted {
  mode: ViewMode;
  leaves: Leaf[];
  generation: number;
  stages: Stages;
  /** The book's length in pages. */
  pages: number;
  columns: number;
  rows: number;
}

/**
 * Writes a view's pages into the surface in one go, with the generation,
 * the stage runs and the span being read as attributes, which a test
 * waits on rather than a clock.
 */
export function showPages(surface: Surface, painted: Painted): void {
  const seats = seated(painted.mode, painted.leaves);
  surface.innerHTML = seats.map(sheet).join("");

  // The box is the sheet, because the border and the shadow are drawn
  // on the box: one wider than the sheet hangs them off its edge.
  const trim = TRIM.exec(painted.leaves[0]?.markup ?? "");
  surface.style.setProperty("--orca-trim-w", trim?.[1] ?? "");
  surface.style.setProperty("--orca-trim-h", trim?.[2] ?? "");
  surface.style.setProperty("--orca-columns", String(painted.columns));
  surface.style.setProperty("--orca-rows", String(painted.rows));
  surface.style.setProperty("--orca-gap", `${String(GAP[painted.mode])}px`);

  surface.dataset["generation"] = String(painted.generation);
  surface.dataset["stageStyle"] = String(painted.stages.style);
  surface.dataset["stageLines"] = String(painted.stages.lines);
  surface.dataset["stageFlow"] = String(painted.stages.flow);
  surface.dataset["stagePaint"] = String(painted.stages.paint);
  surface.dataset["view"] = painted.mode;
  surface.dataset["first"] = String(painted.leaves[0]?.page ?? 0);
  surface.dataset["count"] = String(painted.leaves.length);
  surface.dataset["pages"] = String(painted.pages);

  readable(surface);
}

/**
 * The glyph layer is the text as the sheet drew it, in whatever casing
 * a transform or a set of small capitals left; the painter's selection
 * layer is the manuscript's own, one line at a time in reading order.
 * That is the one a screen reader should read, so the glyphs come out
 * of the tree and it is left in.
 */
function readable(surface: Surface): void {
  for (const glyph of surface.querySelectorAll(
    "text:not([data-selection-line])",
  )) {
    glyph.setAttribute("aria-hidden", "true");
  }
}

function sheet(leaf: Leaf | undefined): string {
  if (leaf === undefined) {
    return '<div class="orca-page" data-empty="true" aria-hidden="true"></div>';
  }
  const folio = String(leaf.page);
  return (
    `<div class="orca-page" role="group" aria-label="Page ${folio}"` +
    ` data-page="${folio}" data-side="${leaf.side}">${leaf.markup}</div>`
  );
}
