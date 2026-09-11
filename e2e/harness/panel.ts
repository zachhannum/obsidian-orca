/**
 * The design panel in the right sidebar, reached by the test ids in its
 * own markup.
 *
 * The picker lists the fonts the scan found, so a spec types to narrow
 * that list rather than naming one. Every wait here is on the panel's
 * own state rather than on a clock.
 */

import { expect, type Locator } from "@playwright/test";
import type { Obsidian } from "./obsidian";

/** The command that opens the panel. */
export const OPEN_PANEL = "orca:open-design";

/** The type the panel is registered under. */
export const PANEL = "orca-design";

/** The id in the plugin's manifest, which the app keys its plugins by. */
const ORCA = "orca";

/** A control's box, measured from the panel's own corner so a scroll does not move it. */
export interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The settings orca saves, as much of them as a spec changes. */
interface Limited {
  limits: { unit: string };
  limit(limits: { unit: string }): void;
}

/** The controls, read off the leaf the panel is drawn in. */
export class Controls {
  /** The panel itself, drawn when there is a book to design. */
  readonly panel: Locator;
  /** The state the panel holds when no book is open. */
  readonly empty: Locator;
  /** The groups the panel offers, each carrying its name. */
  readonly groups: Locator;
  /** The closed field, which shows the font the book is set in. */
  readonly font: Locator;
  /** The filter, which narrows the list rather than naming a font. */
  readonly filter: Locator;
  /** The list of fonts, which carries the number of them shown. */
  readonly rows: Locator;
  readonly options: Locator;
  /** The empty state, shown when nothing matches what was typed. */
  readonly nothing: Locator;
  /** The warning for a font the machine does not have. */
  readonly missing: Locator;

  constructor(protected readonly root: Locator) {
    this.panel = root.getByTestId("orca-panel");
    this.empty = root.getByTestId("orca-panel-empty");
    this.groups = root.getByTestId("orca-panel-group");
    this.font = root.getByTestId("orca-panel-font");
    this.filter = root.getByTestId("orca-panel-filter");
    this.rows = root.getByTestId("orca-panel-rows");
    this.options = root.getByTestId("orca-panel-option");
    this.nothing = root.getByTestId("orca-panel-nothing");
    this.missing = root.getByTestId("orca-panel-missing");
  }

  /** One control, by the design key it writes. */
  control(key: string): Locator {
    return this.root.getByTestId(`orca-panel-${key}`);
  }

  /** One word of a segment, or one tab of a strip, by the value it writes. */
  choice(key: string, value: string): Locator {
    return this.root.getByTestId(`orca-panel-${key}-${value}`);
  }

  /** The line under a row, which is where a unit or a language is said. */
  said(key: string): Locator {
    return this.root.getByTestId(`orca-panel-said-${key}`);
  }

  /** The reset at the end of a row the book sets, by the row's first key. */
  reset(key: string): Locator {
    return this.root.getByTestId(`orca-panel-reset-${key}`);
  }

  /** A number field's stepper button that increases it. */
  up(key: string): Locator {
    return this.root.getByTestId(`orca-panel-${key}-up`);
  }

  /** A number field's stepper button that decreases it. */
  down(key: string): Locator {
    return this.root.getByTestId(`orca-panel-${key}-down`);
  }

  /** The line under a row that says why a field's text writes nothing. */
  invalid(key: string): Locator {
    return this.root.getByTestId(`orca-panel-invalid-${key}`);
  }

  /** The names of the groups the panel offers, in the order it offers them. */
  async grouped(): Promise<string[]> {
    return this.groups.evaluateAll((groups) =>
      groups.map((group) => group.getAttribute("data-group") ?? ""),
    );
  }

  /** The width of the panel's content, which the pane around it sets. */
  async width(): Promise<number> {
    return this.panel.evaluate((panel) => panel.clientWidth);
  }

  /** The groups whose content is wider than the group, by name. */
  async overflowing(): Promise<string[]> {
    return this.groups.evaluateAll((groups) =>
      groups
        .filter((group) => group.scrollWidth > group.clientWidth)
        .map((group) => group.getAttribute("data-group") ?? ""),
    );
  }

