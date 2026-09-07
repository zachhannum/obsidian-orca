/**
 * Orca's preview, reached by the test ids in its own markup.
 *
 * The surface has the generation last painted into it and what
 * that render cost in stage runs, so every wait here is on the page
 * rather than on a clock.
 */

import { expect, type Locator } from "@playwright/test";
import type { Stages } from "@/engine/session";
import { FLOATING, type Obsidian } from "./obsidian";

/** The command that splits the pane and ties the two. */
export const TO_THE_RIGHT = "orca:preview-to-the-right";

/** The label of the action that hands the pane back to the manuscript. */
const AS_MARKDOWN = "Open as markdown";

declare global {
  interface Window {
    /** The recorder a spec installs while `settings` runs. */
    orcaSetting?: { said: string[]; watch: MutationObserver } | undefined;
  }
}

/** The trim the page is photographed at, in whole pixels. */
const POSE = { width: 360, height: 540 };

/** The style tag a pose is held by. */
const POSED = "orca-photograph";

/** The type the preview is registered under. */
export const PREVIEW = "orca-book-preview";

export class Book {
  /** The node the view's pages are written into. */
  readonly surface: Locator;
  /** Every sheet the view seats, empty slots included. */
  readonly sheets: Locator;
  /** The first page itself: one `<svg>` the painter wrote in one go. */
  readonly page: Locator;
  /** The folio being read, which an author can type into. */
  readonly folio: Locator;
  /** The status bar item that reads `page 1 of 2`. */
  readonly status: Locator;
  readonly previous: Locator;
  readonly next: Locator;
  /** The state the pane holds while a cold session lays the whole book out. */
  readonly setting: Locator;
  /** The action that hands the pane back to the manuscript. */
  readonly asMarkdown: Locator;
  /** Every pane reading a book. */
  readonly panes: Locator;

  private readonly pane: Locator;

  constructor(private readonly obsidian: Obsidian) {
    const pane = obsidian.view(PREVIEW);
    this.pane = pane;
    this.surface = pane.getByTestId("orca-sheets");
    this.sheets = this.surface.locator(".orca-page");
    this.page = this.surface.locator("svg").first();
    this.folio = pane.getByTestId("orca-folio");
    // The folio being read is Obsidian's own status bar item, outside
    // the pane, which is where the artboard draws it.
    this.status = obsidian.page.getByTestId("orca-status");
    this.previous = pane.getByLabel("Previous page");
    this.next = pane.getByLabel("Next page");
    this.setting = pane.getByTestId("orca-setting");
    this.asMarkdown = obsidian.action(AS_MARKDOWN);
    this.panes = pane;
  }

  /**
   * Records the state the pane holds while the book is being set, for
   * as long as `during` runs. A whole book is laid out once a session,
   * so the state is recorded as it appears rather than looked for
   * after the pages have replaced it.
   */
  async settings(during: () => Promise<void>): Promise<string[]> {
    await this.obsidian.page.evaluate(() => {
      const said: string[] = [];
      const held = (node: Node): void => {
        if (!(node instanceof HTMLElement)) return;
        const found = node.matches("[data-testid=\'orca-setting\']")
          ? node
          : node.querySelector("[data-testid=\'orca-setting\']");
        if (found !== null) said.push(found.textContent ?? "");
      };
      const watch = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) held(node);
      });
      watch.observe(document.body, { childList: true, subtree: true });
      window.orcaSetting = { said, watch };
    });

    try {
      await during();
    } finally {
      // One app runs the whole suite, so the watch comes off even when
      // `during` throws.
      await this.obsidian.page.evaluate(() => {
        window.orcaSetting?.watch.disconnect();
      });
    }
    const said = await this.obsidian.page.evaluate(() => {
      const held = window.orcaSetting?.said ?? [];
      window.orcaSetting = undefined;
      return held;
    });
    return said;
  }

  /** Splits the pane and ties the two, the way the palette runs it. */
  async split(): Promise<void> {
    await this.obsidian.command(TO_THE_RIGHT);
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

  /** The first folio the surface says it painted, once it says one. */
  async reading(): Promise<number> {
    await expect(this.surface).toHaveAttribute("data-first", /\d+/);
    return Number(await this.surface.getAttribute("data-first"));
  }

  /** The button that reads the book in one of the three views. */
  view(label: string): Locator {
    return this.pane.getByLabel(label, { exact: true });
  }

  /** Reads the book in the view `label` names, and waits for its pages. */
  async show(label: string, mode: string): Promise<void> {
    await this.view(label).click();
    await expect(this.surface).toHaveAttribute("data-view", mode);
  }

  /** The sheet in the `at`th slot, empty slots counted. */
  seat(at: number): Locator {
    return this.sheets.nth(at);
  }

  /** The pages the view says it is showing. */
  async showing(): Promise<number> {
    return Number(await this.surface.getAttribute("data-count"));
  }

  /** Opens the book from the ribbon. */
  async open(): Promise<void> {
    await this.obsidian.ribbon("Open the book").click();
  }

  async close(): Promise<void> {
    await this.obsidian.detach(PREVIEW);
  }

  /**
   * Stands the page on whole pixels, with the chrome that floats over
   * the pane out of the shot. The page is otherwise as tall as the pane
   * leaves it, so it lands on fractions of a pixel, and a runner that
   * lays the pane out a hair differently rasterizes every glyph
   * differently. Where the page stands is what the assertions are for.
   */
  async pose(): Promise<void> {
    await this.obsidian.page.evaluate(
      ([floating, held, trim]) => {
        const page = document.querySelector(".orca-page");
        if (page === null) return;
        const box = page.getBoundingClientRect();
        // Near enough where the page stands, and inside the window.
        const want = {
          top: Math.max(
            Math.min(Math.floor(box.top), window.innerHeight - trim.height),
            0,
          ),
          left: Math.max(
            Math.min(Math.floor(box.left), window.innerWidth - trim.width),
            0,
          ),
        };
        const stand = (top: number, left: number): string =>
          `${floating} { visibility: hidden }` +
          ".orca-page { position: fixed;" +
          ` width: ${String(trim.width)}px; height: ${String(trim.height)}px;` +
          ` top: ${String(top)}px; left: ${String(left)}px }`;
        const pose = document.createElement("style");
        pose.id = held;
        pose.textContent = stand(0, 0);
        document.head.append(pose);
        // A pane is the containing block for anything fixed inside it,
        // and which pane that is answers in pixels rather than in the
        // rules, so the offset is read off where the corner landed.
        const at = page.getBoundingClientRect();
        pose.textContent = stand(want.top - at.top, want.left - at.left);
      },
      [FLOATING, POSED, POSE] as const,
    );
  }

  /** Puts the pane back the way the pose found it. */
  async stand(): Promise<void> {
    await this.obsidian.page.evaluate((held) => {
      document.getElementById(held)?.remove();
    }, POSED);
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
