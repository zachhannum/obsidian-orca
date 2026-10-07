export type Point = readonly [number, number];

/** A point at a time. A track of them is eased from one to the next. */
export type Key = readonly [number, Point];

export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** The share of the span from `a` to `b` that `t` has passed, held to 0 and 1. */
export const prog = (t: number, a: number, b: number): number => {
  if (b > a) return clamp((t - a) / (b - a));
  return t >= b ? 1 : 0;
};

export const EASE = {
  linear: (x: number): number => x,
  outQuad: (x: number): number => 1 - (1 - x) * (1 - x),
  inOutQuad: (x: number): number => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  inCubic: (x: number): number => x * x * x,
  outCubic: (x: number): number => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
};

export type Ease = keyof typeof EASE;

/** Fades in over `[a, a + din]` and out over `[b - dout, b]`. */
export const env = (t: number, a: number, b: number, din: number, dout: number): number =>
  Math.min(EASE.outCubic(prog(t, a, a + din)), 1 - EASE.inCubic(prog(t, b - dout, b)));

/**
 * The point of a track at a time. The track holds its first point
 * before it starts and its last point after it ends.
 */
export function keys(t: number, track: readonly Key[]): Point {
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) throw new Error('a track has no key');
  if (t <= first[0]) return first[1];
  for (let i = 0; i < track.length - 1; i++) {
    const [t0, v0] = track[i] as Key;
    const [t1, v1] = track[i + 1] as Key;
    if (t <= t1) {
      const k = EASE.inOutCubic(prog(t, t0, t1));
      return [lerp(v0[0], v1[0], k), lerp(v0[1], v1[1], k)];
    }
  }
  return last[1];
}
