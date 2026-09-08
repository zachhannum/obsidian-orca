import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { faceBytes, faceOffsets, readFace, type Ranges } from "@/assets/sfnt";

/** One table of a face, before it is placed in a file. */
interface Table {
  tag: string;
  bytes: Uint8Array;
}

/** One record of a name table. */
interface Named {
  platform: number;
  language: number;
  id: number;
  text: string;
}

/** Windows' English and Windows' Spanish, the two a face is listed in here. */
const ENGLISH = 0x0409;
const SPANISH = 0x0c0a;

const ranges =
  (file: Uint8Array): Ranges =>
  async (at, length) =>
    file.subarray(at, at + length);

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (letter) => letter.charCodeAt(0));
}

function utf16(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (const [at, letter] of [...text].entries()) {
    view.setUint16(at * 2, letter.charCodeAt(0));
  }
  return bytes;
}

function nameTable(names: readonly Named[]): Uint8Array {
  const records = names.map((name) => ({
    name,
    bytes: name.platform === 1 ? ascii(name.text) : utf16(name.text),
  }));
  const strings = 6 + records.length * 12;
  const total = records.reduce((sum, { bytes }) => sum + bytes.length, 0);
  const out = new Uint8Array(strings + total);
  const view = new DataView(out.buffer);
  view.setUint16(2, records.length);
  view.setUint16(4, strings);
  let at = 6;
  let held = 0;
  for (const { name, bytes } of records) {
    view.setUint16(at, name.platform);
    view.setUint16(at + 2, name.platform === 1 ? 0 : 1);
    view.setUint16(at + 4, name.language);
    view.setUint16(at + 6, name.id);
    view.setUint16(at + 8, bytes.length);
    view.setUint16(at + 10, held);
    out.set(bytes, strings + held);
    held += bytes.length;
    at += 12;
  }
  return out;
}

/** An `OS/2` table, empty but for the embedding bits. */
function os2(fsType: number): Table {
  const bytes = new Uint8Array(96);
  new DataView(bytes.buffer).setUint16(8, fsType);
  return { tag: "OS/2", bytes };
}

/** The name table a plain face carries, listed in English alone. */
function english(family: string, style: string, postscript = family): Table {
  return {
    tag: "name",
    bytes: nameTable([
      { platform: 3, language: ENGLISH, id: 1, text: family },
      { platform: 3, language: ENGLISH, id: 2, text: style },
      { platform: 3, language: ENGLISH, id: 6, text: postscript },
    ]),
  };
}

/** The tables of one or more faces, laid out as one file. */
function assemble(faces: readonly (readonly Table[])[], collect: boolean): Uint8Array {
  const head = collect ? 12 + faces.length * 4 : 0;
  let at = head;
  const laid = faces.map((tables) => {
    const directory = at;
    at += 12 + tables.length * 16;
    return { directory, tables };
  });
  const placed = laid.map(({ directory, tables }) => ({
    directory,
    tables: tables.map((table) => {
      const spot = at;
      at += table.bytes.length + ((4 - (table.bytes.length % 4)) % 4);
      return { ...table, at: spot };
    }),
  }));

  const out = new Uint8Array(at);
  const view = new DataView(out.buffer);
  if (collect) {
    out.set(ascii("ttcf"), 0);
    view.setUint32(4, 0x00020000);
    view.setUint32(8, faces.length);
    for (const [face, { directory }] of placed.entries()) {
      view.setUint32(12 + face * 4, directory);
    }
  }
  for (const { directory, tables } of placed) {
    view.setUint32(directory, 0x00010000);
    view.setUint16(directory + 4, tables.length);
    let record = directory + 12;
    for (const table of tables) {
      out.set(ascii(table.tag), record);
      view.setUint32(record + 8, table.at);
      view.setUint32(record + 12, table.bytes.length);
      out.set(table.bytes, table.at);
      record += 16;
    }
  }
  return out;
}

const file = (tables: readonly Table[]): Uint8Array => assemble([tables], false);
const collection = (faces: readonly (readonly Table[])[]): Uint8Array =>
  assemble(faces, true);

