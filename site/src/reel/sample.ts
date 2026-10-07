import type { Over, ScrollOver, SlideOver, Timeline, Track, TypeOver } from './compile';
import { EASE, clamp, env, keys, lerp, prog, type Point } from './ease';
import type { Box } from './take';

/**
 * The stage's shape. A `wide` stage shows the whole window. A `narrow`
 * one shows part of it, through a camera.
 */
export type View = 'wide' | 'narrow';

/** The scale the narrow view draws the window at. */
export const NARROW = 0.8;

/** The widest a stage is, in CSS pixels, while it is narrow. */
export const NARROW_BELOW = 640;

/**
 * The view a stage of a given width shows a window in. A window that is
 * itself under the narrow width is a phone's, and shows whole at every
 * width.
 */
export const viewOf = (window: { w: number }, stageWidth: number): View =>
  stageWidth < NARROW_BELOW && window.w >= NARROW_BELOW ? 'narrow' : 'wide';

/** One frame on screen. `crop` moves with the frame, and `within` stays where the window is. */
export interface Layer {
  frame: string;
  opacity: number;
  /** A CSS clip path, in pixels of the window. */
  crop?: string;
  within?: string;
  move?: Point;
}

/** The whole picture at one time, back to front. */
export interface Drawn {
  layers: Layer[];
  /** Boxes in the editor's ground colour, over every layer. */
  covers: Box[];
  /** Boxes in the take's shade, over the frames and under nothing else. */
  shades: (Box & { opacity: number })[];
  caret: { x: number; y: number; h: number; opacity: number } | null;
  pointer: { x: number; y: number; opacity: number; press: number; touch: boolean } | null;
  ring: { x: number; y: number; scale: number; opacity: number } | null;
  /** The point of the window the narrow view centres on. A wide view has none. */
  camera: { x: number; y: number; scale: number } | null;
}

const px = (n: number): string => `${(Math.round(n * 100) / 100).toString()}px`;

/** A clip path that keeps a box of the window. */
const inset = (box: Box, window: { w: number; h: number }): string =>
  `inset(${px(box.y)} ${px(window.w - box.x - box.w)} ${px(window.h - box.y - box.h)} ${px(box.x)})`;

/**
 * The width of each row that is typed by a time, when the rows are
 * typed left to right over `[a, b]`, and the caret's place and height.
 */
export function typed(rows: readonly Box[], t: number, a: number, b: number): { shown: number[]; caret: [number, number, number] } {
  const total = rows.reduce((sum, row) => sum + row.w, 0);
  let left = prog(t, a, b) * total;
  let caret: [number, number, number] | null = null;
  const shown = rows.map((row) => {
    const width = clamp(left, 0, row.w);
    left -= row.w;
    if (width > 0 || caret === null) caret = [row.x + width, row.y, row.h];
    return width;
  });
  const first = rows[0];
  if (first === undefined) throw new Error('typing has no row');
  if (t < a) caret = [first.x, first.y, first.h];
  return { shown, caret: caret ?? [first.x, first.y, first.h] };
}

/** The typed width of every row of a typing, and the caret, which waits at the end of a run for the next. */
export function typing(over: TypeOver, t: number): { shown: number[]; caret: [number, number, number] | null } {
  const shown = over.rows.map(() => 0);
  let caret: [number, number, number] | null = null;
  let done = -Infinity;
  for (const [a, b, i, j] of over.spans) {
    const part = typed(over.rows.slice(i, j), t, a, b);
    part.shown.forEach((width, k) => (shown[i + k] = width));
    if (t >= a - 0.4 && t >= done) caret = part.caret;
    done = b;
  }
  return { shown, caret };
}

/** A clip path that keeps the typed part of each row. */
function reveal(rows: readonly Box[], shown: readonly number[]): string {
  const pad = 5;
  let d = '';
  rows.forEach((row, i) => {
    const width = shown[i] ?? 0;
    if (width <= 0) return;
    const across = width + pad * (width >= row.w ? 2 : 1);
    d += `M${String(row.x - pad)} ${String(row.y - pad)}h${String(across)}v${String(row.h + pad * 2)}h${String(-across)}Z`;
  });
  return d === '' ? 'inset(50%)' : `path('${d}')`;
}

