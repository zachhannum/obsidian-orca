import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { faceCss, familyFor, type Registered } from "@/style/faces";

const root = process.env["ORCA_ROOT"] ?? process.cwd();

/** The snapshot beside this spec, which is reviewed like code. */
const SNAPSHOT = "src/style/faces.snapshot.css";

/** Two variants of one font, each under a family of its own, and a variable face. */
const REGISTERED: Registered[] = [
  {
    font: "Junicode",
    variant: "Regular",
    family: "Junicode",
    faces: [
      { url: "orca-font:junicode-regular", weight: 400, italic: false },
      { url: "orca-font:junicode-bold", weight: 700, italic: false },
      { url: "orca-font:junicode-italic", weight: 400, italic: true },
    ],
  },
  {
    font: "Junicode",
    variant: "Cond",
    family: "Junicode Cond",
    faces: [
      { url: "orca-font:junicode-cond", weight: 400, italic: false },
      { url: "orca-font:junicode-cond-semibold", weight: 600, italic: false },
    ],
  },
  {
    font: "Recursive",
    variant: undefined,
    family: "Recursive",
    faces: [{ url: "orca-font:recursive-vf" }],
  },
];

test("each registered face is one @font-face rule under its variant's family, as checked in beside this spec", async () => {
  const css = faceCss(REGISTERED);

  assert.equal(css, await snapshot(css));
  assert.equal(faceCss([]), "");
});

test("a family registered twice is written once, and a quote in a name or url is escaped", () => {
  const twice = faceCss([...REGISTERED, ...REGISTERED]);
  assert.equal(twice, faceCss(REGISTERED));

  const odd = faceCss([
    { font: 'A "B"', variant: undefined, family: 'A "B"', faces: [{ url: 'orca-font:a"b' }] },
  ]);
  assert.equal(odd, '@font-face {\n  font-family: "A \\"B\\"";\n  src: url("orca-font:a\\"b");\n}\n');
});

test("a font and variant find their family without case, and a variant nothing registers finds none", () => {
  assert.equal(familyFor(REGISTERED, { font: "junicode", variant: "COND" }), "Junicode Cond");
  assert.equal(familyFor(REGISTERED, { font: "Junicode", variant: "Regular" }), "Junicode");
  assert.equal(familyFor(REGISTERED, { font: "Recursive", variant: undefined }), "Recursive");
  assert.equal(familyFor(REGISTERED, { font: "Junicode", variant: "SmCond" }), undefined);
  assert.equal(familyFor(REGISTERED, { font: "Junicode", variant: undefined }), undefined);
  assert.equal(familyFor([], { font: "Junicode", variant: undefined }), undefined);
});

async function snapshot(css: string): Promise<string> {
  const file = path.join(root, SNAPSHOT);
  if (process.env["ORCA_SNAPSHOTS"] !== undefined) await writeFile(file, css);
  return readFile(file, "utf8");
}

// What this tier does not cover: the engine loading a rule's url, which
// waits on the face bytes crossing first, and the variable face's named
// instances, which the file itself lists. Which faces a variant groups
// is the font index's to decide.
