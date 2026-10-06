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

/** The scripts the page loads from its own folder, in the order it loads them. */
const scripts = [...page.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map((m) => m[1]);

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
 * The page's scripts, run without a browser on frames that hold
 * whatever is asked of them. Returns every frame and every mark the
 * scenes asked for, as `frame` and `frame.mark`.
 */
async function asked() {
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
    location: { search: "" },
    addEventListener() {},
    FRAMES: { window: { width: 1200, height: 750 }, frames: [] },
  };
  window.window = window;
  const context = vm.createContext(window);
  for (const script of scripts) {
    vm.runInContext(await read(`loop/${script}`), context, { filename: script });
    // The scenes come after the window, and look every frame up through it.
    if (script === "js/window.js") window.O.shot = frame;
  }
  const O = window.O;
  // A section's frames are files, and the desk draws the first one again at the seam.
  for (const name of [...O.sections.flatMap((s) => s.frames), "notes"]) {
    frames.add(name.split("@").at(-1));
  }
  // A section builds its strips and its covers from more frames.
  O.h = () => anything();
  for (const section of O.sections) section.init?.(anything());
  return { frames: [...frames].sort(), marks: [...marks].sort(), O };
}

test("the page loads every script in its folder", async () => {
  const there = [];
  for (const folder of ["js", "js/scenes"]) {
    for (const file of await readdir(path.join(root, "loop", folder))) {
      if (file.endsWith(".js")) there.push(`${folder}/${file}`);
    }
  }
  assert.deepEqual([...scripts].sort(), there.sort());
});

test("every frame and mark the scenes ask for is one the film spec takes", async () => {
  const { frames, marks } = await asked();
  assert.ok(frames.length > 0 && marks.length > 0, "the scenes asked for nothing");

  for (const name of frames) {
    // The panel's frames are numbered as the spec takes them.
    const taken = /^design-\d+$/.test(name)
      ? spec.includes("`design-${taking}`") || spec.includes(`"${name}"`)
      : spec.includes(`"${name}"`);
    assert.ok(taken, `the spec takes no frame ${name}`);
  }
  for (const asked of marks) {
    const mark = asked.split(".").at(-1);
    const key = new RegExp(`[{,\\s]"?${mark}"?: `);
    assert.match(spec, key, `the spec marks no ${mark}, which ${asked} needs`);
  }
});

test("the loop plays 27.1 seconds, and every pointer path is inside what it plays", async () => {
  const { O } = await asked();
  assert.equal(Math.round(O.LENGTH * 10) / 10, 27.1);
  assert.deepEqual(Object.keys(O.T), ["notes", "write", "design", "css", "export"]);
  assert.equal(O.sections.length, 5);
  for (const track of O.cursorTracks) {
    assert.ok(track.a >= 12.5 && track.b <= O.LAST, `a pointer path runs from ${track.a} to ${track.b}`);
    for (const click of track.clicks) assert.ok(click > track.a && click < track.b);
  }
});

test("the frames the loop reads are never committed", () => {
  assert.match(ignored, /^loop\/assets\/$/m);
});

// What this file does not cover: whether the spec takes as many
// numbered frames as the scenes ask for, and whether a mark is in the
// frame a scene looks for it in. The render throws on both. It also
// does not cover the pixels the page draws, which need a browser, and
// the clips, which need ffmpeg.
