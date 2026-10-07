import { keys, type Ease, type Key, type Point } from './ease';
import { sample } from './sample';
import type { At, Scene, Side } from './scene';
import { frameOf, markOf, mid, type Box, type Take } from './take';

/** A frame that comes up at `t` and fades in over the frames before it. */
export interface Cut {
  t: number;
  frame: string;
  fade: number;
  ease: Ease;
}

/** Typing in one frame. The frame shows over `[a, b)`, and the caret until `caretEnd`. */
export interface TypeOver {
  kind: 'type';
  a: number;
  b: number;
  caretEnd: number;
  /** The time the last row is typed, after which the caret blinks. */
  stop: number;
  frame: string;
  how: 'reveal' | 'cover';
  rows: Box[];
  /** Each run as the time it starts, the time it ends, its first row and the row after its last. */
  spans: [number, number, number, number][];
  /** The editor a `cover` fills. */
  box: Box | null;
}

/** A strip of frames, each placed at the offset it was taken at, seen through `box`. */
export interface ScrollOver {
  kind: 'scroll';
  a: number;
  b: number;
  box: Box;
  frames: { frame: string; scroll: number }[];
}

/** A box of `frame` that moves by up to `by`, which is its own width or height. */
export interface SlideOver {
  kind: 'slide';
  a: number;
  b: number;
  frame: string;
  box: Box;
  by: Point;
  out: boolean;
  push: boolean;
  /** The part of the frame outside the box, which fades in with it. */
  dim: Box | null;
}

export type Over = TypeOver | ScrollOver | SlideOver;

/** One stretch of the pointer on screen, from `a` to `b`. */
export interface Track {
  a: number;
  b: number;
  keys: Key[];
  clicks: number[];
  touch: boolean;
}

/**
 * A scene with every time and every box worked out. It is plain data,
 * so the page carries it as JSON and `sample` draws from it alone.
 */
export interface Timeline {
  id: string;
  take: string;
  window: { w: number; h: number };
  length: number;
  still: number;
  /** The one frame that shows at the still time. */
  stillFrame: string;
  /** Every frame the reel shows, in the order it first needs them. */
  frames: string[];
  /** Each frame with the span of time it is on screen for. */
  uses: [string, number, number][];
  cuts: Cut[];
  overs: Over[];
  tracks: Track[];
  /** The centre of the narrow view. */
  camera: Key[];
  clicks: number[];
}

/**
 * The farthest a click can be from the centre of the narrow view, across
 * and down. It is inside half of what a stage 320 pixels wide shows.
 */
const REACH: Point = [170, 215];

/** The seconds the last frame takes to fade into the first. */
export const SEAM = 0.8;

const OFFSET: Record<Side, (box: Box) => Point> = {
  left: (box) => [-box.w, 0],
  right: (box) => [box.w, 0],
  top: (box) => [0, -box.h],
  bottom: (box) => [0, box.h],
};

/** The part of the window on the far side of a box from the side it came from. */
function beyond(side: Side, box: Box, window: { w: number; h: number }): Box {
  if (side === 'left') return { x: box.x + box.w, y: 0, w: window.w - box.x - box.w, h: window.h };
  if (side === 'right') return { x: 0, y: 0, w: box.x, h: window.h };
  if (side === 'top') return { x: 0, y: box.y + box.h, w: window.w, h: window.h - box.y - box.h };
  return { x: 0, y: 0, w: window.w, h: box.y };
}

const same = (p: Point, q: Point): boolean => p[0] === q[0] && p[1] === q[1];

/**
 * Works a scene out against its take. Throws when the scene names a
 * frame, a mark or a row the take does not have, when the pointer
 * leaves the window, and when the still time shows more than one frame.
 */
