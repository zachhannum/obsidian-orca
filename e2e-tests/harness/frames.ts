/**
 * The frames of one take of a reel. A reel is real Obsidian on the
 * sample book, played in the browser from pictures of the window, and a
 * take is one run of a reel's frames in both schemes.
 *
 * A take writes `build/reel/<take>/<frame>-<scheme>.png` and one
 * `build/reel/<take>.json`, which lists the frames and the boxes the
 * player points at in them.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator } from "@playwright/test";
import { PREVIEW } from "./book";
import { DENSITY, SAMPLE } from "./launch";
import { DEVICES, type Device, type Scheme } from "./obsidian";
import type { Box, Site } from "./site";
import { Vault } from "./vault";

const root = path.resolve(fileURLToPath(import.meta.url), "../../..");

/** The folder every take writes under. */
export const REEL = path.join(root, "build/reel");

/** The window a desktop take is taken in, and the device pixels drawn for each of its CSS pixels. */
export const WINDOW = { width: 1200, height: 750 };
const SHARP = 2;

/** The schemes in the order a frame is taken in them. */
const SCHEMES: Scheme[] = ["dark", "light"];

/** The stages the preview counts, each of which runs before a page is painted. */
const STAGES = ["style", "lines", "flow", "paint"] as const;

/** The views a take opens in the middle of the window. */
const EDITOR = "markdown";
const NOTE = "orca-book";

