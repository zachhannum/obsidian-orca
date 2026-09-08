/**
 * A place in the book, either way round: the page a byte of a
 * manuscript is set on, and the node a page opens at.
 *
 * fleuron assigns node ids in document order, so the runs on a page
 * name a span of them and the page holding one node is found by
 * halving a chapter rather than reading it through.
 *
 * A byte of a note and a byte of a node's text are different bytes,
 * because markup is not text. Everything here counts bytes of the
 * markdown orca sent, which is what the engine answers in.
 */

import type { Page } from "fleuron";
import type { Range } from "@/book/pages";

/** The content nodes a page's runs name. */
export interface Nodes {
  /** The earliest, which is what the page opens at. */
  first: number;
  last: number;
}

/**
 * The nodes a page's runs name, or nothing for a page the engine
 * wrote alone: a blank verso, or one carrying only a folio and a
 * running head.
 */
export function nodesOn(page: Page): Nodes | undefined {
  let first: number | undefined;
  let last: number | undefined;
  for (const item of page.items) {
    if (item.kind !== "text" || item.origin === null) continue;
    const { node } = item.origin;
    if (first === undefined || node < first) first = node;
    if (last === undefined || node > last) last = node;
  }
  return first === undefined || last === undefined
    ? undefined
    : { first, last };
}

/** A page of the book, as the search reads them. Folios count from 1. */
export interface ReadPage {
  (folio: number): Promise<Page | undefined>;
}

/** A page the search read, and the nodes it names. */
interface Probe {
  folio: number;
  nodes: Nodes;
}

/**
 * The folio `node` is set on, looked for between `within.first` and
 * `within.last`. Each page read halves what is left, so a chapter
 * costs a handful of reads rather than one per page. A page naming no
 * node is stood in for by the nearest that does.
 *
 * A node no run names answers with the page its content begins on: a
 * heading's runs are shaped from the text inside it, so the node a
 * byte of `#` was read into is on no page of its own. A node the
 * range runs out before answers with nothing.
 */
export async function folioOf(
  node: number,
  within: Range,
  read: ReadPage,
): Promise<number | undefined> {
  let low = within.first;
  let high = within.last;
  while (low <= high) {
    const at = await probe(Math.floor((low + high) / 2), low, high, read);
    if (at === undefined) return undefined;
    if (node < at.nodes.first) high = at.folio - 1;
    else if (node > at.nodes.last) low = at.folio + 1;
    else return at.folio;
  }
  return low > within.last ? undefined : low;
}

/** The page at `from`, or the nearest either side of it that names a node. */
async function probe(
  from: number,
  low: number,
  high: number,
  read: ReadPage,
): Promise<Probe | undefined> {
  for (let step = 0; from - step >= low || from + step <= high; step += 1) {
    for (const folio of step === 0 ? [from] : [from - step, from + step]) {
      if (folio < low || folio > high) continue;
      const page = await read(folio);
      const nodes = page === undefined ? undefined : nodesOn(page);
      if (nodes !== undefined) return { folio, nodes };
    }
  }
  return undefined;
}

/**
 * The first line at or after `line` that a note wrote content on,
 * counting from 0. A blank line and the note's own frontmatter were
 * read into no node, so a pane that stops on one is reading the line
 * under it.
 */
export function writtenAt(text: string, line: number): number {
  const lines = text.split("\n");
  const last = Math.max(lines.length - 1, 0);
  const from = Math.min(Math.max(line, underMatter(lines)), last);
  for (let at = from; at < lines.length; at += 1) {
    if ((lines[at] ?? "").trim() !== "") return at;
  }
  return from;
}

/** The first line under a note's own frontmatter, which is no node of the book. */
function underMatter(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let at = 1; at < lines.length; at += 1) {
    if ((lines[at] ?? "").trim() === "---") return at + 1;
  }
  return 0;
}

/** The byte of `text` the character at `offset` starts at. */
export function byteOf(text: string, offset: number): number {
  const at = Math.min(Math.max(offset, 0), text.length);
  return new TextEncoder().encode(text.slice(0, at)).length;
}

/**
 * The character of `text` the byte at `byte` falls in. A byte inside a
 * character answers with the character it is part of, so the answer is
 * always a place the editor can put a caret.
 */
export function offsetOf(text: string, byte: number): number {
  if (byte <= 0) return 0;
  const bytes = new TextEncoder().encode(text);
  if (byte >= bytes.length) return text.length;
  let at = byte;
  // A continuation byte is the middle of a character, and decoding a
  // slice that ends on one would count a replacement instead.
  while (at > 0 && ((bytes[at] ?? 0) & 0xc0) === 0x80) at -= 1;
  return new TextDecoder().decode(bytes.subarray(0, at)).length;
}
