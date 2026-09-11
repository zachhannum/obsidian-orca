/**
 * The design panel, reached by the test ids in its own markup.
 *
 * One component is mounted twice, so the controls are read off a root
 * rather than off a view: the right sidebar for the panel, and the book
 * note's page for the copy on it.
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

/** The controls, wherever the panel is mounted. */
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
  /** The styles the engine registered for the font the book is set in. */
  readonly styles: Locator;
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
    this.styles = root.getByTestId("orca-panel-style");
    this.missing = root.getByTestId("orca-panel-missing");
  }

  /** One control, by the design key it writes. */
  control(key: string): Locator {
    return this.root.getByTestId(`orca-panel-${key}`);
  }

  /** One word of a segment, by the value it writes. */
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

  /** The names of the styles the panel shows, which the engine registered. */
  async styleNames(): Promise<string[]> {
    return this.styles.allTextContents();
  }

  /** The axes a style sits on, by its name. */
  async axes(style: string): Promise<string> {
    return (
      (await this.styles
        .filter({ hasText: style })
        .first()
        .getAttribute("data-axes")) ?? ""
    );
  }
}

/** The panel in the right sidebar, which follows the book being read. */
export class Panel extends Controls {
  constructor(private readonly obsidian: Obsidian) {
    super(obsidian.view(PANEL));
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
}
