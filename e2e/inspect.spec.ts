import type { Book } from "./harness/book";
import type { Inspect } from "./harness/inspect";
import type { Panel } from "./harness/panel";
import { expect, test } from "./harness/test";
import type { Vault } from "./harness/vault";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The fixture chapter's note, and the page its title opens on. */
const CHAPTER_NOTE = "Chapter Twelve.md";
const OPENING = 11;

/** A verso of set text in the chapter, under a running head. */
const TEXT_PAGE = 12;

/** The chapter's title, which the page sets under the space above it. */
const CHAPTER_TITLE = "Chapter Twelve";

/**
 * Words on the first line of the chapter's first paragraph. Its first
 * letter is a drop cap, set apart from the line, so the words start
 * after it.
 */
const FIRST_PARAGRAPH = "consequence of";

/** Words on the last line of the chapter's opening page, whose paragraph goes on to the next page. */
const SPLIT_LINE = "repeatedly tried to persuade";

/** The title page, as the toolbar names it. */
const TITLE_PAGE = "Title page";

/** The book's title, which its title page prints. */
const TITLE = "Pride and Prejudice";

/** The role of a section with no role marker in the book note. */
const ROLE = "chapter";

/** A box's size in inches, which is orca's unit until an author picks another. */
const SIZE_IN_INCHES = /^\d+(\.\d+)? × \d+(\.\d+)?in$/;

/**
 * The margin box a verso's running head prints in. The fixture puts the
 * author on the left page, at the outside corner.
 */
const HEAD_BOX = "top-left";

/** A point inside that box on a verso, in points: past the outside margin, in the top margin. */
const IN_THE_HEAD = { x: 60, y: 28 };

/** A rule that restyles the book and moves no paragraph. */
/** The page's top-left corner, in points, where no box and no margin box is set. */
const NO_BOX = { x: 4, y: 4 };

const RESTYLED ="\nh1 { color: #111111; }";

test("the header action and the command each turn inspect mode on and off", async ({
  book,
  inspect,
}) => {
  await book.open();
  await book.painted();
  await expect(inspect.surface).toHaveAttribute("data-inspect", "off");
  await expect(inspect.action).toHaveAttribute("aria-pressed", "false");

  await inspect.on();
  await inspect.off();
  await expect(inspect.action).toHaveAttribute("aria-pressed", "false");

  await inspect.toggle();
  await expect(inspect.surface).toHaveAttribute("data-inspect", "on");
  await expect(inspect.action).toHaveAttribute("aria-pressed", "true");
  await inspect.toggle();
  await inspect.isOff();
  await expect(inspect.action).toHaveAttribute("aria-pressed", "false");
});

test("with inspect mode on, the box under the pointer is outlined", async ({
  book,
  inspect,
}) => {
  await book.open();
  await book.painted();
  await book.type(String(TEXT_PAGE));
  await expect(book.surface).toHaveAttribute("data-first", String(TEXT_PAGE));
  await inspect.on();

  const body = inspect.sheet(TEXT_PAGE).locator("text[data-selection-line]").nth(10);
  const key = await inspect.hoverLine(body);

  // A body paragraph is a node, so its key is the node's id.
  expect(key).toMatch(/^\d+$/);
  const hovered = inspect.outline("hovered");
  await expect(hovered.getByTestId("orca-inspect-edge")).toHaveCount(1);
  await expect(hovered.getByTestId("orca-inspect-edge")).toBeVisible();
  await expect(hovered.getByTestId("orca-inspect-edge")).toHaveAttribute("data-cut", "none");
});

test("the outline tints the margin, the padding and the content in three colors", async ({
  book,
  inspect,
}) => {
  await book.open();
  await book.painted();
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await inspect.on();

  // The chapter's title is set under the space the design puts above
  // it, which the generated layer writes as padding.
  await inspect.hoverLine(inspect.line(OPENING, CHAPTER_TITLE));
  const hovered = inspect.outline("hovered");
  const margin = hovered.getByTestId("orca-inspect-margin");
  const padding = hovered.getByTestId("orca-inspect-padding");
  const content = hovered.getByTestId("orca-inspect-content");
  await expect(margin).toHaveCount(1);
  await expect(padding).toHaveCount(1);
  await expect(content).toHaveCount(1);

  const tints = await Promise.all(
    [margin, padding, content].map((layer) =>
      layer.evaluate((element) => getComputedStyle(element).backgroundColor),
    ),
  );
  for (const tint of tints) expect(tint).not.toBe("rgba(0, 0, 0, 0)");
  expect(new Set(tints).size).toBe(3);

  // The padding is drawn, so the content sits inside a taller padding layer.
  const padded = await padding.boundingBox();
  const inner = await content.boundingBox();
  expect(padded && inner).toBeTruthy();
  expect(padded?.height ?? 0).toBeGreaterThan(inner?.height ?? 0);
});

