/**
 * The navigator, reached by the test ids in its own markup.
 *
 * The pane carries the generation it last drew, so a spec that has to
 * wait for a redraw waits on that rather than on a clock.
 */

import { expect, type Locator } from "@playwright/test";
import type { Obsidian } from "./obsidian";

/** The type the navigator is registered under. */
export const NAVIGATOR = "orca-navigator";

/** Where a dragged entry is let go: over a row, or under it. */
export type Onto = "above" | "below";

export class Navigator {
  /** The pane the shelf is drawn in. */
  readonly pane: Locator;

  constructor(private readonly obsidian: Obsidian) {
    this.pane = this.obsidian.view(NAVIGATOR).getByTestId("orca-navigator");
  }

  /** The navigator, revealed in the sidebar it lives in. */
  async reveal(): Promise<void> {
    await this.obsidian.page.evaluate(async (type) => {
      await window.app.workspace.ensureSideLeaf(type, "left", { reveal: true });
    }, NAVIGATOR);
    await expect(this.pane).toBeVisible();
  }

  /** One book on the shelf. */
  book(path: string): Locator {
    return this.pane.locator(`[data-book="${path}"]`);
  }

  /** A book's own row, which is what its menu opens from. */
  name(path: string): Locator {
    return this.book(path).getByTestId("orca-book");
  }

  /** One entry in a book's reading order, by what the row is called. */
  entry(book: string, name: string): Locator {
    return this.book(book)
      .getByTestId("orca-entry")
      .filter({ hasText: name })
      .first();
  }

  /** One of a book's sections, by the heading it is written with. */
  group(book: string, heading: string): Locator {
    return this.book(book).locator(`[data-heading="${heading}"]`);
  }

  /** Every section of a book, in the order the note has them. */
  groups(book: string): Locator {
    return this.book(book).locator("[data-heading]");
  }

  /** The input a rename is answered in. */
  renaming(book: string): Locator {
    return this.book(book).getByTestId("orca-rename");
  }

  /** Every entry in a book's reading order, in the order it lists them. */
  entries(book: string): Locator {
    return this.book(book).getByTestId("orca-entry");
  }

  /** A button in the navigator's own header. */
  button(label: string): Locator {
    return this.pane.locator(`[aria-label="${label}"]`);
  }

  /**
   * The `+` on a book's own row, opened. Every way of adding to a book
   * is behind it, so a spec that adds something starts here.
   */
  async adding(book: string): Promise<void> {
    await this.opening(
      this.book(book).locator('[aria-label="Add to this book"]'),
      {},
    );
  }

  /**
   * One row's own menu, opened. The menu is on screen before a spec
   * reads it: Obsidian builds one on the event, and an item clicked
   * before it is up is an item nothing answers.
   */
  async menuOn(row: Locator): Promise<void> {
    await this.opening(row, { button: "right" });
  }

