/**
 * The design panel, reached by the test ids in its own markup.
 *
 * The picker lists the families the scan found, so a spec types to
 * narrow that list rather than naming a face. Every wait here is on
 * the panel's own state rather than on a clock.
 */

import { expect, type Locator } from "@playwright/test";
import type { Obsidian } from "./obsidian";

/** The command that opens the panel. */
export const OPEN_PANEL = "orca:open-design";

/** The type the panel is registered under. */
export const PANEL = "orca-design";

export class Panel {
  /** The panel itself, drawn when there is a book to design. */
  readonly panel: Locator;
  /** The closed field, which shows the family the book is set in. */
  readonly face: Locator;
  /** The filter, which narrows the list rather than naming a family. */
  readonly filter: Locator;
  /** The list of families, which carries the number of them shown. */
  readonly rows: Locator;
  readonly options: Locator;
  /** The empty state, shown when nothing matches what was typed. */
  readonly nothing: Locator;
  /** The cuts the engine registered for the family the book is set in. */
  readonly cuts: Locator;
  /** The warning for a family the machine does not have. */
  readonly missing: Locator;

  constructor(private readonly obsidian: Obsidian) {
    const pane = obsidian.view(PANEL);
    this.panel = pane.getByTestId("orca-panel");
    this.face = pane.getByTestId("orca-panel-face");
    this.filter = pane.getByTestId("orca-panel-filter");
    this.rows = pane.getByTestId("orca-panel-rows");
    this.options = pane.getByTestId("orca-panel-option");
    this.nothing = pane.getByTestId("orca-panel-nothing");
    this.cuts = pane.getByTestId("orca-panel-cut");
    this.missing = pane.getByTestId("orca-panel-missing");
  }

  /** Opens the panel and waits for it to be drawn. */
  async open(): Promise<void> {
    await this.obsidian.command(OPEN_PANEL);
    await expect(this.panel).toBeVisible();
  }

  /**
   * Clicks the panel's own tab, which makes it the active leaf. Every
   * leaf change repaints the panel, so this is what an author does that
   * asks it for the book again.
   */
  async focus(): Promise<void> {
    await this.obsidian.tab("Design").first().click();
  }

  /** Opens the picker and waits for its filter. */
  async pick(): Promise<void> {
    await this.face.click();
    await expect(this.filter).toBeVisible();
  }

  /** Types into the filter, which narrows the list. */
  async type(typed: string): Promise<void> {
    await this.filter.fill(typed);
  }

  /** The families in the list, in the order they are shown. */
  async offered(): Promise<string[]> {
    return this.options.allTextContents();
  }

  /** The number of families the list shows, which a filter changes. */
  async offering(): Promise<number> {
    return Number(await this.rows.getAttribute("data-offered"));
  }

  /** The family the closed field shows. */
  async reading(): Promise<string> {
    return (await this.face.textContent()) ?? "";
  }

  /** The styles the panel shows, which are the cuts the engine registered. */
  async styles(): Promise<string[]> {
    return this.cuts.allTextContents();
  }

  /** The axes a cut sits on, by the name of its style. */
  async axes(style: string): Promise<string> {
    return (
      (await this.cuts
        .filter({ hasText: style })
        .first()
        .getAttribute("data-axes")) ?? ""
    );
  }

  async close(): Promise<void> {
    await this.obsidian.detach(PANEL);
  }
}
