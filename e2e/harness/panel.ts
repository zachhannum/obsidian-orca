/**
 * The design panel in the right sidebar. The page objects here find it
 * by the test ids in its own markup.
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

/** CodeMirror's own class for its editable text. */
const CODEMIRROR_CONTENT = ".cm-content";

/** CodeMirror's own class for the element that scrolls its text. */
const CODEMIRROR_SCROLLER = ".cm-scroller";

/** CodeMirror's own class for one line number. */
const CODEMIRROR_LINE_NUMBER = ".cm-lineNumbers .cm-gutterElement";

/** CodeMirror's own class for the box the line numbers sit in. */
const CODEMIRROR_GUTTERS = ".cm-gutters";

/** CodeMirror's own class for the gutter of the line the caret is on. */
const CODEMIRROR_CARET_LINE = ".cm-activeLineGutter";

/** The id in the plugin's manifest, which the app keys its plugins by. */
const ORCA = "orca";

/** A control's box, from the panel's own corner. A scroll does not change it. */
export interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of orca's saved settings that a spec changes. */
interface Limited {
  limits: { unit: string };
  limit(limits: { unit: string }): void;
}

/** The panel's controls, found under the root it is given. */
export class Controls {
  /** The panel itself, drawn when there is a book to design. */
  readonly panel: Locator;
  /** The panel's state when no book is open. */
  readonly empty: Locator;
  /** The panel's groups. Each one carries its name. */
  readonly groups: Locator;
  /** The strip that picks the heading level the Headings group edits. */
  readonly levels: Locator;
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
  /** The picker that adds a font to the book, which no design key names. */
  readonly addFont: Locator;
  /** The fonts the book adds, each carrying its name. */
  readonly addedFonts: Locator;
  /** The header icon that opens the author's own CSS. */
  readonly toCss: Locator;
  /** The header icon that goes back to the controls. */
  readonly toControls: Locator;
  /** The CSS view's switch between wrapping long lines and scrolling them. */
  readonly wrap: Locator;
  /** The element CodeMirror draws the author's CSS in. */
  readonly editor: Locator;
  /** The editable text of that editor. */
  readonly code: Locator;
  /** The squiggles a render put on the author's CSS. */
  readonly flags: Locator;
  /** The line numbers of the editor, the empty spacer CodeMirror keeps aside. */
  readonly lineNumbers: Locator;
  /** The box the line numbers sit in, which the text scrolls behind. */
  readonly gutters: Locator;
  /** The line numbers a squiggle colours. */
  readonly flaggedLines: Locator;
  /** The number of the line the caret is on. */
  readonly caretLine: Locator;
  /** The count of warnings in the CSS view's header. */
  readonly warned: Locator;
  /** The book's name in the header, after the name of the view. */
  readonly bookName: Locator;
  /** The card a hover over a squiggle opens. CodeMirror draws it on the body, outside the panel. */
  readonly card: Locator;
  /** The card a hover over a row's lock opens. The panel draws it on the body, outside the panel. */
  readonly overriddenCard: Locator;
  /** The inspect pane over the editor, there only while a box is pinned. */
  readonly pane: Locator;
  /** The pane's crumbs, the book first and the box last. Each one an author can pick carries `data-picked`. */
  readonly crumbs: Locator;
  /** The selector "Add a rule" writes. */
  readonly selector: Locator;
  /** The pane's rule groups, each with its layer in `data-layer`. */
  readonly ruleGroups: Locator;
  /** Every matched rule, with `data-layer`, and `data-line` or `data-keys` by its layer. */
  readonly rules: Locator;
  /** Every declaration in the pane, a lost one with `data-lost` and a refused one with `data-skipped`. */
  readonly declarations: Locator;
  readonly computed: Locator;
  readonly addRule: Locator;
  /** The pane's button that takes the pin off. */
  readonly unpinButton: Locator;

