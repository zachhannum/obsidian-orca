/**
 * The sea the landing page sits in. One surface, drawn as three paths:
 * two lines above a filled body. The page below the surface is painted
 * by CSS, so this draws the lip alone.
 *
 * The path is computed in css pixels at the width the page is being
 * read at, so the swell keeps its height as the window narrows.
 */

/** The height of the lip, which is the band the surface moves inside. */
export const LIP = 140;

/** The line the surface rests on, measured down from the top of the lip. */
export const REST = 72;

/**
 * The points the surface is sampled at. A ripple is short, so the
 * samples sit closer than one of its wavelengths.
 */
const SAMPLES = 96;

const TAU = Math.PI * 2;

/** One path of the surface: how far under the rest line, and how far behind. */
export interface Wave {
  /** The offset from the rest line, in pixels. Negative is higher. */
  off: number;
  /** The seconds this path runs behind the one under it. */
  lag: number;
  /** A line is stroked along the surface; a body is filled below it. */
  kind: 'line' | 'body';
}

/** The pointer's press on the surface at one moment. */
export interface Touch {
  /** Where the pointer is across the lip, in pixels. */
  x: number;
  /** How hard it presses, from 0 at rest to 1 at a fast sweep. */
  force: number;
}

/** One place the pointer went through the surface. */
export interface Ripple {
  /** Where it went through, in pixels across the lip. */
  x: number;
  /** When, in the seconds the surface is drawn at. */
  t: number;
  /** How hard, from 1 for a fast plunge to a negative pull on the way out. */
  strength: number;
}

/** The depth of the trough under the pointer at full force, before scaling. */
const PRESS = 14;

/** The depth of a full plunge at the point of entry, before scaling. */
const SPLASH = 26;

/** The seconds a ripple lasts before it is dropped. */
const RIPPLE_LIFE = 4;

/** The resting surface's scale and shape at one width. */
function shape(width: number) {
  // The swell holds its height on a wide window and eases off on a
  // narrow one, where the same height would read as a storm.
  const scale = Math.min(1, Math.max(0.45, width / 1440));
  return {
    scale,
    dip: 30 * scale,
    centre: 0.68 * width,
    spread: 0.36 * width,
    long: { length: 0.48 * width, period: 8, height: 9 * scale },
    short: { length: 0.18 * width, period: 5, height: 4 * scale },
  };
}

/**
 * The height of the surface at one point, in pixels down from the top of
 * the lip.
 *
 * The dip in the middle is a bell rather than a wave, so the surface
 * falls away under the title and rises at both edges. Two swells of
 * different lengths run across it in opposite directions, and a slow
 * breath opens and closes the dip. A touch presses a narrow trough into
 * the surface. A ripple sinks where it went in, bobs back, and sends a
 * ring out to each side that fades as it travels.
 */
export function surfaceAt(
  wave: Wave,
  width: number,
  t: number,
  x: number,
  touch?: Touch,
  ripples: readonly Ripple[] = [],
): number {
  const { scale, dip, centre, spread, long, short } = shape(width);
  const at = t - wave.lag;
  const breath = 1 + 0.06 * Math.sin((TAU * at) / 13);
  const bell = Math.exp(-(((x - centre) / spread) ** 2));
  let y =
    REST -
    dip * bell * breath +
    long.height * Math.sin(TAU * (x / long.length - at / long.period)) +
    short.height * Math.sin(TAU * (x / short.length + at / short.period)) +
    wave.off;

  if (touch !== undefined && touch.force > 0) {
    y += PRESS * scale * touch.force * Math.exp(-(((x - touch.x) / (0.05 * width)) ** 2));
  }

  const core = 42 * scale;
  const wavelength = 80 * scale;
  const speed = 240 * scale;
  // A ripple starts when the pointer crosses this path, so it keeps
  // its own clock rather than the path's lag.
  for (const ripple of ripples) {
    const age = t - ripple.t;
    if (age < 0 || age > RIPPLE_LIFE) continue;
    const d = Math.abs(x - ripple.x);
    const sink = Math.exp(-((d / core) ** 2)) * Math.exp(-age / 0.6) * Math.cos((TAU * age) / 0.9);
    const front = speed * age;
    const ring =
      Math.min(1, front / wavelength) *
      Math.exp(-(((d - front) / wavelength) ** 2)) *
      Math.exp(-age / 1.3) *
      -Math.sin((TAU * (d - front)) / wavelength);
    y += SPLASH * scale * ripple.strength * (sink + 0.6 * ring);
  }
  return y;
}

/** The surface at one width and one moment, as an SVG path. */
export function seaPath(
  wave: Wave,
  width: number,
  t: number,
  touch?: Touch,
  ripples: readonly Ripple[] = [],
): string {
  const step = width / SAMPLES;
  const points: [number, number][] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const x = i * step;
    points.push([x, surfaceAt(wave, width, t, x, touch, ripples)]);
  }

  const round = (value: number) => value.toFixed(1);
  const point = (i: number) => points[Math.min(Math.max(i, 0), SAMPLES)] as [number, number];
  let path = `M0 ${round(point(0)[1])}`;
  for (let i = 0; i < SAMPLES; i += 1) {
    const [ax, ay] = point(i - 1);
    const [bx, by] = point(i);
    const [cx, cy] = point(i + 1);
    const [dx, dy] = point(i + 2);
    path +=
      `C${round(bx + (cx - ax) / 6)} ${round(by + (cy - ay) / 6)}` +
      ` ${round(cx - (dx - bx) / 6)} ${round(cy - (dy - by) / 6)}` +
      ` ${round(cx)} ${round(cy)}`;
  }
  return wave.kind === 'line' ? path : `${path}V${String(LIP)}H0Z`;
}

