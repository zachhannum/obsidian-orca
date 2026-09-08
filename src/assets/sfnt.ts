/**
 * An sfnt file, read for its faces' names. A collection holds several
 * faces in one file, and the engine parses a face rather than a
 * collection, so a face crosses as an sfnt of its own.
 */

import { AssetError } from "@/assets/errors";

/** The reason the index rejects a face. */
export type Refusal = "unnamed" | "restricted" | "hidden";

/** The names of one face. */
export interface FaceNames {
  family: string;
  style: string;
  /** Whether the file names variation axes. */
  variable: boolean;
}

/** Reads a slice of one file. A read past the end returns what is there. */
export interface Ranges {
  (at: number, length: number): Promise<Uint8Array>;
}

/** The offset each face of a file begins at. A file of one face has one offset. */
export async function faceOffsets(read: Ranges): Promise<number[]> {
  const head = viewing(await slice(read, 0, HEADER));
  if (tagAt(head, 0) !== COLLECTION) return [0];
  const count = head.getUint32(8);
  if (count === 0) throw new AssetError("a font collection names no faces");
  const table = viewing(await slice(read, HEADER, count * 4));
  const offsets: number[] = [];
  for (let face = 0; face < count; face += 1) {
    offsets.push(table.getUint32(face * 4));
  }
  return offsets;
}

/** One face's names, or the reason it is rejected. */
export async function readFace(
  read: Ranges,
  offset: number,
): Promise<FaceNames | Refusal> {
  const directory = await tables(read, offset);
  const table = directory.get("name");
  if (table === undefined) return "unnamed";
  const names = readNames(await slice(read, table.at, table.length));
  const family = (names.get(TYPOGRAPHIC_FAMILY) ?? names.get(FAMILY) ?? "").trim();
  if (family === "") return "unnamed";
  // A face the system hides has a leading dot in its family or in its
  // PostScript name.
  const postscript = names.get(POSTSCRIPT) ?? "";
  if (family.startsWith(".") || postscript.startsWith(".")) return "hidden";
  if (await restricted(read, directory.get("OS/2"))) return "restricted";
  return {
    family,
    style: (names.get(TYPOGRAPHIC_STYLE) ?? names.get(STYLE) ?? "Regular").trim(),
    variable: directory.has("fvar"),
  };
}

/** One face of a file, as an sfnt of its own. */
export function faceBytes(file: Uint8Array, face: number): Uint8Array {
  if (file.length < HEADER) throw new AssetError("a font file has no header");
  const view = viewing(file);
  if (tagAt(view, 0) !== COLLECTION) return file;

  const faces = view.getUint32(8);
  if (face < 0 || face >= faces) {
    throw new AssetError(`a collection of ${faces} faces has no face ${face}`);
  }
  within(file, HEADER, faces * 4);
  const offset = view.getUint32(HEADER + face * 4);
  within(file, offset, HEADER);

  const count = view.getUint16(offset + 4);
  if (count === 0) throw new AssetError("a face names no tables");
  within(file, offset + HEADER, count * RECORD);

  const parts: Part[] = [];
  let at = HEADER + count * RECORD;
  for (let index = 0; index < count; index += 1) {
    const record = offset + HEADER + index * RECORD;
    const from = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    within(file, from, length);
    parts.push({ record, from, length, to: at });
    at += padded(length);
  }

  // The checksums are copied as they stand. The engine parses the
  // tables, not the sums over them.
  const out = new Uint8Array(at);
  const wrote = viewing(out);
  wrote.setUint32(0, view.getUint32(offset));
  wrote.setUint16(4, count);
  let power = 1;
  while (power * 2 <= count) power *= 2;
  wrote.setUint16(6, power * 16);
  wrote.setUint16(8, Math.log2(power));
  wrote.setUint16(10, count * 16 - power * 16);
  for (const [index, part] of parts.entries()) {
    const record = HEADER + index * RECORD;
    out.set(file.subarray(part.record, part.record + 8), record);
    wrote.setUint32(record + 8, part.to);
    wrote.setUint32(record + 12, part.length);
    out.set(file.subarray(part.from, part.from + part.length), part.to);
  }
  return out;
}

