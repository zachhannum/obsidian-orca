/**
 * The design panel, reached by the test ids in its own markup.
 *
 * The picker offers the families the scan found, so what a spec types
 * narrows the list rather than naming a face. Every wait here is on
 * what the panel or the pages painted.
 */

import { expect, type Locator } from "@playwright/test";
import type { Obsidian } from "./obsidian";

/** The command that opens the panel, the way the palette runs it. */
export const OPEN_PANEL = "orca:open-design";

/** The type the panel is registered under. */
export const PANEL = "orca-design";

export class Panel {
  /** The panel itself, once it has a book to design. */
  readonly panel: Locator;
  /** The closed field, which reads the family the book is set in. */
  readonly face: Locator;
  /** The filter, which narrows the list rather than naming a family. */
  readonly filter: Locator;
  /** The list of families, and the count it says it is offering. */
  readonly rows: Locator;
  readonly options: Locator;
  /** The state the list holds when nothing matches what was typed. */
  readonly nothing: Locator;
  /** The cuts the engine registered for the family the book is set in. */
  readonly cuts: Locator;
  /** The complaint a family the machine does not have raises. */
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

  /** Opens the panel and waits for it to have read the machine's faces. */
  async open(): Promise<void> {
    await this.obsidian.command(OPEN_PANEL);
    await expect(this.panel).toBeVisible();
  }

  /** Opens the picker, which is where the index is offered. */
  async pick(): Promise<void> {
    await this.face.click();
    await expect(this.filter).toBeVisible();
  }

  /** Types into the filter, which narrows what is offered. */
  async type(typed: string): Promise<void> {
    await this.filter.fill(typed);
  }

  /** The families the list is offering, in the order it offers them. */
  async offered(): Promise<string[]> {
    return this.options.allTextContents();
  }

  /** The number the list says it is offering, which a filter changes. */
  async offering(): Promise<number> {
    return Number(await this.rows.getAttribute("data-offered"));
  }

  /** The family the closed field reads. */
  async reading(): Promise<string> {
    return (await this.face.textContent()) ?? "";
  }

  /** The styles the panel offers, which are the cuts the engine answered. */
  async styles(): Promise<string[]> {
    return this.cuts.allTextContents();
  }

  /** The axes a cut sits on, by the style the panel names it. */
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
