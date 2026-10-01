/**
 * The preview's EPUB view, reached by the test ids in its own markup.
 *
 * The view carries the generation its frame last loaded and the place
 * it is turned to, so every wait here is on the pane rather than on a
 * clock. The frame is sandboxed, so what it holds is read through the
 * window that owns it.
 */

import { expect, type Locator } from "@playwright/test";
import { PREVIEW } from "./book";
import type { Obsidian } from "./obsidian";

/** The switch that shows the EPUB view. */
const EPUB = "EPUB";

/** The reader's place, counting from 1 as the status line does. */
export interface Turned {
  section: number;
  sections: number;
  screen: number;
  screens: number;
}

export class Epub {
  /** The node that carries the generation, the device and the place. */
  readonly view: Locator;
  readonly frame: Locator;
  readonly device: Locator;
  /** The button that opens the reader settings. */
  readonly settings: Locator;
  readonly previous: Locator;
  readonly next: Locator;

  private readonly pane: Locator;

  constructor(obsidian: Obsidian) {
    const pane = obsidian.view(PREVIEW);
    this.pane = pane;
    this.view = pane.getByTestId("orca-reflow");
    this.frame = pane.getByTestId("orca-reflow-frame");
    this.device = pane.getByTestId("orca-reflow-device");
    this.settings = pane.getByTestId("orca-reflow-settings");
    this.previous = pane.getByTestId("orca-reflow-previous");
    this.next = pane.getByTestId("orca-reflow-next");
  }

  /** Switches the pane to the EPUB view, and returns the generation its frame loaded. */
  async open(): Promise<number> {
    await this.pane.getByLabel(EPUB, { exact: true }).click();
    return this.painted();
  }

  /** The generation the frame last loaded, once there is one. */
  async painted(): Promise<number> {
    await expect(this.view).toHaveAttribute("data-generation", /\d+/);
    return Number(await this.view.getAttribute("data-generation"));
  }

  /** The control of one reader setting, or one choice of it. */
  setting(key: string): Locator {
    return this.pane.getByTestId(`orca-reflow-setting-${key}`);
  }

  async turned(): Promise<Turned> {
    const read = async (name: string): Promise<number> =>
      Number(await this.view.getAttribute(`data-${name}`));
    return {
      section: await read("section"),
      sections: await read("sections"),
      screen: await read("screen"),
      screens: await read("screens"),
    };
  }

  /** Turns one screen on, and returns once the view says it has moved. */
  async turn(): Promise<Turned> {
    const from = await this.turned();
    await this.next.click();
    await expect
      .poll(async () => {
        const to = await this.turned();
        return to.section !== from.section || to.screen !== from.screen;
      })
      .toBe(true);
    return this.turned();
  }

  /** The `sandbox` attribute of the frame, as it is written. */
  async sandbox(): Promise<string | null> {
    return this.frame.getAttribute("sandbox");
  }

  /**
   * The first heading of the document the frame holds. A chapter's
   * document is titled as its note is, which can be the book's title,
   * so the heading is what names the chapter.
   */
  async heading(): Promise<string> {
    return this.frame.evaluate((frame: HTMLIFrameElement) =>
      (frame.contentDocument?.querySelector("h1")?.textContent ?? "").trim(),
    );
  }

  /** Every word of the document the frame holds. */
  async words(): Promise<string> {
    return this.frame.evaluate((frame: HTMLIFrameElement) =>
      (frame.contentDocument?.body.textContent ?? "").replace(/\s+/g, " "),
    );
  }

  /**
   * The sheets in the document's head, in order. A ReadiumCSS sheet is
   * named as `data-readium` names it, and any other is `own`.
   */
  async sheets(): Promise<string[]> {
    return this.frame.evaluate((frame: HTMLIFrameElement) =>
      Array.from(
        frame.contentDocument?.head.querySelectorAll('style, link[rel~="stylesheet"]') ?? [],
      ).map((sheet) => sheet.getAttribute("data-readium") ?? "own"),
    );
  }

  /** Every property the view has set on the root of the document. */
  async variables(): Promise<Record<string, string>> {
    return this.frame.evaluate((frame: HTMLIFrameElement) => {
      const style = frame.contentDocument?.documentElement.style;
      const set: Record<string, string> = {};
      if (style === undefined) return set;
      for (const name of Array.from(style)) set[name] = style.getPropertyValue(name);
      return set;
    });
  }

  /** A computed property of the document's root, as ReadiumCSS leaves it. */
  async computed(property: string): Promise<string> {
    return this.frame.evaluate((frame: HTMLIFrameElement, name) => {
      const inside = frame.contentDocument;
      const view = inside?.defaultView;
      if (inside === null || inside === undefined || view === null || view === undefined) return "";
      return view.getComputedStyle(inside.documentElement).getPropertyValue(name);
    }, property);
  }

  /**
   * The frame's own size in CSS pixels, which a scale leaves alone, the
   * size it is drawn at, and how far its document is scrolled sideways.
   */
  async measured(): Promise<{
    width: number;
    height: number;
    drawn: { width: number; height: number };
    scrolled: number;
  }> {
    return this.frame.evaluate((frame: HTMLIFrameElement) => {
      const drawn = frame.getBoundingClientRect();
      return {
        width: frame.offsetWidth,
        height: frame.offsetHeight,
        drawn: { width: drawn.width, height: drawn.height },
        scrolled: frame.contentDocument?.scrollingElement?.scrollLeft ?? -1,
      };
    });
  }
}
