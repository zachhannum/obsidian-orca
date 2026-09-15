/**
 * Orca's export dialog, reached by the test ids in its own markup.
 *
 * The dialog writes the state it is in onto the modal, so every wait
 * here is on that attribute rather than on a clock.
 */

import { expect, type Locator } from "@playwright/test";
import type { Obsidian } from "./obsidian";

/** The command that opens the dialog on the active book. */
export const EXPORT_PDF = "orca:export-pdf";

export class Export {
  /** The modal, which carries `data-state`, `data-errors`, `data-leaves` and `data-bytes`. */
  readonly dialog: Locator;
  /** The Save to field. */
  readonly destination: Locator;
  /** The button that asks the OS where the file goes. */
  readonly choose: Locator;
  /** The Export button. */
  readonly write: Locator;
  /** The red cards for the errors that stand. */
  readonly errors: Locator;
  /** The line under the errors that says the rest is fine. */
  readonly fine: Locator;
  /** The footer line. */
  readonly said: Locator;
  /** The button a written export offers, which opens the PDF in the vault. */
  readonly openPdf: Locator;

  constructor(private readonly obsidian: Obsidian) {
    this.dialog = obsidian.page.getByTestId("orca-export");
    this.destination = this.dialog.getByTestId("orca-export-destination");
    this.choose = this.dialog.getByTestId("orca-export-choose");
    this.write = this.dialog.getByTestId("orca-export-write");
    this.errors = this.dialog.getByTestId("orca-export-error");
    this.fine = this.dialog.getByTestId("orca-export-fine");
    this.said = this.dialog.getByTestId("orca-export-said");
    this.openPdf = this.dialog.getByTestId("orca-export-open");
  }

  /** Opens the dialog the way the palette runs it. */
  async open(): Promise<void> {
    await this.obsidian.command(EXPORT_PDF);
    await expect(this.dialog).toBeVisible();
  }

  /** Waits for the dialog to reach a state. */
  async reaches(state: string): Promise<void> {
    await expect(this.dialog).toHaveAttribute("data-state", state);
  }

  /** Shuts the dialog, if one is open. */
  async close(): Promise<void> {
    if ((await this.dialog.count()) === 0) return;
    await this.obsidian.page.keyboard.press("Escape");
    await expect(this.dialog).toHaveCount(0);
  }
}
