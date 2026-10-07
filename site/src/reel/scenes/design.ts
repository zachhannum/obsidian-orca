import type { Point } from '../ease';
import { click, hold, leave, look, overlap, scroll, type Press, type Scene } from '../scene';

/** The top of the chapter's opening page, where each change of the panel shows. */
const PAGE: Point = [600, 330];
/** Keeps the facing page in the narrow view while a control of the panel is clicked. */
const PANEL: Press = { aim: [-170, -60], dwell: 0.22, look: PAGE };
/** A value typed into a field. The pages are set a moment after the last key. */
const TYPED: Press = { ...PANEL, dwell: 0.35, lag: 0.4, fade: 0.2 };
/** The seconds a change stays on the page before the pointer goes on. */
const SEEN = 0.65;

/**
 * Design in the panel: a book note with no design is given a trim, a
 * type size, a title, a line over the title, a drop cap and a first
 * line in small capitals, one control at a time.
 */
export const scene: Scene = {
  id: 'design',
  take: 'design',
  first: 'd0',
  // The page with every change made.
  still: 18.2,
  beats: [
    look('d0', PAGE),
    hold(0.7),

    // The page and its text.
    click('d0', 'trim', { ...PANEL, from: [1010, 520], move: 0.8, then: 'd1' }),
    hold(SEEN),
    click('d1', 'body-size', { ...TYPED, then: 'd2' }),
    hold(SEEN + 0.3),

    // The chapter's title is a first-level heading. The pointer goes to
    // its font while the panel scrolls to the headings.
    scroll(['d2', 'scroll-headings', 'd3'], 0.6),
    overlap(0.5),
    click('d3', 'h1-font', { aim: [-170, -60], move: 0.7, then: 'd4' }),
    hold(0.25),
    click('d4', 'option', { ...PANEL, move: 0.3, then: 'd5' }),
    hold(SEEN),
    click('d5', 'h1-center', { ...PANEL, move: 0.5, then: 'd6' }),
    hold(SEEN),
    click('d6', 'h1-below', { ...PANEL, move: 0.45, then: 'd7' }),
    hold(SEEN),

    // The line over the title is a second-level heading, which the same rows set.
    click('d7', 'h2', { aim: [-170, -60], move: 0.5, dwell: 0.22, then: 'd8' }),
    hold(0.15),
    click('d8', 'h2-size', { ...TYPED, move: 0.5, then: 'd9' }),
    hold(SEEN + 0.3),
    click('d9', 'h2-center', { ...PANEL, move: 0.5, then: 'd10' }),
    hold(SEEN),

    // The chapter's first letter and its first line.
    scroll(['d10', 'scroll-openings', 'd11'], 0.6),
    overlap(0.5),
    click('d11', 'drop-cap', { ...PANEL, move: 0.7, then: 'd12' }),
    hold(SEEN),
    click('d12', 'first-line', { ...PANEL, move: 0.5, then: 'd13' }),
    leave([50, 80], 0.8),
    hold(2.4),
  ],
};
