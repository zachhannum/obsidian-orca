/**
 * The two routes the iOS app's web view has to the phone's files.
 * Capacitor puts both on the window, and Obsidian's API types neither.
 */

import type { PhoneEntry, PhoneRoutes } from "@/assets/phone";

/** An entry Capacitor lists. An older Capacitor lists bare names. */
type Listed = string | { name: string; type?: string };

/** The part of Capacitor's Filesystem plugin the routes ask. */
interface Filesystem {
  readdir(options: { path: string }): Promise<{ files: readonly Listed[] }>;
}

/** The part of Capacitor the routes ask. */
interface Capacitor {
  Plugins?: { Filesystem?: Filesystem };
  convertFileSrc?: (path: string) => string;
}

/** The part of `fetch` a route asks. */
export type Get = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** A window that may carry Capacitor. */
interface Host {
  Capacitor?: Capacitor;
  fetch?: Get;
}

/**
 * The routes of a window that carries Capacitor, or undefined when it
 * has no Capacitor, no Filesystem plugin or no `convertFileSrc`.
 *
 * A file is fetched with the window's own `fetch`, because `requestUrl`
 * does not reach the web view's scheme.
 */
export function phoneRoutes(host: unknown): PhoneRoutes | undefined {
  const page = host as Host | undefined;
  const capacitor = page?.Capacitor;
  const filesystem = capacitor?.Plugins?.Filesystem;
  const convert = capacitor?.convertFileSrc;
  const get = page?.fetch;
  if (
    page === undefined ||
    capacitor === undefined ||
    filesystem === undefined ||
    convert === undefined ||
    get === undefined
  ) {
    return undefined;
  }
  return {
    list: async (url) => {
      const { files } = await filesystem.readdir({ path: url });
      return files.map(entry);
    },
    fetch: async (path, range) => {
      const headers: Record<string, string> = {};
      if (range !== undefined) {
        headers["Range"] = `bytes=${range.at}-${range.at + range.length - 1}`;
      }
      const answer = await get.call(page, convert.call(capacitor, path), {
        headers,
      });
      return {
        status: answer.status,
        bytes: new Uint8Array(await answer.arrayBuffer()),
      };
    },
  };
}

function entry(listed: Listed): PhoneEntry {
  if (typeof listed === "string") return { name: listed, folder: false };
  return { name: listed.name, folder: listed.type === "directory" };
}
