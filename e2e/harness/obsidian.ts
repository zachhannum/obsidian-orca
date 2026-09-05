/**
 * Obsidian's own class names and its app object, in one file, so an
 * Obsidian release breaks one file. Orca's markup has test ids and
 * is reached by those instead.
 */

import type { Browser, Locator, Page } from "@playwright/test";
import type { App } from "obsidian";

/** The two pieces of the app the API does not declare. */
interface Commands {
  executeCommandById(id: string): boolean;
}

interface Config {
  setConfig(key: string, value: unknown): void;
}

declare global {
  interface Window {
    /** Undefined until Obsidian has opened the vault. */
    app: App & { commands: Commands };
  }
}

/** One item on a menu, as much of it as a plugin builds. */
interface Offered {
  title: string;
  click: (() => void) | undefined;
  setTitle(said: string): Offered;
  setIcon(icon: string): Offered;
  setSection(section: string): Offered;
  onClick(heard: () => void): Offered;
}

const CHROME = {
  ribbon: (label: string) => `.side-dock-ribbon-action[aria-label="${label}"]`,
  leaf: (type: string) => `.workspace-leaf-content[data-type="${type}"]`,
  action: (label: string) => `.view-action[aria-label="${label}"]`,
  menu: ".menu",
  item: ".menu-item",
  suggestion: ".suggestion-item",
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
    // A native menu is the platform's own window: CDP can neither read
    // it nor click it, and it holds the renderer until someone answers
    // it. The run asks Obsidian for its own menus instead.
    await page.evaluate(() => {
      (window.app.vault as unknown as Config).setConfig("nativeMenus", false);
    });
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
   * metadata cache as it is written, so the wait here is on the note
   * reaching the cache rather than on a clock.
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

  /** The context menu Obsidian has open, and the items in it. */
  menu(): Locator {
    return this.page.locator(CHROME.menu);
  }

  item(title: string): Locator {
    return this.menu().locator(CHROME.item).filter({ hasText: title });
  }

  /** One command, run the way the palette runs it. */
  async command(id: string): Promise<void> {
    await this.page.evaluate((named) => {
      if (!window.app.commands.executeCommandById(named)) {
        throw new Error(`no command called ${named}`);
      }
    }, id);
  }

  /** Collapses the left sidebar, which is where the navigator lives. */
  async collapse(): Promise<void> {
    await this.page.evaluate(() => {
      window.app.workspace.leftSplit.collapse();
    });
  }

  /** Whether that sidebar is collapsed. */
  async collapsed(): Promise<boolean> {
    return this.page.evaluate(() => window.app.workspace.leftSplit.collapsed);
  }

  /** One row of a fuzzy pick's suggestions. */
  suggestion(): Locator {
    return this.page.locator(CHROME.suggestion);
  }

  /**
   * The items a file's or a folder's own context menu offers, and the
   * one `title` names, clicked. Obsidian fills that menu by asking
   * every plugin for its items, which is what this asks in its place.
   */
  async fileMenu(path: string, title?: string): Promise<string[]> {
    return this.page.evaluate(
      ({ at, clicked }) => {
        const found: { title: string; click: (() => void) | undefined }[] = [];
        const menu = {
          addItem(build: (item: Offered) => unknown) {
            const item: Offered = {
              title: "",
              click: undefined,
              setTitle(said: string) {
                item.title = said;
                return item;
              },
              setIcon: () => item,
              setSection: () => item,
              onClick(heard: () => void) {
                item.click = heard;
                return item;
              },
            };
            build(item);
            found.push(item);
            return menu;
          },
          addSeparator: () => menu,
          showAtMouseEvent: () => menu,
        };

        const file = window.app.vault.getAbstractFileByPath(at);
        if (file === null) throw new Error(`nothing at ${at}`);
        window.app.workspace.trigger("file-menu", menu, file, "orca-e2e");

        const titles = found.map((item) => item.title);
        if (clicked !== undefined) {
          const item = found.find((offered) => offered.title === clicked);
          if (item?.click === undefined) {
            throw new Error(`no \`${clicked}\` in ${titles.join(", ")}`);
          }
          item.click();
        }
        return titles;
      },
      { at: path, clicked: title },
    );
  }

  /** Closes every leaf with a view of this type. */
  async detach(type: string): Promise<void> {
    await this.page.evaluate((of) => {
      for (const leaf of window.app?.workspace.getLeavesOfType(of) ?? []) {
        leaf.detach();
      }
    }, type);
  }
}

/**
 * The renderer the vault is open in. The window appears some time after
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