test("a tag beside the outline shows the element, the section's role and the size", async ({
  book,
  inspect,
}) => {
  await book.open();
  await book.painted();
  await book.type(String(TEXT_PAGE));
  await expect(book.surface).toHaveAttribute("data-first", String(TEXT_PAGE));
  await inspect.on();

  await inspect.hoverLine(inspect.sheet(TEXT_PAGE).locator("text[data-selection-line]").nth(10));

  const tag = inspect.outline("hovered").getByTestId("orca-inspect-tag");
  await expect(tag).toHaveCount(1);
  await expect(tag).toBeVisible();
  await expect(tag.locator("b")).toHaveText("p");
  await expect(tag.locator("i")).toHaveText([ROLE, SIZE_IN_INCHES]);
});

test("a click pins the box, and the design panel opens its CSS view", async ({
  book,
  inspect,
  panel,
}) => {
  await book.open();
  await book.painted();
  await book.type(String(TEXT_PAGE));
  await expect(book.surface).toHaveAttribute("data-first", String(TEXT_PAGE));
  await inspect.on();

  const key = await inspect.pinLine(
    inspect.sheet(TEXT_PAGE).locator("text[data-selection-line]").nth(10),
  );

  expect(key).toMatch(/^\d+$/);
  await expect(inspect.surface).toHaveAttribute(
    "data-inspected-generation",
    String(await book.painted()),
  );
  await expect(inspect.outline("pinned").getByTestId("orca-inspect-edge")).toBeVisible();
  await expect(panel.panel).toBeVisible();
  await expect(panel.editor).toBeVisible();
});

test("a box split across two pages is outlined on both, each open where the page cut", async ({
  book,
  inspect,
}) => {
  await book.open();
  await book.painted();
  // The chapter opens on a recto and runs on to the verso after it,
  // which is the next spread. The grid paints every page of the fixture
  // at once, so both halves of a paragraph across that turn are on screen.
  await book.show("Grid", "grid");
  await expect(inspect.sheet(OPENING)).toBeVisible();
  await expect(inspect.sheet(TEXT_PAGE)).toBeVisible();
  await inspect.on();

  // The opening page ends inside a paragraph that the verso finishes.
  await inspect.pinLine(inspect.line(OPENING, SPLIT_LINE));

  const edges = inspect.outline("pinned").getByTestId("orca-inspect-edge");
  await expect(edges).toHaveCount(2);
  await expect(edges.nth(0)).toHaveAttribute("data-cut", "bottom");
  await expect(edges.nth(1)).toHaveAttribute("data-cut", "top");
  await expect(edges.nth(0)).toBeVisible();
  await expect(edges.nth(1)).toBeVisible();
  // One tag names the box, beside its first piece.
  await expect(inspect.outline("pinned").getByTestId("orca-inspect-tag")).toHaveCount(1);
});

test("a title page element and a running head can each be picked", async ({
  book,
  inspect,
  panel,
}) => {
  await book.open();
  await book.painted();
  await book.choose(TITLE_PAGE);
  await expect(book.surface).toHaveAttribute("data-first", "1");
  await inspect.on();

  // The title page is matter orca writes from the book's properties.
  const title = await inspect.pinLine(inspect.line(1, TITLE));
  expect(title).toMatch(/^\d+$/);
  const titleTag = inspect.outline("pinned").getByTestId("orca-inspect-tag");
  await expect(titleTag.locator("b")).toHaveText("h1");
  await expect(titleTag.locator("i").first()).toHaveText("title-page");
  await expect(panel.editor).toBeVisible();

  // Turning inspect mode off takes the pin with it.
  await inspect.off();
  await inspect.unpinned();

  await book.type(String(TEXT_PAGE));
  await expect(book.surface).toHaveAttribute("data-first", String(TEXT_PAGE));
  await inspect.on();
  const head = await inspect.pin(TEXT_PAGE, IN_THE_HEAD);
  expect(head).toBe(`@${HEAD_BOX}:${String(TEXT_PAGE)}`);
  const headTag = inspect.outline("pinned").getByTestId("orca-inspect-tag");
  await expect(headTag.locator("b")).toHaveText(`@${HEAD_BOX}`);
  await expect(inspect.outline("pinned").getByTestId("orca-inspect-edge")).toBeVisible();
});

