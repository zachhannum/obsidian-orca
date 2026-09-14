import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import {
  familyNamed,
  fontIndex,
  scanFonts,
  VAULT_FONTS,
  type Face,
  type Family,
  type FontFiles,
} from "@/assets/fonts";
import {
  familyVariants,
  usedVariant,
  variantFamily,
  variantName,
  type Variant,
} from "@/assets/variants";

/** A face of the family Sablon with these classes. */
function face(style: string, weight = 400, width = 5, italic = false): Face {
  return {
    path: `fonts/Sablon-${style}.otf`,
    face: 0,
    family: "Sablon",
    style,
    variable: false,
    weight,
    width,
    italic,
    where: "vault",
  };
}

/** A family of these faces, with its variants worked out. */
function family(faces: readonly Face[]): Family {
  return { name: "Sablon", where: "vault", faces: [...faces], variants: familyVariants(faces) };
}

/** Each variant's name, whether it is the default, and its faces' styles. */
function shape(variants: readonly Variant[]): [string, boolean, string[]][] {
  return variants.map((variant) => [
    variant.name,
    variant.isDefault,
    variant.faces.map((one) => one.style),
  ]);
}

/** A seeded generator, so a failing case is the same case on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

test("a face's variant is its style name without its weight and slope words", () => {
  const cases: [string, string][] = [
    ["Cond Bold Italic", "Cond"],
    ["CondSemiBold", "Cond"],
    ["SemiBold", "Regular"],
    ["SmCond Light", "SmCond"],
    ["Extra Light Oblique", "Regular"],
    ["Exp Bold", "Exp"],
    ["Halbred", "Halbred"],
    ["Bold Italic", "Regular"],
    ["Regular", "Regular"],
    ["Display_Black-Italic", "Display"],
  ];
  for (const [style, variant] of cases) {
    assert.equal(variantName(style), variant, style);
  }

  const words = ["Thin", "Light", "Regular", "Book", "Medium", "SemiBold", "Demi", "Bold", "ExtraBold", "Black", "Italic", "Oblique", "Upright"];
  const names = ["Cond", "SmCond", "Exp", "Halbred", "Display Text", "Caption"];
  const gaps = [" ", "-", "_"];
  const random = seeded(113);
  const pick = <T>(from: readonly T[]): T => from[Math.floor(random() * from.length)] as T;
  for (let run = 0; run < 500; run += 1) {
    const name = pick(names);
    let style = name;
    const added = 1 + Math.floor(random() * 3);
    for (let word = 0; word < added; word += 1) {
      style = random() < 0.5 ? `${style}${pick(gaps)}${pick(words)}` : `${pick(words)}${pick(gaps)}${style}`;
    }
    assert.equal(variantName(style), name, `${style} is still ${name}`);
  }
});

test("a family's default variant is its normal-width faces whose style has only weight and slope words", () => {
  const variants = familyVariants([
    face("Bold", 700),
    face("Bold", 700, 3),
    face("Cond", 400, 3),
    face("Italic", 400, 5, true),
    face("Regular"),
    face("Display", 400),
  ]);

  assert.deepEqual(shape(variants), [
    ["Regular", true, ["Regular", "Bold", "Italic"]],
    ["Cond", false, ["Cond"]],
    ["Condensed", false, ["Bold"]],
    ["Display", false, ["Display"]],
  ]);
});

test("a family with no such faces defaults to the variant nearest a regular upright", () => {
  const lanze = familyVariants([
    face("Spear"),
    face("Scythe"),
    face("Pike"),
    face("Halbred"),
  ]);
  assert.deepEqual(
    lanze.map((variant) => [variant.name, variant.isDefault]),
    [
      ["Halbred", true],
      ["Pike", false],
      ["Scythe", false],
      ["Spear", false],
    ],
    "a tie goes to the name that sorts first",
  );

  const weighed = familyVariants([
    face("Alpha Black", 900),
    face("Beta Medium", 500),
    face("Beta Medium Italic", 400, 5, true),
    face("Gamma Light", 200),
  ]);
  assert.equal(
    weighed.find((variant) => variant.isDefault)?.name,
    "Beta",
    "an italic at 400 does not beat an upright at 500",
  );

  const tied = familyVariants([face("Zeta Medium", 500), face("Eta Light", 300)]);
  assert.equal(tied.at(0)?.name, "Eta", "equal distance from 400 goes to the first name");

  const sloped = familyVariants([
    face("Swash Bold Italic", 700, 5, true),
    face("Script Italic", 400, 5, true),
  ]);
  assert.equal(sloped.at(0)?.name, "Script", "with no upright face any face counts");
});

test("a name the family lacks falls back to its default, and a variant is declared under its own family name", () => {
  const sablon = family([face("Regular"), face("Cond Bold", 700, 3)]);

  const plain = usedVariant(sablon, undefined);
  assert.equal(plain.variant.name, "Regular");
  assert.equal(plain.fellBack, false);

  const cond = usedVariant(sablon, "cond");
  assert.equal(cond.variant.name, "Cond");
  assert.equal(cond.fellBack, false);

  const missing = usedVariant(sablon, "Wide");
  assert.equal(missing.variant.name, "Regular");
  assert.equal(missing.fellBack, true);

  assert.equal(variantFamily(sablon, plain.variant), "Sablon");
  assert.equal(variantFamily(sablon, cond.variant), "Sablon Cond");
});

test("the fixture vault's Junicode has three variants, and Alegreya has one", async () => {
  const fixture = directoryVault(
    path.join(process.env["ORCA_ROOT"] ?? process.cwd(), "fixture"),
  );
  const files: FontFiles = {
    list: (directory) => fixture.list(directory),
    read: async (at, from, length) =>
      new Uint8Array(await fixture.readBinary(at)).subarray(from, from + length),
  };
  const index = fontIndex(
    { faces: [], refused: [] },
    await scanFonts(files, [VAULT_FONTS], "vault"),
  );

  const junicode = familyNamed(index, " junicode ");
  assert.ok(junicode !== undefined);
  assert.deepEqual(
    junicode.variants.map((variant) => [
      variant.name,
      variant.isDefault,
      variant.faces.map((one) => one.style).sort(),
    ]),
    [
      ["Regular", true, ["Bold", "Italic", "Regular"]],
      ["Cond", false, ["Cond", "Cond SemiBold"]],
      ["Exp", false, ["Exp Bold"]],
    ],
  );
  assert.equal(variantFamily(junicode, junicode.variants[1] as Variant), "Junicode Cond");

  const alegreya = familyNamed(index, "Alegreya");
  assert.equal(alegreya?.variants.length, 1);
  assert.equal(alegreya?.variants[0]?.isDefault, true);
});

// What this tier does not cover: a family on the platform with many
// variants, which no runner is guaranteed to have, and style names in
// a language other than English, whose weight words are not in the
// list and so read as variants of their own.
