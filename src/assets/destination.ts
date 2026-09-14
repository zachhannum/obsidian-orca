import { AssetError } from "@/assets/errors";

/**
 * The place export writes the book's bytes. A vault path is relative to
 * the vault; a disk path is an absolute path the operating system chose.
 */
export type Destination =
  | { kind: "vault"; path: string }
  | { kind: "disk"; path: string };

/**
 * Writes bytes to a destination. `ui` writes through Obsidian, the Node
 * tier through a directory.
 */
export interface Sink {
  write(destination: Destination, bytes: Uint8Array): Promise<void>;
}

/**
 * Normalizes a vault path for writing. It uses `/` between segments and
 * drops empty and `.` segments. A path that is absolute, climbs with
 * `..` or names nothing is refused with an asset error.
 */
export function vaultWritePath(path: string): string {
  const slashed = path.replace(/\\/g, "/").trim();
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) {
    throw new AssetError(`${path} is not a path inside the vault`);
  }
  const segments = slashed.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) {
    throw new AssetError(`${path} is outside the vault`);
  }
  if (segments.length === 0) {
    throw new AssetError("the export has no file name in the vault");
  }
  return segments.join("/");
}