  /**
   * A menu, opened from a row. The shelf is drawn again on every edit,
   * and a click that lands across one of those redraws opens nothing.
   * Opening a menu changes nothing, so it is asked for again.
   */
  private async opening(
    row: Locator,
    how: { button?: "right" },
  ): Promise<void> {
    await expect(async () => {
      await row.click(how);
      await expect(this.obsidian.menu()).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
  }

  /** How many times the shelf has been drawn. */
  async painted(): Promise<number> {
    await expect(this.pane).toHaveAttribute("data-generation", /\d+/);
    return Number(await this.pane.getAttribute("data-generation"));
  }

  /**
   * Waits for a paint later than the one given. An edit is one write
   * and one paint, so a spec that has to act on a settled list waits
   * for the paint that read the write back.
   */
  async repainted(after: number): Promise<void> {
    await expect.poll(async () => this.painted()).toBeGreaterThan(after);
  }

  /** A fuzzy pick, answered with the first match for what is typed. */
  async pick(named: string): Promise<void> {
    const modal = this.obsidian.page.getByTestId("orca-pick");
    await modal.locator("input").fill(named);
    await this.obsidian.suggestion().first().click();
  }

  /**
   * One row dragged onto another. dnd-kit starts a drag once the
   * pointer has travelled its activation distance, so the pointer moves
   * away before it travels to where it lands.
   */
  async drag(from: Locator, to: Locator, onto: Onto): Promise<void> {
    const { mouse } = this.obsidian.page;
    const start = await box(from);
    const end = await box(to);
    const land = onto === "above" ? end.y + 2 : end.y + end.height - 2;
    await mouse.move(start.x + 20, start.y + start.height / 2);
    await mouse.down();
    await mouse.move(start.x + 20, start.y + start.height / 2 + 10, { steps: 5 });
    await mouse.move(end.x + 20, land, { steps: 15 });
    // dnd-kit settles the drop on the frame after the last move.
    await mouse.move(end.x + 20, land);
    await mouse.up();
  }

  /**
   * One row dragged past the bottom of the pane and held there, with
   * `held` run before it is let go. A drop past the last row lands on
   * the last row.
   */
  async dragOffTheEnd(from: Locator, held: () => Promise<void>): Promise<void> {
    const { mouse } = this.obsidian.page;
    const start = await box(from);
    const floor = await this.obsidian.page.evaluate(() => window.innerHeight - 2);
    await mouse.move(start.x + 20, start.y + start.height / 2);
    await mouse.down();
    // One app runs the whole suite, so the button is released and the
    // drag cancelled on every way out of this block. A button left
    // down, or a drop whose write outruns the fixture going back, fails
    // every spec after this one.
    try {
      await mouse.move(start.x + 20, start.y + start.height / 2 + 10, { steps: 5 });
      await mouse.move(start.x + 20, floor, { steps: 15 });
      await mouse.move(start.x + 20, floor);
      // dnd-kit presses the row it is carrying, so the wait is on that.
      await expect(from).toHaveAttribute("aria-pressed", "true");
      await expect(from).toHaveCSS("transform", /matrix\(/);
      await held();
    } catch (cause) {
      await this.obsidian.page.keyboard.press("Escape");
      throw cause;
    } finally {
      await mouse.up();
    }
  }

  /**
   * How tall the shelf is, and how far the view it sits in has been
   * scrolled. Two elements on purpose: the shelf is what a drag must
   * not grow, and the view is what it must not scroll past the end of.
   *
   * The view is found by the test dnd-kit scrolls on, which is an
   * overflow that allows it, and with something to scroll, since the
   * shelf itself allows one and never has any.
   */
  async reach(): Promise<{ height: number; top: number; most: number }> {
    return this.pane.evaluate((pane) => {
      const scrolls = (node: Element): boolean =>
        /(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY) &&
        node.scrollHeight > node.clientHeight;
      let node: Element | null = pane;
      while (node !== null && !scrolls(node)) node = node.parentElement;
      return {
        height: pane.scrollHeight,
        top: node?.scrollTop ?? 0,
        most: node === null ? 0 : node.scrollHeight - node.clientHeight,
      };
    });
  }

  /** The question a delete asks, answered by the button named. */
  async answer(verb: string): Promise<void> {
    const modal = this.obsidian.page.getByTestId("orca-confirm");
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: verb }).click();
    await expect(modal).toHaveCount(0);
  }

  /** A wikilink pasted into whatever has focus, which a rename box may be. */
  async pasteFocused(text: string): Promise<void> {
    await this.obsidian.page.evaluate((pasted) => {
      const into = document.activeElement;
      if (into === null) throw new Error("nothing has focus");
      const data = new DataTransfer();
      data.setData("text/plain", pasted);
      into.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, text);
  }

  /** A wikilink pasted into a book's list, with the list focused. */
  async paste(book: string, text: string): Promise<void> {
    await this.obsidian.page.evaluate(
      ({ at, pasted }) => {
        const list = document.querySelector<HTMLElement>(`[data-book="${at}"]`);
        if (list === null) throw new Error(`no book at ${at}`);
        list.focus();
        const data = new DataTransfer();
        data.setData("text/plain", pasted);
        list.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { at: book, pasted: text },
    );
  }
}

/**
 * Where a row is on screen. The shelf is drawn again after every edit,
 * and a row measured across one of those redraws has no box, so the
 * measure waits for one rather than asking a fixed number of times.
 */
async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  // The box handed back is the one the poll accepted. Measuring again
  // afterwards is a second reading nothing waits on.
  let found: Awaited<ReturnType<Locator["boundingBox"]>> = null;
  await expect
    .poll(async () => {
      found = await locator.boundingBox();
      return found;
    })
    .not.toBeNull();
  if (found === null) throw new Error("nothing to drag");
  return found;
}
