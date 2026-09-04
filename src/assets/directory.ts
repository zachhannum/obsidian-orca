/**
 * A directory of files as a vault. The Node tier opens a book from a
 * checked-in fixture directory, so the pipeline runs with no
 * application around it.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { AssetError } from "@/assets/errors";
import type { Listing, VaultAdapter } from "@/assets/vault";

export function directoryVault(root: string): VaultAdapter {
  const at = (file: string): string => resolve(root, file);
  return {
    exists: async (file) => {
      const full = at(file);
      try {
        await stat(full);
        return true;
      } catch {
        return false;
      }
    },
    read: (file) => readFile(at(file), "utf8"),
    readBinary: async (file) => {
      const bytes = await readFile(at(file));
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },
    list: async (folder) => {
      const under = at(folder);
      const listing: Listing = { files: [], folders: [] };
      for (const entry of await readdir(under, { withFileTypes: true })) {
        const held = entry.isDirectory() ? listing.folders : listing.files;
        held.push(vaultPath(root, path.join(under, entry.name)));
      }
      listing.files.sort();
      listing.folders.sort();
      return listing;
    },
  };
}

/**
 * A vault path is relative to the vault, separated by `/`, and
 * sometimes has a leading `/`. A path that climbs out of the directory
 * is refused.
 */
function resolve(root: string, at: string): string {
  const full = path.resolve(root, at.replace(/^\/+/, ""));
  const inside = path.relative(root, full);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new AssetError(`${at} is outside the vault`);
  }
  return full;
}

function vaultPath(root: string, full: string): string {
  return path.relative(root, full).split(path.sep).join("/");
}
