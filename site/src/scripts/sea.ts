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

/** The points the surface is sampled at. More reads as a wave, not a curve. */
const SAMPLES = 36;

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

/** The depth of the trough under the pointer at full force, before scaling. */
const PRESS = 18;

/**
 * The surface at one width and one moment, as an SVG path.
 *
 * The dip in the middle is a bell rather than a wave, so the surface
 * falls away under the title and rises at both edges. Two swells of
 * different lengths run across it in opposite directions, and a slow
 * breath opens and closes the dip. A touch presses a narrow trough into
 * the surface, downward, where the lip has room below the rest line.
 */
export function seaPath(wave: Wave, width: number, t: number, touch?: Touch): string {
  // The swell holds its height on a wide window and eases off on a
  // narrow one, where the same height would read as a storm.
  const scale = Math.min(1, Math.max(0.45, width / 1440));
  const dip = 30 * scale;
  const centre = 0.68 * width;
  const spread = 0.36 * width;
  const long = { length: 0.48 * width, period: 8, height: 9 * scale };
  const short = { length: 0.18 * width, period: 5, height: 4 * scale };

  const at = t - wave.lag;
  const breath = 1 + 0.06 * Math.sin((TAU * at) / 13);
  const step = width / SAMPLES;
  const points: [number, number][] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const x = i * step;
    const bell = Math.exp(-(((x - centre) / spread) ** 2));
    const press =
      touch === undefined
        ? 0
        : PRESS * scale * touch.force * Math.exp(-(((x - touch.x) / (0.07 * width)) ** 2));
    const y =
      press +
      REST -
      dip * bell * breath +
      long.height * Math.sin(TAU * (x / long.length - at / long.period)) +
      short.height * Math.sin(TAU * (x / short.length + at / short.period)) +
      wave.off;
    points.push([x, y]);
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

/** The seconds of touches kept, which must outlast the longest lag. */
const MEMORY = 2;

/** The force a mouse resting on the surface keeps, out of 1. */
const HOVER = 0.35;

/**
 * The pixels above the rest line over which a mouse stops reaching the
 * surface. Below the line the reach is three times as deep.
 */
const REACH = 140;

/**
 * Moves the surface until the page is closed. With reduced motion on it
 * draws the surface once and leaves it there.
 *
 * A mouse presses the surface where it crosses the page, harder the
 * faster it moves in either direction and harder the nearer it comes to
 * the rest line. A resting mouse keeps a light press. Each path reads
 * the touch from its own lag back, so the lines above follow the body.
 * A touch screen moves nothing, because a finger scrolling the page is
 * not reaching for the sea.
 */
export function startSea(svg: SVGSVGElement): () => void {
  const paths = [...svg.querySelectorAll<SVGPathElement>('path[data-kind]')];
  const waves = paths.map(waveOf);
  let width = 0;

  const draw = (t: number, touchAt: (lag: number) => Touch | undefined) => {
    const measured = Math.round(svg.getBoundingClientRect().width);
    if (measured !== width && measured > 0) {
      width = measured;
      svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(LIP)}`);
    }
    paths.forEach((path, at) => {
      const wave = waves[at] as Wave;
      path.setAttribute('d', seaPath(wave, width || 1440, t, touchAt(wave.lag)));
    });
  };

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = window.matchMedia('(pointer: fine)');

  // The pointer as last seen, and the eased touch it drives.
  let pointer: { x: number; y: number } | undefined;
  let speed = 0;
  const touch: Touch = { x: 0, force: 0 };
  const history: { t: number; touch: Touch }[] = [];

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const { left, top } = svg.getBoundingClientRect();
    const next = { x: event.clientX - left, y: event.clientY - top };
    if (pointer !== undefined) speed += Math.hypot(next.x - pointer.x, next.y - pointer.y);
    pointer = next;
  };

  const touchAt = (t: number) => (lag: number) => {
    const when = t - lag;
    const past = history.find((entry) => entry.t >= when) ?? history[history.length - 1];
    return past?.touch;
  };

  let frame = 0;
  let last = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const t = (now - start) / 1000;
    const dt = Math.min(0.1, Math.max(0, t - last));
    last = t;
    if (pointer !== undefined) {
      // The trough trails the pointer rather than sticking to it, and
      // its force rises with the distance swept since the last frame.
      touch.x += (pointer.x - touch.x) * Math.min(1, dt * 6);
      const below = pointer.y - REST;
      const reach = below < 0 ? REACH : REACH * 3;
      const near = Math.exp(-((below / reach) ** 2) * 3);
      const swept = Math.min(1, speed / Math.max(1, width * 0.02));
      const target = near * Math.max(HOVER, swept);
      touch.force += (target - touch.force) * Math.min(1, dt * (target > touch.force ? 8 : 1.5));
      speed = 0;
    }
    history.push({ t, touch: { ...touch } });
    while (history.length > 0 && (history[0] as { t: number }).t < t - MEMORY) history.shift();
    draw(t, touchAt(t));
    frame = requestAnimationFrame(tick);
  };

  const settle = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onMove);
    if (still.matches) {
      draw(0, () => undefined);
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
