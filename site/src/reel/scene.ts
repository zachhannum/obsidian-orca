import type { Ease, Point } from './ease';

/** A mark of a frame, by name, or a point of the window. */
export type At = string | Point;

/** A side of the window a drawer or a sheet comes from. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * A run of typing: the number of rows, the seconds they take, and the
 * seconds the typing waits before it starts on them.
 */
export type Run = readonly [rows: number, seconds: number, wait?: number];

export interface Press {
  /** The point the pointer comes in from, when none is on screen. */
  from?: Point;
  /** The seconds the pointer travels for. A pointer already on the target does not travel. */
  move?: number;
  /** The seconds the pointer rests on the target before the click. */
  dwell?: number;
  /** The seconds the beat lasts after the click. */
  rest?: number;
  /** The frame the click brings up. */
  then?: string;
  /** The seconds from the click to the first of that frame. */
  lag?: number;
  fade?: number;
  ease?: Ease;
  /**
   * The offset from the target to the point the narrow view centres on
   * for the click. It keeps what the click changes in the view with
   * the target. The target stays inside the narrowest stage.
   */
  aim?: Point;
  /**
   * The mark of the frame after the click, or the point, that the
   * narrow view turns to once the click has landed. A click that
   * follows within half a second takes the view before it gets there.
   */
  look?: At;
}

export interface Typing {
  /**
   * A `reveal` uncovers the typed frame row by row over the frame
   * under it. A `cover` shows the typed frame inside `box` and hides
   * each row that is not typed yet under the editor's ground colour.
   */
  how?: 'reveal' | 'cover';
  /** The first row typed, counted from the top of the frame's rows. */
  first?: number;
  /** The mark of the editor a `cover` fills. */
  box?: string;
  /** A mark of the frame that is typed as its one row, where the typing is a word of a line. */
  row?: string;
}

export interface Sliding {
  from: Side;
  /** The box leaves, and `frame` is what it leaves behind. */
  out?: boolean;
  /** The frame under the box moves with it, as a pane a drawer pushes does. */
  push?: boolean;
  /**
   * The rest of the frame fades in as the box comes, as the shade behind
   * a sheet does. The ground the box has yet to cover is shaded in the
   * take's own shade.
   */
  dim?: boolean;
  /**
   * The seconds the frame takes to fade in once the box has come. A
   * drawer shades the strip of the pane it pushed, and the slide draws
   * that strip with no shade.
   */
  fade?: number;
  over?: number;
  /** A box under a finger takes the finger's ease, which is `inOutCubic`. */
  ease?: Ease;
}

export type Beat =
  | ({ kind: 'click'; frame: string; at: At } & Press)
  | ({ kind: 'tap'; frame: string; at: At } & Press)
  | ({ kind: 'point'; frame: string; at: At } & Press)
  | { kind: 'leave'; by: Point; over: number }
  | { kind: 'drag'; from: Point; to: Point; over: number }
  | ({ kind: 'type'; frame: string; runs: readonly Run[] } & Typing)
  | { kind: 'scroll'; frames: readonly string[]; over: number; box: string; fixed: readonly string[] }
  | ({ kind: 'slide'; frame: string; box: string } & Sliding)
  | { kind: 'cut'; frame: string; fade: number; ease: Ease }
  | { kind: 'hold'; seconds: number }
  | { kind: 'look'; frame: string; at: At; over: number };

/**
 * A reel, as data. The beats play one after another from 0, and each
 * takes its own length, so no beat names a time. The reel ends by
 * fading back to its first frame.
 */
export interface Scene {
  id: string;
  /** The take the frames are from. */
  take: string;
  /** The frame the reel opens on and fades back to. */
  first: string;
  /**
   * The time the reel holds at under reduced motion, and the time it
   * starts to play from. One whole frame shows at it.
   */
  still: number;
  beats: readonly Beat[];
}

/**
 * Moves the pointer to a mark of `frame`, or to a point, and clicks.
 * The pointer stays where it clicked until `leave`.
 */
export const click = (frame: string, at: At, press: Press = {}): Beat => ({ kind: 'click', frame, at, ...press });

/**
 * Moves the pointer to a mark of `frame`, or to a point, with no click.
 * It rests there for `dwell` and `rest`.
 */
export const point = (frame: string, at: At, press: Press = {}): Beat => ({ kind: 'point', frame, at, ...press });

/** Taps with a finger. The dot shows for the tap alone. */
export const tap = (frame: string, at: At, press: Press = {}): Beat => ({ kind: 'tap', frame, at, ...press });

/**
 * Sends the pointer off by an offset and fades it out. It takes no
 * time, so the beats after it play while the pointer goes.
 */
export const leave = (by: Point = [60, 90], over = 0.8): Beat => ({ kind: 'leave', by, over });

/** Drags a finger. `overlap` puts the scroll or the slide it moves under it. */
export const drag = (from: Point, to: Point, over = 0.5): Beat => ({ kind: 'drag', from, to, over });

/** Types rows of `frame` in runs. The caret stays until another frame takes the window. */
export const type = (frame: string, runs: readonly Run[], typing: Typing = {}): Beat => ({
  kind: 'type',
  frame,
  runs,
  ...typing,
});

/**
 * Scrolls the box of a mark through frames taken at rising or falling
 * offsets. The first frame is the one on screen, and the last one stays.
 * The marks in `fixed` are parts of the first frame that lie over the
 * box and do not scroll with it, as a status bar does.
 */
export const scroll = (
  frames: readonly string[],
  over = 0.5,
  box = 'scroller',
  fixed: readonly string[] = []
): Beat => ({
  kind: 'scroll',
  frames,
  over,
  box,
  fixed,
});

/** Slides the box of a mark of `frame` in from a side, or out to it. */
export const slide = (frame: string, box: string, sliding: Sliding): Beat => ({ kind: 'slide', frame, box, ...sliding });

/** Brings a frame up with no click. */
export const cut = (frame: string, fade = 0, ease: Ease = 'outQuad'): Beat => ({ kind: 'cut', frame, fade, ease });

export const hold = (seconds: number): Beat => ({ kind: 'hold', seconds });

/** Starts the next beat this many seconds before the last one ended. */
export const overlap = (seconds: number): Beat => ({ kind: 'hold', seconds: -seconds });

/**
 * Turns the narrow view to a mark of `frame`, or to a point. It takes
 * no time. At the head of a scene it sets where the view starts.
 */
export const look = (frame: string, at: At, over = 0.6): Beat => ({ kind: 'look', frame, at, over });
