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
  /** The marks of the shot that this device has no control for. The other marks keep their numbers. */
  without?: string[];
}

export interface Asked {
  name: string;
  alt: string;
  /** Mark ids, in the order the page's steps number them. A device takes the same ids, less the ones it is `without`. */
  marks: string[];
  tablet?: Pictured | undefined;
  phone?: Pictured | undefined;
}

export interface Mark extends Box {
  /** The number of the step the mark belongs to, which is its place in the shot's marks. */
  step: number;
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
}

/** The pixels between two marks under which their rings would touch. */
const CROWD = 12;

const crowded = (box: Box, boxes: Box[]): boolean =>
  boxes.some(
    (other) =>
      other !== box &&
      other.y < box.y + box.height &&
      box.y < other.y + other.height &&
      other.x < box.x + box.width + CROWD &&
      box.x < other.x + other.width + CROWD,
  );

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
    const without = pictured.without ?? [];
    for (const id of without) {
      if (!asked.marks.includes(id)) throw new Error(`${name} is without the mark ${id}, which the page does not ask for`);
    }
    const ids = asked.marks.filter((id) => !without.includes(id));
    const sidecar = ids.length === 0 ? undefined : sidecars[name];
    if (ids.length > 0 && sidecar === undefined) {
      throw new Error(`no ${name}.marks.json in site/src/shots, and the page asks for marks`);
    }
    const boxes = ids.map((id) => {
      const box = sidecar?.marks[id];
      if (box === undefined) throw new Error(`${name} has no mark ${id}`);
      return { ...box, step: asked.marks.indexOf(id) + 1 };
    });
    found.push({
      device,
      name,
      alt: pictured.alt ?? asked.alt,
      pictures: { dark: picture('dark'), light: picture('light') },
      measured: sidecar && { width: sidecar.width, height: sidecar.height },
      marks: boxes.map((box) => ({ ...box, crowded: crowded(box, boxes) })),
    });
  }
  return found;
}