test("a pin survives an edit to the CSS", async ({
  book,
  inspect,
  obsidian,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  // A repaint turns the pane to the page the node it follows starts on,
  // so the pin is on the chapter's opening page, which a repaint keeps.
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await inspect.on();

  await inspect.pinLine(inspect.line(OPENING, FIRST_PARAGRAPH));
  const pinnedAt = Number(await inspect.surface.getAttribute("data-inspected-generation"));
  await expect(panel.editor).toBeVisible();

  await panel.typeCss(RESTYLED);
  await expect.poll(async () => vault.read(BOOK)).toContain(RESTYLED);
  await expect.poll(async () => book.painted()).toBeGreaterThan(pinnedAt);

  // The pin is found again for the generation the pages now show.
  await obsidian.page.waitForFunction(() => {
    const surface = document.querySelector<HTMLElement>("[data-testid='orca-sheets']");
    const data = surface?.dataset;
    return (
      data !== undefined &&
      data["inspected"] !== undefined &&
      data["inspectedGeneration"] === data["generation"]
    );
  });
  expect(await inspect.refreshed(pinnedAt)).toBeGreaterThan(pinnedAt);
  await expect(inspect.surface).toHaveAttribute("data-inspected", /^\d+$/);
  await expect(inspect.outline("pinned").getByTestId("orca-inspect-edge")).toBeVisible();

  await panel.close();
  vault.touch(BOOK);
  await vault.modify(BOOK, own);
});

test("an edit to the manuscript that removes the pinned box takes the pin off", async ({
  book,
  inspect,
  vault,
}) => {
  vault.touch(CHAPTER_NOTE);
  await book.open();
  await book.painted();
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await inspect.on();

  await inspect.pinLine(inspect.line(OPENING, FIRST_PARAGRAPH));
  const pinnedAt = Number(await inspect.surface.getAttribute("data-inspected-generation"));

  const note = await vault.read(CHAPTER_NOTE);
  const cut = note.replace(/In consequence of an agreement[\s\S]*?\n\n/, "");
  expect(cut).not.toBe(note);
  await vault.modify(CHAPTER_NOTE, cut);

  await expect.poll(async () => book.painted()).toBeGreaterThan(pinnedAt);
  await inspect.unpinned();
  await expect(inspect.surface).not.toHaveAttribute("data-inspected-generation", /.*/);
  await expect(inspect.outline("pinned")).toHaveCount(0);
  // Inspect mode stays on with nothing pinned.
  await expect(inspect.surface).toHaveAttribute("data-inspect", "on");
});

test("the first Escape removes the pin, and the second turns inspect mode off", async ({
  book,
  inspect,
}) => {
  await book.open();
  await book.painted();
  await book.type(String(TEXT_PAGE));
  await expect(book.surface).toHaveAttribute("data-first", String(TEXT_PAGE));
  await inspect.on();
  await inspect.pinLine(inspect.sheet(TEXT_PAGE).locator("text[data-selection-line]").nth(10));

  await inspect.escape();
  await inspect.unpinned();
  await expect(inspect.surface).toHaveAttribute("data-inspect", "on");
  await expect(inspect.outline("pinned")).toHaveCount(0);

  await inspect.escape();
  await inspect.isOff();
  await expect(inspect.action).toHaveAttribute("aria-pressed", "false");
});

test("a click on the pinned box again, or where no box is, takes the pin off", async ({
  book,
  inspect,
}) => {
  await book.open();
  await book.painted();
  await book.type(String(TEXT_PAGE));
  await expect(book.surface).toHaveAttribute("data-first", String(TEXT_PAGE));
  await inspect.on();
  const line = inspect.sheet(TEXT_PAGE).locator("text[data-selection-line]").nth(10);
  await inspect.pinLine(line);

  await inspect.clickLine(line);
  await inspect.unpinned();
  await expect(inspect.outline("pinned")).toHaveCount(0);
  await expect(inspect.surface).toHaveAttribute("data-inspect", "on");

  await inspect.pinLine(line);
  await inspect.click(TEXT_PAGE, NO_BOX);
  await inspect.unpinned();
  await expect(inspect.surface).toHaveAttribute("data-inspect", "on");
});

test("the pinned node and its generation are written once the outline is committed", async ({
  book,
  inspect,
  obsidian,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await inspect.on();

  // Every write of the attributes is recorded with what the overlay
  // held at that moment, so an attribute written ahead of its outline is
  // caught however quickly the outline follows.
  await obsidian.page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>("[data-testid='orca-sheets']");
    if (surface === null) throw new Error("no surface");
    const seen: { key: string; generation: string; edge: boolean }[] = [];
    const watch = new MutationObserver(() => {
      const { inspected, inspectedGeneration } = surface.dataset;
      if (inspected === undefined || inspectedGeneration === undefined) return;
      seen.push({
        key: inspected,
        generation: inspectedGeneration,
        edge:
          document.querySelector(
            "[data-state='pinned'] [data-testid='orca-inspect-edge']",
          ) !== null,
      });
    });
    watch.observe(surface, {
      attributes: true,
      attributeFilter: ["data-inspected", "data-inspected-generation"],
    });
    (window as unknown as { orcaInspected: unknown }).orcaInspected = { seen, watch };
  });

  const outlined = (): Promise<boolean> =>
    obsidian.page
      .waitForFunction(() => {
        const surface = document.querySelector<HTMLElement>("[data-testid='orca-sheets']");
        const data = surface?.dataset;
        if (data?.["inspected"] === undefined) return false;
        if (data["inspectedGeneration"] !== data["generation"]) return false;
        return {
          edge:
            document.querySelector(
              "[data-state='pinned'] [data-testid='orca-inspect-edge']",
            ) !== null,
        };
      })
      .then(async (handle) => ((await handle.jsonValue()) as { edge: boolean }).edge);

  await inspect.pinLine(inspect.line(OPENING, FIRST_PARAGRAPH));
  expect(await outlined()).toBe(true);
  const pinnedAt = Number(await inspect.surface.getAttribute("data-inspected-generation"));

  // A paint finds the pin again, which writes both attributes a second time.
  await panel.typeCss(RESTYLED);
  await expect.poll(async () => vault.read(BOOK)).toContain(RESTYLED);
  await inspect.refreshed(pinnedAt);
  expect(await outlined()).toBe(true);

  const seen = await obsidian.page.evaluate(() => {
    const recorded = (window as unknown as {
      orcaInspected?: {
        seen: { key: string; generation: string; edge: boolean }[];
        watch: MutationObserver;
      };
    }).orcaInspected;
    recorded?.watch.disconnect();
    delete (window as unknown as { orcaInspected?: unknown }).orcaInspected;
    return recorded?.seen ?? [];
  });
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((write) => !write.edge)).toEqual([]);

  await panel.close();
  vault.touch(BOOK);
  await vault.modify(BOOK, own);
});

