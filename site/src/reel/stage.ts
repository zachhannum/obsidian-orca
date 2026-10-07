import type { Timeline } from './compile';
import { place, sample, viewOf, type View } from './sample';
import type { Paint, Scheme } from './take';

/** The JSON a stage carries: the reel, and where each frame is served in each scheme. */
export interface ReelData {
  timeline: Timeline;
  /** A take that types nothing reads no editor, and holds no colours. */
  paint: Partial<Record<Scheme, Paint>>;
  /** The colour a sheet lays over the page behind it, in each scheme. */
  shade?: Partial<Record<Scheme, string>>;
  /** Each frame at the window's own width, then at twice it. */
  frames: Record<Scheme, Record<string, [string, string]>>;
}

/** The seconds of frames a playing stage holds ahead of its time. */
const AHEAD = 3;

/** The share of a stage that is on screen before it plays. */
const IN_VIEW = 0.25;

/** The seconds of frames that must be ready for the time to move on. */
const SOON = 0.4;

const SVG = 'http://www.w3.org/2000/svg';

/** The arrow's tip and the dot's centre, in pixels of their own pictures. */
const TIP = { arrow: [9, 5], dot: [18, 18] } as const;

interface Slot {
  wrap: HTMLElement;
  img: HTMLImageElement;
}

interface Parts {
  win: HTMLElement;
  slots: Slot[];
  covers: HTMLElement[];
  shades: HTMLElement[];
  caret: HTMLElement;
  arrow: HTMLElement;
  dot: HTMLElement;
  ring: HTMLElement;
}

const px = (n: number): string => `${n.toFixed(2)}px`;

function part(name: string, into: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = name;
  el.hidden = true;
  into.append(el);
  return el;
}

function arrow(into: HTMLElement): HTMLElement {
  const el = part('reel-arrow', into);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M9 5 L9 31 L15.5 25 L20 35 L24.5 33 L20 23.5 L29 23.5 Z');
  svg.append(path);
  el.append(svg);
  return el;
}

function build(view: HTMLElement): Parts {
  const win = document.createElement('div');
  win.className = 'reel-win';
  win.setAttribute('aria-hidden', 'true');
  view.append(win);
  return {
    win,
    slots: [],
    covers: [],
    shades: [],
    caret: part('reel-caret', win),
    ring: part('reel-ring', win),
    arrow: arrow(win),
    dot: part('reel-dot', win),
  };
}

/**
 * Plays one stage. The stage's own picture shows until the frames of
 * the first moments are decoded, and again whenever the reel rests: off
 * screen, and under reduced motion. A resting stage holds no frame.
 */
