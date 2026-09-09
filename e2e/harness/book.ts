/**
 * Orca's preview, reached by the test ids in its own markup.
 *
 * The surface has the generation last painted into it and what
 * that render cost in stage runs, so every wait here is on the page
 * rather than on a clock.
 */

import { expect, type Locator, type Worker } from "@playwright/test";
import { engineName } from "@/engine/pool";
import type { Stages } from "@/engine/session";
import { FLOATING, type Obsidian } from "./obsidian";

/** The command that splits the pane and ties the two. */
export const TO_THE_RIGHT = "orca:preview-to-the-right";

/** The same split, run from the book's side. */
export const TO_THE_LEFT = "orca:manuscript-to-the-left";

/** The commands that turn the book a chapter at a time. */
export const NEXT_CHAPTER = "orca:next-chapter";
export const PREVIOUS_CHAPTER = "orca:previous-chapter";

/** The item a chapter's own menu carries for that split. */
export const SPLIT = "Open preview to the right";

/** The label of the action that hands the pane back to the manuscript. */
const AS_MARKDOWN = "Open as markdown";

declare global {
  interface Window {
    /** The recorder a spec installs while `noticed` runs. */
    orcaSetting?: { said: Notice[]; watch: MutationObserver } | undefined;
  }
}

/** One notice the pane put up while a book was being set. */
export interface Notice {
  /** The words it put on screen. */
  said: string;
  /** Set on a notice that says the book is being set again. */
  again: boolean;
  /** The pages on screen under it. */
  pages: number;
}

/** The trim the page is photographed at, in whole pixels. */
const POSE = { width: 360, height: 540 };

/** The id of the style tag that carries the pose. */
const POSED = "orca-photograph";

/** The type the preview is registered under. */
export const PREVIEW = "orca-book-preview";

/** The note the surface names for a page nobody wrote. */
export const NOWHERE = "-";

