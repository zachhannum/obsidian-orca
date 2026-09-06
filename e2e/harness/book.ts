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
  /** The folio being read, which an author can type into. */
  readonly folio: Locator;
  /** The status bar item that reads `page 1 of 2`. */
  readonly status: Locator;
  readonly previous: Locator;
  readonly next: Locator;

  constructor(private readonly obsidian: Obsidian) {
    const pane = obsidian.view(PREVIEW);
    this.surface = pane.getByTestId("orca-page");
    this.page = this.surface.locator("svg");
    this.folio = pane.getByTestId("orca-folio");
    // The folio being read is Obsidian's own status bar item, outside
    // the pane, which is where the artboard draws it.
    this.status = obsidian.page.getByTestId("orca-status");
    this.previous = pane.getByLabel("Previous page");
    this.next = pane.getByLabel("Next page");
  }

  /** Turns to `folio` by typing it, the way an author reaches a page. */
  async type(folio: string): Promise<void> {
    await this.folio.fill(folio);
    await this.folio.press("Enter");
  }

  /** Presses a key at the page, which is what the page-through listens on. */
  async press(key: string): Promise<void> {
    await this.surface.click();
    await this.surface.press(key);
  }

  /** The folio the surface says it painted, once it says one. */
  async reading(): Promise<number> {
    await expect(this.surface).toHaveAttribute("data-page", /\d+/);
    return Number(await this.surface.getAttribute("data-page"));
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
