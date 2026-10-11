/**
 * Inspect mode on orca's preview: the header action, the pointer over a
 * painted page, and the overlay it draws. The preview writes what it
 * hovered and pinned onto the surface once React has committed it, so
 * every wait here is on those attributes rather than on a clock.
 */

import { expect, type Locator } from "@playwright/test";
import { PREVIEW } from "./book";
import type { Obsidian } from "./obsidian";

/** The command that turns inspect mode on and off. */
export const INSPECT_PAGE = "orca:inspect-page";

/** The label of the header action that does the same. */
const INSPECT = "Inspect the page";

/** A point on a page, in points from its top-left corner. */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle on the screen, in pixels from the top-left of the window. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Inspect {
  /** The header action, which is pressed while inspect mode is on. */
  readonly action: Locator;
  /** The surface the preview writes `data-inspect` and the rest onto. */
  readonly surface: Locator;
  readonly margins: Locator;
  readonly paddings: Locator;
  readonly contents: Locator;
  /** Every outlined piece of a box, each with the side a page cut in `data-cut`. */
  readonly edges: Locator;
  readonly tags: Locator;
  /** The sheet a phone draws the pane in, with how far it is pulled up in `data-pull`. */
  readonly risen: Locator;
  /** The grabber at the top of that sheet, which pulls it. */
  readonly grabber: Locator;
  /** The rules the sheet shows, each with `data-layer`, and `data-line` or `data-keys` by its layer. */
  readonly risenRules: Locator;
  /** The sheet's `Add a rule`, which only a sheet pulled up shows. */
  readonly risenAdd: Locator;
  readonly risenComputed: Locator;
  readonly risenCrumbs: Locator;

  private readonly pane: Locator;

  constructor(private readonly obsidian: Obsidian) {
    this.pane = obsidian.view(PREVIEW);
    this.action = obsidian.actionIn(PREVIEW, INSPECT);
    this.surface = this.pane.getByTestId("orca-sheets");
    this.margins = this.pane.getByTestId("orca-inspect-margin");
    this.paddings = this.pane.getByTestId("orca-inspect-padding");
    this.contents = this.pane.getByTestId("orca-inspect-content");
    this.edges = this.pane.getByTestId("orca-inspect-edge");
    this.tags = this.pane.getByTestId("orca-inspect-tag");
    // The sheet is on the body, over Obsidian's own bar.
    this.risen = obsidian.page.getByTestId("orca-inspect-sheet");
    this.grabber = this.risen.getByTestId("orca-inspect-grabber");
    this.risenRules = this.risen.getByTestId("orca-inspect-rule");
    this.risenAdd = this.risen.getByTestId("orca-inspect-add");
    this.risenComputed = this.risen.getByTestId("orca-inspect-computed");
    this.risenCrumbs = this.risen.getByTestId("orca-inspect-crumb");
  }

  /**
   * Drags the sheet's grabber up or down by a distance in pixels, and
   * lets go. A distance down is positive. It answers the distance the
   * sheet's upper edge had gone under the pointer before it let go.
   */
  async pull(by: number): Promise<number> {
    // The sheet slides up to its place, and the grabber is read there.
    await this.risen.evaluate(async (sheet) => {
      await Promise.all(sheet.getAnimations().map((sliding) => sliding.finished));
    });
    const box = await this.rectOf(this.grabber);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const { mouse } = this.obsidian.page;
    await mouse.move(x, y);
    await mouse.down();
    const rested = (await this.rectOf(this.risen)).y;
    await mouse.move(x, y + by, { steps: 4 });
    const held = (await this.rectOf(this.risen)).y;
    await mouse.up();
    return held - rested;
  }

  /**
   * Moves the pages down by a distance in pixels and resizes nothing,
   * as a scroll does. Zero puts them back.
   */
  async shift(by: number): Promise<void> {
    await this.surface.evaluate((surface, px) => {
      surface.style.translate = px === 0 ? "" : `0 ${String(px)}px`;
    }, by);
  }

  /** The distance a phone has moved the page up so the sheet clears the pinned box, in pixels. */
  async lift(): Promise<number> {
    // A page that has not moved reads as 0 and never as -0.
    return this.surface.evaluate(
      (surface) => Math.abs(new DOMMatrix(getComputedStyle(surface).transform).f),
    );
  }

  /** The place the well's upper edge is on the screen, which no page is drawn above. */
  async wellTop(): Promise<number> {
    const well = await this.rectOf(this.surface.locator(".."));
    return well.y;
  }

  /** The overlay pieces of the pinned box, or of the hovered one. */
  outline(state: "pinned" | "hovered"): Locator {
    return this.pane.locator(`[data-state="${state}"]`);
  }

  /** Turns inspect mode on from the header action, and waits for the surface to say so. */
  async on(): Promise<void> {
    await this.action.click();
    await expect(this.surface).toHaveAttribute("data-inspect", "on");
    await expect(this.action).toHaveAttribute("aria-pressed", "true");
  }

  /** Turns it off the same way. */
  async off(): Promise<void> {
    await this.action.click();
    await this.isOff();
  }

  /** Runs the command, the way the palette does. */
  async toggle(): Promise<void> {
    await this.obsidian.command(INSPECT_PAGE);
  }

  async isOff(): Promise<void> {
    await expect(this.surface).toHaveAttribute("data-inspect", "off");
  }

  /**
   * The screen position of a point on a painted page. The page counts
   * from 1, as `data-page` does. The point is in points from the trim's
   * corner, and the sheet the box holds is read off the viewBox the
   * painter drew.
   */
  async at(page: number, point: Point): Promise<{ x: number; y: number }> {
    const sheet = this.surface.locator(`.orca-page[data-page="${String(page)}"]`);
    const box = await sheet.boundingBox();
    if (box === null) throw new Error(`page ${String(page)} is not painted`);
    const view = await sheet.locator("svg").first().getAttribute("viewBox");
    const [left, top, width, height] = (view ?? "").split(" ").map(Number);
    if (left === undefined || top === undefined || !width || !height) {
      throw new Error(`page ${String(page)} has no sheet`);
    }
    return {
      x: box.x + ((point.x - left) / width) * box.width,
      y: box.y + ((point.y - top) / height) * box.height,
    };
  }

  /** Moves the pointer to a point on a page, and waits for the preview to name what it hovered. */
  async hover(page: number, point: Point): Promise<string> {
    const at = await this.at(page, point);
    await this.obsidian.page.mouse.move(at.x, at.y);
    await expect(this.surface).toHaveAttribute("data-hovered", /.+/);
    return (await this.surface.getAttribute("data-hovered")) ?? "";
  }

  /** Clicks a point on a page, and waits for the pin. It answers the pinned key. */
  async pin(page: number, point: Point): Promise<string> {
    const at = await this.at(page, point);
    await this.obsidian.page.mouse.click(at.x, at.y);
    await expect(this.surface).toHaveAttribute("data-inspected", /.+/);
    return (await this.surface.getAttribute("data-inspected")) ?? "";
  }

  /** Clicks a point on a page without waiting on a pin, for a click that takes one off. */
  async click(page: number, point: Point): Promise<void> {
    const at = await this.at(page, point);
    await this.obsidian.page.mouse.click(at.x, at.y);
  }

  /** The page `page` names, counting from 1. */
  sheet(page: number): Locator {
    return this.surface.locator(`.orca-page[data-page="${String(page)}"]`);
  }

  /**
   * A line the painter set on a page, found in its selection layer by
   * the words it begins with. The layer is the manuscript's own text,
   * so a spec reaches a box by what it says rather than by guessing
   * where it landed.
   */
  line(page: number, said: string): Locator {
    return this.sheet(page).locator("text[data-selection-line]").filter({ hasText: said });
  }

  /**
   * The screen rectangle of something painted. A bounding box waits for
   * its element with no bound of its own, and a repaint can put a new
   * element in the place of the one found visible, so the box is read
   * again until a painted one answers.
   */
  async rectOf(painted: Locator): Promise<Rect> {
    const found: { box?: Rect } = {};
    await expect(async () => {
      const read = await painted.first().boundingBox();
      expect(read).not.toBeNull();
      if (read !== null) found.box = read;
    }).toPass();
    const box = found.box;
    if (box === undefined) throw new Error("nothing is painted there");
    return box;
  }

  /** A point just inside the start of a line, on the screen. */
  async startOf(line: Locator): Promise<{ x: number; y: number }> {
    const box = await this.rectOf(line);
    return { x: box.x + Math.min(12, box.width / 2), y: box.y + box.height / 2 };
  }

  /**
   * Clicks a point on the screen rather than on a page, and waits for
   * the pin. `was` is the key already pinned, which the wait is for the
   * preview to leave. It answers the pinned key.
   */
  async pinAt(at: { x: number; y: number }, was?: string): Promise<string> {
    await this.obsidian.page.mouse.click(at.x, at.y);
    await expect(this.surface).toHaveAttribute("data-inspected", /.+/);
    if (was !== undefined) {
      await expect(this.surface).not.toHaveAttribute("data-inspected", was);
    }
    return (await this.surface.getAttribute("data-inspected")) ?? "";
  }

  /** Moves the pointer onto a line, and waits for the preview to outline what it hovered. */
  async hoverLine(line: Locator): Promise<string> {
    const at = await this.startOf(line);
    await this.obsidian.page.mouse.move(at.x, at.y);
    await expect(this.surface).toHaveAttribute("data-hovered", /.+/);
    await expect(this.outline("hovered").getByTestId("orca-inspect-edge").first()).toBeVisible();
    return (await this.surface.getAttribute("data-hovered")) ?? "";
  }

  /** Clicks a line, and waits for the pin. It answers the pinned key. */
  async pinLine(line: Locator): Promise<string> {
    const at = await this.startOf(line);
    await this.obsidian.page.mouse.click(at.x, at.y);
    await expect(this.surface).toHaveAttribute("data-inspected", /.+/);
    return (await this.surface.getAttribute("data-inspected")) ?? "";
  }

  /** Clicks a line without waiting on a pin, for a click that takes one off. */
  async clickLine(line: Locator): Promise<void> {
    const at = await this.startOf(line);
    await this.obsidian.page.mouse.click(at.x, at.y);
  }

  /** Presses Escape where the focus is, which the view's container hears. */
  async escape(): Promise<void> {
    await this.obsidian.page.keyboard.press("Escape");
  }

  /** Waits until nothing is pinned. */
  async unpinned(): Promise<void> {
    await expect(this.surface).not.toHaveAttribute("data-inspected", /.*/);
  }

  /** The key and generation the preview last pinned, which the design panel's pane shows. */
  async pinned(): Promise<{ key: string; generation: number }> {
    await expect(this.surface).toHaveAttribute("data-inspected", /.+/);
    return {
      key: (await this.surface.getAttribute("data-inspected")) ?? "",
      generation: Number(await this.surface.getAttribute("data-inspected-generation")),
    };
  }

  /** Waits for the pin to answer a generation past `after`, and answers it. */
  async refreshed(after: number): Promise<number> {
    await expect
      .poll(async () => Number(await this.surface.getAttribute("data-inspected-generation")))
      .toBeGreaterThan(after);
    return Number(await this.surface.getAttribute("data-inspected-generation"));
  }
}