  constructor(protected readonly root: Locator) {
    this.panel = root.getByTestId("orca-panel");
    this.empty = root.getByTestId("orca-panel-empty");
    this.groups = root.getByTestId("orca-panel-group");
    this.levels = root.getByTestId("orca-panel-heading-level");
    this.font = root.getByTestId("orca-panel-font");
    this.filter = root.getByTestId("orca-panel-filter");
    this.rows = root.getByTestId("orca-panel-rows");
    this.options = root.getByTestId("orca-panel-option");
    this.nothing = root.getByTestId("orca-panel-nothing");
    this.missing = root.getByTestId("orca-panel-missing");
    this.addFont = root.getByTestId("orca-panel-font-add");
    this.addedFonts = root.getByTestId("orca-panel-font-added");
    this.toCss = root.getByTestId("orca-panel-css");
    this.toControls = root.getByTestId("orca-panel-controls");
    this.wrap = root.getByTestId("orca-panel-wrap");
    this.editor = root.getByTestId("orca-editor");
    this.code = this.editor.locator(CODEMIRROR_CONTENT);
    this.flags = this.editor.getByTestId("orca-editor-flag");
    this.lineNumbers = this.editor.locator(CODEMIRROR_LINE_NUMBER).filter({ hasText: /\d/ });
    this.gutters = this.editor.locator(CODEMIRROR_GUTTERS);
    this.flaggedLines = this.editor.locator(`${CODEMIRROR_LINE_NUMBER}.orca-editor-flagged`);
    this.caretLine = this.editor.locator(`${CODEMIRROR_LINE_NUMBER}${CODEMIRROR_CARET_LINE}`);
    this.warned = root.getByTestId("orca-panel-warned");
    this.bookName = root.getByTestId("orca-panel-book");
    this.card = root.page().getByTestId("orca-editor-card");
    this.overriddenCard = root.page().getByTestId("orca-panel-card");
    this.pane = root.getByTestId("orca-inspect-pane");
    this.crumbs = this.pane.getByTestId("orca-inspect-crumb");
    this.selector = this.pane.getByTestId("orca-inspect-selector");
    this.ruleGroups = this.pane.getByTestId("orca-inspect-group");
    this.rules = this.pane.getByTestId("orca-inspect-rule");
    this.declarations = this.pane.getByTestId("orca-inspect-decl");
    this.computed = this.pane.getByTestId("orca-inspect-computed");
    this.addRule = this.pane.getByTestId("orca-inspect-add");
    this.unpinButton = this.pane.getByTestId("orca-inspect-close");
  }

  /** The matched rules of one layer: `own`, `design` or `theme`. */
  rulesIn(layer: "own" | "design" | "theme"): Locator {
    return this.pane.locator(
      `[data-testid="orca-inspect-rule"][data-layer="${layer}"]`,
    );
  }

  /** The author's rule that starts on a line of the CSS. */
  ownRule(line: number): Locator {
    return this.pane.locator(
      `[data-testid="orca-inspect-rule"][data-layer="own"][data-line="${String(line)}"]`,
    );
  }

  /** The design panel rule a control wrote, by a key the control writes. */
  designRule(key: string): Locator {
    return this.pane.locator(
      `[data-testid="orca-inspect-rule"][data-layer="design"][data-keys="${key}"]`,
    );
  }

  /** The panel row that writes a key, which a design rule's click scrolls to. */
  row(key: string): Locator {
    return this.panel.locator(`[data-keys~="${key}"]`);
  }

  /** Waits for the pane to show the pin the preview answered at a generation. */
  async inspecting(key: string, generation: number): Promise<void> {
    await expect(this.pane).toHaveAttribute("data-inspected", key);
    await expect(this.pane).toHaveAttribute("data-generation", String(generation));
  }

  /** Clicks the crumb that names an element, as `section#chapter-twelve`, and waits for its picked state to flip. */
  async pickCrumb(name: string): Promise<void> {
    const crumb = this.crumbs.filter({ hasText: name }).first();
    const was = await crumb.getAttribute("data-picked");
    await crumb.click();
    await expect(crumb).toHaveAttribute("data-picked", was === "true" ? "false" : "true");
  }

  /** Clicks the line an author's rule names, which puts the caret on that line. */
  async openRule(rule: Locator): Promise<void> {
    await rule.getByRole("button").first().click();
  }

  /** The number of the line the editor's caret is on. */
  async caretAt(): Promise<number> {
    return Number(await this.caretLine.textContent());
  }

  /** Clicks "Add a rule" and waits for the caret to move off the line it was on. */
  async add(): Promise<void> {
    const before = await this.caretAt();
    await this.addRule.click();
    await expect.poll(() => this.caretAt()).not.toBe(before);
  }

  /** Types at the end of the author's CSS, as the author would. */
  async typeCss(typed: string): Promise<void> {
    await this.code.click();
    await this.code.press("ControlOrMeta+End");
    await this.code.pressSequentially(typed);
  }

  /** The distance from a header icon to the center of its button, in pixels, on the axis where it is larger. */
  async offCenter(button: Locator): Promise<number> {
    return button.evaluate((element) => {
      const icon = element.querySelector("svg");
      if (icon === null) return Number.POSITIVE_INFINITY;
      const outer = element.getBoundingClientRect();
      const inner = icon.getBoundingClientRect();
      const across = Math.abs(
        outer.left + outer.width / 2 - (inner.left + inner.width / 2),
      );
      const down = Math.abs(
        outer.top + outer.height / 2 - (inner.top + inner.height / 2),
      );
      return Math.max(across, down);
    });
  }

