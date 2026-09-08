import assert from "node:assert/strict";
import { test } from "node:test";
import type { FontRefEntry } from "fleuron";
import type { Face, Family, FontIndex } from "@/assets/fonts";
import { cuts, missingFace, picking } from "@/ui/face";

/** One face of a family, as the index found it. */
function face(family: string, style: string): Face {
  return {
    path: `/Library/Fonts/${family}-${style}.ttf`,
    face: 0,
    family,
    style,
    variable: false,
    where: "platform",
  };
}

function family(name: string, ...styles: string[]): Family {
  return {
    name,
    where: "platform",
    faces: styles.map((style) => face(name, style)),
  };
}

const INDEX: FontIndex = {
  families: [
    family("Alegreya", "Regular", "Italic"),
    family("Charter", "Regular"),
    family("Spectral", "Regular"),
  ],
  refused: [],
};

/** One cut, as the engine returns it. */
function cut(
  family: string,
  style: string,
  weight: number,
  variations: FontRefEntry["variations"] = [],
): FontRefEntry {
  return {
    family,
    name: `${family} ${style}`,
    style,
    attributes: { italic: style.includes("Italic"), weight },
    variations,
  };
}

test("the picker offers the index, and typing narrows it to what matches", () => {
  assert.deepEqual(
    picking(INDEX, "", 0).offered.map((one) => one.name),
    ["Alegreya", "Charter", "Spectral"],
  );
  // Charter is offered first because its name starts with the string;
  // the rest match on a substring.
  assert.deepEqual(
    picking(INDEX, "c", 0).offered.map((one) => one.name),
    ["Charter", "Spectral"],
  );
  assert.equal(picking(INDEX, "alegre", 0).commits?.name, "Alegreya");
});

test("text matching nothing commits nothing, so a family cannot be typed into a book", () => {
  const picked = picking(INDEX, "Helvetica Neue", 0);
  assert.deepEqual(picked.offered, []);
  assert.equal(picked.commits, undefined);
  assert.equal(picked.at, -1);
});

test("a row the keys ran past lands on the last row of a narrowed list", () => {
  const picked = picking(INDEX, "c", 9);
  assert.equal(picked.at, 1);
  assert.equal(picked.commits?.name, "Spectral");
});

test("the styles a family offers are the cuts the engine registered, by the ids it gave", () => {
  const registered = [
    cut("eb garamond", "Regular", 400),
    cut("alegreya", "Regular", 400),
    cut("alegreya", "Medium", 500, [{ tag: "wght", value: 500 }]),
  ];

  assert.deepEqual(cuts(registered, "Alegreya"), [
    { id: 1, entry: registered[1] },
    { id: 2, entry: registered[2] },
  ]);
  assert.deepEqual(cuts(registered, "Charter"), []);
});

test("a book naming a family the machine does not have is warned about by name", () => {
  assert.equal(missingFace(INDEX, "Alegreya"), undefined);
  assert.equal(missingFace(INDEX, undefined), undefined);
  assert.match(missingFace(INDEX, "Charter Italic") ?? "", /Charter Italic/);
});

// What this tier does not cover: the panel's drawing, which is React
// over these functions; the keys that move between rows, which the e2e
// suite drives in the application the picker is mounted in; and a
// family whose files have gone since the scan, which no fake here can
// take off a disk.