  /**
   * The elements drawn past the panel's right edge, by test id or class.
   * A group that clips its content passes `overflowing`, so this reads
   * where each element lands instead.
   */
  async beyond(): Promise<string[]> {
    return this.panel.evaluate((panel) => {
      const edge = panel.getBoundingClientRect().right;
      return [...panel.querySelectorAll("*")]
        .filter((element) => element.getBoundingClientRect().right > edge + 0.5)
        .map(
          (element) =>
            element.getAttribute("data-testid") ??
            element.getAttribute("class") ??
            element.tagName,
        );
    });
  }

  /** The box one control is drawn in, from the panel's corner. */
  async placed(key: string): Promise<Placed> {
    return this.control(key).evaluate((control) => {
      const box = control.getBoundingClientRect();
      const from = control
        .closest("[data-testid='orca-panel']")
        ?.getBoundingClientRect();
      return {
        x: box.left - (from?.left ?? 0),
        y: box.top - (from?.top ?? 0),
        width: box.width,
        height: box.height,
      };
    });
  }

  /** Opens the picker and waits for its filter. */
  async pick(): Promise<void> {
    await this.font.click();
    await expect(this.filter).toBeVisible();
  }

  /** Types into the filter, which narrows the list. */
  async type(typed: string): Promise<void> {
    await this.filter.fill(typed);
  }

  /** The families in the list, in the order they are shown. */
  async offered(): Promise<string[]> {
    return this.options.allTextContents();
  }

  /** The number of fonts the list shows, which a filter changes. */
  async offering(): Promise<number> {
    return Number(await this.rows.getAttribute("data-offered"));
  }

  /** The font the closed field shows. */
  async reading(): Promise<string> {
    return (await this.font.textContent()) ?? "";
  }
}

/** The panel in the right sidebar, which follows the book being read. */
export class Panel extends Controls {
  /** The leaf the panel is drawn in, whether or not it has a book. */
  readonly leaf: Locator;
  /** The element that scrolls the panel, which is the leaf's content. */
  readonly scroller: Locator;

  constructor(private readonly obsidian: Obsidian) {
    super(obsidian.view(PANEL));
    this.leaf = obsidian.view(PANEL);
    this.scroller = obsidian.content(PANEL);
  }

  /** Opens the panel and waits for it to be drawn. */
  async open(): Promise<void> {
    await this.obsidian.command(OPEN_PANEL);
    await expect(this.panel).toBeVisible();
  }

  /**
   * Clicks the panel's own tab, which makes it the active leaf. Every
   * leaf change repaints the panel, so this is what an author does that
   * asks it for the book again.
   */
  async focus(): Promise<void> {
    await this.obsidian.tab("Design").first().click();
  }

  async close(): Promise<void> {
    await this.obsidian.detach(PANEL);
  }

  /** Sets the sidebar the panel is in to a width, and returns the width it had. */
  async resize(width: number): Promise<number> {
    return this.obsidian.sidebar(width);
  }

  /** The distance the panel is scrolled, in pixels. */
  async scrolled(): Promise<number> {
    return this.scroller.evaluate((scroller) => scroller.scrollTop);
  }

  /**
   * Scrolls the panel until a control sits in the middle of it, and
   * returns how far the panel is then scrolled.
   */
  async scrollTo(control: Locator): Promise<number> {
    await control.evaluate((element) => {
      element.scrollIntoView({ block: "center" });
    });
    return this.scrolled();
  }

  /**
   * Sets the unit orca's settings measure pages in, the way the settings
   * tab saves it, and returns the unit it had.
   */
  async measure(unit: string): Promise<string> {
    return this.obsidian.page.evaluate(
      ({ id, to }) => {
        const orca = window.app.plugins.plugins[id] as Limited | undefined;
        if (orca === undefined) throw new Error(`no plugin called ${id}`);
        const had = orca.limits.unit;
        orca.limit({ ...orca.limits, unit: to });
        return had;
      },
      { id: ORCA, to: unit },
    );
  }
}
