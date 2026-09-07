import type { Stages } from "@/engine/session";

/** The keys that turn a page, as the page each one turns to. */
const KEYS: Record<string, (at: number, pages: number) => number> = {
  PageDown: (at) => at + 1,
  PageUp: (at) => at - 1,
  Home: () => 0,
  End: (_at, pages) => pages - 1,
};

/**
 * The page `key` turns to from `at`, counting from 0, or nothing for a
 * key that turns none. The page it names can be off either end of the
 * book, which the session holds inside it.
 */
export function turnedTo(
  key: string,
  at: number,
  pages: number,
): number | undefined {
  return KEYS[key]?.(at, pages);
}

/** The node a page is written into. */
export interface Surface {
  innerHTML: string;
  readonly dataset: DOMStringMap;
  readonly style: { setProperty: (name: string, value: string) => void };
}

/** The trim the painter drew, read off the page it drew. */
const TRIM = /viewBox="0 0 ([\d.]+) ([\d.]+)"/;

export interface Painted {
  markup: string;
  generation: number;
  stages: Stages;
  /** The folio being read. */
  page: number;
  /** The book's length in pages. */
  pages: number;
}

/**
 * Writes a page into the surface in one go, with the generation, the
 * stage runs and the place in the book as attributes, which a test
 * waits on rather than a clock.
 */
export function showPage(surface: Surface, painted: Painted): void {
  surface.innerHTML = painted.markup;
  // The box is the sheet, because the border and the shadow are drawn
  // on the box: one wider than the sheet hangs them off its edge.
  const trim = TRIM.exec(painted.markup);
  surface.style.setProperty("--orca-trim-w", trim?.[1] ?? "");
  surface.style.setProperty("--orca-trim-h", trim?.[2] ?? "");
  surface.dataset["generation"] = String(painted.generation);
  surface.dataset["stageStyle"] = String(painted.stages.style);
  surface.dataset["stageLines"] = String(painted.stages.lines);
  surface.dataset["stageFlow"] = String(painted.stages.flow);
  surface.dataset["stagePaint"] = String(painted.stages.paint);
  surface.dataset["page"] = String(painted.page);
  surface.dataset["pages"] = String(painted.pages);
}
