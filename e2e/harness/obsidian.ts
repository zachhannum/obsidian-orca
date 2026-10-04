/**
 * Obsidian's own class names and its app object, in one file, so an
 * Obsidian release breaks one file. Orca's markup has test ids and
 * is reached by those instead.
 */

import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  type Browser,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import type { App, WorkspaceLeaf } from "obsidian";
import { COPY, OPENED, PLUGIN } from "./launch";

/** The two pieces of the app the API does not declare. */
interface Commands {
  executeCommandById(id: string): boolean;
  commands: Record<
    string,
    { name: string; checkCallback?: (checking: boolean) => boolean } | undefined
  >;
}

interface Config {
  setConfig(key: string, value: unknown): void;
}

/** The editor a markdown view holds, which the API does not declare on a leaf. */
interface Editing {
  editor: {
    getValue(): string;
    scrollIntoView(
      range: { from: { line: number; ch: number }; to: { line: number; ch: number } },
      center: boolean,
    ): void;
  };
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
  /** Turns a plugin off without writing the choice, as an update does. */
  disablePlugin(id: string): Promise<void>;
  enablePlugin(id: string): Promise<boolean>;
}

/** Obsidian's own plugins, which the API does not declare either. */
interface Internal {
  getPluginById(id: string): { disable(): void } | null;
}

/** The settings window, which the API does not declare. */
interface Settings {
  open(): void;
  close(): void;
  openTabById(id: string): unknown;
}

declare global {
  interface Window {
    /** Undefined until Obsidian has opened the vault. */
    app: App & {
      commands: Commands;
      plugins: Plugins;
      internalPlugins: Internal;
      setting: Settings;
    } & Painted;
    /** Obsidian runs its renderer with node integration on. */
    require(id: string): unknown;
    /** The recorder a spec installs while `notices` runs. */
    orcaNotices?: { said: string[]; watch: MutationObserver } | undefined;
    /** The share sheet a spec stands in for, with the files it was handed. */
    orcaShare?: {
      ends: "shares" | "cancels" | "refuses";
      handed: { name: string; type: string; bytes: string }[][];
    };
    /** The sheets the harness has adopted, by the name it gave each. */
    orcaSheets?: Record<string, CSSStyleSheet> | undefined;
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
  /** The arrows a view header draws for its leaf's history. */
  back: '.view-header-nav-buttons [aria-label="Navigate back"]',
  forward: '.view-header-nav-buttons [aria-label="Navigate forward"]',
  tab: (label: string) => `.workspace-tab-header[aria-label="${label}"]`,
  menu: ".menu",
  item: ".menu-item",
  suggestion: ".suggestion-item",
  notice: ".notice",
  status: ".status-bar",
  /** The bar a phone floats over the foot of its screen. */
  navbar: ".mobile-navbar",
  tooltip: ".tooltip",
  modal: ".modal",
  /** The container of a modal a phone docks to the foot of its screen. */
  docked: ".modal-container.mod-confirmation",
  /** The cover a modal dims the window with. A tap on it closes the modal. */
  backdrop: ".modal-bg",
  buttons: ".titlebar-button-container.mod-right",
  folder: (path: string) => `.nav-folder-title[data-path="${path}"]`,
  settings: ".modal.mod-settings",
  installed: ".setting-item",
  installedName: ".setting-item-name",
  toggle: ".checkbox-container",
  /** The box a note scrolls in, as the editor draws it. */
  editorScroller: ".cm-scroller",
  /** The box a note scrolls in, as the reader draws it. */
  readerScroller: ".markdown-preview-view",
};

export type Side = "left" | "right";

/** The chrome that floats over a pane, which a photograph of one drops. */
export const FLOATING = CHROME.status;

/**
 * The box a note scrolls in, by the view it is read in. A pane holds
 * the markup of both views, so the one being read is the one to
 * scroll.
 */
export const SCROLLER = {
  source: CHROME.editorScroller,
  preview: CHROME.readerScroller,
};

/** The chrome that appears under the pointer, which a picture drops too. */
const HOVERED = CHROME.tooltip;

/** The id of the style tag that holds a window still for a picture. */
const STILL = "orca-still";

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

/** A device the run emulates. */
export type Device = "phone" | "tablet";

/**
 * The size each device is emulated at. Obsidian calls a window a tablet
 * when both sides are 600px or more and a phone otherwise, so a phone
 * on its side is still a phone.
 */
export const DEVICES: Record<Device, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  tablet: { width: 1180, height: 820 },
};

