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

/** The place the page number, the arrows and the count of warnings are drawn. */
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
