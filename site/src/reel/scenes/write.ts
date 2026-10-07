import type { Point } from '../ease';
import { click, hold, leave, look, overlap, type, type Scene } from '../scene';

/** The middle of the lines the chapter is typed on. */
const EDITOR: Point = [650, 330];
/** The chapter's opening page in the preview. */
const SPREAD: Point = [620, 400];

/**
 * Write, then format: the chapter is typed, the note's own action
 * opens the preview, and the preview's own action goes back.
 */
export const scene: Scene = {
  id: 'write',
  take: 'hero',
  first: 'write-empty',
  // The typeset book, between the two clicks.
  still: 5.5,
  beats: [
    look('write', EDITOR),
    hold(0.2),
    type('write', [
      [1, 0.4, 0.4],
      [1, 0.45, 0.1],
      [8, 1.35, 0.15],
      [3, 0.45, 0.1],
    ]),
    overlap(0.35),
    click('write', 'preview', {
      from: [900, 700],
      dwell: 0.1,
      rest: 0.2,
      then: 'read',
      lag: 0.1,
      fade: 0.3,
      ease: 'inOutCubic',
      look: SPREAD,
    }),
    hold(2.6),
    click('read', 'manuscript', { move: 0.7, dwell: 0.2, then: 'write', fade: 0.3, ease: 'inOutCubic', look: EDITOR }),
    leave([-60, 110], 0.7),
    hold(2.6),
  ],
};
