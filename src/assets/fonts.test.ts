import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fontDirectories,
  fontIndex,
  has,
  matching,
  scanFonts,
  VAULT_FONTS,
  type FontFiles,
  type FontIndex,
  type Found,
} from "@/assets/fonts";
import type { Listing } from "@/assets/vault";

function utf16(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (const [at, letter] of [...text].entries()) {
    view.setUint16(at * 2, letter.charCodeAt(0));
  }
  return bytes;
}

/** A name table listing each name once, in Windows English. */
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

/** A file of one face, named this way and embedded on these terms. */
function face(family: string, style: string, fsType = 0): Uint8Array {
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

/** Files at fixed paths. A directory none of them is under is not there. */
function fontFiles(files: Readonly<Record<string, Uint8Array>>): FontFiles {
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

test("the platform's faces and the vault's are one index, and the vault wins the name", async () => {
  const files = fontFiles({
    "/System/Library/Fonts/Sablon.ttf": face("Sablon", "Regular"),
    "/System/Library/Fonts/Supplemental/Text.ttf": face("Text", "Regular"),
    "/System/Library/Fonts/read me.txt": new Uint8Array(64),
    [`${VAULT_FONTS}/Sablon.otf`]: face("Sablon", "Book"),
    [`${VAULT_FONTS}/Halyard.otf`]: face("Halyard", "Regular"),
    [`${VAULT_FONTS}/Locked.otf`]: face("Locked", "Regular", 0x0002),
  });

  const platform = await scanFonts(
    files,
    fontDirectories("darwin", "/Users/reader"),
    "platform",
  );
  const vault = await scanFonts(files, [VAULT_FONTS], "vault");
  const index = fontIndex(platform, vault);

  assert.deepEqual(
    index.families.map((family) => [family.name, family.where]),
    [
      ["Halyard", "vault"],
      ["Sablon", "vault"],
      ["Text", "platform"],
    ],
    "a folder the machine does not have contributes none, a subfolder does",
  );
  assert.deepEqual(
    index.families.find((family) => family.name === "Sablon")?.faces,
    [
      {
        path: `${VAULT_FONTS}/Sablon.otf`,
        face: 0,
        family: "Sablon",
        style: "Book",
        variable: false,
        where: "vault",
      },
    ],
    "the platform's face of that name is not offered beside the book's",
  );
  assert.deepEqual(index.refused, [
    { path: `${VAULT_FONTS}/Locked.otf`, face: 0, why: "restricted" },
  ]);
  assert.equal(has(index, "sablon"), true);
  assert.equal(has(index, "Sablon Text"), false);
});

test("a typed string filters the families, and one that matches none answers with none", () => {
  const index: FontIndex = {
    refused: [],
    families: ["EB Garamond", "Garamond Premier", "Halyard Text", "Sablon"].map(
      (name) => ({ name, where: "platform" as const, faces: [] }),
    ),
  };

  assert.deepEqual(
    matching(index, "gara").map((family) => family.name),
    ["Garamond Premier", "EB Garamond"],
    "the families a name starts come before the ones it is inside",
  );
  assert.deepEqual(
    matching(index, "").map((family) => family.name),
    ["EB Garamond", "Garamond Premier", "Halyard Text", "Sablon"],
  );
  assert.deepEqual(matching(index, "Minion"), []);
});

test("each platform's own font directories are named", () => {
  assert.deepEqual(fontDirectories("darwin", "/Users/reader"), [
    "/System/Library/Fonts",
    "/Library/Fonts",
    "/Users/reader/Library/Fonts",
  ]);
  assert.deepEqual(fontDirectories("win32", "C:/Users/reader"), [
    "C:/Windows/Fonts",
    "C:/Users/reader/AppData/Local/Microsoft/Windows/Fonts",
  ]);
  assert.deepEqual(fontDirectories("linux", "/home/reader"), [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "/home/reader/.local/share/fonts",
    "/home/reader/.fonts",
  ]);
});

test("the faces of a family are in style order, whatever order the files were listed in", async () => {
  const files = fontFiles({
    "/Library/Fonts/b.ttf": face("Sablon", "Italic"),
    "/Library/Fonts/a.ttf": face("Sablon", "Bold"),
  });
  const found: Found = await scanFonts(files, ["/Library/Fonts"], "platform");
  const index = fontIndex(found, { faces: [], refused: [] });

  assert.deepEqual(
    index.families.at(0)?.faces.map((one) => one.style),
    ["Bold", "Italic"],
  );
});

// This tier does not cover the platform's real font directories, which
// no runner is guaranteed to have, nor the walk stopping at four
// folders deep, which needs a linked loop a fake cannot make.
