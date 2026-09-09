/**
 * A place in the manuscript: the node a page opens at, and the bytes of
 * a note the engine is asked about.
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
