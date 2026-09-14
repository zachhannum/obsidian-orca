/**
 * A directory of files as a vault. The Node tier opens a book from a
 * checked-in fixture directory, so the pipeline runs with no
 * application around it.
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { vaultWritePath, type Sink } from "@/assets/destination";
import { AssetError } from "@/assets/errors";
import type { Listing, VaultAdapter } from "@/assets/vault";

/**
 * A sink for the Node tier. A vault destination lands under the root;
 * a disk destination must be absolute and lands where it says.
 */
export function directorySink(root: string): Sink {
  const vault = directoryVault(root);
  return {
    write: async (destination, bytes) => {
      if (destination.kind === "vault") {
        await vault.writeBinary(vaultWritePath(destination.path), bytes);
        return;
      }
      if (!path.isAbsolute(destination.path)) {
        throw new AssetError(`${destination.path} is not an absolute path`);
      }
      await writeAt(destination.path, bytes);
    },
  };
}

async function writeAt(full: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

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
        const into = entry.isDirectory() ? listing.folders : listing.files;
        into.push(vaultPath(root, path.join(under, entry.name)));
      }
      listing.files.sort();
      listing.folders.sort();
      return listing;
    },
    writeBinary: (file, bytes) => writeAt(at(file), bytes),
  };
}

/**
 * A vault path is relative to the vault, separated by `/`, and
 * sometimes has a leading `/`. A path that leads outside the directory
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
