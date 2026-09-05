/**
 * Orca's preview, reached by the test ids in its own markup.
 *
 * The surface has the generation last painted into it and what
 * that render cost in stage runs, so every wait here is on the page
 * rather than on a clock.
 */

import { expect, type Locator } from "@playwright/test";
import type { Stages } from "@/engine/session";
import type { Obsidian } from "./obsidian";

/** The type the preview is registered under. */
export const PREVIEW = "orca-book-preview";

export class Book {
  /** The node the page is written into. */
  readonly surface: Locator;
  /** The page itself: one `<svg>` the painter wrote in one go. */
  readonly page: Locator;

  constructor(private readonly obsidian: Obsidian) {
    this.surface = obsidian.view(PREVIEW).getByTestId("orca-page");
    this.page = this.surface.locator("svg");
  }

  /** Opens the book from the ribbon. */
  async open(): Promise<void> {
    await this.obsidian.ribbon("Open the book").click();
  }

  async close(): Promise<void> {
    await this.obsidian.detach(PREVIEW);
  }

  /** The generation on the surface, once there is one. */
  async painted(): Promise<number> {
    await expect(this.surface).toHaveAttribute("data-generation", /\d+/);
    return Number(await this.surface.getAttribute("data-generation"));
  }

  async stages(): Promise<Stages> {
    const runs = async (stage: string): Promise<number> =>
      Number(await this.surface.getAttribute(`data-stage-${stage}`));
    return {
      style: await runs("style"),
      lines: await runs("lines"),
      flow: await runs("flow"),
      paint: await runs("paint"),
    };
  }
}
