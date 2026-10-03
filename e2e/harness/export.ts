/**
 * Orca's export dialog, reached by the test ids in its own markup.
 *
 * The dialog writes the state it is in onto the modal, so every wait
 * here is on that attribute rather than on a clock.
 */

import { expect, type Locator } from "@playwright/test";
import { PREVIEW } from "./book";
import type { Obsidian } from "./obsidian";

/** The command that opens the dialog on the active book. */
export const EXPORT_PDF = "orca:export-pdf";

/**
 * The selector of what orca draws in the dialog, for a sweep of the
 * controls under it. The modal's own close button is Obsidian's.
 */
export const DIALOG = ".orca-export-host";

/** The dialog, measured with its list of errors scrolled to the end. */
export interface Scrolled {
  /** The height of the list that is out of sight until it scrolls. */
  hidden: number;
  /** The height of the modal that is out of sight, which is none. */
  spill: number;
  /** The distance the row of formats moved as the list scrolled. */
  moved: number;
  /** The row of formats is inside the modal. */
  formats: boolean;
  /** Export and Cancel are inside the modal and the window. */
  buttons: boolean;
  /** The last error is in sight inside the list. */
  last: boolean;
}

/** A file the stand-in for the share sheet was handed. */
export interface Handed {
  name: string;
  type: string;
  bytes: Buffer;
}

export class Export {
  readonly cancel: Locator;
  /** The button that shuts a written export. */
  readonly done: Locator;
  /** The label of the Save to field. */
  readonly label: Locator;
  /** The modal, which carries `data-state`, `data-formats` and `data-errors`. */
  readonly dialog: Locator;
  /**
   * The rows of a written export, one per file. Each carries
   * `data-format`, `data-bytes`, and `data-leaves` for a paged format.
   */
  readonly files: Locator;
  /** The Save to field, which holds the path the files share, before each extension. */
  readonly destination: Locator;
  /** The button that asks the OS where the file goes. */
  readonly choose: Locator;
  /** The Export button. */
  readonly write: Locator;
  /** The red cards for the errors that stand. */
  readonly errors: Locator;
  /** The box the red cards scroll in. */
  readonly list: Locator;
  /** The link on a red card that goes to where the error is fixed. */
  readonly fixes: Locator;
  /** The grabber a phone draws at the top of the dialog. A tap on it closes the dialog. */
  readonly grabber: Locator;
  /** The line under the errors that says the rest is fine. */
  readonly fine: Locator;
  /** The footer line. */
  readonly said: Locator;
  /** The button a written PDF's row offers, which opens it in the vault. */
  readonly openPdf: Locator;
  /** The button a written PDF offers on a device that can share a file. */
  readonly share: Locator;

  constructor(private readonly obsidian: Obsidian) {
    this.dialog = obsidian.page.getByTestId("orca-export");
    this.files = this.dialog.getByTestId("orca-export-file");
    this.destination = this.dialog.getByTestId("orca-export-destination");
    this.choose = this.dialog.getByTestId("orca-export-choose");
    this.write = this.dialog.getByTestId("orca-export-write");
    this.cancel = this.dialog.getByTestId("orca-export-cancel");
    this.done = this.dialog.getByTestId("orca-export-done");
    this.label = this.dialog.getByTestId("orca-export-label");
    this.errors = this.dialog.getByTestId("orca-export-error");
    this.list = this.dialog.getByTestId("orca-export-list");
    this.fixes = this.dialog.getByTestId("orca-export-fix");
    this.grabber = this.dialog.getByTestId("orca-sheet-grabber");
    this.fine = this.dialog.getByTestId("orca-export-fine");
    this.said = this.dialog.getByTestId("orca-export-said");
    this.openPdf = this.dialog.getByTestId("orca-export-open");
    this.share = this.dialog.getByTestId("orca-export-share");
  }

