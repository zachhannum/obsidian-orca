import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { face, fontFiles } from "@/assets/fakes";
import { MANAGED_FONTS } from "@/assets/fonts";
import type { PhoneRoutes } from "@/assets/phone";
import { faceBytes } from "@/assets/sfnt";
import { fontPlaces, readFontIndex, resolveUse, vaultFonts } from "@/ui/fonts";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The face the fixture vault carries. */
const FACE = "fonts/Alegreya-VariableFont_wght.ttf";

test("a face still reads whole after an earlier read crossed to the worker", async () => {
  const fonts = vaultFonts(vault);
  const crossing = await fonts.whole(FACE);
  assert.ok(crossing.byteLength > 0);

  // The op that carries a face transfers its buffer, and the transfer
  // detaches it.
  structuredClone(crossing.buffer, { transfer: [crossing.buffer] });
  assert.equal(crossing.byteLength, 0);

  const again = await fonts.whole(FACE);
  assert.ok(again.byteLength > 0);
  // The index reads ranges out of the same held file.
  assert.deepEqual(await fonts.read(FACE, 0, 4), again.subarray(0, 4));
});

test("with no Node the index reads only the vault's faces, so the picker lists only those", async () => {
  const places = await fontPlaces(vault, undefined);
  assert.deepEqual(places.directories, []);

  const index = await readFontIndex(places);
  assert.ok(index.families.length > 0);
  assert.deepEqual(
    index.families.filter((family) => family.where !== "vault").map((family) => family.name),
    [],
  );
  assert.ok(index.families.some((family) => family.name === "Alegreya"));
});

/** The files a fake phone holds. The managed one has no suffix. */
const PHONE: Readonly<Record<string, Uint8Array>> = {
  "/System/Library/Fonts/Core/Sablon.ttf": face("Sablon", "Regular"),
  "/System/Library/Fonts/Core/Alegreya.ttf": face("Alegreya", "Regular"),
  [`${MANAGED_FONTS}/0A1B`]: face("Halyard", "Regular"),
};

/** Routes over the fake phone's files. */
function phone(): PhoneRoutes {
  const source = fontFiles(PHONE);
  return {
    list: async (url) => {
      if (!url.startsWith("file:///")) throw new Error(`${url} is not a file URL`);
      const directory = url.slice("file://".length);
      const listing = await source.list(directory);
      const entry = (folder: boolean) => (at: string) => ({
        name: at.slice(directory.length + 1),
        folder,
      });
      return [...listing.files.map(entry(false)), ...listing.folders.map(entry(true))];
    },
    fetch: async (at, range) => {
      const bytes = PHONE[at];
      if (bytes === undefined) return { status: 404, bytes: new Uint8Array(0) };
      if (range === undefined) return { status: 200, bytes };
      return { status: 206, bytes: bytes.subarray(range.at, range.at + range.length) };
    },
  };
}

const refused = (): Promise<never> => Promise.reject(new TypeError("Load failed"));

test("with a phone's routes the index holds its system and managed faces beside the vault's, and the vault wins a shared family", async () => {
  const index = await readFontIndex(await fontPlaces(vault, undefined, phone()));
  const found = (name: string) => index.families.find((family) => family.name === name);

  assert.equal(found("Sablon")?.where, "platform");
  assert.equal(found("Sablon")?.faces[0]?.path, "/System/Library/Fonts/Core/Sablon.ttf");
  assert.equal(found("Halyard")?.where, "platform");
  assert.equal(found("Halyard")?.faces[0]?.path, `${MANAGED_FONTS}/0A1B`);
  assert.equal(found("Alegreya")?.where, "vault");
  assert.equal(found("Alegreya")?.faces[0]?.path, FACE);
});

test("a system face picked on a phone reaches the session whole", async () => {
  const places = await fontPlaces(vault, undefined, phone());
  const index = await readFontIndex(places);

  for (const [font, at] of [
    ["Sablon", "/System/Library/Fonts/Core/Sablon.ttf"],
    ["Halyard", `${MANAGED_FONTS}/0A1B`],
  ] as const) {
    const resolved = await resolveUse(places, index, { font, variant: undefined });
    const file = PHONE[at];
    assert.ok(file !== undefined);
    assert.equal(resolved.unread, false);
    assert.ok(resolved.registered !== undefined);
    assert.deepEqual(
      resolved.faces.map((each) => each.bytes),
      [faceBytes(file, 0)],
    );
  }
});

test("routes that fail, and no routes, give the vault's index and no rejection", async () => {
  const alone = await readFontIndex(await fontPlaces(vault, undefined));
  const failing: PhoneRoutes = { list: refused, fetch: refused };

  assert.deepEqual(await readFontIndex(await fontPlaces(vault, undefined, failing)), alone);
  assert.deepEqual(
    await readFontIndex(await fontPlaces(vault, undefined, { ...phone(), fetch: refused })),
    alone,
  );
});

test("a platform face that stops reading leaves its use unread rather than rejecting", async () => {
  const index = await readFontIndex(await fontPlaces(vault, undefined, phone()));
  const places = await fontPlaces(vault, undefined, { ...phone(), fetch: refused });

  const errors = console.error;
  console.error = () => {};
  try {
    const resolved = await resolveUse(places, index, { font: "Sablon", variant: undefined });
    assert.equal(resolved.unread, true);
    assert.deepEqual(resolved.faces, []);
  } finally {
    console.error = errors;
  }
});

// What this tier does not cover: the platform's own font directories,
// which are the machine's rather than the fixture's, and the picker
// rows a face registers for, which need a document. A picker row for a
// phone's face is left to the web view, which is asked for the family
// by name, and no tier checks that it answers for a face a profile
// installed.
