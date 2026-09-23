/**
 * A face's `cmap` table, read for the code points the face sets. A face
 * of a CJK script covers tens of thousands of them, so the reader hands
 * back spans and the caller counts and indexes without holding a list.
 */

import { AssetError } from "@/assets/errors";

/** A span of code points a face covers, both ends included. */
export interface Cover {
  from: number;
  to: number;
}

/** The code points one face maps to a glyph, as spans in ascending order, merged and never touching. */
export function coverage(face: Uint8Array): readonly Cover[] {
  const table = tables(face).get("cmap");
  if (table === undefined) return [];
  within(face, table.at, table.length);
  const cmap = face.subarray(table.at, table.at + table.length);
  const chosen = best(cmap);
  if (chosen === undefined) return [];
  return normalized(read(cmap, chosen));
}

/** The number of code points a set of spans holds. */
export function covered(spans: readonly Cover[]): number {
  let held = 0;
  for (const span of spans) held += span.to - span.from + 1;
  return held;
}

/** The nth code point of a set of spans, counting from 0, or undefined past the end. */
export function coveredAt(
  spans: readonly Cover[],
  at: number,
): number | undefined {
  if (!Number.isInteger(at) || at < 0) return undefined;
  let left = at;
  for (const span of spans) {
    const held = span.to - span.from + 1;
    if (left < held) return span.from + left;
    left -= held;
  }
  return undefined;
}

/** The byte lengths of an sfnt header and of one table directory entry. */
const HEADER = 12;
const RECORD = 16;

/** The subtable formats the reader handles. */
const FORMATS = new Set([0, 4, 6, 12]);

/** The Macintosh platform, whose records the reader cuts to ASCII. */
const MACINTOSH = 1;

/** The last code point, and the surrogates, which stand for no character. */
const LAST = 0x10ffff;
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;

/** The last code point a Mac Roman record is read for. */
const ASCII_LAST = 0x7f;

interface Table {
  at: number;
  length: number;
}

interface Chosen {
  at: number;
  platform: number;
}

function tables(face: Uint8Array): Map<string, Table> {
  within(face, 0, HEADER);
  const head = viewing(face);
  const count = head.getUint16(4);
  if (count === 0) throw new AssetError("a face names no tables");
  within(face, HEADER, count * RECORD);
  const found = new Map<string, Table>();
  for (let index = 0; index < count; index += 1) {
    const at = HEADER + index * RECORD;
    found.set(tagAt(head, at), {
      at: head.getUint32(at + 8),
      length: head.getUint32(at + 12),
    });
  }
  return found;
}

/**
 * The best encoding record the reader handles. A record in a format it
 * does not handle is passed over, so a face that also ships a plain
 * subtable is read from that one.
 */
function best(cmap: Uint8Array): Chosen | undefined {
  within(cmap, 0, 4);
  const view = viewing(cmap);
  const count = view.getUint16(2);
  within(cmap, 4, count * 8);
  let chosen: Chosen | undefined;
  let held = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const at = 4 + index * 8;
    const platform = view.getUint16(at);
    const rank = ranked(platform, view.getUint16(at + 2));
    if (rank === undefined || rank >= held) continue;
    const subtable = view.getUint32(at + 4);
    within(cmap, subtable, 2);
    if (!FORMATS.has(view.getUint16(subtable))) continue;
    chosen = { at: subtable, platform };
    held = rank;
  }
  return chosen;
}

/** The order the records are tried in. A record with no rank is passed over. */
function ranked(platform: number, encoding: number): number | undefined {
  if (platform === 3 && encoding === 10) return 0;
  if (platform === 0 && (encoding === 4 || encoding === 6)) return 1;
  if (platform === 3 && encoding === 1) return 2;
  if (platform === 0 && encoding <= 3) return 3;
  if (platform === 3 && encoding === 0) return 4;
  if (platform === MACINTOSH && encoding === 0) return 5;
  return undefined;
}

function read(cmap: Uint8Array, chosen: Chosen): Cover[] {
  const view = viewing(cmap);
  const format = view.getUint16(chosen.at);
  within(cmap, chosen.at, format === 12 ? 8 : 4);
  const length =
    format === 12 ? view.getUint32(chosen.at + 4) : view.getUint16(chosen.at + 2);
  within(cmap, chosen.at, length);
  const sub = cmap.subarray(chosen.at, chosen.at + length);
  const found =
    format === 0
      ? byteEncoding(sub)
      : format === 4
        ? segmentMapping(sub)
        : format === 6
          ? trimmed(sub)
          : segmentedCoverage(sub);
  // Mac Roman is ASCII to 0x7F and its own set above it. The face is
  // read for the part that agrees.
  if (chosen.platform !== MACINTOSH) return found;
  return found
    .map((span) => ({ from: span.from, to: Math.min(span.to, ASCII_LAST) }))
    .filter((span) => span.from <= span.to);
}

