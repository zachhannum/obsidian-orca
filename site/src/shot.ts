/** The devices a docs picture can be of, in the order the switch lists them. */
export const DEVICES = ['desktop', 'tablet', 'phone'] as const;
export type Device = (typeof DEVICES)[number];

export const SCHEMES = ['dark', 'light'] as const;
export type Scheme = (typeof SCHEMES)[number];

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The marks the spec measured, in CSS pixels of a picture `width` wide. */
export interface Sidecar {
  width: number;
  height: number;
  marks: Record<string, Box>;
}

/** A picture of another device, and the words for it when the shot's own do not fit. */
export interface Pictured {
  name: string;
  alt?: string;
}

export interface Asked {
  name: string;
  alt: string;
  /** Mark ids, in the order the page's steps number them. Every device takes the same ids. */
  marks: string[];
  tablet?: Pictured | undefined;
  phone?: Pictured | undefined;
}

export interface Mark extends Box {
  /** A mark with a neighbor on the same line. Its ring sits inside its box. */
  crowded: boolean;
}

export interface View<Picture> {
  device: Device;
  name: string;
  alt: string;
  pictures: Record<Scheme, Picture>;
  /** The size the marks are measured against, when the view has marks. */
  measured: { width: number; height: number } | undefined;
  marks: Mark[];
  /** The part of the picture a narrow screen shows, when that is less than all of it. */
  crop: Box | undefined;
}

/** The pixels between two marks under which their rings would touch. */
const CROWD = 12;

/** The room a crop leaves around its marks, which holds a ring and its number. */
const ROOM = 28;

/** The least of a picture a crop shows, so one small mark is not blown up past its own size. */
const LEAST = { width: 360, height: 240 };

const crowded = (box: Box, boxes: Box[]): boolean =>
  boxes.some(
    (other) =>
      other !== box &&
      other.y < box.y + box.height &&
      box.y < other.y + other.height &&
      other.x < box.x + box.width + CROWD &&
      box.x < other.x + other.width + CROWD,
  );

/** One axis of a crop: the marks' extent with room, no shorter than `least`, kept inside `limit`. */
function span(from: number, to: number, least: number, limit: number): [number, number] {
  const size = Math.min(limit, Math.max(to - from + 2 * ROOM, least));
  const start = Math.round((from + to) / 2 - size / 2);
  return [Math.max(0, Math.min(start, limit - size)), size];
}

/**
 * The region of a picture that holds every mark. A picture with no marks,
 * or one whose marks reach across all of it, has no crop.
 */
export function crop(size: { width: number; height: number }, boxes: Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  const [x, width] = span(
    Math.min(...boxes.map((box) => box.x)),
    Math.max(...boxes.map((box) => box.x + box.width)),
    LEAST.width,
    size.width,
  );
  const [y, height] = span(
    Math.min(...boxes.map((box) => box.y)),
    Math.max(...boxes.map((box) => box.y + box.height)),
    LEAST.height,
    size.height,
  );
  if (width === size.width && height === size.height) return undefined;
  return { x, y, width, height };
}

/**
 * The views of one shot, one per device it names. It throws when a picture
 * is missing in either scheme, or when a device has no measure of a mark
 * the page asks for, which stops the build.
 */
export function views<Picture>(
  asked: Asked,
  pictures: Record<string, Picture | undefined>,
  sidecars: Record<string, Sidecar | undefined>,
): View<Picture>[] {
  const named: [Device, Pictured | undefined][] = [
    ['desktop', { name: asked.name }],
    ['tablet', asked.tablet],
    ['phone', asked.phone],
  ];
  const found: View<Picture>[] = [];
  for (const [device, pictured] of named) {
    if (pictured === undefined) continue;
    const { name } = pictured;
    const picture = (scheme: Scheme): Picture => {
      const file = pictures[`${name}-${scheme}`];
      if (file === undefined) {
        throw new Error(`no picture ${name}-${scheme}.png in site/src/shots, which the ${device} view asks for`);
      }
      return file;
    };
    const sidecar = asked.marks.length === 0 ? undefined : sidecars[name];
    if (asked.marks.length > 0 && sidecar === undefined) {
      throw new Error(`no ${name}.marks.json in site/src/shots, and the page asks for marks`);
    }
    const boxes = asked.marks.map((id) => {
      const box = sidecar?.marks[id];
      if (box === undefined) throw new Error(`${name} has no mark ${id}`);
      return box;
    });
    found.push({
      device,
      name,
      alt: pictured.alt ?? asked.alt,
      pictures: { dark: picture('dark'), light: picture('light') },
      measured: sidecar && { width: sidecar.width, height: sidecar.height },
      marks: boxes.map((box) => ({ ...box, crowded: crowded(box, boxes) })),
      // A phone picture is already the width of a narrow screen.
      crop: sidecar === undefined || device === 'phone' ? undefined : crop(sidecar, boxes),
    });
  }
  return found;
}
