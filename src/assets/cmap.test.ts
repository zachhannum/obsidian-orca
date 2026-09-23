import assert from "node:assert/strict";
import { test } from "node:test";
import { coverage, covered, coveredAt, type Cover } from "@/assets/cmap";
import { AssetError } from "@/assets/errors";

/** One table of a face, before it is placed in a file. */
interface Table {
  tag: string;
  bytes: Uint8Array;
}

/** One encoding record of a `cmap` table. */
interface Encoding {
  platform: number;
  encoding: number;
  subtable: Uint8Array;
}

/** One segment of a format 4 subtable. Named glyph ids go in its glyph id array. */
interface Segment {
  start: number;
  end: number;
  delta?: number;
  ids?: readonly number[];
}

/** One group of a format 12 subtable. */
interface Group {
  start: number;
  end: number;
  glyph: number;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (letter) => letter.charCodeAt(0));
}

/** The final segment of every format 4 subtable, which maps nothing. */
const SENTINEL: Segment = { start: 0xffff, end: 0xffff, delta: 1 };

function format0(glyphs: ReadonlyMap<number, number>): Uint8Array {
  const bytes = new Uint8Array(262);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, bytes.length);
  for (const [code, glyph] of glyphs) bytes[6 + code] = glyph;
  return bytes;
}

function format4(segments: readonly Segment[]): Uint8Array {
  const count = segments.length;
  const glyphs: number[] = [];
  const offsets = segments.map((segment, index) => {
    if (segment.ids === undefined) return 0;
    const offset = 2 * (count - index) + 2 * glyphs.length;
    glyphs.push(...segment.ids);
    return offset;
  });
  const length = 16 + count * 8 + glyphs.length * 2;
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 4);
  view.setUint16(2, length);
  view.setUint16(6, count * 2);
  for (const [index, segment] of segments.entries()) {
    view.setUint16(14 + index * 2, segment.end);
    view.setUint16(16 + count * 2 + index * 2, segment.start);
    view.setInt16(16 + count * 4 + index * 2, segment.delta ?? 0);
    view.setUint16(16 + count * 6 + index * 2, offsets[index] ?? 0);
  }
  for (const [index, glyph] of glyphs.entries()) {
    view.setUint16(16 + count * 8 + index * 2, glyph);
  }
  return bytes;
}

function format6(first: number, glyphs: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(10 + glyphs.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 6);
  view.setUint16(2, bytes.length);
  view.setUint16(6, first);
  view.setUint16(8, glyphs.length);
  for (const [index, glyph] of glyphs.entries()) {
    view.setUint16(10 + index * 2, glyph);
  }
  return bytes;
}

function format12(groups: readonly Group[]): Uint8Array {
  const bytes = new Uint8Array(16 + groups.length * 12);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 12);
  view.setUint32(4, bytes.length);
  view.setUint32(12, groups.length);
  for (const [index, group] of groups.entries()) {
    view.setUint32(16 + index * 12, group.start);
    view.setUint32(16 + index * 12 + 4, group.end);
    view.setUint32(16 + index * 12 + 8, group.glyph);
  }
  return bytes;
}

/** A subtable in a format the reader passes over. */
function format2(): Uint8Array {
  const bytes = new Uint8Array(518);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 2);
  view.setUint16(2, bytes.length);
  return bytes;
}

function cmap(records: readonly Encoding[]): Table {
  const head = 4 + records.length * 8;
  let at = head;
  const placed = records.map((record) => {
    const spot = at;
    at += record.subtable.length;
    return { ...record, at: spot };
  });
  const bytes = new Uint8Array(at);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, records.length);
  for (const [index, record] of placed.entries()) {
    view.setUint16(4 + index * 8, record.platform);
    view.setUint16(4 + index * 8 + 2, record.encoding);
    view.setUint32(4 + index * 8 + 4, record.at);
    bytes.set(record.subtable, record.at);
  }
  return { tag: "cmap", bytes };
}

/** Lays the tables of one face out as a file of one face. */
function file(tables: readonly Table[]): Uint8Array {
  let at = 12 + tables.length * 16;
  const placed = tables.map((table) => {
    const spot = at;
    at += table.bytes.length + ((4 - (table.bytes.length % 4)) % 4);
    return { ...table, at: spot };
  });
  const bytes = new Uint8Array(at);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  for (const [index, table] of placed.entries()) {
    const record = 12 + index * 16;
    bytes.set(ascii(table.tag), record);
    view.setUint32(record + 8, table.at);
    view.setUint32(record + 12, table.bytes.length);
    bytes.set(table.bytes, table.at);
  }
  return bytes;
}

/** A face whose one encoding record holds this subtable. */
function face(platform: number, encoding: number, subtable: Uint8Array): Uint8Array {
  return file([cmap([{ platform, encoding, subtable }])]);
}

const spans = (...covers: readonly Cover[]): Cover[] => [...covers];

test("a format 4 face lists the code points its segments map, and not the ones they send to .notdef", () => {
  const bytes = face(
    3,
    1,
    format4([
      { start: 0x41, end: 0x43, delta: 100 },
      { start: 0x44, end: 0x45, delta: 100 },
      { start: 0x50, end: 0x53, ids: [5, 0, 7, 0] },
      SENTINEL,
    ]),
  );

  assert.deepEqual(
    coverage(bytes),
    spans({ from: 0x41, to: 0x45 }, { from: 0x50, to: 0x50 }, { from: 0x52, to: 0x52 }),
    "touching segments merge, a zero in the glyph id array is not a glyph",
  );
});