  /**
   * Opens the dialog the way the palette runs it, from the book. A leaf
   * an earlier spec focused, like the design panel, stays active when
   * the book opens, so the preview is put in front first.
   */
  async open(): Promise<void> {
    await this.obsidian.page.evaluate((type) => {
      const preview = window.app.workspace.getLeavesOfType(type)[0];
      if (preview !== undefined) window.app.workspace.setActiveLeaf(preview, { focus: true });
    }, PREVIEW);
    await this.obsidian.command(EXPORT_PDF);
    await expect(this.dialog).toBeVisible();
  }

  /** Ticks the formats named by their targets' ids, and only those. */
  async formats(...ids: string[]): Promise<void> {
    for (const box of await this.dialog.locator("[data-testid^='orca-export-format-']").all()) {
      const id = ((await box.getAttribute("data-testid")) ?? "").slice("orca-export-format-".length);
      await box.setChecked(ids.includes(id));
    }
    await expect(this.dialog).toHaveAttribute("data-formats", ids.join(" "));
  }

  /** The row of the file a written export wrote in one format. */
  file(id: string): Locator {
    return this.files.and(this.dialog.locator(`[data-format="${id}"]`));
  }

  /**
   * Scrolls the list of errors to its end and measures the dialog
   * around it. Lengths are in CSS pixels.
   */
  async scrolled(): Promise<Scrolled> {
    return this.dialog.evaluate((modal) => {
      const part = (id: string): HTMLElement => {
        const found = modal.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (found === null) throw new Error(`the dialog has no ${id}`);
        return found;
      };
      const inside = (inner: DOMRect, outer: DOMRect): boolean =>
        inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
      const list = part("orca-export-list");
      const formats = part("orca-export-formats");
      const before = formats.getBoundingClientRect().top;
      const hidden = list.scrollHeight - list.clientHeight;
      list.scrollTop = list.scrollHeight;
      const frame = modal.getBoundingClientRect();
      const screen = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const buttons = [part("orca-export-write"), part("orca-export-cancel")].map((button) =>
        button.getBoundingClientRect(),
      );
      const last = list.lastElementChild?.getBoundingClientRect();
      return {
        hidden,
        spill: modal.scrollHeight - modal.clientHeight,
        moved: formats.getBoundingClientRect().top - before,
        formats: inside(formats.getBoundingClientRect(), frame),
        buttons: buttons.every((box) => inside(box, frame) && inside(box, screen)),
        last: last !== undefined && inside(last, list.getBoundingClientRect()),
      };
    });
  }

  /**
   * Stands in for the system share sheet, which CDP cannot reach. The
   * dialog reads `navigator` as it opens, so this comes before `open`.
   * Mobile emulation reloads the window, which takes the stand-in away.
   */
  async sharing(): Promise<void> {
    await this.obsidian.page.evaluate(() => {
      const sheet: NonNullable<Window["orcaShare"]> = { cancels: false, handed: [] };
      window.orcaShare = sheet;
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: (data: ShareData) => (data.files?.length ?? 0) > 0,
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          for (const file of data.files ?? []) {
            const bytes = new Uint8Array(await file.arrayBuffer());
            let said = "";
            for (let from = 0; from < bytes.length; from += 0x8000) {
              said += String.fromCharCode(...bytes.subarray(from, from + 0x8000));
            }
            sheet.handed.push({ name: file.name, type: file.type, bytes: btoa(said) });
          }
          if (sheet.cancels) {
            throw new DOMException("Abort due to cancellation of share.", "AbortError");
          }
        },
      });
    });
  }

  /** Sets whether the author shuts the stand-in share sheet without sharing. */
  async cancels(on: boolean): Promise<void> {
    await this.obsidian.page.evaluate((cancels) => {
      if (window.orcaShare !== undefined) window.orcaShare.cancels = cancels;
    }, on);
  }

  /** The files the stand-in share sheet was handed, in order. */
  async handed(): Promise<Handed[]> {
    const handed = await this.obsidian.page.evaluate(() => window.orcaShare?.handed ?? []);
    return handed.map((file) => ({ ...file, bytes: Buffer.from(file.bytes, "base64") }));
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