/** Words on the first line of the chapter's second paragraph, which `p + p` reaches. */
const SECOND_PARAGRAPH = "Her answer";

/** The chapter's section, as a selector reaches it by its id. */
const SECTION = "section#chapter-twelve";

/** The design key that writes the body's first-line indent, which `p + p` sets. */
const INDENT_KEY = "body-first-line-indent";

/**
 * A rule of the author's own for the second paragraph. The fixture's
 * fence is three lines, so a rule typed at its end starts on line 4.
 */
const OWN_RULE = `\n${SECTION} p + p { text-indent: 1.25em; }`;
const OWN_LINE = 4;

/**
 * Opens the book on the chapter's first page with inspect mode on, and
 * pins the second paragraph there. That page is the one a repaint keeps.
 */
async function pinSecond(
  book: Book,
  inspect: Inspect,
  panel: Panel,
): Promise<{ key: string; generation: number }> {
  await book.open();
  await book.painted();
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await inspect.on();
  await inspect.pinLine(inspect.line(OPENING, SECOND_PARAGRAPH));
  const pin = await inspect.pinned();
  await panel.inspecting(pin.key, pin.generation);
  return pin;
}

/**
 * Waits until the pane shows the pin the preview holds for the pages it
 * last painted. Typing a rule renders once for each settled write, so
 * the wait is on the three agreeing rather than on one generation.
 */
async function caughtUp(book: Book, inspect: Inspect, panel: Panel): Promise<void> {
  await expect
    .poll(async () => {
      const painted = await book.surface.getAttribute("data-generation");
      const key = await inspect.surface.getAttribute("data-inspected");
      const answered = await inspect.surface.getAttribute("data-inspected-generation");
      const shown = await panel.pane.getAttribute("data-inspected");
      const shownAt = await panel.pane.getAttribute("data-generation");
      return key !== null && answered === painted && shown === key && shownAt === painted;
    })
    .toBe(true);
}

/** Types a rule at the end of the author's CSS, and waits for the note and the pane to have it. */
async function typeRule(
  book: Book,
  inspect: Inspect,
  panel: Panel,
  vault: Vault,
  rule: string,
): Promise<void> {
  await panel.typeCss(rule);
  await expect.poll(async () => vault.read(BOOK)).toContain(rule);
  await caughtUp(book, inspect, panel);
}

