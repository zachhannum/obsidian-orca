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

/**
 * The surface at one width and one moment, as an SVG path.
 *
 * The dip in the middle is a bell rather than a wave, so the surface
 * falls away under the title and rises at both edges. Two swells of
 * different lengths run across it in opposite directions, and a slow
 * breath opens and closes the dip.
 */
export function seaPath(wave: Wave, width: number, t: number): string {
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
    const y =
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

/**
 * Moves the surface until the page is closed. With reduced motion on it
 * draws the surface once and leaves it there.
 */
export function startSea(svg: SVGSVGElement): () => void {
  const paths = [...svg.querySelectorAll<SVGPathElement>('path[data-kind]')];
  const waves = paths.map(waveOf);
  let width = 0;

  const draw = (t: number) => {
    const measured = Math.round(svg.getBoundingClientRect().width);
    if (measured !== width && measured > 0) {
      width = measured;
      svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(LIP)}`);
    }
    paths.forEach((path, at) => {
      path.setAttribute('d', seaPath(waves[at] as Wave, width || 1440, t));
    });
  };

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  const start = performance.now();
  const tick = (now: number) => {
    draw((now - start) / 1000);
    frame = requestAnimationFrame(tick);
  };

  const settle = () => {
    cancelAnimationFrame(frame);
    if (still.matches) draw(0);
    else frame = requestAnimationFrame(tick);
  };
  settle();
  still.addEventListener('change', settle);
  window.addEventListener('resize', settle);
  return () => {
    cancelAnimationFrame(frame);
    still.removeEventListener('change', settle);
    window.removeEventListener('resize', settle);
  };
}
