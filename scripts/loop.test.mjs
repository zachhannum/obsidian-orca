import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { root } from "./bundle.mjs";

const read = (file) => readFile(path.join(root, file), "utf8");

const [page, spec, ignored] = await Promise.all([
  read("loop/loop.html"),
  read("e2e/film.spec.ts"),
  read(".gitignore"),
]);

/** The devices a loop is made for, and the size of each one's window. */
const DEVICES = {
  desktop: { width: 1200, height: 750 },
  tablet: { width: 1180, height: 820 },
  phone: { width: 390, height: 844 },
};

/** The scripts the page names itself, in the order it loads them. */
const named = [...page.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map((m) => m[1]);

/** A stand-in for any element: every property is another, and every call returns one. */
function anything() {
  const held = {};
  return new Proxy(function () {}, {
    get: (_, key) => (key === Symbol.toPrimitive ? () => "" : (held[key] ??= anything())),
    set: (_, key, value) => ((held[key] = value), true),
    apply: () => anything(),
  });
}

/**
 * One device's scripts, run without a browser on frames that hold
 * whatever is asked of them. Returns the scripts it ran, and every
 * frame and every mark the scenes asked for, as `frame` and
 * `frame.mark`.
 */
async function asked(device) {
  const frames = new Set();
  const marks = new Set();
  const box = { x: 0, y: 0, width: 10, height: 10 };
  const frame = (name) => {
    frames.add(name);
    return {
      name,
      scroll: 0,
      rows: Array.from({ length: 20 }, () => box),
      marks: new Proxy({}, { get: (_, mark) => (marks.add(`${name}.${String(mark)}`), box) }),
    };
  };
  const window = {
    URLSearchParams,
    location: { search: `?device=${device}` },
    addEventListener() {},
    FRAMES: { window: DEVICES[device], frames: [] },
  };
  window.window = window;
  const context = vm.createContext(window);
  const run = async (script) => {
    vm.runInContext(await read(`loop/${script}`), context, { filename: script });
    // The scenes come after the window, and look every frame up through it.
    if (script === "js/window.js") window.O.shot = frame;
  };
  for (const script of named) await run(script);
  const O = window.O;
  // The page writes a device's scenes in after the scripts it names.
  const scenes = O.SCENES.map((scene) => `js/${scene}.js`);
  for (const script of scenes) await run(script);
  // A section's frames are files, and the desk draws the first one again at the seam.
  for (const name of [...O.sections.flatMap((s) => s.frames), O.FIRST]) {
    frames.add(name.split("@").at(-1));
  }
  // A section builds its strips and its covers from more frames.
  O.h = () => anything();
  for (const section of O.sections) section.init?.(anything());
  return { scripts: [...named, ...scenes], frames: [...frames].sort(), marks: [...marks].sort(), O };
}

/** The frames the spec says it takes on a device, from its own list. */
function takes(device) {
  const list = new RegExp(`const TAKES[^=]*= \\{[\\s\\S]*?\\n  ${device}: \\[([\\s\\S]*?)\\n  \\],`).exec(spec);
  assert.ok(list, `the spec lists no frames for a ${device}`);
  return [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("the page loads every script in its folder for one device or another", async () => {
  const there = [];
  for (const folder of ["js", "js/scenes"]) {
    for (const file of await readdir(path.join(root, "loop", folder))) {
      if (file.endsWith(".js")) there.push(`${folder}/${file}`);
    }
  }
  const loaded = new Set();
  for (const device of Object.keys(DEVICES)) {
    for (const script of (await asked(device)).scripts) loaded.add(script);
  }
  assert.deepEqual([...loaded].sort(), there.sort());
  // The page writes the scenes in from the list the clock holds.
  assert.match(page, /for \(const scene of O\.SCENES\) document\.write\(`<script src="js\/\$\{scene\}\.js">/);
});

for (const device of Object.keys(DEVICES)) {
  test(`every frame and mark the ${device}'s scenes ask for is one the film spec takes`, async () => {
    const { frames, marks } = await asked(device);
    assert.ok(frames.length > 0 && marks.length > 0, "the scenes asked for nothing");

    const taken = device === "desktop" ? null : takes(device);
    for (const name of frames) {
      if (taken !== null) {
        assert.ok(taken.includes(name), `the spec takes no frame ${name} on a ${device}`);
        continue;
      }
      // The panel's frames are numbered as the spec takes them.
      const found = /^design-\d+$/.test(name)
        ? spec.includes("`design-${taking}`") || spec.includes(`"${name}"`)
        : spec.includes(`"${name}"`);
      assert.ok(found, `the spec takes no frame ${name}`);
    }
    for (const asked of marks) {
      const mark = asked.split(".").at(-1);
      const key = new RegExp(`[{,\\s]"?${mark}"?: `);
      assert.match(spec, key, `the spec marks no ${mark}, which ${asked} needs`);
    }
  });

  test(`every pointer path of the ${device}'s loop is inside what it plays, and the loop ends on its first frame`, async () => {
    const { O } = await asked(device);
    assert.ok(O.cursorTracks.length > 0, "the loop has no pointer");
    for (const track of O.cursorTracks) {
      assert.ok(track.a >= O.T_FIRST && track.b <= O.LAST, `a pointer path runs from ${track.a} to ${track.b}`);
      for (const click of track.clicks) assert.ok(click > track.a && click < track.b);
    }
    // The last scene ends where the clock does, and each scene after the one before.
    const ends = Object.values(O.T);
    assert.equal(ends.length, O.sections.length);
    assert.deepEqual(ends, [...ends].sort((a, b) => a - b));
    assert.deepEqual([...O.sections].map((section) => section.b), ends);
    assert.ok(ends.at(-1) <= O.LAST);
    // The first moment is the seam's frame alone, which the last moment fades to.
    const first = O.sections[0].show(O.T_FIRST);
    assert.deepEqual(Object.keys(first).filter((name) => first[name] > 0), [O.FIRST]);
  });
}

test("the loops play 27.1, 24.4 and 18.4 seconds, a device's no longer than the desktop's", async () => {
  const lengths = {};
  for (const device of Object.keys(DEVICES)) {
    const { O } = await asked(device);
    lengths[device] = Math.round(O.LENGTH * 10) / 10;
    assert.equal(O.TOUCH, device !== "desktop");
  }
  assert.deepEqual(lengths, { desktop: 27.1, tablet: 24.4, phone: 18.4 });
  const { O } = await asked("desktop");
  assert.deepEqual(Object.keys(O.T), ["notes", "write", "design", "css", "export"]);
  assert.equal(O.sections.length, 5);
});

test("the renderer makes a loop for each device, at that device's size and from its own folders", async () => {
  const render = await read("loop/render.mjs");
  for (const [device, { width, height }] of Object.entries(DEVICES)) {
    const base = device === "desktop" ? "" : `-${device}`;
    const entry = new RegExp(
      `device: "${device}",\\s+name: "loop${base}",\\s+frames: \\{ dark: "ui${base}", light: "ui${base}-light" \\},\\s+width: ${width},\\s+height: ${height},`,
    );
    assert.match(render, entry, `the renderer has no ${device} loop`);
    // The spec writes the folders the renderer reads.
    if (device !== "desktop") {
      assert.match(spec, new RegExp(`${device}: \\{ dark: "ui-${device}", light: "ui-${device}-light" \\}`));
    }
  }
  assert.match(spec, /const FOLDERS: Record<Scheme, string> = \{ dark: "ui", light: "ui-light" \};/);
});

test("the frames the loop reads are never committed", () => {
  assert.match(ignored, /^loop\/assets\/$/m);
});

// What this file does not cover: whether the desktop's spec takes as
// many numbered frames as its scenes ask for, and whether a mark is in
// the frame a scene looks for it in. The render throws on both. It also
// does not cover the pixels the page draws, which need a browser, and
// the clips, which need ffmpeg.