  /** Whether a line of the editor wider than the editor scrolls sideways rather than wraps. */
  async scrollsSideways(): Promise<boolean> {
    return this.editor.evaluate((editor, selector) => {
      const scroller = editor.querySelector(selector);
      return scroller !== null && scroller.scrollWidth > scroller.clientWidth;
    }, CODEMIRROR_SCROLLER);
  }

  /** The background the gutter paints, and the editor's own, as the browser resolves them. */
  async gutterPaint(): Promise<{ gutter: string; host: string }> {
    return this.editor.evaluate((editor, selector) => {
      const gutters = editor.querySelector(selector);
      return {
        gutter: gutters === null ? "" : getComputedStyle(gutters).backgroundColor,
        host: getComputedStyle(editor).backgroundColor,
      };
    }, CODEMIRROR_GUTTERS);
  }

  /** Scrolls the editor's text to one end of a line, and answers where it stopped. */
  async scrollSideways(to: "start" | "end"): Promise<number> {
    return this.editor.evaluate(
      (editor, [selector, where]) => {
        const scroller = editor.querySelector(selector);
        if (scroller === null) return -1;
        scroller.scrollLeft = where === "end" ? scroller.scrollWidth : 0;
        return scroller.scrollLeft;
      },
      [CODEMIRROR_SCROLLER, to] as const,
    );
  }

