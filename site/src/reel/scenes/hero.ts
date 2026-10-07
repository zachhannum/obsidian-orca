import type { Point } from '../ease';
import { click, cut, hold, leave, look, overlap, scroll, type, type Press, type Scene } from '../scene';

/** The middle of the lines the chapter is typed on. */
const EDITOR: Point = [650, 330];
/** The chapter's opening page, in the preview with the navigator open and with it put away. */
const SPREAD: Point = [620, 400];
const OPENING: Point = [300, 420];
/** Obsidian's own button for the left sidebar. */
const SIDEBAR: Point = [321, 19];
/** Keeps the facing page in the narrow view while a control of the panel is stepped. */
const PANEL: Press = { aim: [-170, -60] };
/** A second click on the control the pointer is on. */
const AGAIN: Press = { ...PANEL, dwell: 0.18 };

/**
 * The tour: a chapter is opened and written, set as a book, styled in
 * the design panel and in CSS, and exported.
 */
export const scene: Scene = {
  id: 'hero',
  take: 'hero',
  first: 'notes',
  // The preview beside the design panel, before a control is touched.
  still: 9.5,
  beats: [
    // Chapters stay notes: a click on a chapter opens it, empty.
    look('notes', 'chapter'),
    hold(0.4),
    click('notes', 'chapter', { from: [760, 560], move: 1, rest: 0.15, then: 'write-empty', fade: 0.19, look: EDITOR }),
    leave([220, 160], 0.85),
    hold(1.15),

    // Write, then format: the chapter number, the title and two
    // paragraphs are typed, and the note's own action opens the preview.
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
    leave([40, 120], 0.65),
    hold(1.65),

    // Design in the panel: the navigator is put away, and each click
    // steps a control.
    click('read', SIDEBAR, { from: [700, 380], move: 0.55, dwell: 0.1, then: 'design-0', lag: 0.05, fade: 0.13, look: OPENING }),
    click('design-0', 'size-up', { ...PANEL, move: 0.18, then: 'design-1' }),
    click('design-0', 'size-up', { ...AGAIN, then: 'design-2' }),
    click('design-0', 'size-up', { ...AGAIN, then: 'design-3' }),
    click('design-0', 'spacing-up', { ...PANEL, move: 0.13, then: 'design-4' }),
    click('design-0', 'spacing-up', { ...AGAIN, then: 'design-5' }),
    click('design-0', 'spacing-up', { ...AGAIN, then: 'design-6' }),
    click('design-0', 'justify', { ...PANEL, move: 0.23, then: 'design-7' }),
    hold(0.33),
    scroll(['design-7', 'scroll-down', 'design-8']),
    // The pointer goes to the drop cap rows while the panel scrolls to them.
    overlap(0.83),
    click('design-8', 'drop-cap', { move: 0.93, then: 'design-9' }),
    click('design-9', 'cap-font', { move: 0.23, then: 'design-10' }),
    click('design-10', 'option', { move: 0.28, then: 'design-11', look: OPENING }),
    leave([40, 60], 1.13),
    hold(0.48),
    scroll(['design-11', 'scroll-up', 'design-12']),
    hold(0.35),

    // Go further in CSS: the panel turns to the book's own CSS, a rule
    // is typed at its end, and the pages take it once the typing stops.
    click('design-12', 'css', { from: [900, 640], dwell: 0.15, rest: 0.2, then: 'css-0' }),
    click('css-0', [1000, 690], { move: 0.75, dwell: 0.2, rest: 0, then: 'css-1', fade: 0, aim: [0, -200] }),
    leave([30, 60], 0.4),
    hold(0.3),
    type('css-2', [[8, 2.25, 0.05]], { how: 'cover' }),
    hold(0.3),
    cut('css-2', 0.25),
    look('css-2', OPENING),
    hold(1),

    // Export: the preview's own action opens the dialog, preflight has
    // passed, and one click writes the files.
    click('css-2', 'export', {
      from: [600, 560],
      move: 0.75,
      dwell: 0.2,
      rest: 0.2,
      then: 'export-0',
      lag: 0.05,
      fade: 0.25,
      ease: 'outCubic',
      look: 'dialog',
    }),
    click('export-0', 'write', { move: 0.7, dwell: 0.25, rest: 0.15, then: 'export-1', lag: 0.3, fade: 0.25, ease: 'outCubic' }),
    leave([60, 90], 0.6),
    hold(2.4),
  ],
};