export function compile(scene: Scene, take: Take): Timeline {
  const { w, h } = take.window;
  const fail = (said: string): never => {
    throw new Error(`scene ${scene.id}: ${said}`);
  };
  const point = (frame: string, at: At): Point => (typeof at === 'string' ? mid(take, frame, at) : at);

  frameOf(take, scene.first);
  const cuts: Cut[] = [{ t: 0, frame: scene.first, fade: 0, ease: 'linear' }];
  const overs: Over[] = [];
  const tracks: Track[] = [];
  const clicks: number[] = [];
  const camera: Key[] = [];
  let t = 0;
  let base = scene.first;
  let pointer: Track | null = null;
  let at: Point = [w / 2, h / 2];

  /** The point the narrow view centres on for a click, which keeps the target in the narrowest stage. */
  const aimed = (target: Point, aim: Point | undefined): Point => {
    if (aim === undefined) return target;
    if (Math.abs(aim[0]) > REACH[0] || Math.abs(aim[1]) > REACH[1]) {
      fail(`an aim of ${String(aim[0])}, ${String(aim[1])} puts the click outside the narrow view`);
    }
    return [target[0] + aim[0], target[1] + aim[1]];
  };

  const key = (track: Track, time: number, to: Point): void => {
    const last = track.keys[track.keys.length - 1];
    if (last !== undefined && time < last[0]) fail(`a pointer key at ${String(time)} is before the one at ${String(last[0])}`);
    if (last !== undefined && time === last[0]) track.keys.pop();
    track.keys.push([time, to]);
  };

  /** Turns the narrow view to a point over a span, from wherever it is at the start. */
  const turn = (from: number, to: number, target: Point): void => {
    if (camera.length === 0 || from <= 0) {
      camera.length = 0;
      camera.push([0, target]);
      if (to > 0) camera.push([to, target]);
      return;
    }
    const here = keys(from, camera);
    while (camera.length > 0 && (camera[camera.length - 1]?.[0] ?? -1) >= from) camera.pop();
    camera.push([from, here], [Math.max(to, from + 0.01), target]);
  };

  const bring = (time: number, frame: string, fade: number, ease: Ease): void => {
    frameOf(take, frame);
    cuts.push({ t: time, frame, fade, ease });
    base = frame;
  };

  for (const beat of scene.beats) {
    if (beat.kind === 'hold') {
      t += beat.seconds;
      if (t < 0) fail('an overlap reaches back before the start');
    } else if (beat.kind === 'cut') {
      bring(t, beat.frame, beat.fade, beat.ease);
      t += beat.fade;
    } else if (beat.kind === 'look') {
      turn(t, t + beat.over, point(beat.frame, beat.at));
    } else if (beat.kind === 'click') {
      const target = point(beat.frame, beat.at);
      if (pointer === null) {
        const before = tracks.findLast((track) => !track.touch);
        if (before !== undefined && before.b > t) {
          fail(`the pointer comes in at ${t.toFixed(2)} while it is leaving until ${before.b.toFixed(2)}`);
        }
        at = beat.from ?? [Math.min(w - 20, target[0] + 140), Math.min(h - 20, target[1] + 110)];
        pointer = { a: t, b: t, keys: [[t, at]], clicks: [], touch: false };
        tracks.push(pointer);
      }
      const move = same(at, target) ? 0 : (beat.move ?? 0.6);
      const landed = t + move;
      const clicked = landed + (beat.dwell ?? 0.3);
      key(pointer, t, at);
      key(pointer, landed, target);
      pointer.clicks.push(clicked);
      clicks.push(clicked);
      turn(t, move > 0 ? landed : clicked, aimed(target, beat.aim));
      at = target;
      t = clicked + (beat.rest ?? 0.12);
      key(pointer, t, at);
      pointer.b = t;
      if (beat.then !== undefined) bring(clicked + (beat.lag ?? 0.06), beat.then, beat.fade ?? 0.14, beat.ease ?? 'outQuad');
      if (beat.look !== undefined) turn(clicked + 0.2, clicked + 0.7, point(beat.then ?? beat.frame, beat.look));
    } else if (beat.kind === 'tap') {
      const target = point(beat.frame, beat.at);
      const tapped = t + (beat.dwell ?? 0.3);
      tracks.push({ a: tapped - 0.2, b: tapped + 0.5, keys: [[tapped - 0.2, target], [tapped + 0.5, target]], clicks: [tapped], touch: true });
      clicks.push(tapped);
      turn(t, tapped, aimed(target, beat.aim));
      t = tapped + (beat.rest ?? 0.12);
      if (beat.then !== undefined) bring(tapped + (beat.lag ?? 0.06), beat.then, beat.fade ?? 0.14, beat.ease ?? 'outQuad');
      if (beat.look !== undefined) turn(tapped + 0.2, tapped + 0.7, point(beat.then ?? beat.frame, beat.look));
    } else if (beat.kind === 'leave') {
      if (pointer === null) fail('a leave has no pointer to send off');
      else {
        key(pointer, t, at);
        key(pointer, t + beat.over, [at[0] + beat.by[0], at[1] + beat.by[1]]);
        pointer.b = t + beat.over;
        pointer = null;
      }
    } else if (beat.kind === 'drag') {
      const a = t - 0.12;
      const b = t + beat.over + 0.16;
      tracks.push({ a, b, keys: [[a, beat.from], [t, beat.from], [t + beat.over, beat.to], [b, beat.to]], clicks: [], touch: true });
      t += beat.over;
    } else if (beat.kind === 'type') {
      const all = frameOf(take, beat.frame).rows ?? [];
      const first = beat.first ?? 0;
      const how = beat.how ?? 'reveal';
      const spans: [number, number, number, number][] = [];
      let row = first;
      let u = t;
      for (const [count, seconds, wait] of beat.runs) {
        u += wait ?? 0;
        spans.push([u, u + seconds, row - first, row - first + count]);
        u += seconds;
        row += count;
      }
      if (spans.length === 0) fail(`the typing in ${beat.frame} has no run`);
      if (row > all.length) fail(`the typing asks for ${String(row)} rows of ${beat.frame}, which has ${String(all.length)}`);
      overs.push({
        kind: 'type',
        a: t,
        b: Infinity,
        caretEnd: Infinity,
        stop: u,
        frame: beat.frame,
        how,
        rows: all.slice(first, row),
        spans,
        box: how === 'cover' ? markOf(take, beat.frame, beat.box ?? 'code') : null,
      });
      t = u;
    } else if (beat.kind === 'scroll') {
      const first = beat.frames[0];
      const last = beat.frames[beat.frames.length - 1];
      if (first === undefined || last === undefined || beat.frames.length < 2) {
        fail('a scroll needs the frame it starts on and the one it ends on');
      } else {
        const frames = beat.frames.map((frame) => {
          const scroll = frameOf(take, frame).scroll;
          return { frame, scroll: scroll ?? fail(`frame ${frame} has no scroll offset`) };
        });
        overs.push({ kind: 'scroll', a: t, b: t + beat.over, box: markOf(take, first, beat.box), frames });
        t += beat.over;
        bring(t, last, 0, 'linear');
      }
    } else {
      const over = beat.over ?? 0.4;
      const out = beat.out === true;
      // A box that leaves is a box of the frame on screen.
      const moved = out ? base : beat.frame;
      const box = markOf(take, moved, beat.box);
      overs.push({
        kind: 'slide',
        a: t,
        b: t + over,
        frame: moved,
        box,
        by: OFFSET[beat.from](box),
        out,
        push: beat.push === true,
        dim: beat.dim === true && !out ? beyond(beat.from, box, take.window) : null,
      });
      bring(out ? t : t + over, beat.frame, 0, 'linear');
      t += over;
    }
  }

  const length = t;
  cuts.sort((p, q) => p.t - q.t);
  const lastCut = cuts[cuts.length - 1] ?? { t: 0, fade: 0 };
  if (length - SEAM < lastCut.t + lastCut.fade) fail(`the reel is ${length.toFixed(2)} seconds, too short to fade back after its last frame`);
  cuts.push({ t: length - SEAM, frame: scene.first, fade: SEAM - 1 / 30, ease: 'inOutQuad' });

  for (const over of overs) {
    if (over.kind !== 'type') continue;
    const next = cuts.find((cut) => cut.t >= over.a);
    const other = cuts.find((cut) => cut.t >= over.a && cut.frame !== over.frame);
    over.b = next === undefined ? length : next.t + next.fade;
    over.caretEnd = other === undefined ? length : other.t;
  }

  for (const track of tracks) {
    if (track === pointer) track.b = length;
    if (track.a < 0 || track.b > length) fail(`a pointer is on screen from ${track.a.toFixed(2)} to ${track.b.toFixed(2)}`);
    for (const [, [x, y]] of track.keys) {
      if (x < 0 || x > w || y < 0 || y > h) fail(`the pointer goes to ${String(x)}, ${String(y)}, outside the window`);
    }
  }

  if (camera.length === 0) camera.push([0, [w / 2, h / 2]]);
  // The view is back where it starts by the time the first frame is.
  turn(length - SEAM, length, camera[0]?.[1] ?? [w / 2, h / 2]);

  // A frame is on screen from its cut until a later cut has faded in whole.
  const uses: [string, number, number][] = cuts.map((cut, i) => {
    const hidden = cuts.slice(i + 1).map((later) => later.t + later.fade);
    return [cut.frame, cut.t, Math.min(length, ...hidden)];
  });
  for (const over of overs) {
    if (over.kind === 'scroll') for (const { frame } of over.frames) uses.push([frame, over.a, over.b]);
    else uses.push([over.frame, over.a, over.b]);
  }
  uses.sort((p, q) => p[1] - q[1]);

  const timeline: Timeline = {
    id: scene.id,
    take: scene.take,
    window: { w, h },
    length,
    still: scene.still,
    stillFrame: scene.first,
    frames: [...new Set(uses.map(([frame]) => frame))],
    uses,
    cuts,
    overs,
    tracks,
    camera,
    clicks: clicks.sort((p, q) => p - q),
  };

  if (!(scene.still >= 0 && scene.still < length)) fail(`the still time ${String(scene.still)} is outside the reel`);
  const still = sample(timeline, scene.still, 'wide');
  const [only] = still.layers;
  if (only === undefined || still.layers.length !== 1 || only.opacity < 1 || only.crop !== undefined || only.move !== undefined) {
    fail(`the still time ${String(scene.still)} shows more than one whole frame`);
  } else {
    timeline.stillFrame = only.frame;
  }
  return timeline;
}