  /** Resolves a theme variable to the color the browser computes for it. */
  async resolves(variable: string): Promise<string> {
    return this.editor.evaluate((editor, name) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      editor.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }, variable);
  }

  /** Whether the editor sits under the panel's React root, which it must not. */
  async editorInReact(): Promise<boolean> {
    return this.editor.evaluate(
      (editor) => editor.closest(".orca-panel-host") !== null,
    );
  }

  /** One control, by the design key it writes. */
  control(key: string): Locator {
    return this.root.getByTestId(`orca-panel-${key}`);
  }

  /** One word of a segment, or one tab of a strip, by the value it writes. */
  choice(key: string, value: string): Locator {
    return this.root.getByTestId(`orca-panel-${key}-${value}`);
  }

  /** The line under a row that shows a unit or a language. */
  said(key: string): Locator {
    return this.root.getByTestId(`orca-panel-said-${key}`);
  }

  /** The reset at the end of a row the book sets, by the row's first key. */
  reset(key: string): Locator {
    return this.root.getByTestId(`orca-panel-reset-${key}`);
  }

  /** The lock on a row the author's CSS overrides, by the first key it overrides. */
  overridden(key: string): Locator {
    return this.root.getByTestId(`orca-panel-overridden-${key}`);
  }

  /** A number field's stepper button that increases it. */
  up(key: string): Locator {
    return this.root.getByTestId(`orca-panel-${key}-up`);
  }

  /** A number field's stepper button that decreases it. */
  down(key: string): Locator {
    return this.root.getByTestId(`orca-panel-${key}-down`);
  }

  /**
   * The error line under a row whose field text orca cannot read. Orca
   * writes nothing for that text.
   */
  invalid(key: string): Locator {
    return this.root.getByTestId(`orca-panel-invalid-${key}`);
  }

  /** The names of the panel's groups, in their order. */
  async grouped(): Promise<string[]> {
    return this.groups.evaluateAll((groups) =>
      groups.map((group) => group.getAttribute("data-group") ?? ""),
    );
  }

  /**
   * Whether the book's name in the header is wider than the room it has,
   * and what the header does with the part that does not fit.
   */
  async shortened(): Promise<{ clipped: boolean; overflow: string }> {
    return this.bookName.evaluate((name) => ({
      clipped: name.scrollWidth > name.clientWidth,
      overflow: getComputedStyle(name).textOverflow,
    }));
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
   * The elements past the panel's right edge, by test id or class. A
   * group that clips its content passes `overflowing`, but this still
   * finds the elements it clipped.
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

  /** One control's box, from the panel's corner. */
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

  /** The menu a Variant row opens. */
  get variantMenu(): Locator {
    return this.root.getByTestId("orca-panel-variants");
  }

  /** The row of the font list that offers one family. */
  option(family: string): Locator {
    return this.options.and(this.root.locator(`[data-font="${family}"]`));
  }

  /** The row of the Variant menu that offers one variant. */
  variant(name: string): Locator {
    return this.root.getByTestId("orca-panel-variant").and(
      this.root.locator(`[data-variant="${name}"]`),
    );
  }

  /** The variants the open Variant menu offers, in order. */
  async variants(): Promise<string[]> {
    await expect(this.variantMenu).toBeVisible();
    return this.root
      .getByTestId("orca-panel-variant")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-variant") ?? ""));
  }

  /** Adds a family to the book, through the filter, and waits for its row. */
  async addToBook(family: string): Promise<void> {
    await this.addFont.click();
    await expect(this.filter).toBeVisible();
    await this.type(family);
    await this.option(family).click();
    await expect(this.added(family)).toBeVisible();
  }

  /** The row of a font the book adds. */
  added(family: string): Locator {
    return this.addedFonts.and(this.root.locator(`[data-font="${family}"]`));
  }

  /** Takes a font the book added back out, and waits for its row to go. */
  async dropFromBook(family: string): Promise<void> {
    await this.root
      .getByTestId("orca-panel-font-drop")
      .and(this.root.locator(`[data-font="${family}"]`))
      .click();
    await expect(this.added(family)).toHaveCount(0);
  }

  /** Picks a family for a font key, through the filter, and waits for the field to show it. */
  async chooseFont(key: string, family: string): Promise<void> {
    const field = key === "body-font" ? this.font : this.control(key);
    await field.click();
    await expect(this.filter).toBeVisible();
    await this.type(family);
    await this.option(family).click();
    await expect(field).toContainText(family);
  }

  /** Picks a variant for a font key, and waits for its field to show it. */
  async chooseVariant(fontKey: string, name: string): Promise<void> {
    const field = this.control(`${fontKey}-variant`);
    await field.click();
    await this.variant(name).click();
    await expect(field).toContainText(name);
  }

  /** The glyph browser, once the Glyph row's opener has been clicked. */
  get glyphBrowser(): Locator {
    return this.root.getByTestId("orca-panel-scene-break-ornament-browser");
  }

  /** The browser's filter, which narrows by block name, by hex and by a pasted glyph. */
  get glyphFilter(): Locator {
    return this.root.getByTestId("orca-panel-glyph-filter");
  }

  /** The cells the browser draws, in code point order. */
  get glyphCells(): Locator {
    return this.root.getByTestId("orca-panel-glyph-cell");
  }

  /** The block headings the browser draws, in code point order. */
  get glyphBlocks(): Locator {
    return this.root.getByTestId("orca-panel-glyph-block");
  }

  /** One cell of the browser, named by its code point. */
  glyphCell(code: string): Locator {
    return this.glyphCells.and(this.root.locator(`[data-code="${code}"]`));
  }

  /**
   * Opens the glyph browser and waits for the face to be read. The
   * count the browser carries is written after the paint that draws
   * the cells, so a spec that waits on it never waits on a clock.
   */
  async browseGlyphs(): Promise<number> {
    await this.root.getByTestId("orca-panel-scene-break-ornament-browse").click();
    await expect(this.glyphBrowser).toBeVisible();
    await expect(this.glyphBrowser).not.toHaveAttribute("data-covered", "");
    return Number(await this.glyphBrowser.getAttribute("data-covered"));
  }

  /** The blocks the browser groups the face's code points under, in order. */
  async glyphGroups(): Promise<string[]> {
    return this.glyphBlocks.allTextContents();
  }

  /**
   * The first family a row is drawn in, and whether the document holds
   * a loaded face under that family. A family the document does not hold
   * would draw in the next one in the stack.
   */
  async drawnIn(row: Locator): Promise<{ family: string; loaded: boolean }> {
    return row.evaluate((element) => {
      const first = getComputedStyle(element).fontFamily.split(",")[0] ?? "";
      const family = first.trim().replace(/^["']|["']$/g, "");
      const loaded = [...document.fonts].some(
        (face) =>
          face.family.replace(/^["']|["']$/g, "") === family && face.status === "loaded",
      );
      return { family, loaded };
    });
  }
}

/** The panel in the right sidebar. It shows the book being read. */
export class Panel extends Controls {
  /** The panel's leaf, with or without a book. */
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
   * Scrolls the panel until a control is in the middle of it, and
   * returns how far the panel is then scrolled.
   */
  async scrollTo(control: Locator): Promise<number> {
    await control.evaluate((element) => {
      element.scrollIntoView({ block: "center" });
    });
    return this.scrolled();
  }

  /**
   * Sets the page unit in orca's settings with the call the settings tab
   * uses, and returns the unit it had.
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
