import { click, hold, leave, point, scroll, type Scene } from '../scene';

/** The status bar and the scroller's own bar, which lie over the note and do not scroll with it. */
const OVER = ['status', 'bar'];

/**
 * Chapters stay notes: the book note is read as its page, down to the
 * reading order, and then as its Markdown, where each chapter is a
 * link. Both switches are the header's own actions.
 */
export const scene: Scene = {
  id: 'chapters',
  take: 'chapters',
  first: 'page',
  // The note's Markdown, with the pointer's rest on a chapter's link.
  still: 5.6,
  beats: [
    hold(0.9),
    scroll(['page', 'page-mid', 'page-order'], 1.3, 'scroller', OVER),
    hold(1),

    // The page's own action hands the note to the editor.
    click('page-order', 'as-markdown', {
      from: [900, 420],
      move: 0.75,
      dwell: 0.2,
      rest: 0.25,
      then: 'source-order',
      lag: 0.05,
      fade: 0.2 }),
    point('source-order', 'link', { move: 0.8, dwell: 0, rest: 1.3 }),
    scroll(['source-order', 'source-mid', 'source-top'], 1.5, 'scroller', OVER),
    hold(1.1),

    // The editor's own action hands it back.
    click('source-top', 'as-book', {
      move: 0.75,
      dwell: 0.2,
      rest: 0.25,
      then: 'page',
      lag: 0.05,
      fade: 0.2 }),
    leave([-70, 100], 0.7),
    hold(1.7),
  ] };
