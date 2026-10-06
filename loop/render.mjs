/**
 * The loop on the site's landing page, rendered once per device and
 * scheme from the frames in `loop/assets`. Each clip is an H.264 MP4,
 * which every browser plays, and beside it goes its poster: the loop's
 * first moment, which the page shows until the clip plays.
 *
 *   node loop/render.mjs [--into site/src/shots] [--posters] [--device phone]
 *
 * `--into` copies the files there, and leaves in place a file that
 * looks the same as the new one, so a run on another machine does not
 * rewrite a clip nobody could tell apart.
 *
 * `--posters` takes the posters alone, and renders no clip.
 *
 * `--device` renders one of `desktop`, `tablet` and `phone`.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const HERE = import.meta.dirname;
const PAGE = pathToFileURL(path.join(HERE, "loop.html")).href;
const OUT = path.join(HERE, "..", "build", "loop");
const SEGMENTS = path.join(OUT, "segments");

/**
 * One loop per device. Its files are named after `name`, and `frames`
 * is the folder under `loop/assets` each scheme plays. The window is
 * the size the frames were taken at, and the page shows a clip no wider
 * than that. The desktop's hero is 1200 CSS pixels at its widest, and
 * at 1.6 times that the text stays sharp and a clip stays near 3 MB. A
 * phone's clip is twice its CSS size: at three times, the encoder
 * labels it H.264 level 6, which few phones decode.
 */
const LOOPS = [
  {
    device: "desktop",
    name: "loop",
    frames: { dark: "ui", light: "ui-light" },
    width: 1200,
    height: 750,
    scale: 1.6,
  },
  {
    device: "tablet",
    name: "loop-tablet",
    frames: { dark: "ui-tablet", light: "ui-tablet-light" },
    width: 1180,
    height: 820,
    scale: 1.6,
  },
  {
    device: "phone",
    name: "loop-phone",
    frames: { dark: "ui-phone", light: "ui-phone-light" },
    width: 390,
    height: 844,
    scale: 2,
  },
];
const FPS = 30;
/** A clip over this size is a mistake in the encode, not a bigger window. */
const MOST = 4 * 1024 * 1024;
/** Two clips above this likeness are the same picture. */
const SAME = 0.995;
/** Chromium draws the same pixels on every machine only with these. */
const CHROMIUM = { args: ["--font-render-hinting=none", "--force-color-profile=srgb"] };
const WORKERS = Math.max(2, Math.min(8, os.cpus().length - 2));

/** The value that follows a flag, when the flag is there. */
function flag(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}
const into = flag("--into");
const only = flag("--device");
const postersOnly = process.argv.includes("--posters");

const say = (line) => process.stdout.write(`${line}\n`);

