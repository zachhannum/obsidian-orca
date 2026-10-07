import type { Point } from '../ease';
import { click, cut, hold, leave, look, point, type, type Press, type Scene } from '../scene';

/** The left page of the spread, which is where the plate is once the note names it. */
const PLATE: Point = [580, 370];
/** The left of the dialog, which holds what preflight says. */
const SAID: Point = [505, 385];
/** A place under the line of the note, where the pointer is off the name. */
const ASIDE: Point = [600, 230];
/** A dialog comes up over the preview. */
const OPENS: Press = { lag: 0.05, fade: 0.25, ease: 'outCubic' };

/**
 * Export: preflight refuses the book over an image the note misnames,
 * its link opens the note on the line, the name is set right, and the
 * export writes the files.
 */
export const scene: Scene = {
  id: 'export',
  take: 'export',
  first: 'e0',
  // The dialog with the error standing and Export disabled.
  still: 2.4,
  beats: [
    look('e0', PLATE),
    hold(0.4),
    click('e0', 'export', { ...OPENS, from: [840, 430], move: 0.8, dwell: 0.2, rest: 0.2, then: 'e1', look: SAID }),
    // The refusal is read, and then the button it disables.
    hold(1.3),
    look('e1', 'export-off', 0.5),
    hold(0.8),

    // The error's own link opens the note on the line.
    click('e1', 'fix', { move: 0.6, dwell: 0.25, rest: 0.2, then: 'e2', lag: 0.08, fade: 0.25, look: 'word' }),
    hold(0.4),
    // A click puts the caret in the misspelled word, and the pointer
    // moves off it while the word is typed again.
    click('e2', 'word', { move: 0.45, dwell: 0.15, rest: 0.1 }),
    point('e2', ASIDE, { move: 0.3, dwell: 0, rest: 0 }),
    type('e3', [[1, 0.5, 0.1]], { row: 'word' }),
    hold(0.15),
    cut('e3', 0.15),
    hold(0.4),

    // Back to the book by its tab, and the plate is on its page.
    click('e3', 'preview', {
      move: 0.6,
      dwell: 0.2,
      rest: 0.2,
      then: 'e4',
      lag: 0.08,
      fade: 0.3,
      ease: 'inOutCubic',
      look: PLATE,
    }),
    hold(1.25),

    // Preflight passes, and one click writes the files.
    click('e4', 'export', { ...OPENS, move: 0.7, dwell: 0.2, rest: 0.2, then: 'e5', look: SAID }),
    hold(0.7),
    click('e5', 'write', { ...OPENS, move: 0.6, dwell: 0.25, rest: 0.15, then: 'e6', lag: 0.3, look: SAID }),
    leave([60, 90], 0.6),
    hold(1.5),
  ],
};
