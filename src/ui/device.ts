/**
 * The device orca is drawn for, and what each one changes: the split
 * commands a phone leaves out, and where the preview's foot goes.
 */

export type Device = "desktop" | "tablet" | "phone";

/** The flags Obsidian's `Platform` holds. */
export interface Flags {
  isMobile: boolean;
  isPhone: boolean;
  isTablet: boolean;
}

/**
 * Names the device. Obsidian sets `isPhone` and `isTablet` on mobile
 * alone, and a mobile window it calls neither is drawn as a phone.
 */
export function deviceOf(flags: Flags): Device {
  if (!flags.isMobile) return "desktop";
  return flags.isTablet && !flags.isPhone ? "tablet" : "phone";
}

/** A phone has one pane, so nothing opens beside another there. */
export function splits(device: Device): boolean {
  return device !== "phone";
}

/** Only a phone docks a dialog to the foot of the screen. */
export function sheets(device: Device): boolean {
  return device === "phone";
}

/**
 * Measures how much of a pane a sheet at the foot of the screen covers.
 * `bottom` is the pane's lower edge, from the top of the screen.
 */
export function sheetCover(screen: number, sheet: number, bottom: number): number {
  return Math.max(0, bottom - Math.max(screen - sheet, 0));
}

/** The room a pinned box keeps over it for its tag, and under it before the sheet, in pixels. */
export const TAG_ROOM = 28;
export const SHEET_GAP = 12;

/**
 * Measures how far the page moves up so a sheet at the foot of the
 * screen clears a pinned box. `box` is the box's upper and lower edges
 * before any move, `well` is the upper edge of what the page is drawn
 * in, and `sheet` is the sheet's upper edge. The box stops under the
 * top of the well, so a box taller than the room keeps its tag.
 */
export function liftFor(
  box: { top: number; bottom: number },
  well: number,
  sheet: number,
): number {
  const covered = box.bottom + SHEET_GAP - sheet;
  const room = box.top - TAG_ROOM - well;
  return Math.max(0, Math.round(Math.min(covered, room)));
}

/** The place the page number, the arrows and the count of issues are drawn. */
export type Foot = "status" | "under" | "bar";

/** The narrowest pane of a tablet whose bar holds the foot beside the chapter. */
export const BAR_ROOM = 700;

/**
 * Places the foot. Mobile has no status bar. An upright phone draws
 * the foot under the page, where a thumb reaches it, and a phone on its
 * side has no height to spare for it. A tablet's bar holds it in a pane
 * with the width, which a split pane or a pinned drawer can take away.
 */
export function footPlace(
  device: Device,
  pane: { width: number; height: number },
): Foot {
  if (device === "desktop") return "status";
  if (device === "tablet") return pane.width >= BAR_ROOM ? "bar" : "under";
  return pane.width > pane.height ? "bar" : "under";
}
