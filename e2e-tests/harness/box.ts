import type { Locator } from "@playwright/test";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Waits for an element to come to rest: every animation that ends has
 * ended, and its box is the same two frames later. A drawer or a sheet
 * on mobile slides into place, and a box read on the way is the box of
 * no layout the author sees.
 */
export async function still(of: Locator): Promise<void> {
  await of.evaluate(async (drawn) => {
    const frame = (): Promise<void> =>
      new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          resolve();
        });
      });
    const read = (): string => {
      const { x, y, width, height } = drawn.getBoundingClientRect();
      return [x, y, width, height].join();
    };
    for (;;) {
      const ending = document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
      await Promise.allSettled(ending.map((animation) => animation.finished));
      const before = read();
      await frame();
      await frame();
      if (ending.length === 0 && read() === before) return;
    }
  });
}

/** The box an element is drawn in, once it is at rest. Throws for one that is not drawn. */
export async function boxOf(of: Locator): Promise<Box> {
  await still(of);
  const box = await of.boundingBox();
  if (box === null) throw new Error("the element is not drawn");
  return box;
}

/**
 * The boxes of elements that are compared with each other, read until
 * two readings running agree. Each element comes to rest on its own,
 * and a dialog that moves between two reads would put its buttons in
 * places they never held together.
 */
export async function boxesOf(...of: Locator[]): Promise<Box[]> {
  for (;;) {
    const before = await Promise.all(of.map(boxOf));
    const after = await Promise.all(of.map(boxOf));
    if (JSON.stringify(before) === JSON.stringify(after)) return after;
  }
}

/** The pixels two edges may differ by and still be the same edge. */
export const NEAR = 1;
