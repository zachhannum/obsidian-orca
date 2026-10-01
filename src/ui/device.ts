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

/**
 * Places the foot. Mobile has no status bar, so the foot is under the
 * page, and a phone on its side has no height to spare for it.
 */
export function footPlace(
  device: Device,
  pane: { width: number; height: number },
): Foot {
  if (device === "desktop") return "status";
  if (device === "phone" && pane.width > pane.height) return "bar";
  return "under";
}
