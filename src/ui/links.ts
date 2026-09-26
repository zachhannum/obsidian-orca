import { linkAt, type Page } from "fleuron";

/**
 * A click on a link turns to a place in the book, counting from 0, or
 * opens a url outside Obsidian.
 */
export type Follow = { kind: "turn"; page: number } | { kind: "open"; url: string };

/**
 * The follow for a click at a point on a page, in points from the
 * page's top-left corner. Nothing where no link is under the point, and
 * that includes the space between two lines of one link.
 *
 * The engine resolved the target, and the page it names may be outside
 * the span on screen. Orca reads no second target from the markdown.
 */
export function followAt(page: Page, x: number, y: number): Follow | undefined {
  const link = linkAt(page, x, y);
  if (link === null) return undefined;
  const to = link.to;
  return to.kind === "place"
    ? { kind: "turn", page: to.place.page }
    : { kind: "open", url: to.url };
}
