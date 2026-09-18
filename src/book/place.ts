/**
 * A place in the manuscript: the node a page opens at, the lines a page
 * sets, and the bytes of a note the engine is asked about.
 *
 * A byte of a note and a byte of a node's text are different bytes,
 * because markup is not text. Everything here counts bytes of the
 * markdown orca sent, which is what the engine answers in.
 */

import type { Page } from "fleuron";

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

/**
 * The byte a note's own content begins at, past its frontmatter and the
 * blank lines under it. The engine read those into no node, so this is
 * the byte a section with no caret in it is asked about.
 */
export function writtenByte(text: string): number {
  const line = writtenAt(text, 0);
  const lines = text.split("\n");
  const before = lines.slice(0, line).reduce((at, on) => at + on.length + 1, 0);
  return byteOf(text, before);
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

/**
 * A stretch of one node's own text: the node, and the bytes of it. It is
 * one line of a page, or every line of a page one node wrote.
 */
export interface Written {
  node: number;
  /** The first byte, counting from 0. */
  from: number;
  /** The byte after the last. */
  to: number;
}

/**
 * The lines a page sets, in the order its runs are painted. A line is a
 * baseline, so two runs a font change split are one line. Text the
 * engine wrote itself is on no line here, because a folio and a running
 * head are not the reader's place.
 */
export function linesOn(page: Page): Written[] {
  const lines = new Map<string, Written>();
  for (const item of page.items) {
    if (item.kind !== "text" || item.origin === null) continue;
    const { node, range } = item.origin;
    const key = `${String(node)}:${String(item.y)}`;
    const line = lines.get(key);
    if (line === undefined) {
      lines.set(key, { node, from: range[0], to: range[1] });
      continue;
    }
    line.from = Math.min(line.from, range[0]);
    line.to = Math.max(line.to, range[1]);
  }
  return [...lines.values()];
}

/**
 * The blocks a page sets: one entry per node its runs name, over the
 * bytes of that node the page carries. This is the reader's place,
 * remembered before a render moves it.
 */
export function heldOn(page: Page): Written[] {
  const blocks = new Map<number, Written>();
  for (const line of linesOn(page)) {
    const block = blocks.get(line.node);
    if (block === undefined) {
      blocks.set(line.node, { ...line });
      continue;
    }
    block.from = Math.min(block.from, line.from);
    block.to = Math.max(block.to, line.to);
  }
  return [...blocks.values()];
}

/**
 * The node a page opens at: the earliest block that begins on the page,
 * or the earliest block on it where none begins there. A page that opens
 * mid-block has no opening of its own to name, so it names the block it
 * opens inside. Nothing for a page that sets no block at all.
 */
export function opensOn(held: Written[]): number | undefined {
  return (
    earliest(held.filter((block) => block.from === 0)) ?? earliest(held)
  );
}

/** The earliest of these blocks, which is the one with the lowest node. */
function earliest(blocks: Written[]): number | undefined {
  let first: number | undefined;
  for (const block of blocks) {
    if (first === undefined || block.node < first) first = block.node;
  }
  return first;
}

/** Reads one page of the book, counting from 0. */
export type ReadPage = (at: number) => Promise<Page | undefined>;

/** The pages one node's content runs across, as the engine answers it. */
export interface Runs {
  /** The first, counting from 0. */
  at: number;
  count: number;
}

/** A page one block of the reader's page landed on, and the lines it sets of it. */
export interface Landed {
  /** Place in the book, counting from 0. */
  at: number;
  lines: number;
}

/**
 * The pages of `runs` that now set the bytes of `block`, with how many
 * lines of it each one sets.
 *
 * A node carries its bytes across its pages in order, so the first of
 * them is found by a search and the rest by reading on from it. A
 * paragraph can run across a chapter, and none of those pages but these
 * few are the reader's place.
 */
export async function pagesOf(
  block: Written,
  runs: Runs,
  read: ReadPage,
): Promise<Landed[]> {
  const last = runs.at + Math.max(runs.count, 1) - 1;
  const from = await opensAt(block, runs, read);
  if (from === undefined) return [];
  const landed: Landed[] = [];
  for (let at = from; at <= last; at += 1) {
    const page = await read(at);
    if (page === undefined) break;
    const lines = linesOn(page).filter(
      (line) => line.node === block.node && overlaps(block, line),
    ).length;
    if (lines === 0) break;
    landed.push({ at, lines });
  }
  return landed;
}

/** The page of `runs` that sets where `block` begins, found by halving them. */
async function opensAt(
  block: Written,
  runs: Runs,
  read: ReadPage,
): Promise<number | undefined> {
  let low = runs.at;
  let high = runs.at + Math.max(runs.count, 1) - 1;
  if (low >= high) return low;
  while (low <= high) {
    const at = Math.floor((low + high) / 2);
    const page = await read(at);
    if (page === undefined) return undefined;
    const span = heldOn(page).find((held) => held.node === block.node);
    if (span === undefined) return undefined;
    if (span.to <= block.from) low = at + 1;
    else if (span.from > block.from) high = at - 1;
    else return at;
  }
  return undefined;
}

/**
 * The page the reader comes back to: the one setting the most of the
 * lines they were reading, and the earliest of them where two set as
 * many. Nothing where nothing landed.
 *
 * Lines are counted rather than blocks. A page inside one long paragraph
 * sets one block, and so does every page around it, so a count of blocks
 * would settle nothing.
 */
export function anchorOf(landed: Landed[]): number | undefined {
  const lines = new Map<number, number>();
  for (const on of landed) {
    lines.set(on.at, (lines.get(on.at) ?? 0) + on.lines);
  }
  let found: number | undefined;
  let most = 0;
  for (const [at, count] of [...lines].sort(([one], [two]) => one - two)) {
    if (count > most) {
      most = count;
      found = at;
    }
  }
  return found;
}

/** Whether a line sets any of the bytes a block holds. */
function overlaps(block: Written, line: Written): boolean {
  // A range of no bytes is a line the engine set from an empty node, and
  // it belongs to the block it sits inside.
  if (block.from === block.to || line.from === line.to) {
    return line.from <= block.to && block.from <= line.to;
  }
  return line.from < block.to && block.from < line.to;
}
