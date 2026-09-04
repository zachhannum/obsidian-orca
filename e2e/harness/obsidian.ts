/**
 * Obsidian's own class names and its app object, in one file, so an
 * Obsidian release breaks one file. Orca's markup carries test ids and
 * is reached by those instead.
 */

import type { Browser, Locator, Page } from "@playwright/test";
import type { App } from "obsidian";

declare global {
  interface Window {
    /** Undefined until Obsidian has opened the vault. */
    app: App;
  }
}

const CHROME = {
  ribbon: (label: string) => `.side-dock-ribbon-action[aria-label="${label}"]`,
  leaf: (type: string) => `.workspace-leaf-content[data-type="${type}"]`,
  action: (label: string) => `.view-action[aria-label="${label}"]`,
};

/**
 * The size every page is laid out and photographed at. Obsidian opens
 * its window at the size of the display it is on, so the renderer is
 * given these metrics instead and every run lays the page out the same.
 */
const WINDOW = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };

/** How long the window is given to appear, in milliseconds. */
const APPEARING = 60_000;

export class Obsidian {
  private constructor(readonly page: Page) {}

  /** The window, sized, with its workspace restored. */
  static async attach(browser: Browser): Promise<Obsidian> {
    const page = await renderer(browser);
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", WINDOW);
    await page.waitForFunction(
      () => window.app?.workspace.layoutReady === true,
      undefined,
      { timeout: APPEARING },
    );
    return new Obsidian(page);
  }

  /** A ribbon action, by the label the plugin gave it. */
  ribbon(label: string): Locator {
    return this.page.locator(CHROME.ribbon(label));
  }

  /** The pane a view of this type is drawn in. */
  view(type: string): Locator {
    return this.page.locator(CHROME.leaf(type));
  }

  /** A view's own action, by the label the view gave it. */
  action(label: string): Locator {
    return this.page.locator(CHROME.action(label));
  }

  /**
   * A note, opened in the active pane. Obsidian parses a note into the
   * metadata cache as it is written, so the wait here is on the cache
   * holding the note rather than on a clock.
   */
  async open(path: string): Promise<void> {
    await this.page.waitForFunction(
      (at) => window.app.metadataCache.getCache(at) !== null,
      path,
    );
    await this.page.evaluate(async (at) => {
      const file = window.app.vault.getFileByPath(at);
      if (file === null) throw new Error(`no note at ${at}`);
      await window.app.workspace.getLeaf(false).openFile(file);
    }, path);
  }

  /** Closes every leaf holding a view of this type. */
  async detach(type: string): Promise<void> {
    await this.page.evaluate((of) => {
      for (const leaf of window.app?.workspace.getLeavesOfType(of) ?? []) {
        leaf.detach();
      }
    }, type);
  }
}

/**
 * The renderer holding the vault. The window appears some time after
 * the process starts, so the harness reads the target list until a page
 * has an app on it.
 */
async function renderer(browser: Browser): Promise<Page> {
  const deadline = Date.now() + APPEARING;
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const opened = await page
          .evaluate(() => window.app?.vault.getName() !== undefined)
          .catch(() => false);
        if (opened) return page;
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`no Obsidian window in ${APPEARING}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