export class Book {
  /** The node the view's pages are written into. */
  readonly surface: Locator;
  /** Every sheet the view seats, empty slots included. */
  readonly sheets: Locator;
  /** The first page itself: one `<svg>` the painter wrote in one go. */
  readonly page: Locator;
  /** The folio being read, which an author can type into. */
  readonly folio: Locator;
  /** The chapter control, which names the chapter on screen. */
  readonly chapter: Locator;
  /** The name that control is showing. */
  readonly chapterName: Locator;
  /** The images the painted pages draw. */
  readonly images: Locator;
  /** The bar's count of what the last run had to complain about. */
  readonly warnings: Locator;
  /** The warnings themselves, as the count opens them. */
  readonly issues: Locator;
  /** The status bar item that reads `page 1 of 2`. */
  readonly status: Locator;
  readonly previous: Locator;
  readonly next: Locator;
  /** The state the pane holds while a cold session typesets the whole book. */
  readonly setting: Locator;
  /** The state the pane holds once orca has stopped setting the book. */
  readonly held: Locator;
  /** The offer of what each stop said. */
  readonly report: Locator;
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
    this.images = this.surface.locator("image");
    this.warnings = pane.getByTestId("orca-warnings");
    this.issues = pane.getByTestId("orca-issues").locator(".orca-preview-issue");
    this.folio = pane.getByTestId("orca-folio");
    this.chapter = pane.getByTestId("orca-chapter");
    this.chapterName = this.chapter.locator("option:checked");
    // The folio being read is Obsidian's own status bar item, outside
    // the pane, which is where the artboard draws it.
    this.status = obsidian.page.getByTestId("orca-status");
    this.previous = pane.getByLabel("Previous page");
    this.next = pane.getByLabel("Next page");
    this.setting = pane.getByTestId("orca-setting");
    this.held = pane.getByTestId("orca-held");
    this.report = pane.getByTestId("orca-report");
    this.asMarkdown = obsidian.action(AS_MARKDOWN);
    this.panes = pane;
  }

  /**
   * Records the state the pane holds while the book is being set, for
   * as long as `during` runs. A whole book is typeset once a session,
   * so the state is recorded as it appears rather than looked for
   * after the pages have replaced it.
   */
  async settings(during: () => Promise<void>): Promise<string[]> {
    return (await this.noticed(during)).map((notice) => notice.said);
  }

  /**
   * The same, with what stood under each notice. A book set for the
   * first time has no pages yet; one set again has the pages it last
   * painted, and they stay.
   */
  async noticed(during: () => Promise<void>): Promise<Notice[]> {
    await this.obsidian.page.evaluate(() => {
      const said: Notice[] = [];
      const collect = (node: Node): void => {
        if (!(node instanceof HTMLElement)) return;
        const found = node.matches("[data-testid=\'orca-setting\']")
          ? node
          : node.querySelector("[data-testid=\'orca-setting\']");
        if (found === null) return;
        said.push({
          said: found.textContent ?? "",
          again: found.classList.contains("mod-again"),
          pages: document.querySelectorAll(".orca-page").length,
        });
      };
      const watch = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) collect(node);
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
    return this.obsidian.page.evaluate(() => {
      const recorded = window.orcaSetting?.said ?? [];
      window.orcaSetting = undefined;
      return recorded;
    });
  }

  /**
   * Kills the worker the engine runs in. The worker throws where
   * nothing catches it, which is the one death the main thread sees.
   */
  async kill(book: string): Promise<Worker> {
    let engine: Worker | undefined;
    // A worker orca started reaches the page objects a moment after
    // orca started it, so the wait here is for the attach rather than
    // for anything orca is doing.
    await expect
      .poll(async () => {
        engine = await this.engine(book);
        return engine !== undefined;
      })
      .toBe(true);
    const killed = engine;
    if (killed === undefined) throw new Error(`no engine is running ${book}`);
    await killed.evaluate(() => {
      queueMicrotask(() => {
        throw new Error("the engine was killed");
      });
    });
    return killed;
  }

  /** Waits for orca to start a worker on this book other than the one that died. */
  async restarted(book: string, killed: Worker): Promise<void> {
    await expect
      .poll(async () => {
        const engine = await this.engine(book);
        return engine !== undefined && engine !== killed;
      })
      .toBe(true);
  }

  /** The workers orca has running on this book. */
  async engines(book: string): Promise<number> {
    let running = 0;
    for (const worker of this.obsidian.page.workers()) {
      if ((await named(worker)) === engineName(book)) running += 1;
    }
    return running;
  }

  /** The worker this book's engine runs in, of every worker the page has. */
  private async engine(book: string): Promise<Worker | undefined> {
    for (const worker of this.obsidian.page.workers()) {
      if ((await named(worker)) === engineName(book)) return worker;
    }
    return undefined;
  }

  /** Splits the pane and ties the two, the way the palette runs it. */
  async split(): Promise<void> {
    await this.obsidian.command(TO_THE_RIGHT);
  }

  /** Splits the manuscript out beside the book, from the book's side. */
  async manuscriptBeside(): Promise<void> {
    await this.obsidian.command(TO_THE_LEFT);
  }

  /** Turns to `folio` by typing it, the way an author reaches a page. */
  async type(folio: string): Promise<void> {
    await this.folio.fill(folio);
    await this.folio.press("Enter");
  }

  /** Turns to a chapter by name, the way a reader picks one off the bar. */
  async choose(name: string): Promise<void> {
    await this.chapter.selectOption({ label: name });
  }

  /** Every chapter the control offers, in reading order. */
  async offered(): Promise<string[]> {
    return this.chapter.locator("option").allTextContents();
  }

  /** Presses a key at the page, which is what the page-through listens on. */
  async press(key: string): Promise<void> {
    await this.surface.click();
    await this.surface.press(key);
  }

  /** Presses a key where the focus already is, without moving it. */
  async key(key: string): Promise<void> {
    await this.obsidian.page.keyboard.press(key);
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

  /** Opens a second pane on the book, in a tab beside the one open. */
  async again(): Promise<void> {
    await this.obsidian.page.evaluate(async (type) => {
      const open = window.app.workspace.getLeavesOfType(type)[0];
      const state = open?.getViewState();
      if (state === undefined) throw new Error("no book is open");
      await window.app.workspace.getLeaf("tab").setViewState(state);
    }, PREVIEW);
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
   * sizes the pane a hair differently rasterizes every glyph
   * differently. Where the page stands is what the assertions are for.
   */
  async pose(): Promise<void> {
    await this.obsidian.page.evaluate(
      ([floating, id, trim]) => {
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
        pose.id = id;
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
    await this.obsidian.page.evaluate((id) => {
      document.getElementById(id)?.remove();
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

/** The name a worker runs under, or nothing for one already gone. */
function named(worker: Worker): Promise<string | undefined> {
  return worker.evaluate(() => self.name).catch(() => undefined);
}