test("the pane: a click pins the box, and the pane sits above the CSS editor", async ({
  book,
  inspect,
  panel,
}) => {
  const pin = await pinSecond(book, inspect, panel);

  await expect(panel.pane).toHaveAttribute("data-inspected", pin.key);
  await expect(panel.pane).toHaveAttribute("data-generation", String(pin.generation));
  await expect(panel.pane).toBeVisible();
  await expect(panel.editor).toBeVisible();
  const pane = await panel.pane.boundingBox();
  const editor = await panel.editor.boundingBox();
  expect(pane && editor).toBeTruthy();
  expect((pane?.y ?? 0) + (pane?.height ?? 0)).toBeLessThanOrEqual((editor?.y ?? 0) + 1);
});

test("the pane: its close button takes the pin off and leaves inspect mode on", async ({
  book,
  inspect,
  panel,
}) => {
  await pinSecond(book, inspect, panel);

  await panel.unpinButton.click();
  await inspect.unpinned();
  await expect(panel.pane).toHaveCount(0);
  await expect(inspect.surface).toHaveAttribute("data-inspect", "on");
});

test("the pane: the ancestors are crumbs, and a click on one takes it out of the selector or puts it back", async ({
  book,
  inspect,
  panel,
}) => {
  await pinSecond(book, inspect, panel);

  await expect(panel.crumbs.last()).toHaveText("p");
  const section = panel.crumbs.filter({ hasText: SECTION });
  await expect(section).toHaveCount(1);
  // The selector starts at the nearest ancestor with an id.
  await expect(section).toHaveAttribute("data-picked", "true");
  await expect(panel.selector).toHaveText(`${SECTION} > p`);

  await panel.pickCrumb(SECTION);
  await expect(panel.selector).toHaveText("p");
  await panel.pickCrumb(SECTION);
  await expect(panel.selector).toHaveText(`${SECTION} > p`);
});

