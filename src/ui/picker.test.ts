import assert from "node:assert/strict";
import { test } from "node:test";
import type { Face, Family, FontIndex } from "@/assets/fonts";
import { emptyDesign } from "@/style/design";
import { missingFont, missingFonts, picking } from "@/ui/picker";

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

test("a book naming a font the machine does not have is warned about by name", () => {
  assert.equal(missingFont(INDEX, "Alegreya"), undefined);
  assert.equal(missingFont(INDEX, undefined), undefined);
  assert.match(missingFont(INDEX, "Charter Italic") ?? "", /Charter Italic/);
});

test("a heading font the machine does not have is warned about as a missing body font is", () => {
  const design = emptyDesign();
  design.body.font = "Alegreya";
  design.headings[1].font = "Zzyzx Grotesque";
  design.headings[3].font = "zzyzx grotesque";
  assert.deepEqual(missingFonts(INDEX, design), [
    missingFont(INDEX, "Zzyzx Grotesque"),
  ]);
  design.body.font = "Helvetica Neue";
  assert.equal(missingFonts(INDEX, design).length, 2);
});

// What this tier does not cover: the panel's drawing, which is React
// over these functions; the keys that move between rows, which the e2e
// suite drives in the application the picker is mounted in; and a
// font whose files have gone since the scan, which no fake here can
// take off a disk.
