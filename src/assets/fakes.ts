/** Font files built in memory, for the tests of the index. */

import type { FontFiles } from "@/assets/fonts";
import type { Listing } from "@/assets/vault";

function utf16(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (const [at, letter] of [...text].entries()) {
    view.setUint16(at * 2, letter.charCodeAt(0));
  }
  return bytes;
}

/** Makes a name table with each name once, in Windows English. */
function nameTable(names: readonly (readonly [number, string])[]): Uint8Array {
  const records = names.map(([id, text]) => ({ id, bytes: utf16(text) }));
  const strings = 6 + records.length * 12;
  const out = new Uint8Array(
    strings + records.reduce((sum, { bytes }) => sum + bytes.length, 0),
  );
  const view = new DataView(out.buffer);
  view.setUint16(2, records.length);
  view.setUint16(4, strings);
  let at = 6;
  let held = 0;
  for (const { id, bytes } of records) {
    view.setUint16(at, 3);
    view.setUint16(at + 2, 1);
    view.setUint16(at + 4, 0x0409);
    view.setUint16(at + 6, id);
    view.setUint16(at + 8, bytes.length);
    view.setUint16(at + 10, held);
    out.set(bytes, strings + held);
    held += bytes.length;
    at += 12;
  }
  return out;
}

/** Makes a file of one face with these names and this `fsType`. */
export function face(family: string, style: string, fsType = 0): Uint8Array {
  const os2 = new Uint8Array(96);
  new DataView(os2.buffer).setUint16(8, fsType);
  const tables = [
    {
      tag: "name",
      bytes: nameTable([
        [1, family],
        [2, style],
        [6, `${family}-${style}`],
      ]),
    },
    { tag: "OS/2", bytes: os2 },
  ];
  let at = 12 + tables.length * 16;
  const placed = tables.map((table) => {
    const spot = at;
    at += table.bytes.length + ((4 - (table.bytes.length % 4)) % 4);
    return { ...table, at: spot };
  });
  const out = new Uint8Array(at);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  let record = 12;
  for (const table of placed) {
    out.set(
      Uint8Array.from(table.tag, (letter) => letter.charCodeAt(0)),
      record,
    );
    view.setUint32(record + 8, table.at);
    view.setUint32(record + 12, table.bytes.length);
    out.set(table.bytes, table.at);
    record += 16;
  }
  return out;
}

/** Font files at fixed paths. A directory none of them is under is not there. */
export function fontFiles(files: Readonly<Record<string, Uint8Array>>): FontFiles {
  return {
    list: async (directory) => {
      const under = `${directory.replace(/\/+$/, "")}/`;
      const listing: Listing = { files: [], folders: [] };
      const folders = new Set<string>();
      for (const path of Object.keys(files)) {
        if (!path.startsWith(under)) continue;
        const rest = path.slice(under.length);
        const cut = rest.indexOf("/");
        if (cut === -1) listing.files.push(path);
        else folders.add(under + rest.slice(0, cut));
      }
      if (listing.files.length === 0 && folders.size === 0) {
        throw new Error(`no directory at ${directory}`);
      }
      listing.folders.push(...folders);
      listing.files.sort();
      listing.folders.sort();
      return listing;
    },
    read: async (path, at, length) => {
      const bytes = files[path];
      if (bytes === undefined) throw new Error(`no file at ${path}`);
      return bytes.subarray(at, at + length);
    },
  };
}
