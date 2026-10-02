/**
 * The font files of a phone, which has no file system to open. One
 * route lists a directory and another fetches a file's bytes.
 */

import { AssetError } from "@/assets/errors";
import type { FontFiles } from "@/assets/fonts";
import type { Listing } from "@/assets/vault";

/** One entry of a listed directory. */
export interface PhoneEntry {
  name: string;
  folder: boolean;
}

/** A fetched body and the status it came with. */
export interface PhoneBody {
  status: number;
  bytes: Uint8Array;
}

/** The two routes a web view has to the phone's files. `ui` implements them. */
export interface PhoneRoutes {
  /** Lists the directory at a `file://` URL. */
  list(url: string): Promise<PhoneEntry[]>;
  /** Fetches the file at a path, or one range of it. */
  fetch(path: string, range?: { at: number; length: number }): Promise<PhoneBody>;
}

/** Font files read over a phone's routes. */
export interface PhoneFonts extends FontFiles {
  whole(file: string): Promise<Uint8Array>;
}

/**
 * Reads font files over a phone's routes. A fetch whose range is not
 * honoured answers with the whole file, and that file is held until
 * another is read, so a scan fetches it once.
 */
export function phoneFonts(routes: PhoneRoutes): PhoneFonts {
  let held: { path: string; bytes: Uint8Array } | undefined;
  return {
    list: async (directory) => {
      const under = directory.replace(/\/+$/, "");
      const listing: Listing = { files: [], folders: [] };
      for (const entry of await routes.list(`file://${under}`)) {
        const into = entry.folder ? listing.folders : listing.files;
        into.push(`${under}/${entry.name}`);
      }
      return listing;
    },
    read: async (path, at, length) => {
      if (held?.path === path) return held.bytes.subarray(at, at + length);
      const { status, bytes } = await routes.fetch(path, { at, length });
      if (status === PARTIAL) return bytes.subarray(0, length);
      if (status !== WHOLE) throw unread(path, status);
      held = { path, bytes };
      return bytes.subarray(at, at + length);
    },
    whole: async (file) => {
      const { status, bytes } = await routes.fetch(file);
      if (status !== WHOLE) throw unread(file, status);
      return bytes;
    },
  };
}

/** The statuses of a range that was honoured and of a whole file. */
const PARTIAL = 206;
const WHOLE = 200;

function unread(path: string, status: number): AssetError {
  return new AssetError(`the file at ${path} answered ${status}`);
}
