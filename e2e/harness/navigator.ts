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

/** How many redraws a row is measured across before the drag gives up. */
const TRIES = 20;

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

  /** One entry in a book's reading order, by what the row is called. */
  entry(book: string, name: string): Locator {
    return this.book(book)
      .getByTestId("orca-entry")
      .filter({ hasText: name })
      .first();
  }

  /** One of a book's headings. */
  group(book: string, heading: string): Locator {
    return this.book(book).locator(`[data-heading="${heading}"]`);
  }

  /** Every entry in a book's reading order, in the order it lists them. */
  entries(book: string): Locator {
    return this.book(book).getByTestId("orca-entry");
  }

  /** The quiet line about the notes the book does not read. */
  loose(book: string): Locator {
    return this.book(book).getByTestId("orca-loose");
  }

  /** The row that makes a chapter at the end of the body. */
  newChapter(book: string): Locator {
    return this.book(book).getByTestId("orca-new-chapter");
  }

  /** A button in the navigator's own header. */
  button(label: string): Locator {
    return this.pane.locator(`[aria-label="${label}"]`);
  }

  /** How many times the shelf has been drawn. */
  async painted(): Promise<number> {
    await expect(this.pane).toHaveAttribute("data-generation", /\d+/);
    return Number(await this.pane.getAttribute("data-generation"));
  }

  /** A fuzzy pick, answered with the first match for what is typed. */
  async pick(named: string): Promise<void> {
    const modal = this.obsidian.page.getByTestId("orca-pick");
    await modal.locator("input").fill(named);
    await this.obsidian.suggestion().first().click();
  }

  /**
   * One entry dragged onto another. The drag is pointer events, so the
   * pointer travels far enough to pass the slop before it lands.
   */
  async drag(from: Locator, to: Locator, onto: Onto): Promise<void> {
    const { mouse } = this.obsidian.page;
    const start = await box(from);
    const end = await box(to);
    await mouse.move(start.x + 20, start.y + start.height / 2);
    await mouse.down();
    await mouse.move(start.x + 20, start.y + start.height / 2 + 8, { steps: 4 });
    await mouse.move(
      end.x + 20,
      onto === "above" ? end.y + 1 : end.y + end.height - 1,
      { steps: 10 },
    );
    await mouse.up();
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
 * so a row measured across one of those redraws is measured again.
 */
async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  for (let tries = 0; tries < TRIES; tries += 1) {
    const found = await locator.boundingBox();
    if (found !== null) return found;
  }
  throw new Error("nothing to drag");
}
