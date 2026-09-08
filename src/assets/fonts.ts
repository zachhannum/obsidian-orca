/**
 * The font families an author has, read from the font files
 * themselves. A family comes from the platform's font directories or
 * from a folder in the vault.
 */

import { faceOffsets, readFace, type Refusal, type Ranges } from "@/assets/sfnt";
import type { Listing } from "@/assets/vault";

/** Reads font directories and font files. `ui` implements it over the platform and the vault. */
export interface FontFiles {
  list(directory: string): Promise<Listing>;
  read(path: string, at: number, length: number): Promise<Uint8Array>;
}

/** The place a face was found. */
export type Where = "platform" | "vault";

/** One face of a family. */
export interface Face {
  path: string;
  /** The index of this face in its collection, counting from 0. */
  face: number;
  family: string;
  style: string;
  variable: boolean;
  where: Where;
}

/** One family and its faces. */
export interface Family {
  name: string;
  where: Where;
  faces: Face[];
}

/** A face the scan rejected. */
export interface Refused {
  path: string;
  face: number;
  why: Refusal;
}

/** The faces one scan accepted, and the ones it rejected. */
export interface Found {
  faces: Face[];
  refused: Refused[];
}

/** The families an author has, and the faces the scans rejected. */
export interface FontIndex {
  families: Family[];
  refused: Refused[];
}

/** The vault folder for a book's own faces. */
export const VAULT_FONTS = "fonts";

/** The font directories for `darwin`, `win32`, or any other platform. */
export function fontDirectories(platform: string, home: string): string[] {
  if (platform === "darwin") {
    return ["/System/Library/Fonts", "/Library/Fonts", `${home}/Library/Fonts`];
  }
  if (platform === "win32") {
    return [
      "C:/Windows/Fonts",
      `${home}/AppData/Local/Microsoft/Windows/Fonts`,
    ];
  }
  return [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    `${home}/.local/share/fonts`,
    `${home}/.fonts`,
  ];
}

/** The faces under these directories. A directory that is not there contributes none. */
export async function scanFonts(
  files: FontFiles,
  directories: readonly string[],
  where: Where,
): Promise<Found> {
  const found: Found = { faces: [], refused: [] };
  const seen = new Set<string>();
  for (const directory of directories) {
    await walk(files, directory, 0, where, found, seen);
  }
  return found;
}

/** Two scans as one index. A family in the vault replaces the platform's under the same name. */
export function fontIndex(platform: Found, vault: Found): FontIndex {
  const families = new Map<string, Family>();
  for (const face of vault.faces) keep(families, face);
  for (const face of platform.faces) {
    if (families.get(face.family.toLowerCase())?.where === "vault") continue;
    keep(families, face);
  }
  const listed = [...families.values()].sort((one, two) => before(one.name, two.name));
  for (const family of listed) {
    family.faces.sort((one, two) => before(one.style, two.style));
  }
  return { families: listed, refused: [...platform.refused, ...vault.refused] };
}

/**
 * The families a typed string matches. A name that starts with the
 * string comes before one that only contains it.
 */
export function matching(index: FontIndex, typed: string): Family[] {
  const want = typed.trim().toLowerCase();
  if (want === "") return [...index.families];
  const starting: Family[] = [];
  const holding: Family[] = [];
  for (const family of index.families) {
    const name = family.name.toLowerCase();
    if (name.startsWith(want)) starting.push(family);
    else if (name.includes(want)) holding.push(family);
  }
  return [...starting, ...holding];
}

/** Whether the index has this family. The comparison ignores case. */
export function has(index: FontIndex, family: string): boolean {
  const want = family.trim().toLowerCase();
  return index.families.some((known) => known.name.toLowerCase() === want);
}

/** The number of folders a scan walks down. The bound stops a loop of linked folders. */
const DEPTH = 4;

const SFNT = [".ttf", ".otf", ".ttc", ".otc"];

async function walk(
  files: FontFiles,
  directory: string,
  depth: number,
  where: Where,
  found: Found,
  seen: Set<string>,
): Promise<void> {
  if (depth >= DEPTH || seen.has(directory)) return;
  seen.add(directory);
  let listing: Listing;
  try {
    listing = await files.list(directory);
  } catch {
    // A machine that does not have this directory is the ordinary
    // case, not a failure to report.
    return;
  }
  for (const file of listing.files) {
    if (sfnt(file)) await open(files, file, where, found);
  }
  for (const folder of listing.folders) {
    await walk(files, folder, depth + 1, where, found, seen);
  }
}

async function open(
  files: FontFiles,
  path: string,
  where: Where,
  found: Found,
): Promise<void> {
  const read: Ranges = (at, length) => files.read(path, at, length);
  let offsets: number[];
  try {
    offsets = await faceOffsets(read);
  } catch {
    // A file that does not parse is not a face, so it is not reported
    // as rejected.
    return;
  }
  for (const [face, offset] of offsets.entries()) {
    let named;
    try {
      named = await readFace(read, offset);
    } catch {
      continue;
    }
    if (typeof named === "string") {
      found.refused.push({ path, face, why: named });
      continue;
    }
    found.faces.push({ path, face, ...named, where });
  }
}

function keep(families: Map<string, Family>, face: Face): void {
  const key = face.family.toLowerCase();
  const known = families.get(key);
  if (known === undefined) {
    families.set(key, { name: face.family, where: face.where, faces: [face] });
    return;
  }
  known.faces.push(face);
}

function sfnt(path: string): boolean {
  const name = path.toLowerCase();
  return SFNT.some((suffix) => name.endsWith(suffix));
}

/** Names sort by their code units, so an index is the same on every run. */
function before(one: string, two: string): number {
  if (one === two) return 0;
  return one < two ? -1 : 1;
}