test("a format 12 group that spans the surrogates comes back without them", () => {
  const bytes = face(
    3,
    10,
    format12([
      { start: 0x41, end: 0x5a, glyph: 1 },
      { start: 0x2000, end: 0x2002, glyph: 0 },
      { start: 0xd000, end: 0xe0ff, glyph: 100 },
      { start: 0x1f600, end: 0x1f600, glyph: 0 },
    ]),
  );

  assert.deepEqual(
    coverage(bytes),
    spans(
      { from: 0x41, to: 0x5a },
      { from: 0x2001, to: 0x2002 },
      { from: 0xd000, to: 0xd7ff },
      { from: 0xe000, to: 0xe0ff },
    ),
    "a group that starts on .notdef loses its first code point, and a group of one loses all of it",
  );
});

test("a Mac Roman face lists its ornaments where they sit, up to 0x7F", () => {
  const glyphs = new Map<number, number>();
  for (let code = 0x41; code <= 0x5a; code += 1) glyphs.set(code, code - 0x40);
  glyphs.set(0xa1, 90);

  assert.deepEqual(
    coverage(face(1, 0, format0(glyphs))),
    spans({ from: 0x41, to: 0x5a }),
    "a format 0 subtable is read for the letters the ornaments sit on",
  );

  assert.deepEqual(
    coverage(face(1, 0, format6(0x21, [1, 2, 0, 3]))),
    spans({ from: 0x21, to: 0x22 }, { from: 0x24, to: 0x24 }),
    "a format 6 subtable is read over the run it holds",
  );

  assert.deepEqual(
    coverage(face(1, 0, format6(0x7e, [1, 1, 1]))),
    spans({ from: 0x7e, to: 0x7f }),
    "and stops where Mac Roman stops agreeing with ASCII",
  );
});

test("a symbol face's ornaments come back at U+F020 and up", () => {
  const bytes = face(
    3,
    0,
    format4([{ start: 0xf020, end: 0xf0ff, delta: 1 }, SENTINEL]),
  );

  assert.deepEqual(coverage(bytes), spans({ from: 0xf020, to: 0xf0ff }));
});

test("the best record the reader handles is the one it reads", () => {
  const both = file([
    cmap([
      { platform: 3, encoding: 1, subtable: format4([{ start: 0x41, end: 0x42, delta: 1 }, SENTINEL]) },
      { platform: 3, encoding: 10, subtable: format12([{ start: 0x1f600, end: 0x1f601, glyph: 7 }]) },
    ]),
  ]);
  assert.deepEqual(
    coverage(both),
    spans({ from: 0x1f600, to: 0x1f601 }),
    "Windows UCS-4 is read over Windows BMP",
  );

  const symbol = file([
    cmap([
      { platform: 3, encoding: 0, subtable: format4([{ start: 0xf020, end: 0xf021, delta: 1 }, SENTINEL]) },
      { platform: 0, encoding: 3, subtable: format4([{ start: 0x41, end: 0x42, delta: 1 }, SENTINEL]) },
    ]),
  ]);
  assert.deepEqual(
    coverage(symbol),
    spans({ from: 0x41, to: 0x42 }),
    "Unicode is read over Windows Symbol, whatever order the records are in",
  );

  assert.deepEqual(
    coverage(face(3, 1, format2())),
    [],
    "a record in a format the reader passes over leaves the face with none",
  );
});

test("a face with no cmap table covers nothing", () => {
  assert.deepEqual(coverage(file([{ tag: "head", bytes: new Uint8Array(54) }])), []);
});

test("a cmap that reads outside itself is refused", () => {
  const bytes = face(3, 10, format12([{ start: 0x41, end: 0x5a, glyph: 1 }]));
  assert.throws(() => coverage(bytes.subarray(0, bytes.length - 4)), AssetError);

  const counted = format6(0x21, [1, 2, 3]);
  new DataView(counted.buffer).setUint16(8, 1000);
  assert.throws(
    () => coverage(face(1, 0, counted)),
    AssetError,
    "a subtable that names more entries than it holds is refused too",
  );
});

test("a set of spans is counted and indexed without a list of its code points", () => {
  const held = spans({ from: 0x41, to: 0x43 }, { from: 0x50, to: 0x50 });

  assert.equal(covered(held), 4);
  assert.equal(covered([]), 0);
  assert.equal(coveredAt(held, 0), 0x41);
  assert.equal(coveredAt(held, 2), 0x43);
  assert.equal(coveredAt(held, 3), 0x50);
  assert.equal(coveredAt(held, 4), undefined, "past the end there is nothing");
  assert.equal(coveredAt(held, -1), undefined);
  assert.equal(coveredAt([], 0), undefined);
});

// What this tier does not cover: format 2 and format 13, which no face
// the index accepts uses on its own; format 14, so a face's variation
// sequences are not listed; a Mac Roman subtable past 0x7F, which reads
// as nothing; and whether a code point the table maps draws ink rather
// than a blank glyph.
