import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import esbuild from "esbuild";
import { root } from "./bundle.mjs";

const reel = path.join(root, "site/src/reel");
const shots = path.join(root, "site/src/shots/reel");

/** The most bytes one packed frame may weigh, which the packer holds too. */
const LIMIT = 300 * 1024;

/** The player's modules and every scene, built and run with no browser. */
async function player() {
  const scenes = (await readdir(path.join(reel, "scenes"))).filter((file) => file.endsWith(".ts")).sort();
  const built = await esbuild.build({
    stdin: {
      contents: [
        `export * from "./compile"; export * from "./sample"; export * from "./scene"; export * from "./take";`,
        ...scenes.map((file, at) => `import { scene as s${at} } from "./scenes/${file.replace(/\.ts$/, "")}";`),
        `export const SCENES = [${scenes.map((_, at) => `s${at}`).join(", ")}];`,
      ].join("\n"),
      resolveDir: reel,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const text = Buffer.from(built.outputFiles[0].text).toString("base64");
  return { ...(await import(`data:text/javascript;base64,${text}`)), files: scenes };
}

const P = await player();
const takeOf = async (name) => JSON.parse(await readFile(path.join(shots, `${name}.json`), "utf8"));
const hero = P.SCENES.find((scene) => scene.id === "hero");
const heroTake = await takeOf("hero");
const tour = P.compile(hero, heroTake);

/** The frames on screen at a time, back to front. */
const frames = (timeline, t) => P.sample(timeline, t, "wide").layers.map((layer) => layer.frame);
const near = (a, b, by = 0.01) => Math.abs(a - b) <= by;

test("the hero plays the notes, writing, the design panel, the CSS view and export, in that order", () => {
  assert.ok(near(tour.length, 27.1), `the hero is ${tour.length} seconds`);
  const shown = [
    [0, ["notes"]],
    [2.5, ["write-empty"]],
    [8, ["read"]],
    [9.5, ["design-0"]],
    [10.1, ["design-1"]],
    [10.4, ["design-2"]],
    [10.8, ["design-3"]],
    [11.25, ["design-4"]],
    [11.55, ["design-5"]],
    [12, ["design-6"]],
    [12.6, ["design-7"]],
    [13.4, ["design-8"]],
    [14, ["design-9"]],
    [14.7, ["design-10"]],
    [15.4, ["design-11"]],
    [16.2, ["design-12"]],
    [17.8, ["css-0"]],
    [18.5, ["css-1"]],
    [19.8, ["css-1", "css-2"]],
    [21.8, ["css-2"]],
    [24, ["export-0"]],
    [25.5, ["export-1"]],
  ];
  for (const [t, wanted] of shown) assert.deepEqual(frames(tour, t), wanted, `at ${t} seconds`);
  // A frame fades in over the one before it.
  const fading = P.sample(tour, 6.95, "wide").layers.at(-1);
  assert.equal(fading.frame, "read");
  assert.ok(fading.opacity > 0 && fading.opacity < 1);
});

test("the hero's pointer is on each target when it clicks, and a ring follows the click", () => {
  const targets = [
    ["notes", "chapter"],
    ["write", "preview"],
    [321, 19],
    ...["size-up", "size-up", "size-up", "spacing-up", "spacing-up", "spacing-up", "justify"].map((mark) => ["design-0", mark]),
    ["design-8", "drop-cap"],
    ["design-9", "cap-font"],
    ["design-10", "option"],
    ["design-12", "css"],
    [1000, 690],
    ["css-2", "export"],
    ["export-0", "write"],
  ];
  assert.equal(tour.clicks.length, targets.length);
  tour.clicks.forEach((t, at) => {
    const target = targets[at];
    const [x, y] = typeof target[0] === "string" ? P.mid(heroTake, target[0], target[1]) : target;
    const { pointer, ring } = P.sample(tour, t + 0.01, "wide");
    assert.ok(pointer !== null && ring !== null, `no pointer at the click at ${t}`);
    assert.ok(near(pointer.x, x) && near(pointer.y, y), `the click at ${t} is at ${pointer.x}, ${pointer.y}`);
    assert.equal(pointer.touch, false);
    assert.ok(pointer.opacity > 0.9 && pointer.press < 1);
  });
  // The pointer is off the window while the chapter is typed.
  assert.equal(P.sample(tour, 4.5, "wide").pointer, null);
});

test("the hero types the chapter row by row, then the rule under covers", () => {
  const rows = heroTake.frames.find((frame) => frame.name === "write").rows;
  const writing = tour.overs.find((over) => over.kind === "type" && over.frame === "write");
  assert.equal(writing.rows.length, 13);
  assert.deepEqual(P.typing(writing, 3.2).shown, rows.slice(0, 13).map(() => 0));
  const part = P.typing(writing, 5);
  assert.deepEqual(part.shown.slice(0, 2), [rows[0].w, rows[1].w]);
  const typed = part.shown.filter((width) => width > 0).length;
  assert.ok(typed > 3 && typed < 10, `${typed} rows are typed at 5 seconds`);
  assert.equal(part.shown.at(-1), 0);
  assert.deepEqual(P.typing(writing, 6.5).shown, rows.slice(0, 13).map((row) => row.w));

  // The caret is at the end of what is typed, and it is gone once the preview takes the pane.
  const at = P.sample(tour, 5, "wide");
  const row = rows[typed - 1];
  assert.ok(near(at.caret.x, row.x + part.shown[typed - 1] + 1) && near(at.caret.y, row.y - 2));
  assert.match(at.layers[1].crop, /^path\('M/);
  assert.equal(P.sample(tour, 6.9, "wide").caret, null);

  // A row of the rule is covered until it is typed, and the page is set after the last.
  const rule = heroTake.frames.find((frame) => frame.name === "css-2").rows;
  assert.equal(P.sample(tour, 18.62, "wide").covers.length, rule.length);
  const half = P.sample(tour, 19.8, "wide");
  assert.ok(half.covers.length > 0 && half.covers.length < rule.length);
  assert.match(half.layers[1].crop, /^inset\(/);
  const set = P.sample(tour, 21.8, "wide");
  assert.equal(set.covers.length, 0);
  assert.ok(set.caret !== null, "the caret leaves the editor before the dialog opens");
});

test("the hero scrolls the panel through frames placed at their own offsets", () => {
  const scroll = (name) => heroTake.frames.find((frame) => frame.name === name).scroll;
  const middle = P.sample(tour, 12.95, "wide").layers;
  assert.deepEqual(middle.map((layer) => layer.frame), ["design-7", "design-7", "scroll-down", "design-8"]);
  const at = scroll("design-7") - middle[1].move[1];
  assert.ok(at > scroll("design-7") && at < scroll("design-8"));
  for (const layer of middle.slice(1)) {
    assert.ok(near(layer.move[1], scroll(layer.frame) - at));
    assert.equal(layer.crop, layer.within);
  }
});

for (const scene of P.SCENES) {
  test(`the ${scene.id} reel compiles against its take, and its frames are packed in both schemes`, async () => {
    const take = await takeOf(scene.take);
    const timeline = P.compile(scene, take);
    const { w, h } = take.window;
    assert.ok(timeline.tracks.length > 0, "the reel has no pointer");
    for (const track of timeline.tracks) {
      assert.ok(track.a >= 0 && track.b <= timeline.length && track.a < track.b);
      const times = track.keys.map(([t]) => t);
      assert.deepEqual(times, [...times].sort((a, b) => a - b));
      for (const [, [x, y]] of track.keys) assert.ok(x >= 0 && x <= w && y >= 0 && y <= h);
      for (const click of track.clicks) assert.ok(click > track.a && click < track.b);
    }
    for (const list of [timeline.cuts.map((cut) => cut.t), timeline.camera.map(([t]) => t), timeline.clicks]) {
      assert.deepEqual(list, [...list].sort((a, b) => a - b));
    }

    // The first moment is the first frame alone, which the last moment has faded to.
    assert.deepEqual(frames(timeline, 0), [scene.first]);
    const last = P.sample(timeline, timeline.length, "wide").layers.at(-1);
    assert.equal(last.frame, scene.first);
    assert.ok(last.opacity > 0.99);
    assert.deepEqual(P.sample(timeline, timeline.length, "narrow").camera, P.sample(timeline, 0, "narrow").camera);

    // The still is one whole frame, and it is what a reader with no script sees.
    assert.deepEqual(frames(timeline, timeline.still), [timeline.stillFrame]);

    // The page carries the timeline as JSON, and draws the same from it.
    const carried = JSON.parse(JSON.stringify(timeline));
    for (let t = 0; t < timeline.length; t += 0.37) {
      assert.deepEqual(P.sample(carried, t, "narrow"), P.sample(timeline, t, "narrow"));
      // A frame on screen is one the player was told to hold for that time.
      for (const frame of frames(timeline, t)) {
        assert.ok(timeline.uses.some(([name, a, b]) => name === frame && t >= a && t <= b), `${frame} at ${t}`);
      }
    }

    for (const frame of timeline.frames) {
      for (const scheme of ["dark", "light"]) {
        const file = path.join(shots, scene.take, `${frame}-${scheme}.webp`);
        assert.ok((await stat(file)).isFile(), `no ${frame}-${scheme}.webp`);
      }
    }
  });

  test(`at every click of the ${scene.id} reel, the narrowest stage shows the pointer's target`, async () => {
    const take = await takeOf(scene.take);
    const timeline = P.compile(scene, take);
    // A stage 320 pixels wide, in the narrow view's shape.
    const stage = { w: 320, h: 400 };
    assert.ok(timeline.clicks.length > 0);
    for (const t of timeline.clicks) {
      const { camera, pointer } = P.sample(timeline, t, "narrow");
      const { scale, x, y } = P.place(camera, timeline.window, stage);
      const at = [pointer.x * scale + x, pointer.y * scale + y];
      assert.ok(at[0] >= 0 && at[0] <= stage.w && at[1] >= 0 && at[1] <= stage.h, `the click at ${t} is at ${at}`);
    }
  });
}

test("every scene file is a scene of its own name", () => {
  assert.deepEqual(P.SCENES.map((scene) => `${scene.id}.ts`), P.files);
  assert.ok(P.files.includes("hero.ts") && P.files.includes("write.ts"));
});

test("the write reel types the chapter, opens the preview, and goes back to the manuscript", () => {
  const write = P.compile(P.SCENES.find((scene) => scene.id === "write"), heroTake);
  assert.equal(write.take, "hero");
  assert.equal(write.clicks.length, 2);
  const [open, back] = write.clicks;
  assert.deepEqual(frames(write, open - 0.1), ["write-empty", "write"]);
  assert.deepEqual(frames(write, open + 0.5), ["read"]);
  assert.deepEqual(frames(write, back + 0.5), ["write"]);
  assert.equal(write.stillFrame, "read");
  const at = (t) => P.sample(write, t, "wide").pointer;
  assert.deepEqual([at(open).x, at(open).y], P.mid(heroTake, "write", "preview"));
  assert.deepEqual([at(back).x, at(back).y], P.mid(heroTake, "read", "manuscript"));
});

test("a scene that names a frame, a mark or a row the take does not have does not compile", () => {
  const scene = (beats, more = {}) => ({ id: "t", take: "hero", first: "notes", still: 0, beats, ...more });
  assert.throws(() => P.compile(scene([P.hold(2)], { first: "nowhere" }), heroTake), /no frame nowhere/);
  assert.throws(() => P.compile(scene([P.click("notes", "nothing"), P.hold(2)]), heroTake), /no mark nothing/);
  assert.throws(() => P.compile(scene([P.click("notes", "chapter", { then: "gone" }), P.hold(2)]), heroTake), /no frame gone/);
  assert.throws(() => P.compile(scene([P.type("write", [[21, 1]]), P.hold(2)]), heroTake), /21 rows/);
  assert.throws(() => P.compile(scene([P.scroll(["notes", "read"]), P.hold(2)]), heroTake), /no scroll offset|no mark scroller/);
  assert.throws(() => P.compile(scene([P.click("notes", [1300, 10]), P.hold(2)]), heroTake), /outside the window/);
  assert.throws(() => P.compile(scene([P.click("notes", "chapter", { aim: [400, 0] }), P.hold(2)]), heroTake), /outside the narrow view/);
  assert.throws(() => P.compile(scene([P.click("notes", "chapter", { then: "read" })]), heroTake), /too short/);
  assert.throws(() => P.compile(scene([P.hold(3)], { still: 2.6 }), heroTake), /more than one whole frame/);
});

test("a finger taps and drags as a dot, and a drawer and a sheet slide by their own size", () => {
  const box = { x: 90, y: 0, w: 300, h: 844 };
  const sheet = { x: 0, y: 500, w: 390, h: 344 };
  const take = {
    take: "phone",
    window: { w: 390, h: 844 },
    density: 2,
    paint: {},
    frames: [
      { name: "page", marks: { button: { x: 300, y: 20, w: 40, h: 40 } } },
      { name: "panel", marks: { drawer: box, close: { x: 100, y: 20, w: 40, h: 40 } } },
      { name: "sheet", marks: { dialog: sheet } },
    ],
  };
  const beats = [
    P.hold(1),
    P.drag([384, 430], [130, 430], 0.4),
    P.overlap(0.4),
    P.slide("panel", "drawer", { from: "right", push: true }),
    P.tap("panel", "close"),
    P.slide("page", "drawer", { from: "right", out: true, push: true }),
    P.tap("page", "button", { rest: 0.2 }),
    P.slide("sheet", "dialog", { from: "bottom", dim: true }),
    P.hold(2),
  ];
  const timeline = P.compile({ id: "phone", take: "phone", first: "page", still: 0, beats }, take);

  // The drawer comes from a whole width away over the page it pushes aside.
  const coming = P.sample(timeline, 1.2, "wide");
  assert.deepEqual(coming.layers.map((layer) => layer.frame), ["page", "panel"]);
  assert.ok(coming.layers[0].move[0] < 0 && coming.layers[0].move[0] > -300);
  assert.ok(coming.layers[1].move[0] > 0 && near(coming.layers[1].move[0] - coming.layers[0].move[0], 300));
  assert.equal(coming.pointer.touch, true);
  assert.ok(coming.pointer.x < 384 && coming.pointer.x > 130);
  assert.deepEqual(frames(timeline, 1.45), ["panel"]);

  // A tap is a dot on its target that is gone a moment later.
  const [close, open] = timeline.clicks;
  assert.deepEqual([P.sample(timeline, close, "wide").pointer.x, P.sample(timeline, close, "wide").pointer.y], [120, 40]);
  assert.equal(P.sample(timeline, close + 0.6, "wide").pointer, null);

  // The drawer leaves the way it came, and the page comes back with it.
  const going = P.sample(timeline, close + 0.12 + 0.2, "wide");
  assert.deepEqual(going.layers.map((layer) => layer.frame), ["page", "panel"]);
  assert.ok(going.layers[1].move[0] > 0 && going.layers[0].move[0] < 0);

  // The sheet comes up by its own height, and the page above it dims.
  const up = P.sample(timeline, open + 0.2 + 0.1, "wide");
  assert.deepEqual(up.layers.map((layer) => layer.frame), ["page", "sheet", "sheet"]);
  assert.ok(up.layers[1].opacity > 0 && up.layers[1].opacity < 1);
  assert.equal(up.layers[1].crop, "inset(0px 0px 344px 0px)");
  assert.ok(up.layers[2].move[1] > 0 && up.layers[2].move[1] < 344);
});

test("no committed frame weighs over 300 KB", async () => {
  let seen = 0;
  for (const take of await readdir(shots, { withFileTypes: true })) {
    if (!take.isDirectory()) continue;
    for (const file of await readdir(path.join(shots, take.name))) {
      assert.match(file, /-(dark|light)\.webp$/, `${take.name}/${file} is not a packed frame`);
      const { size } = await stat(path.join(shots, take.name, file));
      assert.ok(size <= LIMIT, `${take.name}/${file} is ${Math.round(size / 1024)} KB`);
      seen += 1;
    }
  }
  assert.ok(seen > 0, "no frame is committed");
});

// What this file does not cover: the pixels a reel draws, the loading of
// frames and the change of scheme, which need a browser and are in
// site/tests/reel.spec.ts. It does not cover the packer, which needs
// sharp and is in site/tests/pack.spec.ts. It does not cover whether a
// mark is where the control it names is drawn, which the spec that takes
// the frames settles.