test("the pane: matched rules are grouped as Book CSS, Design panel and Orca's theme", async ({
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await pinSecond(book, inspect, panel);

  // An empty layer is not drawn, so the author's CSS is given a rule
  // for the paragraph.
  await typeRule(book, inspect, panel, vault, OWN_RULE);

  await expect(panel.ruleGroups).toHaveCount(3);
  expect(
    await panel.ruleGroups.evaluateAll((groups) =>
      groups.map((group) => group.getAttribute("data-layer")),
    ),
  ).toEqual(["own", "design", "theme"]);
  await expect(panel.ruleGroups).toHaveText([/^Book CSS/, /^Design panel/, /^Orca's theme/]);
  for (const layer of ["own", "design", "theme"] as const) {
    await expect(panel.rulesIn(layer).first()).toBeVisible();
  }

  await vault.modify(BOOK, own);
});

test("the pane: an author's rule shows its line, and a click puts the caret on it", async ({
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await pinSecond(book, inspect, panel);
  await typeRule(book, inspect, panel, vault, OWN_RULE);

  const rule = panel.ownRule(OWN_LINE);
  await expect(rule).toHaveCount(1);
  await expect(rule).toContainText(`line ${String(OWN_LINE)}`);

  // The caret is at the end of what was typed, so it goes to the top first.
  await panel.code.press("ControlOrMeta+Home");
  await expect.poll(async () => panel.caretAt()).toBe(1);
  await panel.openRule(rule);
  await expect.poll(async () => panel.caretAt()).toBe(OWN_LINE);

  await vault.modify(BOOK, own);
});

test("the pane: a design panel rule names its control, and a click opens it", async ({
  book,
  inspect,
  panel,
}) => {
  await pinSecond(book, inspect, panel);

  const rule = panel.designRule(INDENT_KEY);
  await expect(rule).toHaveCount(1);
  await expect(rule).toContainText("p + p");
  await expect(rule).toContainText("First-line indent");

  await panel.openRule(rule);
  await expect(panel.panel).toHaveAttribute("data-viewing", "controls");
  await expect(panel.row(INDENT_KEY)).toBeVisible();
  await expect(panel.row(INDENT_KEY)).toContainText("First-line indent");
});

test("the pane: a lost declaration is struck through, and a refused one keeps its squiggle", async ({
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await pinSecond(book, inspect, panel);
  await expect(panel.flags).toHaveCount(0);

  const rule = `\n${SECTION} p + p { text-indent: 1.35em; float: left }`;
  await typeRule(book, inspect, panel, vault, rule);

  // The author's rule wins the indent, so the design panel's is lost.
  const designed = panel
    .designRule(INDENT_KEY)
    .getByTestId("orca-inspect-decl")
    .filter({ hasText: "text-indent" });
  await expect(designed).toHaveAttribute("data-lost", "true");
  await expect(
    designed.evaluate((element) => getComputedStyle(element).textDecorationLine),
  ).resolves.toContain("line-through");
  const won = panel
    .ownRule(OWN_LINE)
    .getByTestId("orca-inspect-decl")
    .filter({ hasText: "text-indent" });
  await expect(won).not.toHaveAttribute("data-lost", /.*/);

  // The engine refuses the float, which the pane shows from the flag.
  const refused = panel
    .ownRule(OWN_LINE)
    .getByTestId("orca-inspect-decl")
    .filter({ hasText: "float" });
  await expect(refused).toHaveAttribute("data-skipped", "true");
  await expect(panel.flaggedLines.filter({ hasText: String(OWN_LINE) })).toHaveCount(1);
  const flagged = await panel.flags.count();
  expect(flagged).toBeGreaterThan(0);

  // The squiggle is the editor's, and it stays when the pane goes.
  await inspect.off();
  await expect(panel.pane).toHaveCount(0);
  await expect(panel.flags).toHaveCount(flagged);

  await vault.modify(BOOK, own);
});

test("the pane: it shows the computed font, line height, indent, margins and box", async ({
  book,
  inspect,
  panel,
}) => {
  await pinSecond(book, inspect, panel);

  const value = (label: string) => panel.computed.locator(`[data-label="${label}"]`);
  // The fixture sets the body at 10.5pt on 14pt, indented 1.2em. The
  // engine computes the line height as a ratio of the size: 14 / 10.5.
  await expect(value("Font")).toContainText("10.5pt");
  await expect(value("Line height")).toHaveText(/^1\.333/);
  await expect(value("Indent")).toHaveText(/^12\.6(pt)?$/);
  await expect(value("Margins")).toHaveText(/ above, .* below$/);
  await expect(value("Box")).toHaveText(SIZE_IN_INCHES);
});

test("the pane: Add a rule inserts an empty rule for the selector at the caret", async ({
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await pinSecond(book, inspect, panel);

  // The caret goes after the fence's last rule, on line 3.
  await panel.code.click();
  await panel.code.press("ControlOrMeta+End");
  await expect.poll(async () => panel.caretAt()).toBe(3);
  await expect(panel.selector).toHaveText(`${SECTION} > p`);

  await panel.add();

  const inserted = `${SECTION} > p {\n  \n}`;
  await expect.poll(async () => vault.read(BOOK)).toContain(inserted);
  const fence = /```css\n([\s\S]*?)```/.exec(await vault.read(BOOK))?.[1] ?? "";
  expect(fence).toContain(inserted);
  // The caret waits on the empty line inside the braces.
  await expect.poll(async () => panel.caretAt()).toBe(5);

  await vault.modify(BOOK, own);
});

/** The design key that writes the chapter's drop cap, which the fixture sets to 3 lines. */
const DROP_CAP_KEY = "chapter-drop-cap";

/** A rule of the author's own for the opening line of every paragraph in the chapter. */
const FIRST_LINE_RULE = `\n${SECTION} p::first-line { color: #333333; }`;

/** A rule of the author's own that puts a box above the chapter's title, with words in it. */
const GENERATED = "Set apart";
const BEFORE_RULE = `\n${SECTION} h1::before { content: "${GENERATED}"; }`;

/**
 * A point on the drop cap of a pinned paragraph. The letter is set at
 * the top left corner of the paragraph's box, so a point just inside
 * that corner is on the letter.
 */
async function onTheCap(inspect: Inspect): Promise<{ x: number; y: number }> {
  const box = await inspect.rectOf(
    inspect.outline("pinned").getByTestId("orca-inspect-edge").first(),
  );
  return { x: box.x + 3, y: box.y + 3 };
}

test("a click on a drop cap pins its `::first-letter`, and the pane lists the rules that match it", async ({
  book,
  inspect,
  panel,
}) => {
  await book.open();
  await book.painted();
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await inspect.on();

  // The paragraph is pinned first, because its box says where the letter is.
  const paragraph = await inspect.pinLine(inspect.line(OPENING, FIRST_PARAGRAPH));
  const cap = await inspect.pinAt(await onTheCap(inspect), paragraph);
  expect(cap).not.toBe(paragraph);
  await caughtUp(book, inspect, panel);
  // The tag and the crumbs name the pseudo-element after its element.
  await expect(inspect.outline("pinned").getByTestId("orca-inspect-tag").locator("b")).toHaveText(
    "p::first-letter",
  );
  await expect(panel.crumbs.last()).toHaveText("::first-letter");
  await expect(panel.crumbs.nth(-2)).toHaveText("p");
  // The drop cap comes from the design panel's control, and that is the
  // rule the pane lists. "Add a rule" names the pseudo-element too.
  const rule = panel.designRule(DROP_CAP_KEY);
  await expect(rule).toBeVisible();
  await expect(rule).toContainText("::first-letter");
  await expect(rule).toContainText("initial-letter");
  await expect(panel.selector).toHaveText(`${SECTION} > p::first-letter`);
});

test("the outline around a pinned drop cap is the letter, not the paragraph", async ({
  book,
  inspect,
}) => {
  await book.open();
  await book.painted();
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await inspect.on();

  const pinned = await inspect.pinLine(inspect.line(OPENING, FIRST_PARAGRAPH));
  const edge = inspect.outline("pinned").getByTestId("orca-inspect-edge");
  const paragraph = await inspect.rectOf(edge.first());

  await inspect.pinAt(await onTheCap(inspect), pinned);
  const letter = await inspect.rectOf(edge.first());

  expect(letter.width).toBeLessThan(paragraph.width);
  expect(letter.height).toBeLessThan(paragraph.height);
  // The letter sits at the corner the paragraph starts at.
  expect(Math.abs(letter.x - paragraph.x)).toBeLessThan(paragraph.width / 4);
  expect(Math.abs(letter.y - paragraph.y)).toBeLessThan(paragraph.height / 2);
});

test("the crumb for the element pins the element, and its rules replace the drop cap's", async ({
  book,
  inspect,
  panel,
}) => {
  await book.open();
  await book.painted();
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await inspect.on();

  const paragraph = await inspect.pinLine(inspect.line(OPENING, FIRST_PARAGRAPH));
  await inspect.pinAt(await onTheCap(inspect), paragraph);
  await caughtUp(book, inspect, panel);
  await expect(panel.designRule(DROP_CAP_KEY)).toBeVisible();

  // The crumb for the element is the one that carries a node to pin.
  const element = panel.crumbs.nth(-2);
  await expect(element).toHaveText("p");
  await element.click();

  await expect(inspect.surface).toHaveAttribute("data-inspected", paragraph);
  await caughtUp(book, inspect, panel);
  await expect(panel.crumbs.last()).toHaveText("p");
  await expect(panel.selector).toHaveText(`${SECTION} > p`);
  await expect(panel.designRule(DROP_CAP_KEY)).toHaveCount(0);
});

test("a click on a first line pins its `::first-line`, and the pane lists the rules that match it", async ({
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await pinSecond(book, inspect, panel);
  await typeRule(book, inspect, panel, vault, FIRST_LINE_RULE);

  // The words of the opening line start after the drop cap, and they
  // are the rest of `::first-line`.
  await inspect.pinLine(inspect.line(OPENING, FIRST_PARAGRAPH));
  await caughtUp(book, inspect, panel);

  await expect(panel.crumbs.last()).toHaveText("::first-line");
  await expect(panel.selector).toHaveText(`${SECTION} > p::first-line`);
  await expect(panel.rulesIn("own").filter({ hasText: "::first-line" })).toHaveCount(1);

  await panel.close();
  vault.touch(BOOK);
  await vault.modify(BOOK, own);
});

test("a click on the text of a generated box pins its `::before`, and the pane lists its rules", async ({
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await pinSecond(book, inspect, panel);
  await typeRule(book, inspect, panel, vault, BEFORE_RULE);

  await inspect.pinLine(inspect.line(OPENING, GENERATED));
  await caughtUp(book, inspect, panel);

  await expect(panel.crumbs.last()).toHaveText("::before");
  await expect(panel.crumbs.nth(-2)).toHaveText("h1");
  await expect(panel.selector).toHaveText(`${SECTION} > h1::before`);
  await expect(panel.rulesIn("own").filter({ hasText: "::before" })).toHaveCount(1);

  await panel.close();
  vault.touch(BOOK);
  await vault.modify(BOOK, own);
});

test("an edit to the CSS that takes a pseudo-element away takes the pin off", async ({
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await pinSecond(book, inspect, panel);
  await typeRule(book, inspect, panel, vault, BEFORE_RULE);
  await inspect.pinLine(inspect.line(OPENING, GENERATED));
  await caughtUp(book, inspect, panel);
  const pin = await inspect.pinned();

  // Backing the rule out leaves the engine with no `::before` to answer for.
  await panel.code.click();
  await panel.code.press("ControlOrMeta+End");
  for (let at = 0; at < BEFORE_RULE.length; at += 1) {
    await panel.code.press("Backspace");
  }
  await expect.poll(async () => vault.read(BOOK)).not.toContain("::before");

  await expect.poll(async () => book.painted()).toBeGreaterThan(pin.generation);
  await inspect.unpinned();
  await expect(inspect.outline("pinned")).toHaveCount(0);
  await expect(inspect.surface).toHaveAttribute("data-inspect", "on");

  await panel.close();
  vault.touch(BOOK);
  await vault.modify(BOOK, own);
});

test("the pane: a running head and a title page element show their selectors and rules", async ({
  book,
  inspect,
  panel,
}) => {
  await book.open();
  await book.painted();
  await inspect.on();

  await inspect.pinLine(inspect.line(1, TITLE));
  let pin = await inspect.pinned();
  await panel.inspecting(pin.key, pin.generation);
  await expect(panel.crumbs.filter({ hasText: "section#title-page" })).toHaveCount(1);
  await expect(panel.selector).toHaveText("section#title-page > h1");
  await expect(
    panel.rulesIn("design").filter({ hasText: "section#title-page" }).first(),
  ).toBeVisible();

  await inspect.off();
  await inspect.unpinned();
  await expect(panel.pane).toHaveCount(0);

  await book.type(String(TEXT_PAGE));
  await expect(book.surface).toHaveAttribute("data-first", String(TEXT_PAGE));
  await inspect.on();
  await inspect.pin(TEXT_PAGE, IN_THE_HEAD);
  pin = await inspect.pinned();
  expect(pin.key).toBe(`@${HEAD_BOX}:${String(TEXT_PAGE)}`);
  await panel.inspecting(pin.key, pin.generation);
  await expect(panel.crumbs).toHaveText([/^@page/, `@${HEAD_BOX}`]);
  await expect(panel.selector).toHaveText(`@${HEAD_BOX}`);
  const head = panel.rulesIn("design").filter({ hasText: `@${HEAD_BOX}` }).first();
  await expect(head).toBeVisible();
  await expect(head).toContainText(new RegExp(`@page.*› @${HEAD_BOX}`));
  await expect(head).toContainText("Jane Austen");
});

test("the pane: after an edit to the CSS it shows the pin at the new generation, with the new rule", async ({
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  const pinned = await pinSecond(book, inspect, panel);
  await expect(panel.ownRule(OWN_LINE)).toHaveCount(0);

  await typeRule(book, inspect, panel, vault, OWN_RULE);

  const now = await inspect.pinned();
  expect(now.generation).toBeGreaterThan(pinned.generation);
  await expect(panel.pane).toHaveAttribute("data-generation", String(now.generation));
  await expect(panel.ownRule(OWN_LINE)).toHaveCount(1);
  await expect(panel.ownRule(OWN_LINE)).toContainText("text-indent");
  await expect(panel.ownRule(OWN_LINE)).toContainText("1.25em");

  await vault.modify(BOOK, own);
});

test("the pane: a section is named by its id in the pane and in an inserted rule", async ({
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await inspect.on();

  // The chapter's title is matched by the design panel's rule for the
  // section's opening, which reaches the section by its id.
  await inspect.pinLine(inspect.line(OPENING, CHAPTER_TITLE));
  const pin = await inspect.pinned();
  await panel.inspecting(pin.key, pin.generation);
  await expect(panel.crumbs.filter({ hasText: SECTION })).toHaveCount(1);
  await expect(panel.rulesIn("design").filter({ hasText: SECTION }).first()).toBeVisible();
  await expect(panel.pane).not.toContainText(":nth-child");

  await panel.code.click();
  await panel.code.press("ControlOrMeta+End");
  await expect(panel.selector).toHaveText(`${SECTION} > h1`);
  await panel.add();

  await expect.poll(async () => vault.read(BOOK)).toContain(`${SECTION} > h1 {`);
  expect(await vault.read(BOOK)).not.toContain(":nth-child");

  await vault.modify(BOOK, own);
});

// What this spec does not cover: a hover that lands between two
// animation frames, since the pointer is moved once and the answer read
// after it lands. The size of a tag in millimetres or points is not
// checked here; the unit's conversion is a Node test. A rule the pane
// opens from a heading level other than H1 is not driven. No element in
// the fixture has classes and no id, so a selector that names classes
// is a Node test. No section in the fixture is set in columns, so a box
// with two pieces on one page is a Node test too.
// The fixture generates `a::after` on the contents page, and the specs
// here reach `::before` through a rule of the author's own instead.
