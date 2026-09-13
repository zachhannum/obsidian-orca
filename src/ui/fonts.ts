/**
 * Reads the font files the machine and the vault hold.
 *
 * A face installed on the machine is not in the vault, so the
 * platform's directories are read through the file system rather than
 * the vault adapter. Orca is desktop only, so the file system is
 * available.
 */

import { open, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { AssetError } from "@/assets/errors";
import {
  VAULT_FONTS,
  familyNamed,
  fontDirectories,
  fontIndex,
  scanFonts,
  type Face as IndexedFace,
  type Family,
  type FontFiles,
  type FontIndex,
} from "@/assets/fonts";
import { faceBytes } from "@/assets/sfnt";
import { contentKey, fontUrl, type Hashed } from "@/assets/registry";
import { usedVariant, variantFamily } from "@/assets/variants";
import { readBytes, type Listing, type VaultAdapter } from "@/assets/vault";
import type { Face } from "@/book/plan";
import type { FontUse } from "@/style/design";
import type { Registered } from "@/style/faces";
import { previewFace, previewFamily } from "@/ui/picker";

/**
 * Font files, read a range at a time for the index and whole for a
 * face that crosses.
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

/** The vault's own faces, read through the vault adapter. */
export function vaultFonts(vault: VaultAdapter): FontSource {
  // A vault holds few faces and the index reads a handful of ranges
  // out of each, so each file is read once and held whole.
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
    // A face sent to the worker transfers its buffer, and the transfer
    // detaches the file the face came out of. The copy leaves the held
    // file with its bytes for the next read.
    whole: async (at) => (await file(at)).slice(),
  };
}

/** The places the index reads. A test substitutes its own directory. */
export interface FontPlaces {
  platform: FontSource;
  vault: FontSource;
  /** The platform's own directories. */
  directories: readonly string[];
  /** The vault folder a book's own faces are in. */
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
 * The families the machine and the vault hold. The vault's faces are
 * scanned last and win a name collision, so a book carrying its own
 * face is set in that one.
 */
export async function readFontIndex(places: FontPlaces): Promise<FontIndex> {
  const [platform, vault] = await Promise.all([
    scanFonts(places.platform, places.directories, "platform"),
    scanFonts(places.vault, [places.folder], "vault"),
  ]);
  return fontIndex(platform, vault);
}

/** A font and variant a design sets, as the faces that cross and the rules that register them. */
export interface ResolvedUse {
  use: FontUse;
  /**
   * Absent for a font the machine does not have and for one whose
   * files would not read. The engine then sets that text in the face it
   * carries.
   */
  registered: Registered | undefined;
  /** Each face of the variant in use, under the url its rule names. */
  faces: Face[];
  /** True when the design names a variant the family lacks, so the default is used. */
  fellBack: boolean;
  /** True when a face of the variant would not read. */
  unread: boolean;
}

/**
 * The faces of the one variant a use sets, and the `@font-face` rules
 * for them. Only that variant crosses, so the engine cannot match a
 * face of another variant of the family.
 *
 * A face is split out of a collection first, because the engine does
 * not read a collection and a family is rarely every face in one.
 */
export async function resolveUse(
  places: FontPlaces,
  index: FontIndex,
  use: FontUse,
): Promise<ResolvedUse> {
  const family = familyNamed(index, use.font);
  if (family === undefined || family.variants.length === 0) {
    return { use, registered: undefined, faces: [], fellBack: false, unread: false };
  }
  const { variant, fellBack } = usedVariant(family, use.variant);
  let crossed: Hashed[];
  try {
    crossed = await Promise.all(variant.faces.map((face) => crossing(places, face)));
  } catch {
    return { use, registered: undefined, faces: [], fellBack, unread: true };
  }
  const faces = crossed.map((hashed) => ({ ...hashed, url: fontUrl(hashed.key) }));
  const registered: Registered = {
    font: use.font,
    variant: use.variant,
    family: variantFamily(family, variant),
    faces: variant.faces.map((face, at) => {
      const url = faces[at]?.url ?? "";
      // A variable face declares no weight or slope, so the file
      // registers every instance it names.
      return face.variable ? { url } : { url, weight: face.weight, italic: face.italic };
    }),
  };
  return { use, registered, faces, fellBack, unread: false };
}

/** Registers a face with the document, so a picker row previews in it. */
export interface Previews {
  add(family: string, bytes: Uint8Array): Promise<void>;
}

/** The document's faces. A family registered once is not registered again. */
export function documentPreviews(document: Document): Previews {
  const added = new Map<string, Promise<void>>();
  return {
    add: (family, bytes) => {
      const known = added.get(family);
      if (known !== undefined) return known;
      const adding = (async () => {
        const face = new FontFace(family, new Uint8Array(bytes));
        await face.load();
        document.fonts.add(face);
      })();
      added.set(family, adding);
      adding.catch(() => added.delete(family));
      return adding;
    },
  };
}

/**
 * Registers the vault's own faces with the document, each family in
 * its default variant. The browser resolves an installed family by name
 * but not one the vault carries, so a row offering it would draw in the
 * interface face instead. Nothing crosses to the engine, because the
 * browser draws a picker row.
 */
export async function previewFaces(
  places: FontPlaces,
  index: FontIndex,
  previews: Previews,
): Promise<void> {
  await Promise.all(
    index.families
      .filter((family) => family.where === "vault")
      .map(async (family) => {
        const variant = family.variants.find((each) => each.isDefault);
        const face = variant === undefined ? undefined : previewFace(variant);
        if (face === undefined) return;
        await preview(places, previewFamily(family.name), face, previews);
      }),
  );
}

/**
 * Registers one face of each variant of a family with the document,
 * under the variant's own preview family, so each row of the Variant
 * menu draws in its own face.
 */
export async function previewVariants(
  places: FontPlaces,
  family: Family,
  previews: Previews,
): Promise<void> {
  await Promise.all(
    family.variants.map(async (variant) => {
      const face = previewFace(variant);
      if (face === undefined) return;
      await preview(places, previewFamily(variantFamily(family, variant)), face, previews);
    }),
  );
}

async function preview(
  places: FontPlaces,
  family: string,
  face: IndexedFace,
  previews: Previews,
): Promise<void> {
  try {
    const { bytes } = await crossing(places, face);
    await previews.add(family, bytes);
  } catch {
    // A face that will not load leaves its row in the interface face,
    // which still reads.
  }
}

async function crossing(places: FontPlaces, face: IndexedFace): Promise<Hashed> {
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