/** Reads one path's wave out of the attributes the markup carries. */
function waveOf(path: SVGPathElement): Wave {
  return {
    off: Number(path.dataset['off'] ?? 0),
    lag: Number(path.dataset['lag'] ?? 0),
    kind: path.dataset['kind'] === 'line' ? 'line' : 'body',
  };
}

/** The force a mouse resting under the surface keeps, out of 1. */
const HOVER = 0.4;

/** The pixels past the surface a mouse must go before it counts as in or out. */
const MARGIN = 4;

/** The pixels under the rest line over which a mouse stops holding a trough. */
const DEPTH = 320;

/** The most ripples moving at once. An older one gives way to a newer one. */
const MOST_RIPPLES = 8;

/**
 * Moves the surface until the page is closed. With reduced motion on it
 * draws the surface once and leaves it there.
 *
 * Each path is its own surface to the mouse. A mouse that goes down
 * through a path plunges into it: the path sinks where it went in and
 * rings spread out to both sides, deeper the faster it went. Under a
 * path the mouse holds a trough in it, deeper while it moves. Coming
 * back out pulls a smaller ripple up. A touch screen moves nothing,
 * because a finger scrolling the page is not reaching for the sea.
 */
export function startSea(svg: SVGSVGElement): () => void {
  const layers = [...svg.querySelectorAll<SVGPathElement>('path[data-kind]')].map((path) => ({
    path,
    wave: waveOf(path),
    under: false,
    touch: { x: 0, force: 0 } as Touch,
    ripples: [] as Ripple[],
  }));
  let width = 0;
  let now = 0;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = window.matchMedia('(pointer: fine)');

  let pointer: { x: number; y: number; at: number } | undefined;
  let speed = 0;

  const draw = (t: number, live: boolean) => {
    const measured = Math.round(svg.getBoundingClientRect().width);
    if (measured !== width && measured > 0) {
      width = measured;
      svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(LIP)}`);
    }
    for (const layer of layers) {
      const d = live
        ? seaPath(layer.wave, width || 1440, t, layer.touch, layer.ripples)
        : seaPath(layer.wave, width || 1440, t);
      layer.path.setAttribute('d', d);
    }
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const { left, top } = svg.getBoundingClientRect();
    const next = { x: event.clientX - left, y: event.clientY - top, at: event.timeStamp };
    if (pointer !== undefined) speed += Math.hypot(next.x - pointer.x, next.y - pointer.y);

    for (const layer of layers) {
      // The path without the pointer's own marks, so a ripple passing
      // a still mouse does not count as the mouse going through.
      const surface = surfaceAt(layer.wave, width || 1440, now, next.x);
      const wasUnder = layer.under;
      if (!layer.under && next.y > surface + MARGIN) layer.under = true;
      else if (layer.under && next.y < surface - MARGIN) layer.under = false;
      if (pointer === undefined || layer.under === wasUnder) continue;

      const seconds = Math.max(0.004, (next.at - pointer.at) / 1000);
      const fall = Math.abs(next.y - pointer.y) / seconds;
      const strength = Math.min(1, 0.35 + fall / 1600);
      layer.ripples.push({ x: next.x, t: now, strength: layer.under ? strength : -0.5 * strength });
      if (layer.ripples.length > MOST_RIPPLES) layer.ripples.shift();
    }
    pointer = next;
  };

  let frame = 0;
  const start = performance.now();
  const tick = (stamp: number) => {
    const t = (stamp - start) / 1000;
    const dt = Math.min(0.1, Math.max(0, t - now));
    now = t;
    const swept = Math.min(1, speed / Math.max(1, width * 0.02));
    speed = 0;
    for (const layer of layers) {
      const { touch, ripples } = layer;
      if (pointer !== undefined) {
        // The trough trails the pointer rather than sticking to it. Its
        // force rises with the distance swept since the last frame, and
        // it fades as the pointer sinks deep. Out of the path it lets go.
        touch.x += (pointer.x - touch.x) * Math.min(1, dt * 6);
        const depth = Math.max(0, pointer.y - REST - layer.wave.off);
        const hold = Math.max(HOVER, swept) * Math.exp(-((depth / DEPTH) ** 2));
        const target = layer.under ? hold : 0;
        touch.force += (target - touch.force) * Math.min(1, dt * (target > touch.force ? 8 : 2));
      }
      while (ripples.length > 0 && (ripples[0] as Ripple).t < t - RIPPLE_LIFE) ripples.shift();
    }
    draw(t, true);
    frame = requestAnimationFrame(tick);
  };

  const settle = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onMove);
    if (still.matches) {
      draw(0, false);
      return;
    }
    if (mouse.matches) window.addEventListener('pointermove', onMove, { passive: true });
    frame = requestAnimationFrame(tick);
  };
  settle();
  still.addEventListener('change', settle);
  mouse.addEventListener('change', settle);
  window.addEventListener('resize', settle);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onMove);
    still.removeEventListener('change', settle);
    mouse.removeEventListener('change', settle);
    window.removeEventListener('resize', settle);
  };
}
