import type { Point } from './ease';

/** A box in CSS pixels of the window. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Scheme = 'dark' | 'light';

/** The colours the player draws with in one scheme. */
export interface Paint {
  /** The editor's ground, which covers a row that is not typed yet. */
  cover: string;
  caret: string;
}

export interface Frame {
  name: string;
  marks: Record<string, Box>;
  /** The lines of text in the frame's editor, from the top. */
  rows?: Box[];
  /** The offset the frame's scroller was at. */
  scroll?: number;
}

/** The frames of one run through real Obsidian, with the boxes the spec measured in each. */
export interface Take {
  take: string;
  window: { w: number; h: number };
  density: number;
  /** The editor's colours in each scheme, for a take that typed in one. */
  paint: Partial<Record<Scheme, Paint>>;
  frames: Frame[];
}

/** Throws when the take has no such frame. */
export function frameOf(take: Take, name: string): Frame {
  const frame = take.frames.find((held) => held.name === name);
  if (frame === undefined) throw new Error(`take ${take.take} has no frame ${name}`);
  return frame;
}

/** Throws when the frame has no such mark. */
export function markOf(take: Take, frame: string, mark: string): Box {
  const box = frameOf(take, frame).marks[mark];
  if (box === undefined) throw new Error(`frame ${frame} of take ${take.take} has no mark ${mark}`);
  return box;
}

/** The centre of a mark. */
export function mid(take: Take, frame: string, mark: string): Point {
  const box = markOf(take, frame, mark);
  return [box.x + box.w / 2, box.y + box.h / 2];
}
