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
   * from 1, as `data-page` does, and its trim is read off the viewBox
   * the painter drew.
   */
  async at(page: number, point: Point): Promise<{ x: number; y: number }> {
    const sheet = this.surface.locator(`.orca-page[data-page="${String(page)}"]`);
    const box = await sheet.boundingBox();
    if (box === null) throw new Error(`page ${String(page)} is not painted`);
    const view = await sheet.locator("svg").first().getAttribute("viewBox");
    const [, , width, height] = (view ?? "").split(" ").map(Number);
    if (width === undefined || height === undefined || !width || !height) {
      throw new Error(`page ${String(page)} has no trim`);
    }
    return {
      x: box.x + (point.x / width) * box.width,
      y: box.y + (point.y / height) * box.height,
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

  /** A point just inside the start of a line, on the screen. */
  private async startOf(line: Locator): Promise<{ x: number; y: number }> {
    // A bounding box waits for its element with no bound of its own.
    // A repaint can put a new line in the place of the one found visible,
    // so the box is read again until a painted line answers.
    const found: { box?: { x: number; y: number; width: number; height: number } } = {};
    await expect(async () => {
      const read = await line.first().boundingBox();
      expect(read).not.toBeNull();
      if (read !== null) found.box = read;
    }).toPass();
    const box = found.box;
    if (box === undefined) throw new Error("the line is not painted");
    return { x: box.x + Math.min(12, box.width / 2), y: box.y + box.height / 2 };
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
