import type { Locator } from "@playwright/test";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The box an element is drawn in. Throws for one that is not drawn.
 * A dialog on mobile slides into place, so the box is read once every
 * animation that ends has ended.
 */
export async function boxOf(of: Locator): Promise<Box> {
  await of.evaluate(async () => {
    const ending = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.allSettled(ending.map((animation) => animation.finished));
  });
  const box = await of.boundingBox();
  if (box === null) throw new Error("the element is not drawn");
  return box;
}

/** The pixels two edges may differ by and still be the same edge. */
export const NEAR = 1;
