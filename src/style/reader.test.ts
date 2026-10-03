import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import {
  DEVICES,
  DEVICE_DEFAULT,
  DEVICE_GROUPS,
  READER_ALIGNMENTS,
  READER_DEFAULTS,
  READER_FONTS,
  READER_LABELS,
  READER_MARGINS,
  READER_SIZE_MAX,
  READER_SIZE_MIN,
  READER_SIZE_STEP,
  READER_SPACINGS,
  READER_STORED,
  READER_THEMES,
  READER_VARIABLES,
  READER_VERTICALS,
  deviceBox,
  readerInset,
  readerPage,
  readerSizeStep,
  readerStored,
  readerVariables,
  type ReaderSettings,
  type ReaderStored,
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

test("the text size is a step of eight, and the publisher's is the second", () => {
  assert.deepEqual(readerSizeStep(READER_SIZE_MIN), { step: 1, steps: 8 });
  assert.deepEqual(readerSizeStep(READER_DEFAULTS.size), { step: 2, steps: 8 });
  assert.deepEqual(readerSizeStep(READER_SIZE_MAX), { step: 8, steps: 8 });
});

test("the size steps land on the author's size", () => {
  assert.equal((100 - READER_SIZE_MIN) % READER_SIZE_STEP, 0);
  assert.equal((READER_SIZE_MAX - READER_SIZE_MIN) % READER_SIZE_STEP, 0);
});

test("the devices are named ones, each with a screen in CSS pixels and a body around it", () => {
  assert.deepEqual(
    DEVICES.map((device) => [device.id, device.kind, device.width, device.height]),
    [
      ["iphone", "phone", 393, 852],
      ["android-phone", "phone", 412, 915],
      ["ipad", "tablet", 820, 1180],
      ["android-tablet", "tablet", 800, 1280],
      ["kindle-fire", "tablet", 601, 962],
      ["kindle-paperwhite", "ink", 632, 840],
      ["kobo-clara", "ink", 536, 724],
      ["nook-glowlight", "ink", 536, 724],
    ],
  );
  assert.equal(new Set(DEVICES.map((device) => device.id)).size, DEVICES.length);
  for (const device of DEVICES) {
    assert.ok(device.width > 0 && device.height > device.width, device.id);
    for (const side of Object.values(device.bezel)) assert.ok(side > 0, device.id);
    assert.ok(device.radius >= 0, device.id);
    assert.ok(device.safe.top >= 0 && device.safe.bottom >= 0, device.id);
    assert.deepEqual(deviceBox(device), {
      width: device.width + device.bezel.left + device.bezel.right,
      height: device.height + device.bezel.top + device.bezel.bottom,
    });
    assert.ok(DEVICE_GROUPS.some((group) => group.kind === device.kind), device.id);
  }
  // An e-reader's chin is thicker than the rest of its body.
  for (const device of DEVICES.filter((each) => each.kind === "ink")) {
    assert.ok(device.bezel.bottom > device.bezel.top, device.id);
  }
  assert.equal(DEVICES.find((device) => device.id === DEVICE_DEFAULT)?.label, "Kindle Paperwhite");
  assert.deepEqual(
    DEVICE_GROUPS.map((group) => group.label),
    ["Phones", "Tablets", "E-readers"],
  );
});

test("the top and bottom margins inset the text, past what the device keeps of its screen", () => {
  const device = (id: string): (typeof DEVICES)[number] => {
    const found = DEVICES.find((each) => each.id === id);
    assert.ok(found !== undefined, id);
    return found;
  };
  const paperwhite = device("kindle-paperwhite");
  assert.deepEqual(readerInset(READER_DEFAULTS, paperwhite), { top: 32, bottom: 32 });
  assert.deepEqual(readerInset({ ...READER_DEFAULTS, vertical: "narrow" }, paperwhite), {
    top: 16,
    bottom: 16,
  });
  assert.deepEqual(readerInset({ ...READER_DEFAULTS, vertical: "wide" }, paperwhite), {
    top: 56,
    bottom: 56,
  });
  // The island and the bar that goes home are the system's.
  assert.deepEqual(readerInset(READER_DEFAULTS, device("iphone")), { top: 91, bottom: 66 });
  // The setting moves no ReadiumCSS variable.
  assert.deepEqual(changed({ vertical: "wide" }), {});
});

test("the screen around the text is the colour of the theme's page", () => {
  assert.equal(readerPage(READER_DEFAULTS), "#FFFFFF");
  for (const theme of ["sepia", "dark"] as const) {
    const settings = { ...READER_DEFAULTS, theme };
    assert.equal(readerPage(settings), readerVariables(settings).get("--USER__backgroundColor"));
  }
});

/** A stored value drawn from the lists, by a generator seeded so a failure repeats. */
function drawn(seed: number): ReaderStored {
  let state = seed;
  const pick = <Value>(from: readonly Value[]): Value => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return from[state % from.length] as Value;
  };
  const sizes: number[] = [];
  for (let size = READER_SIZE_MIN; size <= READER_SIZE_MAX; size += READER_SIZE_STEP) {
    sizes.push(size);
  }
  return {
    device: pick(DEVICES).id,
    settings: {
      font: pick(READER_FONTS).value,
      size: pick(sizes),
      spacing: pick(READER_SPACINGS).value,
      margins: pick(READER_MARGINS).value,
      vertical: pick(READER_VERTICALS).value,
      align: pick(READER_ALIGNMENTS).value,
      theme: pick(READER_THEMES).value,
    },
  };
}

