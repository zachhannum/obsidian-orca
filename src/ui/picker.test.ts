import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { VAULT_FONTS, familyNamed, type Face, type Family, type FontIndex } from "@/assets/fonts";
import { familyVariants } from "@/assets/variants";
import { emptyDesign } from "@/style/design";
import { readFontIndex, resolveUse, vaultFonts } from "@/ui/fonts";
import {
  missingAdded,
  missingFont,
  missingFonts,
  missingVariant,
  missingVariants,
  picking,
} from "@/ui/picker";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** One face of a family, as the index found it. */
function face(family: string, style: string): Face {
  return {
    path: `/Library/Fonts/${family}-${style}.ttf`,
    face: 0,
    family,
    style,
    variable: false,
    weight: 400,
    width: 5,
    italic: false,
    where: "platform",
  };
}

function family(name: string, ...styles: string[]): Family {
  return {
    name,
    where: "platform",
    faces: styles.map((style) => face(name, style)),
    variants: [],
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

test("a stored variant the machine does not have warns and sets in the family's default variant", async () => {
  const faces = [face("Junicode", "Regular"), face("Junicode", "Cond")];
  const junicode: Family = {
    name: "Junicode",
    where: "platform",
    faces,
    variants: familyVariants(faces),
  };
  const index: FontIndex = { families: [junicode, ...INDEX.families], refused: [] };
  assert.equal(missingVariant(index, { font: "Junicode", variant: "cond" }), undefined);
  assert.equal(missingVariant(index, { font: "Junicode", variant: undefined }), undefined);
  assert.equal(
    missingVariant(index, { font: "Junicode", variant: "SmExp" }),
    "Missing variant: Junicode SmExp",
  );
  // A font the machine lacks is warned about as a missing font, not a missing variant.
  assert.equal(missingVariant(index, { font: "Zzyzx Grotesque", variant: "Cond" }), undefined);
  const design = emptyDesign();
  design.body.font = "Junicode";
  design.body.fontVariant = "SmExp";
  assert.equal(missingVariants(index, design).length, 1);

  // The book sets in the default variant: its faces cross and its family is registered.
  const places = {
    platform: vaultFonts(vault),
    vault: vaultFonts(vault),
    directories: [],
    folder: VAULT_FONTS,
  };
  const fixture = await readFontIndex(places);
  const resolved = await resolveUse(places, fixture, { font: "Junicode", variant: "SmExp" });
  assert.equal(resolved.fellBack, true);
  assert.equal(resolved.registered?.family, "Junicode");
  const regular = familyNamed(fixture, "Junicode")?.variants.find((each) => each.isDefault);
  assert.equal(regular?.name, "Regular");
  assert.equal(resolved.faces.length, regular.faces.length);
});

test("a font the book adds that the machine no longer has warns the way a design font warns", () => {
  const design = emptyDesign();
  design.body.font = "Charter";

  // The warning is the one a design font gets, word for word.
  assert.deepEqual(missingAdded(INDEX, design, ["Junicode"]), [
    missingFont(INDEX, "Junicode"),
  ]);
  assert.deepEqual(missingAdded(INDEX, design, ["Alegreya"]), []);
  // A font a design key also names warns under the design, so it warns
  // once however it is capitalized.
  assert.deepEqual(missingAdded(INDEX, emptyDesign(), ["Junicode"]), [
    missingFont(INDEX, "Junicode"),
  ]);
  design.headings[2].font = "junicode";
  assert.deepEqual(missingAdded(INDEX, design, ["Junicode"]), []);
});

// What this tier does not cover: the panel's drawing, which is React
// over these functions; the keys that move between rows, which the e2e
// suite drives in the application the picker is mounted in; and a
// font whose files have gone since the scan, which no fake here can
// take off a disk.