/** The byte lengths of an sfnt header and of one table directory entry. */
const HEADER = 12;
const RECORD = 16;

const COLLECTION = "ttcf";

/** The name ids a family and a style are read from, in the order they are tried. */
const FAMILY = 1;
const STYLE = 2;
const POSTSCRIPT = 6;
const TYPOGRAPHIC_FAMILY = 16;
const TYPOGRAPHIC_STYLE = 17;

/** Windows' English, the preferred language for a name. */
const ENGLISH = 0x0409;

/** Restricted embedding, the one `fsType` bit that keeps a face out of the index. */
const RESTRICTED = 0x0002;

interface Table {
  at: number;
  length: number;
}

interface Part {
  record: number;
  from: number;
  length: number;
  to: number;
}

async function tables(
  read: Ranges,
  offset: number,
): Promise<Map<string, Table>> {
  const head = viewing(await slice(read, offset, HEADER));
  const count = head.getUint16(4);
  if (count === 0) throw new AssetError("a face names no tables");
  const directory = viewing(await slice(read, offset + HEADER, count * RECORD));
  const found = new Map<string, Table>();
  for (let index = 0; index < count; index += 1) {
    const at = index * RECORD;
    found.set(tagAt(directory, at), {
      at: directory.getUint32(at + 8),
      length: directory.getUint32(at + 12),
    });
  }
  return found;
}

async function restricted(read: Ranges, os2: Table | undefined): Promise<boolean> {
  if (os2 === undefined || os2.length < 10) return false;
  const table = viewing(await slice(read, os2.at, 10));
  return (table.getUint16(8) & RESTRICTED) !== 0;
}

/**
 * The names one table holds, keyed by name id. An English record is
 * preferred, since a face is listed in every language it ships in and
 * the first record is as often Spanish as English.
 */
function readNames(table: Uint8Array): Map<number, string> {
  if (table.length < 6) throw new AssetError("a font's name table has no header");
  const view = viewing(table);
  const count = view.getUint16(2);
  const strings = view.getUint16(4);
  const found = new Map<number, string>();
  const ranks = new Map<number, number>();
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 12;
    if (at + 12 > table.length) break;
    const platform = view.getUint16(at);
    const language = view.getUint16(at + 4);
    const name = view.getUint16(at + 6);
    const length = view.getUint16(at + 8);
    const from = strings + view.getUint16(at + 10);
    const rank = ranked(platform, language);
    const held = ranks.get(name);
    if (held !== undefined && held <= rank) continue;
    if (from + length > table.length) continue;
    found.set(name, decode(table.subarray(from, from + length), platform));
    ranks.set(name, rank);
  }
  return found;
}

function ranked(platform: number, language: number): number {
  if (platform === 3 && language === ENGLISH) return 0;
  if (platform === 1 && language === 0) return 1;
  if (platform === 3) return 2;
  if (platform === 0) return 3;
  return 4;
}

/** Platform 1 is Mac Roman, read as latin1; the rest are UTF-16BE. */
function decode(bytes: Uint8Array, platform: number): string {
  let text = "";
  if (platform === 1) {
    for (const byte of bytes) text += String.fromCharCode(byte);
    return text;
  }
  const view = viewing(bytes);
  for (let at = 0; at + 1 < bytes.length; at += 2) {
    text += String.fromCharCode(view.getUint16(at));
  }
  return text;
}

async function slice(
  read: Ranges,
  at: number,
  length: number,
): Promise<Uint8Array> {
  if (at < 0 || length < 0 || !Number.isSafeInteger(at + length)) {
    throw new AssetError("a font file was read outside itself");
  }
  const bytes = await read(at, length);
  if (bytes.length < length) {
    throw new AssetError("a font file ends before its tables do");
  }
  return bytes;
}

function within(file: Uint8Array, at: number, length: number): void {
  if (at < 0 || length < 0 || at + length > file.length) {
    throw new AssetError("a font file ends before its tables do");
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

function padded(length: number): number {
  return length + ((4 - (length % 4)) % 4);
}
