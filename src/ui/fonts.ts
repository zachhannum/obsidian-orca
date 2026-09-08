/**
 * The font files the author has, as the index reads them.
 *
 * A face installed on the machine is not in the vault, so the
 * platform's directories are read through the file system the
 * application already runs on. Orca is desktop only, which is what
 * makes that available at all.
 */

import { open, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { AssetError } from "@/assets/errors";
import {
  VAULT_FONTS,
  fontDirectories,
  fontIndex,
  scanFonts,
  type Face,
  type Family,
  type FontFiles,
  type FontIndex,
} from "@/assets/fonts";
import { faceBytes } from "@/assets/sfnt";
import { contentKey, type Hashed } from "@/assets/registry";
import { readBytes, type Listing, type VaultAdapter } from "@/assets/vault";

/**
 * Font files, read a range at a time to index them and whole for a
 * face that crosses. The index reads headers; only a face the author
 * picked is read entire.
 */
export interface FontSource extends FontFiles {
  whole(file: string): Promise<Uint8Array>;
}

/** The platform's own font directories, read through the file system. */
export function platformFonts(): FontSource {
  return {
    list: async (directory) => {
      const listing: Listing = { files: [], folders: [] };
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const into = entry.isDirectory() ? listing.folders : listing.files;
        into.push(path.join(directory, entry.name));
      }
      return listing;
    },
    read: async (file, at, length) => {
      const handle = await open(file, "r");
      try {
        const into = new Uint8Array(length);
        const { bytesRead } = await handle.read(into, 0, length, at);
        return into.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
    whole: async (file) => new Uint8Array(await readFile(file)),
  };
}

/** The vault's own faces, read through the vault the rest of `assets` reads. */
export function vaultFonts(vault: VaultAdapter): FontSource {
  // A vault holds few faces and the index reads a handful of ranges
  // out of each, so a file read once answers every range of it.
  const held = new Map<string, Promise<Uint8Array>>();
  const file = (at: string): Promise<Uint8Array> => {
    const known = held.get(at);
    if (known !== undefined) return known;
    const reading = readBytes(vault, at).then((bytes) => new Uint8Array(bytes));
    held.set(at, reading);
    reading.catch(() => held.delete(at));
    return reading;
  };
  return {
    list: (directory) => vault.list(directory),
    read: async (at, from, length) =>
      (await file(at)).subarray(from, from + length),
    whole: file,
  };
}

/** The places the index looks. A test stands a directory in for a system one. */
export interface FontPlaces {
  platform: FontSource;
  vault: FontSource;
  /** The platform's own directories. */
  directories: readonly string[];
  /** The folder in the vault a book's own faces live in. */
  folder: string;
}

/** The places the running machine keeps faces. */
export function fontPlaces(vault: VaultAdapter): FontPlaces {
  return {
    platform: platformFonts(),
    vault: vaultFonts(vault),
    directories: fontDirectories(process.platform, homedir()),
    folder: VAULT_FONTS,
  };
}

/**
 * The families the author has. The vault's faces are scanned last and
 * win a name collision, so a book carrying its own face is set in that
 * one rather than in whatever the machine happens to install under the
 * same name.
 */
export async function readFontIndex(places: FontPlaces): Promise<FontIndex> {
  const [platform, vault] = await Promise.all([
    scanFonts(places.platform, places.directories, "platform"),
    scanFonts(places.vault, [places.folder], "vault"),
  ]);
  return fontIndex(platform, vault);
}

/**
 * One family's faces, as the bytes that cross and the key they go
 * under. A collection's face is split out here: the engine refuses a
 * collection, and a family is rarely every face in one.
 */
export async function familyFaces(
  places: FontPlaces,
  family: Family,
): Promise<Hashed[]> {
  return Promise.all(family.faces.map((face) => crossing(places, face)));
}

async function crossing(places: FontPlaces, face: Face): Promise<Hashed> {
  const source = face.where === "vault" ? places.vault : places.platform;
  const file = await read(source, face.path);
  const bytes = faceBytes(file, face.face);
  return { key: await contentKey(bytes), bytes };
}

async function read(source: FontSource, at: string): Promise<Uint8Array> {
  try {
    return await source.whole(at);
  } catch (cause) {
    if (cause instanceof AssetError) throw cause;
    throw new AssetError(`the face at ${at} will not read`, { cause });
  }
}
