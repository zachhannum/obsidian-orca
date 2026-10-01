import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEVICES,
  READER_ALIGNMENTS,
  READER_DEFAULTS,
  READER_FONTS,
  READER_MARGINS,
  READER_SIZE_MAX,
  READER_SIZE_MIN,
  READER_SIZE_STEP,
  READER_SPACINGS,
  READER_THEMES,
  READER_VARIABLES,
  readerVariables,
  type ReaderSettings,
} from "@/style/reader";
import { READIUM } from "@/style/readium";

/** The names one change to the defaults moves, with their new values. */
function changed(change: Partial<ReaderSettings>): Record<string, string | undefined> {
  const before = readerVariables(READER_DEFAULTS);
  const after = readerVariables({ ...READER_DEFAULTS, ...change });
  const moved: Record<string, string | undefined> = {};
  for (const [name, value] of after) {
    if (before.get(name) !== value) moved[name] = value;
  }
  return moved;
}

test("the defaults set the margin and leave everything else to the author's CSS", () => {
  const set = [...readerVariables(READER_DEFAULTS)].filter(([, value]) => value !== undefined);
  assert.deepEqual(set, [["--RS__pageGutter", "32px"]]);
});

test("each setting changes the variable it maps to and no other", () => {
  assert.deepEqual(changed({ font: "oldStyle" }), { "--USER__fontFamily": "var(--RS__oldStyleTf)" });
  assert.deepEqual(changed({ font: "modern" }), { "--USER__fontFamily": "var(--RS__modernTf)" });
  assert.deepEqual(changed({ font: "sans" }), { "--USER__fontFamily": "var(--RS__sansTf)" });
  assert.deepEqual(changed({ font: "humanist" }), { "--USER__fontFamily": "var(--RS__humanistTf)" });

  assert.deepEqual(changed({ size: 75 }), { "--USER__fontSize": "75%" });
  assert.deepEqual(changed({ size: 250 }), { "--USER__fontSize": "250%" });

  assert.deepEqual(changed({ spacing: 1.2 }), { "--USER__lineHeight": "1.2" });
  assert.deepEqual(changed({ spacing: 1.75 }), { "--USER__lineHeight": "1.75" });
  assert.deepEqual(changed({ spacing: 2 }), { "--USER__lineHeight": "2" });

  assert.deepEqual(changed({ margins: "narrow" }), { "--RS__pageGutter": "16px" });
  assert.deepEqual(changed({ margins: "wide" }), { "--RS__pageGutter": "56px" });

  assert.deepEqual(changed({ align: "start" }), { "--USER__textAlign": "start" });
  assert.deepEqual(changed({ align: "justify" }), { "--USER__textAlign": "justify" });

  assert.deepEqual(changed({ theme: "sepia" }), {
    "--USER__backgroundColor": "#faf4e8",
    "--USER__textColor": "#121212",
    "--USER__linkColor": "#305282",
    "--USER__visitedColor": "#7b5281",
  });
  assert.deepEqual(changed({ theme: "dark" }), {
    "--USER__backgroundColor": "#000000",
    "--USER__textColor": "#FEFEFE",
    "--USER__linkColor": "#63caff",
    "--USER__visitedColor": "#0099E5",
  });
});

/** The defaults with each option of each list in turn. */
function everyOption(): ReaderSettings[] {
  const all: ReaderSettings[] = [];
  for (const { value } of READER_FONTS) all.push({ ...READER_DEFAULTS, font: value });
  for (let size = READER_SIZE_MIN; size <= READER_SIZE_MAX; size += READER_SIZE_STEP) {
    all.push({ ...READER_DEFAULTS, size });
  }
  for (const { value } of READER_SPACINGS) all.push({ ...READER_DEFAULTS, spacing: value });
  for (const { value } of READER_MARGINS) all.push({ ...READER_DEFAULTS, margins: value });
  for (const { value } of READER_ALIGNMENTS) all.push({ ...READER_DEFAULTS, align: value });
  for (const { value } of READER_THEMES) all.push({ ...READER_DEFAULTS, theme: value });
  return all;
}

test("the bundled ReadiumCSS reads every variable the mapping sets", () => {
  const sheets = READIUM.before + READIUM.after;
  for (const name of READER_VARIABLES) {
    // A user variable works through a rule that looks for its name in
    // the root's style attribute. Any other is declared on the root.
    const used = name.startsWith("--USER__") ? `[style*="${name}"]` : `${name}:`;
    assert.ok(sheets.includes(used), `${name} is not in ReadiumCSS`);
  }

  const referenced = new Set<string>();
  for (const settings of everyOption()) {
    const variables = readerVariables(settings);
    assert.deepEqual([...variables.keys()], [...READER_VARIABLES]);
    for (const value of variables.values()) {
      for (const match of value?.matchAll(/var\((--[\w-]+)\)/g) ?? []) {
        if (match[1] !== undefined) referenced.add(match[1]);
      }
    }
  }
  assert.equal(referenced.size, 4);
  for (const name of referenced) {
    assert.ok(sheets.includes(`${name}:`), `${name} is not defined in ReadiumCSS`);
  }
});

test("the size steps land on the author's size", () => {
  assert.equal((100 - READER_SIZE_MIN) % READER_SIZE_STEP, 0);
  assert.equal((READER_SIZE_MAX - READER_SIZE_MIN) % READER_SIZE_STEP, 0);
});

test("the devices are a phone, an e-reader and a tablet", () => {
  assert.deepEqual(
    DEVICES.map((device) => [device.label, device.width, device.height]),
    [
      ["Phone", 390, 844],
      ["E-reader", 600, 800],
      ["Tablet", 820, 1180],
    ],
  );
});

test("each ReadiumCSS sheet is in the bundle with its licence banner", () => {
  for (const [name, sheet] of Object.entries(READIUM)) {
    assert.ok(sheet.startsWith("/*!\n * Readium CSS v."), `${name} has no banner`);
    const banner = sheet.slice(0, sheet.indexOf("*/"));
    assert.match(banner, /Copyright \(c\) .*Readium Foundation/, name);
    assert.match(banner, /BSD-style license/, name);
    assert.ok(sheet.length > banner.length + 1000, `${name} is only a banner`);
  }
  assert.match(READIUM.before, /--RS__oldStyleTf:/);
  assert.match(READIUM.after, /column-width:var\(--RS__colWidth\)/);
});

// What this tier does not cover: a browser applying the sheets, so
// whether a variable moves the text on a screen is for the e2e suite.
// The sepia and dark colours are not checked against ReadiumCSS, which
// ships none.