test("a collection holds one face per entry, and a face crosses as an sfnt of its own", async () => {
  const bytes = collection([
    [english("Sablon", "Regular"), os2(0)],
    [english("Sablon", "Italic"), os2(0), { tag: "fvar", bytes: new Uint8Array(16) }],
  ]);

  const offsets = await faceOffsets(ranges(bytes));
  assert.equal(offsets.length, 2);

  const names = [];
  for (const offset of offsets) names.push(await readFace(ranges(bytes), offset));
  assert.deepEqual(names, [
    { family: "Sablon", style: "Regular", variable: false },
    { family: "Sablon", style: "Italic", variable: true },
  ]);

  const one = faceBytes(bytes, 1);
  assert.notEqual(one.length, bytes.length, "a face is not the collection");
  assert.deepEqual(await faceOffsets(ranges(one)), [0], "and is a file of one face");
  assert.deepEqual(await readFace(ranges(one), 0), {
    family: "Sablon",
    style: "Italic",
    variable: true,
  });

  const alone = file([english("Sablon", "Regular")]);
  assert.equal(faceBytes(alone, 0), alone, "a file of one face is already one");
});

test("a face with no family, restricted embedding or a hidden name is turned down", async () => {
  const unnamed = file([{ tag: "OS/2", bytes: new Uint8Array(96) }]);
  assert.equal(await readFace(ranges(unnamed), 0), "unnamed");

  const restricted = file([english("Sablon", "Regular"), os2(0x0002)]);
  assert.equal(await readFace(ranges(restricted), 0), "restricted");

  const printable = file([english("Sablon", "Regular"), os2(0x0004)]);
  assert.deepEqual(
    await readFace(ranges(printable), 0),
    { family: "Sablon", style: "Regular", variable: false },
    "preview and print is not a refusal",
  );

  const hiddenFamily = file([english(".LastResort", "Regular")]);
  assert.equal(await readFace(ranges(hiddenFamily), 0), "hidden");

  const hiddenPostScript = file([
    english("System Font", "Regular", ".SFNS-Regular"),
  ]);
  assert.equal(await readFace(ranges(hiddenPostScript), 0), "hidden");
});

test("a face is named in English, whatever order its name table lists languages in", async () => {
  const bytes = file([
    {
      tag: "name",
      bytes: nameTable([
        { platform: 3, language: SPANISH, id: 1, text: "Helvética" },
        { platform: 3, language: SPANISH, id: 2, text: "Negrita" },
        { platform: 1, language: 0, id: 1, text: "Helvetica Mac" },
        { platform: 3, language: ENGLISH, id: 1, text: "Helvetica" },
        { platform: 3, language: ENGLISH, id: 2, text: "Bold" },
        { platform: 3, language: SPANISH, id: 16, text: "Helvética" },
        { platform: 3, language: ENGLISH, id: 16, text: "Helvetica" },
        { platform: 3, language: ENGLISH, id: 17, text: "Bold" },
      ]),
    },
  ]);

  assert.deepEqual(await readFace(ranges(bytes), 0), {
    family: "Helvetica",
    style: "Bold",
    variable: false,
  });
});

/** The one face this tier reads from the machine, where the machine has it. */
const HELVETICA = "/System/Library/Fonts/Helvetica.ttc";

test(
  "the platform's own Helvetica reads as six English faces",
  { skip: !existsSync(HELVETICA) },
  async () => {
    const bytes = new Uint8Array(readFileSync(HELVETICA));
    const offsets = await faceOffsets(ranges(bytes));
    assert.equal(offsets.length, 6);

    const styles = [];
    for (const offset of offsets) {
      const named = await readFace(ranges(bytes), offset);
      assert.notEqual(typeof named, "string", "no face of it is turned down");
      if (typeof named === "string") continue;
      assert.equal(named.family, "Helvetica");
      styles.push(named.style);
    }
    assert.deepEqual([...styles].sort(), [
      "Bold",
      "Bold Oblique",
      "Light",
      "Light Oblique",
      "Oblique",
      "Regular",
    ]);

    const one = faceBytes(bytes, 0);
    const tag = new DataView(one.buffer, one.byteOffset).getUint32(0);
    assert.ok(
      tag === 0x00010000 || tag === 0x4f54544f || tag === 0x74727565,
      "a face split out of the collection opens with an sfnt tag",
    );
  },
);

// This tier does not cover the faces a machine other than macOS keeps,
// which are read through the same two functions but named by files no
// runner is guaranteed; nor a name table written in a language a
// platform 2 record encodes, which no shipping face uses.
