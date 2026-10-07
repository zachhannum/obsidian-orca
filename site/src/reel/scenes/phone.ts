import type { Point } from '../ease';
import { drag, hold, overlap, slide, tap, type Scene } from '../scene';

/** The seconds a drawer or the sheet takes to slide. */
const SLIDE = 0.45;
/**
 * A swipe from the right edge of the screen, which brings the design
 * drawer in. The finger travels the drawer's width, so the drawer's
 * edge stays under it.
 */
const IN: [Point, Point] = [
  [384, 430],
  [56, 430],
];
/** A swipe from the drawer's edge, which sends it back. */
const OUT: [Point, Point] = [
  [56, 430],
  [384, 430],
];

/**
 * Orca on a phone: the preview, the design panel as a drawer that
 * pushes the page aside, one tap that justifies the text, and export
 * as a sheet.
 */
export const scene: Scene = {
  id: 'phone',
  take: 'phone',
  first: 'page',
  // The page alone, justified, after the drawer has gone.
  still: 4.5,
  beats: [
    hold(0.9),
    drag(...IN, SLIDE),
    overlap(SLIDE),
    slide('drawer', 'drawer', { from: 'right', push: true, ease: 'inOutCubic', over: SLIDE, fade: 0.15 }),
    hold(0.7),
    tap('drawer', 'justify', { dwell: 0.3, rest: 0.2, then: 'justified', lag: 0.05, fade: 0.12 }),
    hold(1),

    // The page under the drawer is the book as the tap set it.
    drag(...OUT, SLIDE),
    overlap(SLIDE),
    slide('set', 'drawer', { from: 'right', out: true, push: true, over: SLIDE }),
    hold(1.1),

    // Export is a sheet, and one tap writes the files.
    tap('set', 'export', { dwell: 0.3, rest: 0.15 }),
    slide('sheet', 'sheet', { from: 'bottom', dim: true, over: SLIDE }),
    hold(0.9),
    tap('sheet', 'write', { dwell: 0.3, rest: 0.2, then: 'written', lag: 0.3, fade: 0.25, ease: 'outCubic' }),
    hold(2.4),
  ],
};
