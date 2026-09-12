/**
 * Obsidian's own class names and its app object, in one file, so an
 * Obsidian release breaks one file. Orca's markup has test ids and
 * is reached by those instead.
 */

import path from "node:path";
import process from "node:process";
import {
  expect,
  type Browser,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import type { App } from "obsidian";
import { COPY, OPENED } from "./launch";

/** The two pieces of the app the API does not declare. */
interface Commands {
  executeCommandById(id: string): boolean;
  commands: Record<
    string,
    { checkCallback?: (checking: boolean) => boolean } | undefined
  >;
}

interface Config {
  setConfig(key: string, value: unknown): void;
}

/** The scheme Obsidian is painted in, and the theme name it goes by. */
export type Scheme = "dark" | "light";
const THEMES: Record<Scheme, string> = {
  dark: "obsidian",
  light: "moonstone",
};

/** The two calls the app makes that its API does not declare. */
interface Painted {
  changeTheme(theme: string): void;
}

/** Electron's own bridge, which the renderer reaches through `require`. */
interface Bridge {
  ipcRenderer: { sendSync(channel: string, ...args: unknown[]): unknown };
}

/** The plugins the app loaded, by id. The API does not declare them. */
interface Plugins {
  plugins: Record<string, unknown>;
}

/** Obsidian's own plugins, which the API does not declare either. */
interface Internal {
  getPluginById(id: string): { disable(): void } | null;
}

declare global {
  interface Window {
    /** Undefined until Obsidian has opened the vault. */
    app: App & {
      commands: Commands;
      plugins: Plugins;
      internalPlugins: Internal;
    } & Painted;
    /** Obsidian runs its renderer with node integration on. */
    require(id: string): unknown;
    /** The recorder a spec installs while `notices` runs. */
    orcaNotices?: { said: string[]; watch: MutationObserver } | undefined;
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
  content: (type: string) =>
    `.workspace-leaf-content[data-type="${type}"] > .view-content`,
  action: (label: string) => `.view-action[aria-label="${label}"]`,
  tab: (label: string) => `.workspace-tab-header[aria-label="${label}"]`,
  menu: ".menu",
  item: ".menu-item",
  suggestion: ".suggestion-item",
  notice: ".notice",
  status: ".status-bar",
};

export type Side = "left" | "right";

/** The chrome that floats over a pane, which a photograph of one drops. */
export const FLOATING = CHROME.status;

/**
 * The size every page is typeset and photographed at. Obsidian opens
 * its window at the size of the display it is on, so the renderer is
 * given these metrics instead and every run typesets the page the same.
 */
const WINDOW = {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
};

/** Timeout for the window to appear, in milliseconds. */
const APPEARING = 60_000;

export class Obsidian {
  private constructor(
    readonly page: Page,
    private readonly session: CDPSession,
  ) {}

  /**
   * Attaches to the window the named vault is open in, sizes it and
   * restores its workspace. A `fresh` attach reloads the window first,
   * which stops every worker the window ran and loads orca again.
   */
  static async attach(
    browser: Browser,
    fresh = false,
    vault = process.env[OPENED],
  ): Promise<Obsidian> {
    const page = await renderer(browser, vault);
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", WINDOW);
    if (fresh) await page.reload();
    await page.waitForFunction(
      () => window.app?.workspace.layoutReady === true,
      undefined,
      { timeout: APPEARING },
    );
    // A native menu is the platform's own window: CDP can neither read
    // it nor click it, and it holds the renderer until someone answers
    // it. The run asks Obsidian for its own menus instead.
    await page.evaluate(() => {
      const vault = window.app.vault as unknown as Config;
      vault.setConfig("nativeMenus", false);
      // A delete goes where the author's setting sends it. The run
      // keeps one inside the vault it opened.
      vault.setConfig("trashOption", "local");
    });
    return new Obsidian(page, session);
  }

  /**
   * Opens a second vault in a window of its own and attaches to it. It
   * is the same Obsidian: the app holds a window per vault, so a spec
   * that needs another vault costs no second process.
   */
  static async open(from: Obsidian, vault: string): Promise<Obsidian> {
    const browser = from.page.context().browser();
    if (browser === null) throw new Error("the attachment has no browser");
    await from.page.evaluate((at) => {
      const { ipcRenderer } = window.require("electron") as Bridge;
      ipcRenderer.sendSync("vault-open", at, false);
    }, vault);
    return Obsidian.attach(browser, false, path.basename(vault));
  }

  /** The sample vault's copy, which the launcher made for the run. */
  static sample(): string {
    const copy = process.env[COPY];
    if (copy === undefined) throw new Error(`${COPY} is not set`);
    return copy;
  }

  /**
   * Sizes the window. The pictures are taken at several widths, and the
   * renderer is given the metrics rather than the window resized, so a
   * runner's own display does not reach the shot.
   */
  async size(width: number, height: number): Promise<void> {
    await this.session.send("Emulation.setDeviceMetricsOverride", {
      ...WINDOW,
      width,
      height,
    });
  }

  /** Paints the app in one of the two schemes. */
  async paint(scheme: Scheme): Promise<void> {
    await this.page.evaluate((theme) => {
      window.app.changeTheme(theme);
    }, THEMES[scheme]);
    await expect(this.page.locator("body")).toHaveClass(
      new RegExp(`\\btheme-${scheme}\\b`),
    );
  }

  /**
   * Trusts this vault, so its plugins load. Obsidian asks the question
   * in a dialog the first time a vault is opened, and keeps the answer
   * in the renderer's own storage under the vault's id. The answer is
   * written here instead: a dialog nobody answers takes every click
   * meant for the window under it, and waiting for one to appear is a
   * race the window can win.
   */
  async trust(plugin: string): Promise<void> {
    await this.page.evaluate(() => {
      const { appId } = window.app as unknown as { appId: string };
      window.localStorage.setItem(`enable-plugin-${appId}`, "true");
    });
    await this.page.reload();
    await this.page.waitForFunction(
      (id) =>
        window.app?.workspace.layoutReady === true &&
        window.app.plugins.plugins[id] !== undefined,
      plugin,
      { timeout: APPEARING },
    );
  }

  /**
   * Turns off some of Obsidian's own plugins and waits for the status
   * bar to lose the items they put there.
   */
  async quieten(plugins: string[]): Promise<void> {
    await this.page.evaluate((ids) => {
      for (const id of ids) {
        window.app.internalPlugins.getPluginById(id)?.disable();
      }
    }, plugins);
    for (const id of plugins) {
      await expect(
        this.page.locator(`${CHROME.status} .plugin-${id}`),
      ).toHaveCount(0);
    }
  }

  /** Shuts this window, which leaves the app running on the vaults still open. */
  async shut(): Promise<void> {
    await this.page.evaluate(() => {
      window.close();
    });
  }

  /** A ribbon action, by the label the plugin gave it. */
  ribbon(label: string): Locator {
    return this.page.locator(CHROME.ribbon(label));
  }

  /** The pane a view of this type is drawn in. */
  view(type: string): Locator {
    return this.page.locator(CHROME.leaf(type));
  }

  /** The element under a view's header, which scrolls the view's content. */
  content(type: string): Locator {
    return this.page.locator(CHROME.content(type));
  }

  /** A view's own action, by the label the view gave it. */
  action(label: string): Locator {
    return this.page.locator(CHROME.action(label));
  }

  /** A leaf's own tab, by the name the view is displayed under. */
  tab(label: string): Locator {
    return this.page.locator(CHROME.tab(label));
  }

  /**
   * Opens a note in the active pane. Obsidian parses a note into the
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

  /**
   * Clicks an item on the open menu. Obsidian runs the item and takes
   * the menu off the page in the same task, so a menu still standing is
   * a click nothing answered, and the item is clicked again. A menu
   * already gone is a click that landed, and is never clicked twice.
   */
  async choose(title: string): Promise<void> {
    const item = this.item(title);
    await expect(item).toBeVisible();
    await expect(async () => {
      if ((await this.menu().count()) === 0) return;
      await item.click();
      await expect(this.menu()).toHaveCount(0, { timeout: 1000 });
    }).toPass({ timeout: 30_000 });
  }

  /** One command, run the way the palette runs it. */
  async command(id: string): Promise<void> {
    await this.page.evaluate((named) => {
      if (!window.app.commands.executeCommandById(named)) {
        throw new Error(`no command called ${named}`);
      }
    }, id);
  }

  /**
   * Whether a command offers itself to be run, which is what greys it
   * out of the palette. `executeCommandById` answers that it dispatched
   * rather than that the command took it, so this asks the check.
   */
  async offers(id: string): Promise<boolean> {
    return this.page.evaluate((named) => {
      const found = window.app.commands.commands[named];
      if (found === undefined) throw new Error(`no command called ${named}`);
      return found.checkCallback?.(true) === true;
    }, id);
  }

  /** The workspace as it would be written to disk, for a spec that reopens it. */
  async layout(): Promise<Record<string, unknown>> {
    return this.page.evaluate(() => window.app.workspace.getLayout());
  }

  /** Opens a workspace again, which is what a restart does to every leaf. */
  async reopen(layout: Record<string, unknown>): Promise<void> {
    await this.page.evaluate(
      async (saved) => window.app.workspace.changeLayout(saved),
      layout,
    );
  }

  /**
   * Collapses a sidebar. The navigator is in the left one and the
   * design panel is in the right one.
   */
  async collapse(side: Side = "left"): Promise<void> {
    await this.page.evaluate((on) => {
      const { leftSplit, rightSplit } = window.app.workspace;
      (on === "left" ? leftSplit : rightSplit).collapse();
    }, side);
  }

  /** Whether that sidebar is collapsed. */
  async collapsed(side: Side = "left"): Promise<boolean> {
    return this.page.evaluate((on) => {
      const { leftSplit, rightSplit } = window.app.workspace;
      return (on === "left" ? leftSplit : rightSplit).collapsed;
    }, side);
  }

  /**
   * Sets the right sidebar's width in pixels, and returns the width it
   * had. The API declares neither the width nor the setter.
   */
  async sidebar(width: number): Promise<number> {
    return this.page.evaluate((size) => {
      const split = window.app.workspace.rightSplit as unknown as {
        size: number;
        setSize(size: number): void;
      };
      const had = split.size;
      split.setSize(size);
      return had;
    }, width);
  }

  /** One row of a fuzzy pick's suggestions. */
  suggestion(): Locator {
    return this.page.locator(CHROME.suggestion);
  }

  /** The notice orca is showing. */
  notice(): Locator {
    return this.page.locator(CHROME.notice);
  }

  /**
   * Records every notice shown while `during` runs. Obsidian takes a
   * notice off the screen after a few seconds, so they are recorded as
   * they appear rather than counted afterwards.
   */
  async notices(during: () => Promise<void>): Promise<string[]> {
    await this.page.evaluate((selector) => {
      const said: string[] = [];
      // Obsidian makes the container on the first notice, so the watch
      // is on the body rather than on the container.
      const watch = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.matches(selector)) {
              said.push(node.textContent ?? "");
            }
          }
        }
      });
      watch.observe(document.body, { childList: true, subtree: true });
      window.orcaNotices = { said, watch };
    }, CHROME.notice);

    // One app runs the whole suite, so the watch comes off even when
    // `during` throws: a spec that fails inside one would otherwise
    // leave an observer on the body for every spec after it.
    let said: string[] = [];
    let ran = false;
    try {
      await during();
      ran = true;
    } finally {
      try {
        said = await this.page.evaluate(() => {
          const notices = window.orcaNotices;
          if (notices === undefined) return [];
          notices.watch.disconnect();
          window.orcaNotices = undefined;
          return notices.said;
        });
      } catch (cause) {
        // A page that is gone cannot be read, and the reason it is
        // gone is what the spec should report. On the way out of a
        // block that finished, nothing was recorded and no list of
        // what was said can be answered for.
        if (ran) throw cause;
      }
    }
    return said;
  }

  /**
   * Builds a file's or folder's context menu and clicks the item
   * `title` names. Obsidian fills that menu by asking every plugin for
   * its items, and this asks the same question in its place.
   *
   * A plugin reading the metadata cache has nothing to offer for a note
   * the cache has not taken yet, so the menu is asked again until the
   * item named is on it.
   */
  async fileMenu(path: string, title?: string): Promise<string[]> {
    if (title === undefined) return this.offered(path);
    let found: string[] = [];
    // The menu is only read while it is asked again, so an item is run
    // once however many times the menu was built.
    await expect(async () => {
      found = await this.offered(path);
      expect(found).toContain(title);
    }).toPass({ timeout: 30_000 });
    await this.offered(path, title);
    return found;
  }

  private async offered(path: string, title?: string): Promise<string[]> {
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
 * Finds the renderer page a vault is open in. The window appears some
 * time after the process starts, so the harness reads the target list
 * until a page has that vault on it. A run holds a window per vault, so
 * the name is what tells them apart.
 */
async function renderer(browser: Browser, vault?: string): Promise<Page> {
  const deadline = Date.now() + APPEARING;
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const name = await page
          .evaluate(() => window.app?.vault.getName())
          .catch(() => undefined);
        if (name !== undefined && (vault === undefined || name === vault)) {
          return page;
        }
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`no Obsidian window on ${vault ?? "a vault"} in ${APPEARING}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
