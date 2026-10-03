import type { ViewMode } from "@/ui/page";

/** The zoom at which a page fits the pane. A page is never drawn smaller. */
export const FIT = 1;

/** The closest the preview looks: eight times the fitted page. */
export const CLOSEST = 8;

/** The zooms the keys and the control stop at, from fit to the closest. */
const STOPS = [1, 1.25, 1.5, 2, 3, 4, 6, 8];

/**
 * The share one pixel of a wheel's travel scales the page by. Chromium sends
 * a trackpad pinch as a wheel of a few pixels a frame, and a mouse wheel
 * held with Ctrl as a hundred a notch, so a notch is about a stop.
 */
const WHEEL = 0.0025;

/** A gap smaller than this is the rounding of a pinch, not a zoom. */
const EPSILON = 0.005;

/**
 * Whether a view zooms. The grid is the zoomed-out check, and the size
 * of its pages decides how many it shows.
 */
export function zooms(mode: ViewMode): boolean {
  return mode !== "grid";
}

export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return FIT;
  return Math.min(Math.max(zoom, FIT), CLOSEST);
}

/** The next stop above `zoom`, which a pinch can leave between two. */
export function steppedIn(zoom: number): number {
  return STOPS.find((stop) => stop > zoom + EPSILON) ?? CLOSEST;
}

/** The next stop below `zoom`. */
export function steppedOut(zoom: number): number {
  return [...STOPS].reverse().find((stop) => stop < zoom - EPSILON) ?? FIT;
}

/** The zoom as the control prints it and the surface carries it. */
export function percentOf(zoom: number): number {
  return Math.round(zoom * 100);
}

/**
 * The zoom after a wheel moved `deltaY` pixels with Ctrl or Cmd held.
 * The scale is exponential, so a pinch out and the same pinch back end
 * where they began.
 */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-deltaY * WHEEL));
}

/**
 * The zoom after two fingers that began `from` pixels apart at `zoom`
 * are `to` pixels apart.
 */
export function pinchZoom(zoom: number, from: number, to: number): number {
  if (from <= 0) return clampZoom(zoom);
  return clampZoom((zoom * to) / from);
}

/** One side of a sheet along one axis: where it starts and how long it is. */
export interface Edge {
  start: number;
  size: number;
}

/** The place of a point along a sheet, as a share of the sheet's size. */
export function shareOf(sheet: Edge, point: number): number {
  return sheet.size === 0 ? 0 : (point - sheet.start) / sheet.size;
}

/**
 * The scroll that puts the place `share` of the way along `sheet`
 * under `point`. A sheet is measured after it is drawn at the zoom, so
 * the scroll is what the new size moved the place by.
 */
export function scrollTo(sheet: Edge, share: number, point: number): number {
  return sheet.start + share * sheet.size - point;
}
