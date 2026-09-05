import { AssetError } from "@/assets/errors";

/** What is in a folder, as vault paths. */
export interface Listing {
  files: string[];
  folders: string[];
}

/**
 * The vault, narrowed to what `assets` reads from it. `ui` implements
 * it over Obsidian's adapter and the Node tier over a directory.
 */
export interface VaultAdapter {
  /** Whether there is a file or a folder at this path. */
  exists(path: string): Promise<boolean>;
  /** A file's text. */
  read(path: string): Promise<string>;
  /** A file's bytes. */
  readBinary(path: string): Promise<ArrayBuffer>;
  /** What is directly under a folder. */
  list(folder: string): Promise<Listing>;
}

/** A file's text. A read that fails is an asset error naming the path. */
export async function readText(
  vault: VaultAdapter,
  path: string,
): Promise<string> {
  return await read(() => vault.read(path), path);
}

/** A file's bytes, with the same error on a read that fails. */
export async function readBytes(
  vault: VaultAdapter,
  path: string,
): Promise<ArrayBuffer> {
  return await read(() => vault.readBinary(path), path);
}

async function read<T>(ask: () => Promise<T>, path: string): Promise<T> {
  try {
    return await ask();
  } catch (cause) {
    // An adapter's own error is routed rather than replaced.
    if (cause instanceof AssetError) throw cause;
    throw new AssetError(`the vault has no file at ${path}`, { cause });
  }
}
