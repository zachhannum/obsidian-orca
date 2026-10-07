import { hold, tap, type Press, type Scene } from '../scene';

/** A dialog comes up over the preview. */
const OPENS: Press = { lag: 0.05, fade: 0.25, ease: 'outCubic' };

/**
 * Orca on a tablet: the navigator and the design panel pinned beside
 * the preview, a tap on a chapter that turns the preview to it, one tap
 * that justifies the text, and the export.
 */
export const scene: Scene = {
  id: 'tablet',
  take: 'tablet',
  first: 'pinned',
  // The chapter's opening page, justified, between the two drawers.
  still: 4.8,
  beats: [
    hold(1),
    tap('pinned', 'chapter', { dwell: 0.35, rest: 0.2, then: 'turned', lag: 0.08, fade: 0.25 }),
    hold(1.5),
    tap('turned', 'justify', { dwell: 0.35, rest: 0.2, then: 'justified', lag: 0.05, fade: 0.12 }),
    hold(1.7),

    // Export, from the action in the preview's own bar.
    tap('justified', 'export', { ...OPENS, dwell: 0.35, rest: 0.2, then: 'dialog' }),
    hold(1),
    tap('dialog', 'write', { ...OPENS, dwell: 0.3, rest: 0.2, then: 'written', lag: 0.3 }),
    hold(2.4),
  ] };