test("any device and settings the lists offer are read back from the plugin's data as they were saved", () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const stored = drawn(seed);
    // The data is JSON, which drops a setting left to the publisher.
    const saved: unknown = JSON.parse(JSON.stringify(stored));
    assert.deepEqual(readerStored(saved), stored, `seed ${String(seed)}`);
  }
  assert.deepEqual(readerStored(READER_STORED), READER_STORED);
});

test("a stored field the lists do not offer reads as its default, and the other fields stay", () => {
  for (const junk of [undefined, null, 4, "junk", [], { device: 7, settings: "none" }]) {
    assert.deepEqual(readerStored(junk), READER_STORED);
  }
  const stored = drawn(7);
  const withSetting = (key: keyof ReaderSettings, value: unknown): unknown => ({
    device: stored.device,
    settings: { ...stored.settings, [key]: value },
  });
  const junk: Record<keyof ReaderSettings, unknown[]> = {
    font: ["comic", 3, null],
    size: [50, 275, 110, "125", Number.NaN, null],
    spacing: [1.3, "1.5", 0],
    margins: ["huge", 16, null],
    vertical: ["huge", 32, null],
    align: ["center", true],
    theme: ["night", 0, null],
  };
  for (const key of Object.keys(junk) as (keyof ReaderSettings)[]) {
    for (const value of junk[key]) {
      assert.deepEqual(
        readerStored(withSetting(key, value)),
        { device: stored.device, settings: { ...stored.settings, [key]: READER_DEFAULTS[key] } },
        `${key}: ${String(value)}`,
      );
    }
  }
  for (const device of ["kindle", 3, null, undefined]) {
    assert.deepEqual(readerStored({ device, settings: stored.settings }), {
      device: DEVICE_DEFAULT,
      settings: stored.settings,
    });
  }
  // A missing key is that setting's default.
  assert.deepEqual(readerStored({ device: "ipad", settings: { theme: "sepia" } }), {
    device: "ipad",
    settings: { ...READER_DEFAULTS, theme: "sepia" },
  });
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

test("the PreviewViews artboard names every device and every option of every setting", async () => {
  const root = process.env["ORCA_ROOT"] ?? process.cwd();
  const part = await readFile(path.join(root, "design/parts/PreviewViews.html"), "utf8");
  for (const device of DEVICES) {
    const option = `${device.label} · ${String(device.width)} × ${String(device.height)}`;
    assert.ok(part.includes(`<span>${option}</span>`), `no ${option}`);
  }
  for (const group of DEVICE_GROUPS) {
    assert.ok(part.includes(`>${group.label}</div>`), `no ${group.label}`);
  }
  for (const label of Object.values(READER_LABELS)) {
    assert.ok(part.includes(`<span class="lab">${label}</span>`), `no ${label}`);
  }
  const labels = [
    ...READER_FONTS,
    ...READER_SPACINGS,
    ...READER_MARGINS,
    ...READER_VERTICALS,
    ...READER_ALIGNMENTS,
    ...READER_THEMES,
  ].map((option) => option.label);
  for (const label of labels) {
    assert.match(part, new RegExp(`[> ]${label.replace(".", "\\.")}[<,. ]`), `no ${label}`);
  }
  // The text size is drawn as its step, and no percent reaches the author.
  const { step, steps } = readerSizeStep(READER_DEFAULTS.size);
  assert.ok(part.includes(`>${String(step)} of ${String(steps)}<`), "no step");
  const words = part
    .slice(part.indexOf("<!-- the EPUB view"), part.indexOf("Opened where you are reading."))
    .replace(/<[^>]*>/g, " ")
    // The status line's percentage is how far through the book the
    // reader is, and it is no text size.
    .replace(/page \d+ of \d+ · \d+%/g, "");
  assert.doesNotMatch(words, /\d\s*%/);
});

// What this tier does not cover: a browser applying the sheets, so
// whether a variable moves the text on a screen is for the e2e suite.
// The sepia and dark colours are not checked against ReadiumCSS, which
// ships none.
