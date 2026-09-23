/**
 * The glyph browser, without its drawing.
 *
 * The browser lists the code points a face covers, under the name of
 * the Unicode block each one sits in. It hides no block. An ornamental
 * font maps its ornaments where it likes, and some map them onto the
 * letter keys or into the private use area, so a list of ornament
 * blocks would hide the fonts the browser exists for.
 */

import { coveredAt, type Cover } from "@/assets/cmap";
import { blockOf, nextBlock, OTHER } from "@/ui/blocks";

/**
 * The columns the grid draws. The browser steps by this on an arrow
 * key, so the count is fixed here rather than by the layout.
 */
export const COLUMNS = 6;

/** One block of the browser, and the parts of it the face covers. */
export interface Section {
  name: string;
  spans: readonly Cover[];
  count: number;
}

/** The browser's state. */
export interface Browsing {
  /** The sections the typed string leaves, in code point order. */
  sections: Section[];
  /** The number of code points those sections hold. */
  offered: number;
  /** The selected cell, counted across the sections, or -1 for none. */
  at: number;
  /** The code point a commit takes, or nothing when nothing matches. */
  commits: number | undefined;
}

/** A face's coverage grouped into blocks, in code point order. A block the face does not touch gets no section. */
export function sections(spans: readonly Cover[]): Section[] {
  const out: Section[] = [];
  for (const span of spans) {
    let from = span.from;
    while (from <= span.to) {
      const block = blockOf(from);
      const until =
        block !== undefined ? block.to : (nextBlock(from)?.from ?? Infinity) - 1;
      const to = Math.min(span.to, until);
      add(out, block?.name ?? OTHER, { from, to });
      from = to + 1;
    }
  }
  return out;
}

/**
 * Narrows the sections by a typed string and clamps the selected cell
 * to the result. A cell past the end of a narrowed list lands on its
 * last cell.
 */
export function browsing(
  spans: readonly Cover[],
  typed: string,
  at: number,
): Browsing {
  const narrowed = narrow(sections(spans), typed);
  const offered = narrowed.reduce((count, section) => count + section.count, 0);
  if (offered === 0) {
    return { sections: narrowed, offered, at: -1, commits: undefined };
  }
  const on = Math.min(Math.max(at, 0), offered - 1);
  return { sections: narrowed, offered, at: on, commits: glyphAt(narrowed, on) };
}

/** The code point a cell holds, counting across the sections from 0, or nothing past the end. */
export function glyphAt(sections: readonly Section[], at: number): number | undefined {
  let left = at;
  for (const section of sections) {
    if (left < section.count) return coveredAt(section.spans, left);
    left -= section.count;
  }
  return undefined;
}

/** The cell a code point sits in, counting across the sections from 0, or -1 when no section holds it. */
export function cellOf(sections: readonly Section[], code: number): number {
  let before = 0;
  for (const section of sections) {
    for (const span of section.spans) {
      if (code >= span.from && code <= span.to) return before + code - span.from;
      before += span.to - span.from + 1;
    }
  }
  return -1;
}

/**
 * The family the browser reads. A scene break with no font of its own
 * is set in the body's face, and a design that names no body font is
 * set in the face the engine carries.
 */
export function browsedFamily(
  scene: string | undefined,
  body: string | undefined,
  carried: string,
): string {
  return scene ?? body ?? carried;
}

/** The label a cell carries, which is its code point in hex. Orca ships no table of character names. */
export function glyphName(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function narrow(all: Section[], typed: string): Section[] {
  const text = typed.trim();
  if (text === "") return all;
  const one = [...text];
  if (one.length === 1) {
    const code = one[0]?.codePointAt(0);
    const only = code === undefined ? undefined : onlyCode(all, code);
    if (only !== undefined) return only;
  }
  const hex = /^(?:u\+|0x)?([0-9a-f]{2,6})$/i.exec(text);
  const found = hex?.[1] === undefined ? undefined : onlyCode(all, parseInt(hex[1], 16));
  if (found !== undefined) return found;
  const lower = text.toLowerCase();
  return all.filter((section) => section.name.toLowerCase().includes(lower));
}

function onlyCode(all: Section[], code: number): Section[] | undefined {
  for (const section of all) {
    for (const span of section.spans) {
      if (code >= span.from && code <= span.to) {
        return [{ name: section.name, spans: [{ from: code, to: code }], count: 1 }];
      }
    }
  }
  return undefined;
}

function add(out: Section[], name: string, span: Cover): void {
  const count = span.to - span.from + 1;
  const last = out[out.length - 1];
  if (last !== undefined && last.name === name) {
    last.spans = [...last.spans, span];
    last.count += count;
    return;
  }
  out.push({ name, spans: [span], count });
}
