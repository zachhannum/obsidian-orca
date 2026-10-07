import { click, cut, hold, leave, overlap, type, type Scene } from '../scene';

/** The seconds the pointer takes to reach the paragraph, and the seconds the outline takes to come up under it. */
const REACH = 0.75;
const OUTLINE = 0.12;

/**
 * Advanced CSS styling: inspect mode pins a paragraph of the colophon,
 * the pane adds a rule for it, three declarations are typed, and the
 * page is set again.
 */
export const scene: Scene = {
  id: 'css',
  take: 'css',
  first: 'c0',
  // The pane with the new rule over the one it beat, beside the page it set.
  still: 10.2,
  beats: [
    hold(0.6),
    click('c0', 'inspect', { from: [880, 330], move: 0.8, then: 'c1' }),
    hold(0.25),

    // The outline comes up as the pointer reaches the paragraph, and a
    // click pins it.
    hold(REACH),
    cut('c2', OUTLINE),
    overlap(REACH + OUTLINE),
    click('c1', 'para', { move: REACH, dwell: 0.65, rest: 0.2, then: 'c3', fade: 0.2 }),
    hold(1.05),

    // The pane writes an empty rule for the paragraph, and the caret is inside it.
    click('c3', 'add', { move: 0.7, then: 'c4' }),
    leave([40, -70], 0.5),
    hold(0.5),
    type('c5', [[1, 0.6, 0.1], [1, 0.5, 0.15], [1, 0.6, 0.15]], { how: 'cover', box: 'code' }),
    hold(0.35),
    cut('c5', 0.25),
    hold(1.6),

    // The pin comes off, and the page is clear of its outline.
    click('c5', 'close', { from: [1010, 300], move: 0.7, then: 'c6', fade: 0.2 }),
    leave([-50, 90], 0.7),
    hold(2.1),
  ] };