/** Runs ffmpeg to its end, and fails when it does. */
function ffmpeg(args, stdin = "ignore") {
  const run = spawn("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: [stdin, "inherit", "inherit"] });
  const closed = new Promise((resolve, reject) => {
    run.on("error", reject);
    run.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg left with ${code}`))));
  });
  return { run, closed };
}

/**
 * The likeness of two clips, from 0 to 1. It is 0 when they differ in
 * length or in the color they are labelled with.
 */
function likeness(a, b) {
  const kind = (file) =>
    execFileSync("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_packets,color_transfer,color_space", "-of", "csv=p=0", file]).toString().trim();
  if (kind(a) !== kind(b)) return 0;
  const log = spawnSync("ffmpeg", ["-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const all = /All:([\d.]+)/.exec(log);
  return all === null ? 0 : Number(all[1]);
}

/** Copies a file into the folder `--into` names, unless the one there is the same. */
function keep(file, same) {
  if (into === undefined) return;
  const there = path.join(into, path.basename(file));
  if (existsSync(there) && same(there, file)) {
    say(`${there} is the same, and stays`);
    return;
  }
  copyFileSync(file, there);
  say(`wrote ${there}`);
}

/**
 * The loop's page on one scheme's frames, ready to be sought. A page
 * that threw has a frame or a mark missing, and a picture of it would
 * be a wrong one.
 */
async function open(browser, loop, scheme) {
  const folder = loop.frames[scheme];
  if (!existsSync(path.join(HERE, "assets", folder, "frames.js"))) {
    throw new Error(`loop/assets/${folder} holds no frames, which \`npm run film\` takes`);
  }
  const page = await browser.newPage({
    viewport: { width: loop.width, height: loop.height },
    deviceScaleFactor: loop.scale,
  });
  const threw = [];
  page.on("pageerror", (error) => threw.push(error.message));
  await page.goto(`${PAGE}?render=1&device=${loop.device}&ui=${folder}&fps=${FPS}`);
  await page.evaluate("O.ready");
  if (threw.length > 0) throw new Error(`the loop's page threw: ${threw.join("; ")}`);
  return page;
}

/** Takes the poster, and returns the loop's length in seconds. */
async function poster(browser, loop, scheme) {
  const page = await open(browser, loop, scheme);
  await page.evaluate("O.seek(0)");
  const file = path.join(OUT, `${loop.name}-${scheme}.png`);
  await page.screenshot({ path: file });
  const length = await page.evaluate("O.LENGTH");
  await page.close();
  keep(file, (a, b) => readFileSync(a).equals(readFileSync(b)));
  return length;
}

/**
 * Renders one span of frames to a segment, in a browser of its own, so
 * the spans are drawn at the same time.
 */
async function segment(loop, scheme, from, to, file, drawn) {
  const browser = await chromium.launch(CHROMIUM);
  const page = await open(browser, loop, scheme);
  // The frames are sRGB, and are turned into video with the BT.709
  // matrix the file is labelled with.
  const { run, closed } = ffmpeg(
    ["-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", file],
    "pipe",
  );
  for (let frame = from; frame < to; frame += 1) {
    await page.evaluate(`O.seek(${frame / FPS})`);
    const png = await page.screenshot({ type: "png" });
    if (!run.stdin.write(png)) await new Promise((resolve) => run.stdin.once("drain", resolve));
    drawn();
  }
  run.stdin.end();
  await closed;
  await browser.close();
}

/** Renders one scheme's clip, and fails when it is too big to be right. */
async function clip(loop, scheme, length) {
  rmSync(SEGMENTS, { recursive: true, force: true });
  mkdirSync(SEGMENTS, { recursive: true });
  const frames = Math.round(length * FPS);
  const per = Math.ceil(frames / WORKERS);
  say(`${loop.name}-${scheme}: ${frames} frames on ${WORKERS} workers`);
  let done = 0;
  const drawn = () => {
    done += 1;
    if (done % 150 === 0) say(`${done}/${frames}`);
  };
  const spans = [];
  for (let from = 0; from < frames; from += per) {
    const name = `${String(spans.length).padStart(2, "0")}.mp4`;
    spans.push({ name, from, to: Math.min(frames, from + per) });
  }
  await Promise.all(
    spans.map(({ name, from, to }) => segment(loop, scheme, from, to, path.join(SEGMENTS, name), drawn)),
  );
  const list = path.join(SEGMENTS, "list.txt");
  writeFileSync(list, spans.map(({ name }) => `file '${name}'`).join("\n"));
  const master = path.join(OUT, `${loop.name}-${scheme}-master.mp4`);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-an", "-c:v", "copy", "-movflags", "+faststart", master]).closed;
  rmSync(SEGMENTS, { recursive: true, force: true });

  const mp4 = path.join(OUT, `${loop.name}-${scheme}.mp4`);
  // A browser reads a clip labelled with BT.709's own curve darker in
  // the shadows than the page around it, so the clip is labelled with
  // the sRGB curve to match the pictures.
  await ffmpeg(["-i", master, "-an", "-c:v", "libx264", "-profile:v", "high", "-preset", "veryslow", "-crf", "28", "-pix_fmt", "yuv420p",
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1",
    "-g", String(FPS * 2), "-movflags", "+faststart", mp4]).closed;
  rmSync(master);
  const size = statSync(mp4).size;
  say(`${mp4}  ${(size / 1024 / 1024).toFixed(2)} MB`);
  if (size > MOST) throw new Error(`${mp4} is over ${MOST / 1024 / 1024} MB`);
  keep(mp4, (a, b) => likeness(a, b) >= SAME);
}

const loops = LOOPS.filter((loop) => only === undefined || loop.device === only);
if (loops.length === 0) throw new Error(`no device ${only}: ${LOOPS.map((loop) => loop.device).join(", ")}`);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(CHROMIUM);
const clips = [];
for (const loop of loops) {
  for (const scheme of Object.keys(loop.frames)) {
    clips.push({ loop, scheme, length: await poster(browser, loop, scheme) });
  }
}
await browser.close();

if (!postersOnly) {
  for (const { loop, scheme, length } of clips) await clip(loop, scheme, length);
}
