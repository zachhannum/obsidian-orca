/**
 * The pages whose art a cut would leave a white edge on.
 *
 * The engine sets the pages and orca reads where their art is. Nothing
 * here places anything.
 */

import type { DrawItem, Page } from "fleuron";

/** The distance, in points, inside which two edges count as one. */
const NEAR = 0.5;

/**
 * The places in the book, counting from 0, of the pages that carry art
 * to the trim and not to the edge of the bleed. Art is an image, a
 * background or a filled box. A page with no bleed is never one of them.
 */
export function shortOfBleed(pages: readonly Page[]): number[] {
  return pages.flatMap((page, at) =>
    page.bleed > 0 && page.items.some((item) => stopsShort(page, item)) ? [at] : [],
  );
}

function stopsShort(page: Page, item: DrawItem): boolean {
  if (item.kind === "text") return false;
  const right = item.x + item.w;
  const bottom = item.y + item.h;
  // The printer's marks lie past the bleed, so they never touch the trim.
  if (right <= 0 || bottom <= 0 || item.x >= page.width || item.y >= page.height) return false;
  const edge = page.bleed - NEAR;
  return (
    short(-item.x, edge) ||
    short(-item.y, edge) ||
    short(right - page.width, edge) ||
    short(bottom - page.height, edge)
  );
}

/** Whether art that runs `past` the trim on one edge stops before the bleed's edge. */
function short(past: number, edge: number): boolean {
  return past > -NEAR && past < edge;
}