/** The short side of Obsidian mobile's own buttons, in CSS pixels. */
export const TOUCH = 44;

/** The most of the screen above the keyboard that a sheet is as tall as. */
export const SHEET = 0.8;

/** The controls a pointer can press, which a finger has to reach too. */
const PRESSED = "button, input, select, textarea, [role=button], [role=tab], .clickable-icon";

/** The key Obsidian keeps mobile emulation under, in the renderer's storage. */
const EMULATING = "EmulateMobile";

/** Timeout for the window to appear, in milliseconds. */
const APPEARING = 60_000;

export class Obsidian {
  private constructor(
    readonly page: Page,
    private readonly session: CDPSession,
  ) {}

  /**
   * Sends one touch event over CDP. A finger is a point that goes down,
   * moves and lifts, and `points` is empty on the lift. Two fingers
   * each carry an `id`, which says which point is which finger's.
   */
  async touch(
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    points: { x: number; y: number; id?: number }[],
  ): Promise<void> {
    await this.session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  }

  /** The size the renderer was last given. */
  private sized = { width: WINDOW.width, height: WINDOW.height };

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
    // Obsidian saves the layout some time after a leaf closes, and a
    // reload before then opens the leaves the last spec closed.
    if (fresh) {
      // Emulation is kept for every vault, so a spec that died inside
      // it would leave the next one on a phone.
      await page.evaluate(async (key) => {
        await (window.app.workspace as unknown as { saveLayout(): Promise<void> }).saveLayout();
        window.localStorage.removeItem(key);
      }, EMULATING);
      await page.reload();
    }
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
   * runner's own display does not reach the shot. The scale is the
   * device pixels drawn for each CSS pixel, which leaves the layout as
   * it is.
   */
  async size(width: number, height: number, scale = 1): Promise<void> {
    this.sized = { width, height };
    await this.session.send("Emulation.setDeviceMetricsOverride", {
      ...WINDOW,
      width,
      height,
      deviceScaleFactor: scale,
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
   * Reloads the window, as Obsidian does when it starts again. Every
   * engine stops, and orca loads again and sets each book from its note.
   */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.page.waitForFunction(
      () => window.app?.workspace.layoutReady === true,
      undefined,
      { timeout: APPEARING },
    );
  }

  /**
   * Turns Obsidian's mobile emulation on or off. The app keeps the
   * setting in the renderer's storage and reloads the window, so orca
   * loads again on the paths it takes on a phone. The desktop app's
   * Node is still there under emulation.
   */
  async emulateMobile(on: boolean): Promise<void> {
    if (!on) await this.size(WINDOW.width, WINDOW.height);
    await this.page.evaluate(async () => {
      await (window.app.workspace as unknown as { saveLayout(): Promise<void> }).saveLayout();
    });
    const loaded = this.page.waitForEvent("load");
    // The app reloads the window inside the call, so the call is left
    // to run after the evaluate returns.
    await this.page.evaluate((mobile) => {
      window.setTimeout(() => {
        (window.app as unknown as { emulateMobile(on: boolean): void }).emulateMobile(mobile);
      });
    }, on);
    await loaded;
    await this.page.waitForFunction(
      // The window can still be loading, with an app that has no
      // workspace or plugins yet.
      ({ mobile, id }) =>
        window.app?.workspace?.layoutReady === true &&
        window.app.plugins?.plugins[id] !== undefined &&
        document.body.classList.contains("emulate-mobile") === mobile,
      { mobile: on, id: PLUGIN },
      { timeout: APPEARING },
    );
  }

  /**
   * Emulates a device: the window takes its size and loads on the
   * mobile paths. Obsidian reads the size as it loads, and an open view
   * hears of no change after that, so a change of device loads the
   * window again.
   */
  async mobile(device: Device, scale = 1): Promise<void> {
    const { width, height } = DEVICES[device];
    await this.size(width, height, scale);
    const emulating = await this.page.evaluate(() =>
      document.body.classList.contains("emulate-mobile"),
    );
    if (emulating) await this.reload();
    else await this.emulateMobile(true);
    await this.page.waitForFunction(
      ({ kind, id }) =>
        document.body.classList.contains(`is-${kind}`) &&
        window.app.plugins.plugins[id] !== undefined,
      { kind: device, id: PLUGIN },
      { timeout: APPEARING },
    );
  }

  /**
   * Turns the device on its side, or upright again. Only the shape of
   * the window changes: the window is not loaded again, as a device
   * that is turned is not.
   */
  async turn(): Promise<void> {
    await this.size(this.sized.height, this.sized.width);
  }

  /**
   * The controls under a root that a finger cannot reach: each one
   * drawn with a short side under the size of Obsidian mobile's own
   * buttons. A control inside a label is reached through the label, so
   * it takes the label's box.
   */
  async cramped(root: string): Promise<string[]> {
    return this.page.evaluate(
      ({ within, pressed, least }) => {
        const small: string[] = [];
        for (const top of document.querySelectorAll(within)) {
          for (const control of top.querySelectorAll<HTMLElement>(pressed)) {
            if (control.matches(":disabled") || !control.checkVisibility()) continue;
            const box = (control.closest("label") ?? control).getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            const short = Math.min(box.width, box.height);
            if (short >= least - 0.5) continue;
            const name =
              control.getAttribute("data-testid") ??
              control.getAttribute("aria-label") ??
              control.className;
            small.push(`${name} ${Math.round(box.width)}x${Math.round(box.height)}`);
          }
        }
        return small;
      },
      { within: root, pressed: PRESSED, least: TOUCH },
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

  /**
   * The same action, inside the pane a view of this type is drawn in.
   * Two views can offer an action under one label, so a click that must
   * land on one of them names the view it belongs to.
   */
  actionIn(type: string, label: string): Locator {
    return this.view(type).locator(CHROME.action(label));
  }

  /** The arrow in a view's header that walks its leaf's history one way. */
  navigateIn(type: string, way: "back" | "forward"): Locator {
    return this.view(type).locator(CHROME[way]);
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

  /** A button on the dialog Obsidian has open, by its label. */
  button(label: string): Locator {
    return this.page.locator(CHROME.modal).getByRole("button", { name: label, exact: true });
  }

  /** A folder's own row in the file tree, by its path. */
  treeItem(path: string): Locator {
    return this.page.locator(CHROME.folder(path));
  }

  /**
   * Right-clicks a row and waits for its menu. A row the tree is still
   * drawing takes a click that opens nothing, so the click is tried again
   * until a menu is up.
   */
  async contextMenu(row: Locator): Promise<void> {
    await expect(async () => {
      await row.click({ button: "right" });
      await expect(this.menu()).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
  }

  /** The settings window. */
  settings(): Locator {
    return this.page.locator(CHROME.settings);
  }

  /**
   * Opens settings on one tab, by the tab's id, as a modal in this window,
   * and returns the vault's value for opening settings in a window of
   * their own. CDP is attached to this window only.
   */
  async openSettings(tab: string): Promise<boolean | null> {
    const had = await this.page.evaluate((id) => {
      const vault = window.app.vault as unknown as Config & {
        getConfig(key: string): unknown;
      };
      const was = vault.getConfig("settingsPopoutWindow");
      vault.setConfig("settingsPopoutWindow", false);
      window.app.setting.open();
      window.app.setting.openTabById(id);
      return typeof was === "boolean" ? was : null;
    }, tab);
    await expect(this.settings()).toBeVisible();
    return had;
  }

  /** Closes settings and puts back the value `openSettings` returned. */
  async closeSettings(had: boolean | null): Promise<void> {
    await this.page.evaluate((value) => {
      window.app.setting.close();
      (window.app.vault as unknown as Config).setConfig("settingsPopoutWindow", value);
    }, had);
    await expect(this.settings()).toHaveCount(0);
  }

  /**
   * An installed community plugin's row in settings, by its name. The
   * row's name is followed by its version and author.
   */
  installed(name: string): Locator {
    return this.settings()
      .locator(CHROME.installed)
      .filter({
        has: this.page.locator(CHROME.installedName, {
          hasText: new RegExp(`^${name}\\b`),
        }),
      });
  }

  /** The toggle that turns an installed plugin on and off. */
  enabled(name: string): Locator {
    return this.installed(name).locator(CHROME.toggle);
  }

  /** One command, run the way the palette runs it. */
  async command(id: string): Promise<void> {
    await this.page.evaluate((named) => {
      if (!window.app.commands.executeCommandById(named)) {
        throw new Error(`no command called ${named}`);
      }
    }, id);
  }

  /** Whether the palette has a command at all. */
  async registered(id: string): Promise<boolean> {
    return this.page.evaluate(
      (named) => window.app.commands.commands[named] !== undefined,
      id,
    );
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

  /**
   * Turns orca off and on again in the running app, without the flag
   * that keeps it off. Obsidian keeps the plugin's tabs across it, as
   * it does when it updates the plugin.
   */
  async reloadPlugin(): Promise<void> {
    await this.page.evaluate(async (id) => {
      await window.app.plugins.disablePlugin(id);
      await window.app.plugins.enablePlugin(id);
    }, PLUGIN);
  }

  /** The tabs of one view type, in any sidebar or pane. */
  async tabs(type: string): Promise<number> {
    return this.page.evaluate((named) => {
      let found = 0;
      window.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.getViewState().type === named) found += 1;
      });
      return found;
    }, type);
  }

  /**
   * The titles of the tabs of one view type. A tab Obsidian rebuilt as
   * the "Plugin no longer active" placeholder is titled with the view
   * type itself.
   */
  async titles(type: string): Promise<string[]> {
    return this.page.evaluate((named) => {
      const found: string[] = [];
      window.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.getViewState().type === named) found.push(leaf.getDisplayText());
      });
      return found;
    }, type);
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
   * Shows a note as the text on disk: the editor in source mode, with
   * the properties written out rather than drawn as a table. A picture
   * of a note's own Markdown is of the file, not of a form over it.
   */
  async asSource(): Promise<void> {
    await this.page.evaluate(() => {
      const vault = window.app.vault as unknown as Config;
      vault.setConfig("livePreview", false);
      vault.setConfig("propertiesInDocument", "source");
      // The app reads its editor settings once, on being told to.
      window.app.workspace.updateOptions();
    });
  }

  /**
   * Scrolls the open editor to the line that begins with this text, and
   * puts it in the middle of the pane.
   */
  async scrollTo(said: string): Promise<void> {
    await this.page.evaluate((text) => {
      const [leaf] = window.app.workspace.getLeavesOfType("markdown");
      const editor = (leaf?.view as unknown as Editing | undefined)?.editor;
      if (editor === undefined) throw new Error("no editor is open");
      const at = editor
        .getValue()
        .split("\n")
        .findIndex((line) => line.startsWith(text));
      if (at < 0) throw new Error(`the note has no line starting ${text}`);
      const place = { line: at, ch: 0 };
      editor.scrollIntoView({ from: place, to: place }, true);
    }, said);
  }

  /**
   * Hides the chrome that comes and goes: the status bar, which reads
   * from whichever pane is under it, the tooltip the pointer raises,
   * and the scrollbars, which fade. A picture of any of them is a
   * picture that differs from one run to the next. The pointer goes to
   * the corner as well, so nothing under it is drawn as hovered.
   */
  async still(): Promise<void> {
    await this.page.mouse.move(0, 0);
    // The app styles its own scrollbars, so this has to outrank it.
    await this.hold(
      `${FLOATING}, ${HOVERED} { visibility: hidden }` +
        "* { scrollbar-width: none !important }" +
        "*::-webkit-scrollbar { display: none !important }",
    );
  }

  /**
   * Holds only the pointer still, for a picture of the whole window. The
   * status bar and the scrollbars stay in it. The window buttons Obsidian
   * draws on Linux and Windows go, with the room the tab bar keeps for
   * them, so the picture is the same window on every platform.
   */
  async unhovered(): Promise<void> {
    await this.page.mouse.move(0, 0);
    await this.hold(
      `${HOVERED} { visibility: hidden }` +
        `${CHROME.buttons} { display: none !important }` +
        `body { --frame-right-space: 0px !important }`,
    );
  }

  /**
   * Holds the pointer still, squares the open modal (no rounded corners,
   * no border, no shadow) and hands back a crop to it. The crop is rounded
   * inward to whole pixels, because a modal centred in the window can sit
   * on a half pixel, and a crop rounded outward takes a row of the window
   * behind it. The page the picture is shown on draws the frame.
   */
  async unframed(
    modal: Locator,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    await this.page.mouse.move(0, 0);
    await this.hold(
      `${HOVERED} { visibility: hidden }` +
        `${CHROME.modal} { border-radius: 0 !important; border: 0 !important; box-shadow: none !important }`,
    );
    const box = await modal.boundingBox();
    if (box === null) throw new Error("the modal has no box to crop to");
    const x = Math.ceil(box.x);
    const y = Math.ceil(box.y);
    return {
      x,
      y,
      width: Math.floor(box.x + box.width) - x,
      height: Math.floor(box.y + box.height) - y,
    };
  }

  private async hold(css: string): Promise<void> {
    await this.page.evaluate(
      (what) => {
        // A second hold replaces the first, so one call to moving puts
        // all of it back.
        const sheets = (window.orcaSheets ??= {});
        const sheet = sheets[what.id] ?? new CSSStyleSheet();
        sheet.replaceSync(what.css);
        if (!document.adoptedStyleSheets.includes(sheet)) {
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        }
        sheets[what.id] = sheet;
      },
      { id: STILL, css },
    );
  }

  /** Puts that chrome back. */
  async moving(): Promise<void> {
    await this.page.evaluate((id) => {
      const sheet = window.orcaSheets?.[id];
      if (sheet === undefined) return;
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (adopted) => adopted !== sheet,
      );
      delete window.orcaSheets?.[id];
    }, STILL);
  }

  /** Puts the editor back the way a vault is read by default. */
  async asRendered(): Promise<void> {
    await this.page.evaluate(() => {
      const vault = window.app.vault as unknown as Config;
      vault.setConfig("livePreview", true);
      vault.setConfig("propertiesInDocument", "visible");
      window.app.workspace.updateOptions();
    });
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

  /** Collapses a sidebar and waits for it to be out of the way. */
  async put(side: Side): Promise<void> {
    await this.collapse(side);
    await this.page.waitForFunction((on) => {
      const { leftSplit, rightSplit } = window.app.workspace;
      return (on === "left" ? leftSplit : rightSplit).collapsed;
    }, side);
  }

  /**
   * Pins a tablet's drawer beside the main area, or takes the pin off.
   * A pinned drawer is open and nothing collapses it. The API declares
   * no pin, and a phone has none.
   */
  async pin(on: boolean, side: Side = "left"): Promise<void> {
    await this.page.evaluate((want) => {
      const { leftSplit, rightSplit } = window.app.workspace;
      const split = (want.side === "left" ? leftSplit : rightSplit) as unknown as {
        setPinned(on: boolean): void;
      };
      split.setPinned(want.on);
    }, { on, side });
  }

  /**
   * The sheets on the screen that hold a test id: the modals Obsidian
   * docks to the foot of a phone's screen. With no id, every one.
   */
  sheet(testid?: string): Locator {
    const docked = this.page.locator(CHROME.docked);
    return testid === undefined ? docked : docked.filter({ has: this.page.getByTestId(testid) });
  }

  /** The cover behind a sheet. A tap on it closes the sheet. */
  backdrop(testid: string): Locator {
    return this.sheet(testid).locator(CHROME.backdrop);
  }

  /**
   * Raises the keyboard as far as a sheet can tell: emulation raises
   * none, so this sets the height Obsidian mobile reports for one.
   * `undefined` puts it away.
   */
  async keyboard(height: number | undefined): Promise<void> {
    await this.page.evaluate((px) => {
      const { style } = document.documentElement;
      if (px === undefined) style.removeProperty("--keyboard-height");
      else style.setProperty("--keyboard-height", `${String(px)}px`);
    }, height);
  }

  /** Opens a sidebar as the author does, and waits for it to be open. */
  async expand(side: Side): Promise<void> {
    await this.page.evaluate((on) => {
      const { leftSplit, rightSplit } = window.app.workspace;
      (on === "left" ? leftSplit : rightSplit).expand();
    }, side);
    await this.page.waitForFunction((on) => {
      const { leftSplit, rightSplit } = window.app.workspace;
      return !(on === "left" ? leftSplit : rightSplit).collapsed;
    }, side);
  }

  /**
   * Makes a view the tab of the drawer it is in, and leaves the drawer
   * as it is. The API declares no call that picks a drawer's tab.
   */
  async fronts(type: string): Promise<void> {
    await this.page.evaluate((view) => {
      const leaf = window.app.workspace.getLeavesOfType(view)[0];
      if (leaf === undefined) throw new Error(`no ${view} is open`);
      const drawer = leaf.getRoot() as unknown as { openLeaf(leaf: unknown): void };
      drawer.openLeaf(leaf);
    }, type);
  }

  /** The top of the bar a phone floats over the foot of its screen. */
  async navbar(): Promise<number> {
    const box = await this.page.locator(CHROME.navbar).boundingBox();
    if (box === null) throw new Error("the window draws no bar at its foot");
    return box.y;
  }

  /** Whether that sidebar is collapsed. */
  async collapsed(side: Side = "left"): Promise<boolean> {
    return this.page.evaluate((on) => {
      const { leftSplit, rightSplit } = window.app.workspace;
      return (on === "left" ? leftSplit : rightSplit).collapsed;
    }, side);
  }

  /**
   * Opens a sidebar and sets its width in pixels, and returns the width
   * it had. The API declares neither the width nor the setter.
   */
  async sidebar(width: number, side: Side = "right"): Promise<number> {
    const had = await this.page.evaluate((want) => {
      const { leftSplit, rightSplit } = window.app.workspace;
      const split = (want.side === "left" ? leftSplit : rightSplit) as unknown as {
        size: number;
        setSize(size: number): void;
        expand(): void;
      };
      const had = split.size;
      split.expand();
      split.setSize(want.width);
      return had;
    }, { width, side });
    // A view in a sidebar builds nothing while the sidebar is still
    // away, so the width is not set until the sidebar is open.
    await this.page.waitForFunction((on) => {
      const { leftSplit, rightSplit } = window.app.workspace;
      return !(on === "left" ? leftSplit : rightSplit).collapsed;
    }, side);
    return had;
  }

  /**
   * The text a drag of one file out of the file explorer carries, as
   * the explorer's own drag start writes it. The explorer draws no row
   * inside a folded folder or behind another tab, so it is shown and
   * the file's folders are opened for the drag, and both are put back
   * after it.
   */
  async carried(path: string): Promise<string> {
    return this.page.evaluate(async (at) => {
      interface Row {
        selfEl: HTMLElement;
        collapsed?: boolean;
        setCollapsed?(collapsed: boolean): Promise<void> | void;
      }
      const [leaf] = window.app.workspace.getLeavesOfType("file-explorer");
      const rows = (leaf?.view as unknown as { fileItems: Record<string, Row | undefined> } | undefined)
        ?.fileItems;
      if (leaf === undefined || rows === undefined) throw new Error("no file explorer");
      const tabs = leaf.parent as unknown as {
        currentTab: number;
        selectTabIndex(tab: number): void;
      };
      const shown = tabs.currentTab;
      await window.app.workspace.revealLeaf(leaf);
      const folded: Row[] = [];
      const parts = at.split("/").slice(0, -1);
      for (let depth = 1; depth <= parts.length; depth += 1) {
        const folder = rows[parts.slice(0, depth).join("/")];
        if (folder?.collapsed !== true) continue;
        await folder.setCollapsed?.(false);
        folded.push(folder);
      }
      // The explorer draws an opened folder's rows on the next frame.
      await new Promise((drawn) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(drawn));
      });
      const row = rows[at]?.selfEl;
      if (row === undefined) throw new Error(`the file explorer has no row for ${at}`);
      const data = new DataTransfer();
      row.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }),
      );
      const carried = data.getData("text/plain");
      row.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: data }));
      for (const folder of folded.reverse()) await folder.setCollapsed?.(true);
      tabs.selectTabIndex(shown);
      if (carried === "") throw new Error(`the file explorer started no drag for ${at}`);
      return carried;
    }, path);
  }

  /** One row of a fuzzy pick's suggestions. */
  suggestion(): Locator {
    return this.page.locator(CHROME.suggestion);
  }

  /** The tooltip the pointer raised. */
  tooltip(): Locator {
    return this.page.locator(CHROME.tooltip);
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
            if (node.instanceOf(HTMLElement) && node.matches(selector)) {
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
    let failed: Error | undefined;
    try {
      await during();
    } catch (cause) {
      failed = cause instanceof Error ? cause : new Error(String(cause));
    }
    let said: string[] = [];
    try {
      said = await this.page.evaluate(() => {
        const notices = window.orcaNotices;
        if (notices === undefined) return [];
        notices.watch.disconnect();
        window.orcaNotices = undefined;
        return notices.said;
      });
    } catch (cause) {
      // A page that is gone cannot be read, and the reason it is gone
      // is what the spec should report. On the way out of a block that
      // finished, nothing was recorded and no list of what was said
      // can be answered for.
      if (failed === undefined) throw cause;
    }
    if (failed !== undefined) throw failed;
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

  /**
   * Closes every leaf with a view of this type, a deferred one included.
   * A background tab holds the type in its state and no view yet, and a
   * reload of the window would open it beside the leaf the next spec
   * asks for.
   */
  async detach(type: string): Promise<void> {
    await this.page.evaluate((of) => {
      const leaves: WorkspaceLeaf[] = [];
      window.app?.workspace.iterateAllLeaves((leaf) => {
        if (leaf.getViewState().type === of) leaves.push(leaf);
      });
      for (const leaf of leaves) leaf.detach();
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
    await delay(250);
  }
}