/** A box as the take's JSON writes it. */
interface Written {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One frame: a picture of the window in each scheme, and the boxes the player points at in it. */
interface Frame {
  name: string;
  marks: Record<string, Written>;
  rows?: Written[];
  /** The distance a scroller is scrolled, which the player animates between frames. */
  scroll?: number;
}

/**
 * The colors the player draws over a frame with: the ground, which
 * hides the rows not yet typed, and the text, which is the caret.
 */
interface Paint {
  cover: string;
  caret: string;
}

/** The choices a take makes for one frame beside its marks. */
export interface Taking {
  /** The rows of text the player uncovers one after another, as the typing. */
  rows?: Box[];
  /** Keeps the focus where it is. An open menu closes without it. */
  focused?: boolean;
  /** Leaves the pointer where it is, so what it hovers is in the picture. */
  hovered?: boolean;
  /** The scroller whose offset the frame records. */
  scroll?: Locator;
  /** The editor the take's colors are read from, once in each scheme. */
  paint?: Locator;
  /** The cover behind a sheet, whose color the take's shade is read from, once in each scheme. */
  shade?: Locator;
  /** Boxes the take measured itself, kept as marks: a word in a line is no element to point a locator at. */
  measured?: Record<string, Box>;
}

/** The book a take is of, and where a chapter of it opens when the session is sound. */
export interface Expected {
  book: string;
  chapter: string;
  folio: number;
  /**
   * The device the take is taken on, in Obsidian's mobile layout. The
   * window takes the device's size, and the preview shows one page.
   */
  device?: Device;
}

function written(box: Box): Written {
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/**
 * The rows of text an editor draws, one box per visual row, in reading
 * order. With `last`, only the rows of that many lines at the end.
 */
export async function rowsIn(editor: Locator, last = 0): Promise<Box[]> {
  return editor.evaluate((root, count) => {
    const rects: DOMRect[] = [];
    for (const line of [...root.querySelectorAll(".cm-line")].slice(-count)) {
      const range = document.createRange();
      range.selectNodeContents(line);
      rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
    }
    // A wrapped line and the marks inside it each give a box, so the
    // boxes that share a row are joined into one.
    rects.sort((a, b) => a.top - b.top || a.left - b.left);
    const rows: { x: number; y: number; width: number; height: number }[] = [];
    for (const rect of rects) {
      const last = rows[rows.length - 1];
      const middle = rect.top + rect.height / 2;
      if (last !== undefined && middle > last.y && middle < last.y + last.height) {
        const right = Math.max(last.x + last.width, rect.right);
        last.x = Math.min(last.x, rect.left);
        last.width = right - last.x;
      } else {
        rows.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      }
    }
    return rows
      .filter((row) => row.y + row.height > 0 && row.y < innerHeight)
      .map((row) => ({
        x: Math.round(row.x),
        y: Math.round(row.y),
        width: Math.round(row.width),
        height: Math.round(row.height),
      }));
  }, last);
}

/** The ground an editor is drawn on, and the color of its text. */
async function paintOf(editor: Locator): Promise<Paint> {
  return editor.evaluate((drawn) => {
    let ground = "";
    for (let at: Element | null = drawn; at !== null && ground === ""; at = at.parentElement) {
      const color = getComputedStyle(at).backgroundColor;
      if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") ground = color;
    }
    const text = drawn.querySelector(".cm-content") ?? drawn;
    return { cover: ground, caret: getComputedStyle(text).color };
  });
}

/**
 * The color a cover lays over what is behind it, with its opacity in
 * the alpha. A canvas paints the color, so any way of writing one reads
 * the same.
 */
async function shadeOf(cover: Locator): Promise<string> {
  return cover.evaluate((drawn) => {
    const style = getComputedStyle(drawn);
    const context = createEl("canvas").getContext("2d");
    if (context === null) throw new Error("no canvas to read the cover's color with");
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
    const strength = Math.round((alpha / 255) * Number(style.opacity) * 1000) / 1000;
    return `rgb(${String(red)} ${String(green)} ${String(blue)} / ${String(strength)})`;
  });
}

/**
 * One take of a reel on the sample vault. `begin` starts it from a
 * sound session, `frame` takes each state in both schemes, and `end`
 * writes the take's JSON and puts the vault back.
 *
 * Every write to the vault goes through `vault`, which is what puts it
 * back.
 */
export class Recorder {
  /** The sample vault's copy, put back from the checked-in one. */
  readonly vault: Vault;

  private readonly into: string;
  private frames: Frame[] = [];
  private paints: Partial<Record<Scheme, Paint>> = {};
  private shades: Partial<Record<Scheme, string>> = {};
  private book = "";
  private device: Device | undefined;
  private window = WINDOW;

  constructor(
    readonly site: Site,
    private readonly take: string,
  ) {
    this.vault = new Vault(site.obsidian.page, SAMPLE);
    this.into = path.join(REEL, take);
  }

  /**
   * Starts the take: sizes the window, loads orca again, and checks
   * that the chapter opens on the folio the take expects. A session
   * that set the book in another order opens it somewhere else, and
   * every frame after that would be of the wrong pages.
   */
  async begin(expected: Expected): Promise<void> {
    if (process.env[DENSITY] !== String(SHARP)) {
      throw new Error(`a take is taken with ${DENSITY}=${String(SHARP)}`);
    }
    const { obsidian, book } = this.site;
    this.book = expected.book;
    this.device = expected.device;
    this.window = expected.device === undefined ? WINDOW : DEVICES[expected.device];
    this.frames = [];
    this.paints = {};
    this.shades = {};
    await rm(this.into, { recursive: true, force: true });
    await rm(`${this.into}.json`, { force: true });
    await mkdir(this.into, { recursive: true });

    await this.shut();
    // A device loads the window again, and orca with it.
    if (expected.device === undefined) await obsidian.size(WINDOW.width, WINDOW.height, SHARP);
    else await obsidian.mobile(expected.device, SHARP);
    await obsidian.page.waitForFunction(
      (size) =>
        window.innerWidth === size.width &&
        window.innerHeight === size.height &&
        window.devicePixelRatio === size.density,
      { ...this.window, density: SHARP },
    );
    if (expected.device === undefined) await obsidian.reloadPlugin();
    // The mobile layout is kept apart from the desktop's, with the tabs
    // the last device take opened.
    else {
      await this.site.quieten();
      await this.shut();
    }
    await obsidian.asRendered();
    await obsidian.focused();

    await obsidian.open(expected.book);
    await book.open();
    await expect(book.surface).toBeVisible();
    await this.opensOn(expected.chapter, expected.folio);
    await this.shut();
    // Every frame is painted in the first scheme from the last one, and
    // so is the first frame. A scheme the window is already in paints
    // nothing again, and the picture keeps what the last take drew.
    await this.site.paint(SCHEMES[SCHEMES.length - 1] ?? "light");
  }

  /**
   * Turns the preview to a chapter, and checks the folio it opens on:
   * the spread's first on the desktop, and the one page's on a device.
   */
  async opensOn(chapter: string, folio: number): Promise<void> {
    const { book } = this.site;
    if (this.device === undefined) await book.show("Spread", "spread");
    else await book.show("Single page", "single");
    await book.choose(chapter);
    await this.settled();
    await expect(book.surface).toHaveAttribute("data-first", String(folio));
  }

  /**
   * Waits for the pane to carry a painted generation and a run of every
   * stage, and for the book to be quiet at that generation.
   */
  async settled(): Promise<void> {
    const { book } = this.site;
    await expect(book.surface).toHaveAttribute("data-generation", /[1-9]\d*/);
    for (const stage of STAGES) {
      await expect(book.surface).toHaveAttribute(`data-stage-${stage}`, /[1-9]\d*/);
    }
    await book.settled(this.book);
  }

  /**
   * Takes a picture of the whole window in each scheme and keeps the
   * boxes of the targets. One state is painted twice, so both pictures
   * hold the same boxes. A state that a change of scheme closes fails
   * here, on the boxes it lost.
   *
   * The pointer is moved off the window unless the frame is `hovered`:
   * the player draws its own.
   */
  async frame(
    name: string,
    targets: Record<string, Locator> = {},
    { rows, focused = false, hovered = false, scroll, paint, shade, measured = {} }: Taking = {},
  ): Promise<void> {
    const { obsidian } = this.site;
    // A device take loads the window again, which drops the hold.
    await obsidian.focused();
    await obsidian.unhovered(hovered);
    // A sidebar whose leaf is active draws its tab in the accent, so the
    // pane in the middle is made the active one, without the focus.
    // A device's drawer has no tab to draw in the accent, so the active
    // leaf there is left as it is.
    if (!focused) {
      await obsidian.page.evaluate((desktop) => {
        const { workspace } = window.app;
        const middle = workspace.getMostRecentLeaf(workspace.rootSplit);
        if (desktop && middle !== null) workspace.setActiveLeaf(middle, { focus: false });
        (document.activeElement as HTMLElement | null)?.blur();
      }, this.device === undefined);
    }
    // A drawer and a sheet slide in, and a box read on the way is not
    // where the picture has it.
    if (this.device !== undefined) await this.slid();
    // Obsidian flashes the tab of a sidebar it has just revealed.
    await expect(obsidian.page.locator(".workspace-tab-header.is-flashing")).toHaveCount(0);

    const crop = { x: 0, y: 0, ...this.window };
    let marks: Record<string, Box> | undefined;
    for (const scheme of SCHEMES) {
      await this.site.paint(scheme);
      // A control with a transition fades to the new scheme's colors.
      if (this.device !== undefined) await this.slid();
      const measured = (await this.site.marks(crop, targets)).marks;
      expect(measured, `${name} holds its marks in ${scheme}`).toEqual(marks ?? measured);
      marks = measured;
      if (paint !== undefined) this.paints[scheme] = await paintOf(paint);
      if (shade !== undefined) this.shades[scheme] = await shadeOf(shade);
      await obsidian.page.screenshot({
        path: path.join(this.into, `${name}-${scheme}.png`),
        scale: "device",
        animations: "disabled",
      });
    }
    const scrolled =
      scroll === undefined ? undefined : await scroll.evaluate((scroller) => scroller.scrollTop);
    this.frames.push({
      name,
      marks: Object.fromEntries(
        Object.entries({ ...marks, ...measured }).map(([mark, box]) => [mark, written(box)]),
      ),
      ...(rows === undefined ? {} : { rows: rows.map(written) }),
      ...(scrolled === undefined ? {} : { scroll: scrolled }),
    });
  }

  /**
   * Scrolls a scroller and takes a frame there, with the scroller as
   * its `scroller` mark. The player draws a scroll from the frames
   * either side and this one between.
   */
  async scrolledTo(scroller: Locator, name: string, top: number): Promise<void> {
    await scroller.evaluate((element, to) => {
      element.scrollTop = to;
    }, Math.round(top));
    await this.frame(name, { scroller }, { scroll: scroller });
  }

  /** Puts this text in the editor in front, and takes the focus off it so no caret or markup shows. */
  async editorHolds(text: string): Promise<void> {
    await this.site.obsidian.page.evaluate((value) => {
      const editor = window.app.workspace.activeEditor?.editor;
      if (editor === undefined) throw new Error("no editor in front");
      editor.setValue(value);
      (document.activeElement as HTMLElement | null)?.blur();
    }, text);
  }

  /**
   * Waits for Obsidian to have read a property of a note the take
   * wrote. Orca finds a book by its properties, and they are read some
   * time after the write.
   */
  async indexed(note: string, property: string, value: string): Promise<void> {
    await this.site.obsidian.page.waitForFunction(
      (want) => {
        const file = window.app.vault.getFileByPath(want.note);
        if (file === null) return false;
        const read: unknown = window.app.metadataCache.getFileCache(file)?.frontmatter?.[want.property];
        return read === want.value;
      },
      { note, property, value },
    );
  }

  /** Writes the take's JSON, then puts the vault and the window back. */
  async end(): Promise<void> {
    const listed = {
      take: this.take,
      ...(this.device === undefined ? {} : { device: this.device }),
      window: { w: this.window.width, h: this.window.height },
      density: SHARP,
      paint: this.paints,
      ...(Object.keys(this.shades).length === 0 ? {} : { shade: this.shades }),
      frames: this.frames,
    };
    await writeFile(`${this.into}.json`, `${JSON.stringify(listed, null, 2)}\n`);
    await this.restore();
  }

  /**
   * Puts back every note the take wrote and closes the panes it opened.
   * One app runs every take of a shard, so a take that failed is put
   * back as well.
   */
  async restore(): Promise<void> {
    await this.site.obsidian.moving();
    await this.vault.restore();
    await this.shut();
    if (this.device === undefined) return;
    // A device take leaves the desktop's layout for the take after it.
    // Loading the window again shuts a sheet the take left open.
    const { obsidian } = this.site;
    if (this.device === "tablet") {
      for (const side of ["left", "right"] as const) await obsidian.pin(false, side);
    }
    await obsidian.emulateMobile(false);
    this.device = undefined;
    this.window = WINDOW;
  }

  /** Waits for every slide on the screen to end. */
  private async slid(): Promise<void> {
    await this.site.obsidian.page.evaluate(async () => {
      const ending = document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
      await Promise.allSettled(ending.map((animation) => animation.finished));
    });
  }

  private async shut(): Promise<void> {
    const { obsidian } = this.site;
    for (const type of [PREVIEW, EDITOR, NOTE]) await obsidian.detach(type);
  }
}