/** Format 0: one glyph id per byte, 256 of them. */
function byteEncoding(sub: Uint8Array): Cover[] {
  fits(sub, 6 + 256);
  const found: Cover[] = [];
  const add = adding(found);
  for (let code = 0; code < 256; code += 1) {
    if ((sub[6 + code] ?? 0) !== 0) add(code);
  }
  return found;
}

/**
 * Format 4: one delta per segment, and a glyph id array where the
 * segment names one. A zero in that array is `.notdef`, not a glyph.
 */
function segmentMapping(sub: Uint8Array): Cover[] {
  fits(sub, 14);
  const view = viewing(sub);
  const pairs = view.getUint16(6);
  if (pairs % 2 !== 0) {
    throw new AssetError("a font's cmap names half a segment");
  }
  const count = pairs / 2;
  fits(sub, 16 + count * 8);
  const starts = 16 + count * 2;
  const deltas = 16 + count * 4;
  const offsets = 16 + count * 6;
  const found: Cover[] = [];
  const add = adding(found);
  for (let segment = 0; segment < count; segment += 1) {
    const end = view.getUint16(14 + segment * 2);
    const start = view.getUint16(starts + segment * 2);
    const delta = view.getInt16(deltas + segment * 2);
    const offset = view.getUint16(offsets + segment * 2);
    if (start > end) continue;
    for (let code = start; code <= end; code += 1) {
      let glyph: number;
      if (offset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        // A segment whose glyph ids run past the subtable maps nothing;
        // shipping faces end on one and the face is still readable.
        const at = offsets + segment * 2 + offset + (code - start) * 2;
        const id = at + 2 <= sub.length ? view.getUint16(at) : 0;
        glyph = id === 0 ? 0 : (id + delta) & 0xffff;
      }
      if (glyph !== 0) add(code);
    }
  }
  return found;
}

/** Format 6: a glyph id per code point over one run of them. */
function trimmed(sub: Uint8Array): Cover[] {
  fits(sub, 10);
  const view = viewing(sub);
  const first = view.getUint16(6);
  const count = view.getUint16(8);
  fits(sub, 10 + count * 2);
  const found: Cover[] = [];
  const add = adding(found);
  for (let index = 0; index < count; index += 1) {
    if (view.getUint16(10 + index * 2) !== 0) add(first + index);
  }
  return found;
}

/**
 * Format 12: a run of code points per group, against a run of glyph
 * ids. Only a group that starts at `.notdef` loses a code point.
 */
function segmentedCoverage(sub: Uint8Array): Cover[] {
  fits(sub, 16);
  const view = viewing(sub);
  const groups = view.getUint32(12);
  fits(sub, 16 + groups * 12);
  const found: Cover[] = [];
  for (let group = 0; group < groups; group += 1) {
    const at = 16 + group * 12;
    const start = view.getUint32(at);
    const end = view.getUint32(at + 4);
    if (start > end) continue;
    found.push({ from: view.getUint32(at + 8) === 0 ? start + 1 : start, to: end });
  }
  return found;
}

/** Appends one code point, extending the run it continues. */
function adding(found: Cover[]): (code: number) => void {
  return (code) => {
    const last = found.at(-1);
    if (last !== undefined && code === last.to + 1) last.to = code;
    else found.push({ from: code, to: code });
  };
}

function normalized(spans: readonly Cover[]): Cover[] {
  const kept: Cover[] = [];
  for (const span of spans) kept.push(...clipped(span));
  kept.sort((a, b) => a.from - b.from);
  const merged: Cover[] = [];
  for (const span of kept) {
    const last = merged.at(-1);
    if (last === undefined || span.from > last.to + 1) {
      merged.push({ ...span });
      continue;
    }
    if (span.to > last.to) last.to = span.to;
  }
  return merged;
}

/** One span with the surrogates cut out of it and its end held to U+10FFFF. */
function clipped(span: Cover): Cover[] {
  const from = Math.max(span.from, 0);
  const to = Math.min(span.to, LAST);
  if (from > to) return [];
  const parts: Cover[] = [];
  if (from < SURROGATE_FIRST) {
    parts.push({ from, to: Math.min(to, SURROGATE_FIRST - 1) });
  }
  if (to > SURROGATE_LAST) {
    parts.push({ from: Math.max(from, SURROGATE_LAST + 1), to });
  }
  return parts;
}

function within(bytes: Uint8Array, at: number, length: number): void {
  if (at < 0 || length < 0 || at + length > bytes.length) {
    throw new AssetError("a font file ends before its tables do");
  }
}

function fits(sub: Uint8Array, need: number): void {
  if (!Number.isSafeInteger(need) || need > sub.length) {
    throw new AssetError("a font's cmap subtable holds less than it names");
  }
}

function viewing(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function tagAt(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}
