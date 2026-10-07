import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/testUtils/directory";
import {
  fontDirectories,
  fontIndex,
  has,
  matching,
  scanFonts,
  VAULT_FONTS,
  MANAGED_FONTS,
  type FontFiles,
  type FontIndex,
  type Found,
} from "@/assets/fonts";
import { face, fontFiles } from "@/assets/fakes";
import { readText } from "@/assets/vault";
import { readModel } from "@/book/model";

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
        weight: 400,
        width: 5,
        italic: false,
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
      (name) => ({ name, where: "platform" as const, faces: [], variants: [] }),
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
  assert.deepEqual(fontDirectories("ios", ""), ["/System/Library/Fonts"]);
});

test("a file with no font suffix is opened by its bytes only when the scan asks", async () => {
  const woff = face("Webbed", "Regular");
  woff.set([0x77, 0x4f, 0x46, 0x46]);
  const files = fontFiles({
    [`${MANAGED_FONTS}/0A1B`]: face("Halyard", "Regular"),
    [`${MANAGED_FONTS}/2C3D`]: woff,
    [`${MANAGED_FONTS}/4E5F`]: new Uint8Array(64),
    [`${MANAGED_FONTS}/6A`]: new Uint8Array(2),
    [`${MANAGED_FONTS}/Sablon.ttf`]: face("Sablon", "Regular"),
  });

  const sniffed = await scanFonts(files, [MANAGED_FONTS], "platform", { byBytes: true });
  assert.deepEqual(
    sniffed.faces.map((one) => [one.family, one.path]),
    [
      ["Halyard", `${MANAGED_FONTS}/0A1B`],
      ["Sablon", `${MANAGED_FONTS}/Sablon.ttf`],
    ],
    "a WOFF file and a file that is not a font are left closed",
  );
  assert.deepEqual(sniffed.refused, []);

  const named = await scanFonts(files, [MANAGED_FONTS], "platform");
  assert.deepEqual(
    named.faces.map((one) => one.family),
    ["Sablon"],
  );
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

test("the sample book's own faces are in its vault, under the family its note names", async () => {
  const sample = directoryVault(
    path.join(process.env["ORCA_ROOT"] ?? process.cwd(), "docs/sample"),
  );
  const files: FontFiles = {
    list: (directory) => sample.list(directory),
    read: async (at, from, length) =>
      new Uint8Array(await sample.readBinary(at)).subarray(from, from + length),
  };
  const { book } = readModel(
    await readText(
      sample,
      "Twenty Thousand Leagues/Twenty Thousand Leagues Under the Sea.md",
    ),
  );

  const found = await scanFonts(files, [VAULT_FONTS], "vault");
  const index = fontIndex({ faces: [], refused: [] }, found);

  assert.deepEqual(index.refused, []);
  assert.equal(book.design.body.font, "EB Garamond");
  assert.ok(has(index, "EB Garamond"));
  const family = index.families.find((known) => known.name === "EB Garamond");
  assert.equal(family?.where, "vault");
  // The text is set in the upright, and the note italicises a word here
  // and there, so the book uses both cuts and the vault holds both.
  assert.deepEqual(
    family?.faces.map((face) => face.style),
    ["Italic", "Regular"],
  );
});

// What this tier does not cover: the platform's real font
// directories, which no runner is guaranteed to have, and the walk
// stopping at four folders deep, which needs a loop of linked folders
// a fake cannot build. It does not cover the files iOS keeps in its
// managed directory, which only a device with a profile has.
