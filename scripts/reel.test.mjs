import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import esbuild from "esbuild";
import { root } from "./bundle.mjs";

const reel = path.join(root, "site/src/reel");
const shots = path.join(root, "site/src/shots/reel");

/** The byte limit of one packed frame, which the packer holds too. */
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
    format: "cjs",
    platform: "node",
    target: "node22",
  });
  // The bundle runs in this realm, so what it returns compares equal to a literal.
  const holder = { exports: {} };
  const run = new vm.Script(`(function (module, exports) {${built.outputFiles[0].text}\n})`);
  run.runInThisContext()(holder, holder.exports);
  return { ...holder.exports, files: scenes };
}

const P = await player();
const takeOf = async (name) => JSON.parse(await readFile(path.join(shots, `${name}.json`), "utf8"));
const hero = P.SCENES.find((scene) => scene.id === "hero");
const heroTake = await takeOf("hero");
const tour = P.compile(hero, heroTake);

/** The frames on screen at a time, back to front. */
const frames = (timeline, t) => P.sample(timeline, t).layers.map((layer) => layer.frame);
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
  const fading = P.sample(tour, 6.95).layers.at(-1);
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
    const { pointer, ring } = P.sample(tour, t + 0.01);
    assert.ok(pointer !== null && ring !== null, `no pointer at the click at ${t}`);
    assert.ok(near(pointer.x, x) && near(pointer.y, y), `the click at ${t} is at ${pointer.x}, ${pointer.y}`);
    assert.equal(pointer.touch, false);
    assert.ok(pointer.opacity > 0.9 && pointer.press < 1);
  });
  // The pointer is off the window while the chapter is typed.
  assert.equal(P.sample(tour, 4.5).pointer, null);
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
  const at = P.sample(tour, 5);
  const row = rows[typed - 1];
  assert.ok(near(at.caret.x, row.x + part.shown[typed - 1] + 1) && near(at.caret.y, row.y - 2));
  assert.match(at.layers[1].crop, /^path\('M/);
  assert.equal(P.sample(tour, 6.9).caret, null);

  // A row of the rule is covered until it is typed, and the page is set after the last.
  const rule = heroTake.frames.find((frame) => frame.name === "css-2").rows;
  assert.equal(P.sample(tour, 18.62).covers.length, rule.length);
  const half = P.sample(tour, 19.8);
  assert.ok(half.covers.length > 0 && half.covers.length < rule.length);
  assert.match(half.layers[1].crop, /^inset\(/);
  const set = P.sample(tour, 21.8);
  assert.equal(set.covers.length, 0);
  assert.ok(set.caret !== null, "the caret leaves the editor before the dialog opens");
});

test("the hero scrolls the panel through frames placed at their own offsets", () => {
  const scroll = (name) => heroTake.frames.find((frame) => frame.name === name).scroll;
  const middle = P.sample(tour, 12.95).layers;
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
    for (const list of [timeline.cuts.map((cut) => cut.t), timeline.clicks]) {
      assert.deepEqual(list, [...list].sort((a, b) => a - b));
    }

    // The first moment is the first frame alone, which the last moment has faded to.
    assert.deepEqual(frames(timeline, 0), [scene.first]);
    const last = P.sample(timeline, timeline.length).layers.at(-1);
    assert.equal(last.frame, scene.first);
    assert.ok(last.opacity > 0.99);

    // The still is one whole frame, and it is what a reader with no script sees.
    assert.deepEqual(frames(timeline, timeline.still), [timeline.stillFrame]);

    // The page carries the timeline as JSON, and draws the same from it.
    const carried = JSON.parse(JSON.stringify(timeline));
    for (let t = 0; t < timeline.length; t += 0.37) {
      assert.deepEqual(P.sample(carried, t), P.sample(timeline, t));
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
  const at = (t) => P.sample(write, t).pointer;
  assert.deepEqual([at(open).x, at(open).y], P.mid(heroTake, "write", "preview"));
  assert.deepEqual([at(back).x, at(back).y], P.mid(heroTake, "read", "manuscript"));
});

test("the design reel starts from the book with no design, and each of its panel changes brings up the page it set", async () => {
  const take = await takeOf("design");
  const scene = P.SCENES.find((held) => held.id === "design");
  const design = P.compile(scene, take);
  assert.equal(scene.first, "d0");
  assert.deepEqual(frames(design, 0), ["d0"]);
  assert.ok(design.length >= 16 && design.length <= 20, `the design reel is ${design.length} seconds`);

  // Each click is on a control of the frame on screen, and brings up the frame after it.
  const steps = [
    ["d0", "trim", "d1"],
    ["d1", "body-size", "d2"],
    ["d3", "h1-font", "d4"],
    ["d4", "option", "d5"],
    ["d5", "h1-center", "d6"],
    ["d6", "h1-below", "d7"],
    ["d7", "h2", "d8"],
    ["d8", "h2-size", "d9"],
    ["d9", "h2-center", "d10"],
    ["d11", "drop-cap", "d12"],
    ["d12", "first-line", "d13"],
  ];
  assert.equal(design.clicks.length, steps.length);
  design.clicks.forEach((t, at) => {
    const [on, mark, then] = steps[at];
    assert.deepEqual(frames(design, t - 0.01), [on], `before the click on ${mark}`);
    const { pointer } = P.sample(design, t);
    assert.deepEqual([pointer.x, pointer.y], P.mid(take, on, mark), `the click on ${mark}`);
    const cut = design.cuts.find((held) => held.t >= t);
    assert.equal(cut.frame, then);
    assert.deepEqual(frames(design, cut.t + cut.fade + 0.01), [then], `after the click on ${mark}`);
  });
  // Two clicks open a list and a tab, and the other nine set the pages.
  assert.equal(steps.filter(([, mark]) => mark !== "h1-font" && mark !== "h2").length, 9);

  // The panel scrolls to the headings and to the chapter openings through a frame between.
  const strips = design.overs.filter((over) => over.kind === "scroll").map((over) => over.frames.map((held) => held.frame));
  assert.deepEqual(strips, [["d2", "scroll-headings", "d3"], ["d10", "scroll-openings", "d11"]]);
  for (const strip of design.overs.filter((over) => over.kind === "scroll")) {
    const offsets = strip.frames.map((held) => held.scroll);
    assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
    assert.ok(offsets[0] < offsets[1] && offsets[1] < offsets[2]);
  }
  // A reader with no script sees the page with every change made.
  assert.equal(design.stillFrame, "d13");
});

test("the CSS reel pins a paragraph of the colophon in inspect mode, adds a rule for it, types three declarations, and ends on the page set again", async () => {
  const take = await takeOf("css");
  const scene = P.SCENES.find((held) => held.id === "css");
  const css = P.compile(scene, take);
  assert.deepEqual(frames(css, 0), ["c0"]);
  assert.ok(css.length >= 12 && css.length <= 14, `the CSS reel is ${css.length} seconds`);

  const steps = [
    ["c0", "inspect", "c1"],
    ["c2", "para", "c3"],
    ["c3", "add", "c4"],
    ["c5", "close", "c6"],
  ];
  assert.equal(css.clicks.length, steps.length);
  css.clicks.forEach((t, at) => {
    const [on, mark, then] = steps[at];
    // The outline is under the pointer before the click that pins the paragraph.
    assert.deepEqual(frames(css, t - 0.01), [on], `before the click on ${mark}`);
    const { pointer } = P.sample(css, t);
    assert.deepEqual([pointer.x, pointer.y], P.mid(take, on, mark), `the click on ${mark}`);
    const cut = css.cuts.find((held) => held.t >= t);
    assert.deepEqual(frames(css, cut.t + cut.fade + 0.01), [then], `after the click on ${mark}`);
  });

  // The three declarations are typed in the editor, each under a cover until it is.
  const typed = css.overs.find((over) => over.kind === "type");
  const rows = take.frames.find((frame) => frame.name === "c5").rows;
  assert.equal(rows.length, 3);
  assert.equal(typed.frame, "c5");
  assert.equal(typed.how, "cover");
  assert.deepEqual(typed.rows, rows);
  assert.deepEqual(typed.box, take.frames.find((frame) => frame.name === "c5").marks.code);
  assert.equal(P.sample(css, typed.a + 0.01).covers.length, 3);
  const half = P.sample(css, (typed.a + typed.stop) / 2);
  assert.ok(half.covers.length > 0 && half.covers.length < 3);
  assert.ok(half.caret !== null);
  for (const scheme of ["dark", "light"]) {
    assert.match(take.paint[scheme].cover, /^rgb\(/);
    assert.match(take.paint[scheme].caret, /^rgb\(/);
  }

  // The page is set once the typing stops, and the reel ends on it with the pin off.
  const set = P.sample(css, typed.stop + 0.7);
  assert.deepEqual(set.layers.map((layer) => layer.frame), ["c5"]);
  assert.equal(set.covers.length, 0);
  assert.equal(css.stillFrame, "c5");
  assert.deepEqual(frames(css, css.length - P.SEAM - 0.05), ["c6"]);
});

test("a take that typed nothing holds no colours, and its reel still compiles", async () => {
  const take = await takeOf("design");
  assert.deepEqual(take.paint, {});
  assert.ok(P.compile(P.SCENES.find((held) => held.id === "design"), take).length > 0);
});

test("the chapters reel shows the book note's page, then its Markdown with each chapter as a link, and both switches are clicks on the header's own actions", async () => {
  const scene = P.SCENES.find((held) => held.id === "chapters");
  const take = await takeOf("chapters");
  const reel = P.compile(scene, take);
  assert.ok(reel.length >= 10 && reel.length <= 12.5, `the chapters reel is ${reel.length} seconds`);

  // The two clicks are the only ones, and each is on the header action
  // of the view on screen and brings up the other view.
  const [toMarkdown, toBook] = reel.clicks;
  assert.equal(reel.clicks.length, 2);
  for (const [t, frame, mark, then] of [
    [toMarkdown, "page-order", "as-markdown", "source-order"],
    [toBook, "source-top", "as-book", "page"],
  ]) {
    assert.deepEqual(frames(reel, t - 0.01), [frame], `before the click at ${t}`);
    const [x, y] = P.mid(take, frame, mark);
    const { pointer, ring } = P.sample(reel, t + 0.01);
    assert.ok(ring !== null && near(pointer.x, x) && near(pointer.y, y), `the click at ${t} is at ${pointer.x}, ${pointer.y}`);
    assert.deepEqual(frames(reel, t + 0.5), [then], `after the click at ${t}`);
  }

  // The page is read down to its reading order before the first click,
  // and the Markdown up to its properties before the second.
  const [down, up] = reel.overs;
  assert.deepEqual(down.frames.map((held) => held.frame), ["page", "page-mid", "page-order"]);
  assert.deepEqual(up.frames.map((held) => held.frame), ["source-order", "source-mid", "source-top"]);
  assert.ok(down.b <= toMarkdown && up.a > toMarkdown && up.b <= toBook);
  for (const over of [down, up]) {
    const offsets = over.frames.map((held) => held.scroll);
    const tall = over.box.h;
    assert.ok(Math.abs(offsets[1] - offsets[0]) < tall && Math.abs(offsets[2] - offsets[1]) < tall, "a strip has a gap");
    // The status bar and the scroller's bar stay still over the strip.
    const middle = P.sample(reel, (over.a + over.b) / 2).layers;
    const still = middle.filter((layer) => layer.frame === over.frames[0].frame && layer.move === undefined && layer.crop !== undefined);
    assert.equal(still.length, 2);
  }

  // The pointer rests on a chapter's link with no click, and the still is that picture.
  const [x, y] = P.mid(take, "source-order", "link");
  const rest = P.sample(reel, scene.still);
  assert.ok(near(rest.pointer.x, x) && near(rest.pointer.y, y) && rest.ring === null);
  assert.equal(reel.stillFrame, "source-order");
  // The reel ends on the page it opens on.
  assert.deepEqual(frames(reel, reel.length - 1), ["page"]);
});

test("the export reel shows preflight refusing the book with the Export button disabled, the fix in the note, and then the export", async () => {
  const scene = P.SCENES.find((held) => held.id === "export");
  const take = await takeOf("export");
  const reel = P.compile(scene, take);
  assert.ok(reel.length >= 12 && reel.length <= 14.5, `the export reel is ${reel.length} seconds`);

  const steps = [
    ["e0", "export", "e1"],
    ["e1", "fix", "e2"],
    // The click in the word starts the typing, which shows the line set right.
    ["e2", "word", "e3"],
    ["e3", "preview", "e4"],
    ["e4", "export", "e5"],
    ["e5", "write", "e6"],
  ];
  assert.equal(reel.clicks.length, steps.length);
  reel.clicks.forEach((t, at) => {
    const [frame, mark, then] = steps[at];
    assert.equal(frames(reel, t - 0.01).at(-1), frame, `before the click at ${t}`);
    const [x, y] = P.mid(take, frame, mark);
    const { pointer } = P.sample(reel, t + 0.01);
    assert.ok(near(pointer.x, x) && near(pointer.y, y), `the click at ${t} is at ${pointer.x}, ${pointer.y}`);
    assert.equal(frames(reel, t + 0.6).at(-1), then, `after the click at ${t}`);
  });

  // The refusal is the still, and it stands for two seconds or more
  // with the disabled button in it.
  assert.equal(reel.stillFrame, "e1");
  assert.ok(take.frames.find((frame) => frame.name === "e1").marks["export-off"] !== undefined);
  assert.ok(reel.clicks[1] - reel.clicks[0] >= 2.5, "the refusal is not on screen long enough to read");

  // The fix types the word alone, over the line as the note has it, and
  // no cover hides the line.
  const fix = reel.overs.find((over) => over.kind === "type");
  assert.equal(fix.frame, "e3");
  assert.deepEqual(fix.rows, [take.frames.find((frame) => frame.name === "e3").marks.word]);
  const [a, b] = fix.spans[0];
  const typing = P.sample(reel, (a + b) / 2);
  assert.deepEqual(typing.layers.map((layer) => layer.frame), ["e2", "e3"]);
  assert.equal(typing.covers.length, 0);
  assert.ok(typing.caret !== null && typing.caret.x > fix.rows[0].x && typing.caret.x < fix.rows[0].x + fix.rows[0].w);
  // The pointer is off the word while it is typed.
  assert.ok(typing.pointer.y > fix.rows[0].y + fix.rows[0].h + 20);
});

test("a pointer moved to a point clicks nothing, and a scene that names no fixed mark scrolls as before", () => {
  const scene = (beats) => ({ id: "t", take: "hero", first: "notes", still: 0, beats });
  const moved = P.compile(scene([P.click("notes", "chapter"), P.point("notes", [400, 300], { move: 0.5 }), P.hold(2)]), heroTake);
  assert.equal(moved.clicks.length, 1);
  const there = P.sample(moved, moved.clicks[0] + 0.12 + 0.5 + 0.2);
  assert.deepEqual([there.pointer.x, there.pointer.y], [400, 300]);
  assert.deepEqual(tour.overs.find((over) => over.kind === "scroll").fixed, []);
  assert.throws(
    () => P.compile(scene([P.scroll(["design-7", "scroll-down", "design-8"], 0.5, "scroller", ["nowhere"]), P.hold(2)]), heroTake),
    /no mark nowhere/,
  );
});

test("a scene that names a frame, a mark or a row the take does not have does not compile", () => {
  const scene = (beats, more = {}) => ({ id: "t", take: "hero", first: "notes", still: 0, beats, ...more });
  assert.throws(() => P.compile(scene([P.hold(2)], { first: "nowhere" }), heroTake), /no frame nowhere/);
  assert.throws(() => P.compile(scene([P.click("notes", "nothing"), P.hold(2)]), heroTake), /no mark nothing/);
  assert.throws(() => P.compile(scene([P.click("notes", "chapter", { then: "gone" }), P.hold(2)]), heroTake), /no frame gone/);
  assert.throws(() => P.compile(scene([P.type("write", [[21, 1]]), P.hold(2)]), heroTake), /21 rows/);
  assert.throws(() => P.compile(scene([P.scroll(["notes", "read"]), P.hold(2)]), heroTake), /no scroll offset|no mark scroller/);
  assert.throws(() => P.compile(scene([P.click("notes", [1300, 10]), P.hold(2)]), heroTake), /outside the window/);
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
  const coming = P.sample(timeline, 1.2);
  assert.deepEqual(coming.layers.map((layer) => layer.frame), ["page", "panel"]);
  assert.ok(coming.layers[0].move[0] < 0 && coming.layers[0].move[0] > -300);
  assert.ok(coming.layers[1].move[0] > 0 && near(coming.layers[1].move[0] - coming.layers[0].move[0], 300));
  assert.equal(coming.pointer.touch, true);
  assert.ok(coming.pointer.x < 384 && coming.pointer.x > 130);
  assert.deepEqual(frames(timeline, 1.45), ["panel"]);

  // A tap is a dot on its target that is gone a moment later.
  const [close, open] = timeline.clicks;
  assert.deepEqual([P.sample(timeline, close).pointer.x, P.sample(timeline, close).pointer.y], [120, 40]);
  assert.equal(P.sample(timeline, close + 0.6).pointer, null);

  // The drawer leaves the way it came, and the page comes back with it.
  const going = P.sample(timeline, close + 0.12 + 0.2);
  assert.deepEqual(going.layers.map((layer) => layer.frame), ["page", "panel"]);
  assert.ok(going.layers[1].move[0] > 0 && going.layers[0].move[0] < 0);

  // The sheet comes up by its own height, and the page above it dims.
  const up = P.sample(timeline, open + 0.2 + 0.1);
  assert.deepEqual(up.layers.map((layer) => layer.frame), ["page", "sheet", "sheet"]);
  assert.ok(up.layers[1].opacity > 0 && up.layers[1].opacity < 1);
  assert.equal(up.layers[1].crop, "inset(0px 0px 344px 0px)");
  assert.ok(up.layers[2].move[1] > 0 && up.layers[2].move[1] < 344);
});

test("a section plays a phone reel and a tablet reel from frames of Obsidian's mobile layout, with a touch dot for each tap and swipe", async () => {
  for (const device of ["phone", "tablet"]) {
    const scene = P.SCENES.find((held) => held.id === device);
    const take = await takeOf(scene.take);
    assert.equal(take.device, device);
    const timeline = P.compile(scene, take);

    // Every pointer is a finger: a dot at each tap, and a dot that moves for a swipe.
    assert.ok(timeline.tracks.length > 0);
    for (const track of timeline.tracks) assert.equal(track.touch, true);
    for (const beat of scene.beats) assert.notEqual(beat.kind, "click");
    for (const t of timeline.clicks) {
      const { pointer, ring } = P.sample(timeline, t + 0.01);
      assert.ok(pointer !== null && pointer.touch && pointer.opacity > 0.9 && ring !== null, `no dot at the tap at ${t}`);
    }
    assert.equal(P.sample(timeline, timeline.clicks[0] + 0.7).pointer, null);
  }

  const phoneTake = await takeOf("phone");
  const tabletTake = await takeOf("tablet");

  const phone = P.compile(P.SCENES.find((held) => held.id === "phone"), phoneTake);
  const tablet = P.compile(P.SCENES.find((held) => held.id === "tablet"), tabletTake);
  const drawer = phoneTake.frames.find((frame) => frame.name === "drawer").marks.drawer;
  const sheet = phoneTake.frames.find((frame) => frame.name === "sheet").marks.sheet;
  const [coming, going, rising] = phone.overs;
  assert.deepEqual(phone.overs.map((over) => over.kind), ["slide", "slide", "slide"]);

  // The drawer comes in from the right over a swipe, and the page it pushes meets its edge all the way.
  assert.deepEqual([coming.frame, coming.out, coming.push, coming.by], ["drawer", false, true, [drawer.w, 0]]);
  for (const k of [0.2, 0.5, 0.8]) {
    const t = coming.a + (coming.b - coming.a) * k;
    const { layers, pointer } = P.sample(phone, t);
    assert.deepEqual(layers.map((layer) => layer.frame), ["page", "drawer"]);
    const edge = drawer.x + layers[1].move[0];
    assert.ok(near(phoneTake.window.w + layers[0].move[0], edge), `the page and the drawer part at ${t}`);
    // The drawer's edge stays under the finger.
    assert.ok(pointer !== null && pointer.touch, `no finger on the swipe at ${t}`);
    assert.ok(pointer.x <= edge && edge - pointer.x <= 6.01, `the finger is at ${pointer.x} and the drawer at ${edge}`);
  }
  // The strip of the page the drawer leaves in sight is shaded once the drawer is in: the
  // frame fades in over the slide, which stays drawn at its end for as long.
  const settling = P.sample(phone, coming.b + coming.held / 2).layers;
  assert.deepEqual(settling.map((layer) => layer.frame), ["page", "drawer", "drawer"]);
  assert.ok(near(settling[0].move[0], -drawer.w) && near(settling[1].move[0], 0));
  assert.ok(settling[2].opacity > 0 && settling[2].opacity < 1 && settling[2].crop === undefined);
  assert.deepEqual(frames(phone, coming.b + coming.held + 0.01), ["drawer"]);

  // It leaves the same way, and the page left behind is the justified one.
  assert.deepEqual([going.frame, going.out, going.push], ["justified", true, true]);
  const leaving = P.sample(phone, (going.a + going.b) / 2);
  assert.deepEqual(leaving.layers.map((layer) => layer.frame), ["set", "justified"]);
  assert.ok(near(phoneTake.window.w + leaving.layers[0].move[0], drawer.x + leaving.layers[1].move[0]));
  assert.ok(leaving.pointer !== null && leaving.pointer.touch);
  assert.deepEqual(frames(phone, going.b + 0.01), ["set"]);
  assert.equal(going.held, 0);

  // The sheet rises by its own height over the page, which dims.
  assert.deepEqual([rising.frame, rising.by, rising.dim], ["sheet", [0, sheet.h], { x: 0, y: 0, w: 390, h: sheet.y }]);
  const risen = P.sample(phone, (rising.a + rising.b) / 2);
  const up = risen.layers;
  assert.deepEqual(up.map((layer) => layer.frame), ["set", "sheet", "sheet"]);
  assert.ok(up[1].opacity > 0 && up[1].opacity < 1 && up[2].move[1] > 0 && up[2].move[1] < sheet.h);
  // The page between the shaded part and the sheet's top is shaded as much, in the take's own shade.
  assert.deepEqual(risen.shades, [{ x: 0, y: sheet.y, w: sheet.w, h: up[2].move[1], opacity: up[1].opacity }]);
  for (const scheme of ["dark", "light"]) assert.match(phoneTake.shade[scheme], /^rgb\(\d+ \d+ \d+ \/ 0\.\d+\)$/);
  assert.deepEqual(P.sample(phone, rising.b + 0.01).shades, []);

  // Each tap brings up the frame the take took after it.
  const after = (timeline, at) => frames(timeline, timeline.clicks[at] + 0.6);
  assert.deepEqual([0, 2].map((at) => after(phone, at)), [["justified"], ["written"]]);
  assert.deepEqual([0, 1, 2, 3].map((at) => after(tablet, at)), [["turned"], ["justified"], ["dialog"], ["written"]]);
  assert.equal(phone.stillFrame, "set");
  assert.equal(tablet.stillFrame, "justified");
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
// the frames settles. It does not cover what the design take starts
// from: e2e/reel/design.spec.ts strips the book note to the keys a new
// book has, with no design key and no CSS, before its first frame, and
// e2e/reel/css.spec.ts takes the colophon's rule out the same way.
