/**
 * A directory of files as a vault. The Node tier opens a book from a
 * checked-in fixture directory, so the pipeline runs with no
 * application around it.
 */

import { vaultWritePath, type Sink } from "@/assets/destination";
import { AssetError } from "@/assets/errors";
import * as nodeFiles from "node:fs/promises";
import * as nodePath from "node:path";
import type { Files, Paths } from "@/assets/node";
import type { Listing, VaultAdapter } from "@/assets/vault";

// The Node tier's own vault, which the bundle never reaches.
const files = nodeFiles as Files;
const paths = nodePath as Paths;

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
      if (!paths.isAbsolute(destination.path)) {
        throw new AssetError(`${destination.path} is not an absolute path`);
      }
      await writeAt(destination.path, bytes);
    },
  };
}

async function writeAt(full: string, bytes: Uint8Array): Promise<void> {
  await files.mkdir(paths.dirname(full), { recursive: true });
  await files.writeFile(full, bytes);
}

export function directoryVault(root: string): VaultAdapter {
  const at = (file: string): string => resolve(root, file);
  return {
    exists: async (file) => {
      const full = at(file);
      try {
        await files.stat(full);
        return true;
      } catch {
        return false;
      }
    },
    read: (file) => files.readFile(at(file), "utf8"),
    readBinary: async (file) => {
      const bytes = await files.readFile(at(file));
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    },
    list: async (folder) => {
      const under = at(folder);
      const listing: Listing = { files: [], folders: [] };
      for (const entry of await files.readdir(under, { withFileTypes: true })) {
        const into = entry.isDirectory() ? listing.folders : listing.files;
        into.push(vaultPath(root, paths.join(under, entry.name)));
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
  const full = paths.resolve(root, at.replace(/^\/+/, ""));
  const inside = paths.relative(root, full);
  if (inside.startsWith("..") || paths.isAbsolute(inside)) {
    throw new AssetError(`${at} is outside the vault`);
  }
  return full;
}

function vaultPath(root: string, full: string): string {
  return paths.relative(root, full).split(paths.sep).join("/");
}