function startReel(stage: HTMLElement): void {
  const said = stage.querySelector('[data-reel-data]');
  const view = stage.querySelector<HTMLElement>('.reel-view');
  if (said === null || view === null) return;
  const data = JSON.parse(said.textContent) as ReelData;
  const { timeline } = data;
  const root = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  const held = new Map<string, { img: HTMLImageElement; ready: boolean }>();
  let seen = typeof IntersectionObserver !== 'function';
  let size = { w: view.clientWidth, h: view.clientHeight };
  let time = timeline.still;
  let last: number | null = null;
  let raf = 0;
  let parts: Parts | null = null;
  let broken = false;

  const scheme = (): Scheme => (root.dataset['theme'] === 'light' ? 'light' : 'dark');
  // A picture of a device is whole at every width.
  const shape = (): View => (stage.dataset['reelWhole'] === undefined ? viewOf(timeline.window, size.w) : 'wide');
  // A narrow stage and a screen of one pixel to the point take the
  // smaller file, so a phone never decodes the larger.
  const sharp = (): 0 | 1 => (shape() === 'wide' && size.w * devicePixelRatio > timeline.window.w * 1.05 ? 1 : 0);
  const fileOf = (frame: string): string => data.frames[scheme()][frame]?.[sharp()] ?? '';
  const playing = (): boolean => seen && !calm.matches && !broken;

  /** The time the stage is told to draw in place of its clock's. */
  const pinned = (): number | null => {
    const at = stage.dataset['reelHold'];
    return at === undefined || at === '' || !Number.isFinite(Number(at)) ? null : Number(at);
  };

  /** The files on screen from a time until some seconds after it, around the end of the loop too. */
  const filesFor = (from: number, seconds: number): Set<string> => {
    const until = from + seconds;
    const files = new Set<string>();
    for (const [frame, a, b] of timeline.uses) {
      if ((a <= until && b >= from) || a <= until - timeline.length) files.add(fileOf(frame));
    }
    return files;
  };

  const rest = (): void => {
    window.cancelAnimationFrame(raf);
    raf = 0;
    parts?.win.remove();
    parts = null;
    held.clear();
    stage.dataset['reelState'] = 'still';
    stage.dataset['reelAt'] = timeline.still.toFixed(3);
    stage.dataset['reelFrames'] = timeline.stillFrame;
  };

  /** Fetches and decodes the files it is given, and lets go of every other. */
  const hold = (files: Set<string>): void => {
    for (const file of held.keys()) if (!files.has(file)) held.delete(file);
    for (const file of files) {
      if (held.has(file)) continue;
      const entry = { img: new Image(), ready: false };
      held.set(file, entry);
      entry.img.src = file;
      entry.img.decode().then(
        () => {
          entry.ready = true;
        },
        () => {
          // A frame that will not load leaves the stage on its picture.
          if (held.get(file) !== entry) return;
          broken = true;
          rest();
        }
      );
    }
  };

  const draw = (at: number): void => {
    const drawn = sample(timeline, at, shape());
    parts ??= build(view);
    const { win, slots, covers, shades, caret, ring } = parts;
    const placed = place(drawn.camera, timeline.window, size);
    win.style.transform = `translate(${px(placed.x)}, ${px(placed.y)}) scale(${placed.scale.toFixed(5)})`;
    const paint = data.paint[scheme()];
    if (paint !== undefined) {
      win.style.setProperty('--reel-cover', paint.cover);
      win.style.setProperty('--reel-caret', paint.caret);
    }

    drawn.layers.forEach((layer, i) => {
      let slot = slots[i];
      if (slot === undefined) {
        const wrap = part('reel-layer', win);
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'sync';
        wrap.append(img);
        slot = { wrap, img };
        slots.push(slot);
        // A frame lies over the frames before it, and under the pointer.
        wrap.style.zIndex = String(i);
      }
      const file = fileOf(layer.frame);
      if (slot.img.getAttribute('src') !== file) slot.img.src = file;
      slot.wrap.hidden = false;
      slot.wrap.style.clipPath = layer.within ?? '';
      slot.img.style.opacity = layer.opacity.toFixed(4);
      slot.img.style.clipPath = layer.crop ?? '';
      slot.img.style.transform = layer.move === undefined ? '' : `translate(${px(layer.move[0])}, ${px(layer.move[1])})`;
    });
    slots.slice(drawn.layers.length).forEach((slot) => {
      slot.wrap.hidden = true;
      slot.img.removeAttribute('src');
    });

    drawn.covers.forEach((box, i) => {
      const cover = (covers[i] ??= part('reel-cover', win));
      cover.hidden = false;
      cover.style.left = px(box.x);
      cover.style.top = px(box.y);
      cover.style.width = px(box.w);
      cover.style.height = px(box.h);
    });
    covers.slice(drawn.covers.length).forEach((cover) => (cover.hidden = true));

    win.style.setProperty('--reel-shade', data.shade?.[scheme()] ?? 'transparent');
    drawn.shades.forEach((box, i) => {
      const shade = (shades[i] ??= part('reel-shade', win));
      shade.hidden = false;
      shade.style.left = px(box.x);
      shade.style.top = px(box.y);
      shade.style.width = px(box.w);
      shade.style.height = px(box.h);
      shade.style.opacity = box.opacity.toFixed(4);
    });
    shades.slice(drawn.shades.length).forEach((shade) => (shade.hidden = true));

    caret.hidden = drawn.caret === null;
    if (drawn.caret !== null) {
      caret.style.left = px(drawn.caret.x);
      caret.style.top = px(drawn.caret.y);
      caret.style.height = px(drawn.caret.h);
      caret.style.opacity = String(drawn.caret.opacity);
    }

    const { pointer } = drawn;
    parts.arrow.hidden = pointer === null || pointer.touch;
    parts.dot.hidden = pointer === null || !pointer.touch;
    if (pointer !== null) {
      const el = pointer.touch ? parts.dot : parts.arrow;
      const [dx, dy] = pointer.touch ? TIP.dot : TIP.arrow;
      el.style.transform = `translate(${px(pointer.x - dx)}, ${px(pointer.y - dy)}) scale(${pointer.press.toFixed(4)})`;
      el.style.opacity = pointer.opacity.toFixed(4);
    }
    ring.hidden = drawn.ring === null;
    if (drawn.ring !== null) {
      ring.style.transform = `translate(${px(drawn.ring.x)}, ${px(drawn.ring.y)}) scale(${drawn.ring.scale.toFixed(4)})`;
      ring.style.opacity = drawn.ring.opacity.toFixed(4);
    }

    // The suite waits on these, so they are written after the picture.
    stage.dataset['reelFrames'] = [...new Set(drawn.layers.map((layer) => layer.frame))].join(' ');
    stage.dataset['reelAt'] = at.toFixed(3);
    stage.dataset['reelState'] = 'playing';
  };

  const step = (now: number): void => {
    raf = 0;
    if (!playing()) return;
    const pin = pinned();
    const passed = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    const next = pin ?? (time + passed) % timeline.length;
    hold(filesFor(next, pin === null ? AHEAD : 0));
    const due = [...filesFor(next, pin === null ? SOON : 0)];
    if (due.every((file) => held.get(file)?.ready === true)) {
      time = next;
      draw(next);
      // A pinned stage has no clock, and draws again when something changes.
      if (pin !== null) return;
    } else {
      stage.dataset['reelState'] = 'loading';
    }
    raf = window.requestAnimationFrame(step);
  };

  const update = (): void => {
    stage.dataset['reelView'] = shape();
    if (!playing()) {
      rest();
    } else if (raf === 0) {
      last = null;
      raf = window.requestAnimationFrame(step);
    }
  };

  calm.addEventListener('change', update);
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  new MutationObserver(update).observe(stage, { attributes: true, attributeFilter: ['data-reel-hold'] });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      size = { w: view.clientWidth, h: view.clientHeight };
      update();
    }).observe(view);
  }
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(
      (entries) => {
        seen = (entries.at(-1)?.intersectionRatio ?? 0) >= IN_VIEW;
        update();
      },
      { threshold: IN_VIEW }
    ).observe(view);
  }
  update();
}

/** Resolves when the picture a stage shows is drawn, or will not be. */
async function drawn(stage: HTMLElement): Promise<void> {
  const still = [...stage.querySelectorAll<HTMLImageElement>('.reel-still')].find((img) => img.offsetParent !== null);
  if (still === undefined) return;
  if (!still.complete) {
    await new Promise<void>((done) => {
      still.addEventListener('load', () => done(), { once: true });
      still.addEventListener('error', () => done(), { once: true });
    });
  }
  await still.decode().catch(() => undefined);
}

/**
 * Plays every stage while it is on screen. Until a stage first comes
 * on screen it is its picture alone: its reel is not read, and no
 * frame is asked for. The picture is drawn before the first frame is
 * asked for, so the frames never hold it back. Under reduced motion a
 * stage asks for no frame at all.
 */
export function startReels(stages: HTMLElement[]): void {
  for (const stage of stages) {
    if (typeof IntersectionObserver !== 'function') {
      startReel(stage);
      continue;
    }
    const near = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      void drawn(stage).then(() => startReel(stage));
    });
    near.observe(stage);
  }
}
