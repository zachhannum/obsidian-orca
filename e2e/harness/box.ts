import type { Locator } from "@playwright/test";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box an element is drawn in. Throws for one that is not drawn. */
export async function boxOf(of: Locator): Promise<Box> {
  const box = await of.boundingBox();
  if (box === null) throw new Error("the element is not drawn");
  return box;
}

/** The pixels two edges may differ by and still be the same edge. */
export const NEAR = 1;