function drawType(over: TypeOver, t: number, timeline: Timeline, drawn: Drawn): void {
  const { shown, caret } = typing(over, t);
  if (t < over.b) {
    if (over.how === 'reveal') {
      drawn.layers.push({ frame: over.frame, opacity: 1, crop: reveal(over.rows, shown) });
    } else if (over.box !== null) {
      const box = over.box;
      drawn.layers.push({ frame: over.frame, opacity: 1, crop: inset(box, timeline.window) });
      // A row not yet typed is covered from its last letter, or from the gutter.
      over.rows.forEach((row, i) => {
        const width = shown[i] ?? 0;
        if (width >= row.w) return;
        const x = width > 0 ? row.x + width : box.x + 2;
        drawn.covers.push({ x, y: row.y - 3, w: box.x + box.w - 3 - x, h: row.h + 7 });
      });
    }
  }
  if (caret !== null && t < over.caretEnd) {
    const blinked = t > over.stop && Math.floor((t - over.stop) * 2.4) % 2 === 1;
    drawn.caret = { x: caret[0] + 1, y: caret[1] - 2, h: caret[2] + 4, opacity: blinked ? 0 : 1 };
  }
}

function drawScroll(over: ScrollOver, t: number, timeline: Timeline, drawn: Drawn): void {
  const first = over.frames[0];
  const last = over.frames[over.frames.length - 1];
  if (first === undefined || last === undefined) return;
  const at = lerp(first.scroll, last.scroll, EASE.inOutCubic(prog(t, over.a, over.b)));
  const clip = inset(over.box, timeline.window);
  // Each frame holds its own picture of what lies over the box, which
  // is cut out of it so that it does not scroll past.
  const rect = (box: Box): string => `M${String(box.x)} ${String(box.y)}h${String(box.w)}v${String(box.h)}h${String(-box.w)}Z`;
  const crop = over.fixed.length === 0 ? clip : `path(evenodd, '${[over.box, ...over.fixed].map(rect).join('')}')`;
  for (const { frame, scroll } of over.frames) {
    drawn.layers.push({ frame, opacity: 1, crop, within: clip, move: [0, scroll - at] });
  }
  for (const box of over.fixed) drawn.layers.push({ frame: first.frame, opacity: 1, crop: inset(box, timeline.window) });
}

function drawSlide(over: SlideOver, t: number, timeline: Timeline, drawn: Drawn): void {
  const k = EASE[over.ease](prog(t, over.a, over.b));
  // A box that comes in starts a whole step away, and one that leaves ends there.
  const away = over.out ? k : 1 - k;
  const under = drawn.layers[drawn.layers.length - 1];
  if (over.push && under !== undefined) {
    const back = over.out ? -(1 - k) : -k;
    under.move = [over.by[0] * back, over.by[1] * back];
  }
  if (over.dim !== null) {
    drawn.layers.push({ frame: over.frame, opacity: k, crop: inset(over.dim, timeline.window) });
    // The ground between the shaded part and the box, which the box has yet to cover.
    const { box, by } = over;
    const gap = { w: Math.abs(by[0]) * away, h: Math.abs(by[1]) * away };
    if (by[0] !== 0) drawn.shades.push({ x: by[0] > 0 ? box.x : box.x + box.w - gap.w, y: box.y, w: gap.w, h: box.h, opacity: k });
    else drawn.shades.push({ x: box.x, y: by[1] > 0 ? box.y : box.y + box.h - gap.h, w: box.w, h: gap.h, opacity: k });
  }
  drawn.layers.push({
    frame: over.frame,
    opacity: 1,
    crop: inset(over.box, timeline.window),
    move: [over.by[0] * away, over.by[1] * away],
  });
}

function drawOver(over: Over, t: number, timeline: Timeline, drawn: Drawn): void {
  if (over.kind === 'type') {
    if (t >= over.a && t < Math.max(over.b, over.caretEnd)) drawType(over, t, timeline, drawn);
  } else if (over.kind === 'scroll') {
    if (t >= over.a && t < over.b) drawScroll(over, t, timeline, drawn);
  } else if (t >= over.a && t < over.b + over.held) {
    drawSlide(over, t, timeline, drawn);
  }
}

/** A finger shows while it is on the glass: around each tap, or for the length of a drag. */
function touching(t: number, track: Track): number {
  if (track.clicks.length === 0) return env(t, track.a, track.b, 0.1, 0.14);
  return Math.max(...track.clicks.map((c) => env(t, c - 0.12, c + 0.24, 0.08, 0.16)));
}

function drawPointer(t: number, timeline: Timeline, drawn: Drawn): void {
  const on = timeline.tracks.filter((track) => t >= track.a && t <= track.b);
  // A finger that has just landed is the one on the glass.
  const track = on.sort((p, q) => q.a - p.a)[0];
  if (track === undefined) return;
  const [x, y] = keys(t, track.keys);
  let press = 1;
  for (const c of track.clicks) {
    const d = t - c;
    if (d > -0.08 && d < 0.14) press = Math.min(press, 1 - 0.18 * Math.sin(prog(d, -0.08, 0.14) * Math.PI));
    if (d >= 0 && d < 0.5) {
      const k = d / 0.5;
      drawn.ring = { x, y, scale: 0.3 + EASE.outCubic(k) * 0.9, opacity: (1 - k) * 0.9 };
    }
  }
  const opacity = track.touch ? touching(t, track) : env(t, track.a, track.b, 0.3, 0.3);
  drawn.pointer = { x, y, opacity, press, touch: track.touch };
}

/**
 * The picture a reel shows at a time. It reads the timeline and
 * nothing else, so a time draws the same in the page and in a test.
 */
export function sample(timeline: Timeline, time: number, view: View): Drawn {
  const t = clamp(time, 0, Math.max(0, timeline.length - 1e-6));
  const drawn: Drawn = { layers: [], covers: [], shades: [], caret: null, pointer: null, ring: null, camera: null };

  // The last frame to have faded in whole is the ground, and each
  // frame brought up after it fades in over it.
  const started = timeline.cuts.filter((cut) => t >= cut.t);
  const shown = started.map((cut) => EASE[cut.ease](prog(t, cut.t, cut.t + cut.fade)));
  const ground = shown.lastIndexOf(1);
  const base = started[ground];
  if (base !== undefined) drawn.layers.push({ frame: base.frame, opacity: 1 });
  for (const over of timeline.overs) drawOver(over, t, timeline, drawn);
  started.forEach((cut, i) => {
    const opacity = shown[i] ?? 0;
    if (i > ground && opacity > 0) drawn.layers.push({ frame: cut.frame, opacity });
  });

  drawPointer(t, timeline, drawn);
  if (view === 'narrow') {
    const [x, y] = keys(t, timeline.camera);
    drawn.camera = { x, y, scale: NARROW };
  }
  return drawn;
}

/**
 * The scale and the offset that put the window in a stage of a given
 * size. A wide view fits the window to the stage's width. A narrow
 * view centres the camera, and stops at the window's edges.
 */
export function place(
  camera: Drawn['camera'],
  window: { w: number; h: number },
  stage: { w: number; h: number }
): { scale: number; x: number; y: number } {
  if (camera === null) return { scale: stage.w / window.w, x: 0, y: 0 };
  const { scale } = camera;
  return {
    scale,
    x: clamp(stage.w / 2 - camera.x * scale, Math.min(0, stage.w - window.w * scale), 0),
    y: clamp(stage.h / 2 - camera.y * scale, Math.min(0, stage.h - window.h * scale), 0),
  };
}
