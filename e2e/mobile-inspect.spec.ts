import type { Locator } from "@playwright/test";
import type { Book } from "./harness/book";
import type { Inspect, Rect } from "./harness/inspect";
import type { Obsidian } from "./harness/obsidian";
import type { Panel } from "./harness/panel";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The fixture chapter, and the page its title opens on. */
const CHAPTER_TITLE = "Chapter Twelve";
const OPENING = 11;

/** Words on the first line of the chapter's second paragraph. */
const SECOND_PARAGRAPH = "Her answer";

/** The design key that writes the body's first-line indent, which `p + p` sets. */
const INDENT_KEY = "body-first-line-indent";

/**
 * A rule of the author's own for every chapter title. The fixture's
 * fence is three lines, so a rule typed at its end starts on line 4.
 */
const TITLE_CSS = "h1 { color: #111111; }";
const TITLE_RULE = 4;

/** The widest gap between two boxes that are drawn in the same place, in pixels. */
const CLOSE = 1.5;

/** A drag of the grabber long enough to be a pull. */
const A_PULL = 90;

/** Opens the book on the chapter's first page, with inspect mode on from the header. */
async function inspecting(book: Book, inspect: Inspect): Promise<void> {
  await book.open();
  await book.settled(BOOK);
  await book.choose(CHAPTER_TITLE);
  await expect(book.surface).toHaveAttribute("data-first", String(OPENING));
  await expect(inspect.action).toBeVisible();
  await inspect.on();
}

/** The edge the overlay draws around the pinned box. */
function pinnedEdge(inspect: Inspect): Locator {
  return inspect.outline("pinned").getByTestId("orca-inspect-edge").first();
}

/** A box's place on its page, as fractions of the page, which a move and a resize both keep. */
function onPage(box: Rect, page: Rect): { x: number; y: number; height: number } {
  return {
    x: (box.x - page.x) / page.width,
    y: (box.y - page.y) / page.height,
    height: box.height / page.height,
  };
}

/**
 * Waits until the overlay's box is where the element is: around the
 * line that was tapped, and at the place on the page it was pinned at.
 */
async function agrees(
  inspect: Inspect,
  line: Locator,
  pinnedAt: { x: number; y: number; height: number },
): Promise<void> {
  await expect(async () => {
    const page = await inspect.rectOf(inspect.sheet(OPENING));
    const edge = await inspect.rectOf(pinnedEdge(inspect));
    const text = await inspect.rectOf(line);
    expect(text.y).toBeGreaterThanOrEqual(edge.y - CLOSE);
    expect(text.y + text.height).toBeLessThanOrEqual(edge.y + edge.height + CLOSE);
    expect(text.x).toBeGreaterThanOrEqual(edge.x - CLOSE);
    const now = onPage(edge, page);
    expect(Math.abs(now.x - pinnedAt.x) * page.width).toBeLessThan(CLOSE);
    expect(Math.abs(now.y - pinnedAt.y) * page.height).toBeLessThan(CLOSE);
    expect(Math.abs(now.height - pinnedAt.height) * page.height).toBeLessThan(CLOSE);
  }).toPass();
}

for (const device of ["phone", "tablet"] as const) {
  test(`on a ${device} the box stays on the element when the header hides, a drawer opens and shuts, and the pages move`, async ({
    obsidian,
    book,
    inspect,
  }) => {
    await obsidian.mobile(device);
    try {
      await inspecting(book, inspect);
      const line = inspect.line(OPENING, SECOND_PARAGRAPH);
      await inspect.pinLine(line);
      await expect(pinnedEdge(inspect)).toBeVisible();
      // A tablet opens the drawer for the pin, which resizes the page,
      // so the place is read once the box is around the line.
      await expect(async () => {
        const edge = await inspect.rectOf(pinnedEdge(inspect));
        const text = await inspect.rectOf(line);
        expect(text.y).toBeGreaterThanOrEqual(edge.y - CLOSE);
        expect(text.y + text.height).toBeLessThanOrEqual(edge.y + edge.height + CLOSE);
      }).toPass();
      const pinnedAt = onPage(
        await inspect.rectOf(pinnedEdge(inspect)),
        await inspect.rectOf(inspect.sheet(OPENING)),
      );
      const pin = await inspect.pinned();

      // The header hides. A tablet's view moves up under it, and a
      // phone floats the header over the view.
      await obsidian.headers(false);
      await agrees(inspect, line, pinnedAt);
      await obsidian.headers(true);
      await agrees(inspect, line, pinnedAt);

      // A drawer opens and shuts.
      await obsidian.expand("right");
      await obsidian.put("right");
      await agrees(inspect, line, pinnedAt);
      await obsidian.expand("left");
      await obsidian.put("left");
      await agrees(inspect, line, pinnedAt);

      // The pages move and nothing is resized, as in a scroll.
      const still = await inspect.rectOf(inspect.sheet(OPENING));
      await inspect.shift(37);
      await expect
        .poll(async () => (await inspect.rectOf(inspect.sheet(OPENING))).y - still.y)
        .toBeCloseTo(37, 0);
      await agrees(inspect, line, pinnedAt);
      await inspect.shift(0);
      await agrees(inspect, line, pinnedAt);

      // None of it took the pin off.
      expect((await inspect.pinned()).key).toBe(pin.key);
    } finally {
      await inspect.shift(0);
      await obsidian.headers(true);
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });
}

test("on a phone a tap pins a box and the pane rises as a sheet over the foot of the page, with the drawer shut", async ({
  obsidian,
  book,
  inspect,
  panel,
}) => {
  await obsidian.mobile("phone");
  try {
    await inspecting(book, inspect);
    await obsidian.put("right");
    const key = await inspect.pinLine(inspect.line(OPENING, SECOND_PARAGRAPH));

    // The sheet rises with the crumbs and the first rule that matched.
    await expect(inspect.risen).toBeVisible();
    await expect(inspect.risen).toHaveAttribute("data-pull", "peek");
    expect(await obsidian.collapsed("right")).toBe(true);
    await expect(inspect.risenCrumbs.last()).toHaveText("p");
    await expect(inspect.risenRules.filter({ visible: true })).toHaveCount(1);
    await expect(inspect.risenAdd).toBeHidden();
    await expect(inspect.risenComputed).toBeHidden();
    // The drawer's panel draws no second pane.
    await expect(panel.pane).toHaveCount(0);

    // The sheet is at the foot of the screen, over Obsidian's own bar.
    const screen = await obsidian.page.evaluate(() => window.innerHeight);
    // The sheet slides up to its place, so the place is read once it is there.
    await expect(async () => {
      const sheet = await inspect.rectOf(inspect.risen);
      expect(sheet.y + sheet.height).toBeCloseTo(screen, 0);
      expect(sheet.y).toBeLessThan(await obsidian.navbar());
    }).toPass();
    await expect(inspect.grabber).toBeVisible();

    // The box is on screen with the sheet under it.
    await expect(async () => {
      const edge = await inspect.rectOf(pinnedEdge(inspect));
      const top = (await inspect.rectOf(inspect.risen)).y;
      expect(edge.y + edge.height).toBeLessThanOrEqual(top);
      expect(edge.y).toBeGreaterThanOrEqual(await inspect.wellTop());
    }).toPass();

    // A swipe that opens a drawer slides the main area aside, and the
    // sheet goes with it.
    const rested = await inspect.rectOf(inspect.risen);
    await obsidian.slide(-120);
    await expect.poll(async () => (await inspect.rectOf(inspect.risen)).x).toBeCloseTo(rested.x - 120, 0);
    await obsidian.slide(0);
    await expect.poll(async () => (await inspect.rectOf(inspect.risen)).x).toBeCloseTo(rested.x, 0);

    // Pulled up, it is the whole pane.
    await inspect.pull(-A_PULL);
    await expect(inspect.risen).toHaveAttribute("data-pull", "full");
    expect(await inspect.risenRules.filter({ visible: true }).count()).toBeGreaterThan(1);
    await expect(inspect.risenComputed).toBeVisible();
    await expect(inspect.risenAdd).toBeVisible();
    // The sheet stops short of the top of the screen, and the page
    // moves up, so the box is still in sight over it.
    await expect(async () => {
      const edge = await inspect.rectOf(pinnedEdge(inspect));
      const top = (await inspect.rectOf(inspect.risen)).y;
      expect(top).toBeGreaterThanOrEqual(screen * 0.2 - CLOSE);
      expect(edge.y).toBeLessThan(top);
      expect(edge.y).toBeGreaterThanOrEqual(await inspect.wellTop());
    }).toPass();

    // A tap on the grabber takes it back to the first rule, and a pull
    // down past its foot closes it and removes the pin.
    await inspect.grabber.click();
    await expect(inspect.risen).toHaveAttribute("data-pull", "peek");
    expect(await inspect.pinned()).toMatchObject({ key });
    await inspect.pull(A_PULL);
    await inspect.unpinned();
    await expect(inspect.risen).toHaveCount(0);
    await expect(inspect.surface).toHaveAttribute("data-inspect", "on");
    // The page is back where it was.
    await expect.poll(async () => inspect.lift()).toBe(0);
  } finally {
    await obsidian.slide(0);
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("on a phone the page moves up when the sheet would cover the pinned box, and a tap on another box pins that one with the sheet still up", async ({
  obsidian,
  book,
  inspect,
}) => {
  await obsidian.mobile("phone");
  try {
    await inspecting(book, inspect);
    const page = await inspect.rectOf(inspect.sheet(OPENING));
    const first = await inspect.pinLine(inspect.line(OPENING, SECOND_PARAGRAPH));
    await expect(inspect.risen).toBeVisible();

    // The chapter's title is over the sheet, and a tap pins it.
    const second = await inspect.pinAt(
      await middleOf(inspect, inspect.line(OPENING, CHAPTER_TITLE)),
      first,
    );
    await expect(inspect.risen).toBeVisible();
    await expect(inspect.risen).toHaveAttribute("data-pull", "peek");
    await expect(inspect.risenCrumbs.last()).toHaveText("h1");

    // The lowest line is at the foot of the page, where the whole pane rises to.
    const lines = inspect.sheet(OPENING).locator("text[data-selection-line]");
    const lowest = await lines.evaluateAll((drawn) => {
      const tops = drawn.map((line) => line.getBoundingClientRect().top);
      return tops.indexOf(Math.max(...tops));
    });
    const low = await inspect.rectOf(lines.nth(lowest));
    expect(low.y).toBeGreaterThan(page.y + page.height / 2);
    await inspect.pinAt({ x: low.x + low.width / 2, y: low.y + low.height / 2 }, second);
    await inspect.pull(-A_PULL);
    await expect(inspect.risen).toHaveAttribute("data-pull", "full");
    await expect.poll(async () => (await inspect.rectOf(inspect.risen)).y).toBeLessThan(low.y);

    await expect(async () => {
      const edge = await inspect.rectOf(pinnedEdge(inspect));
      const top = (await inspect.rectOf(inspect.risen)).y;
      expect(edge.y + edge.height).toBeLessThanOrEqual(top);
      expect(edge.y).toBeGreaterThanOrEqual(await inspect.wellTop());
      // The page moved up for it.
      expect((await inspect.rectOf(inspect.sheet(OPENING))).y).toBeLessThan(page.y);
    }).toPass();
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("on a phone a tap on a rule's line, on the control that wrote a rule, and on Add a rule each open the right drawer there and keep the pin", async ({
  obsidian,
  book,
  inspect,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await obsidian.mobile("phone");
  try {
    await inspecting(book, inspect);
    // The rule is typed in the drawer's editor, as an author writes it.
    await obsidian.expand("right");
    await panel.toCss.click();
    await expect(panel.editor).toBeVisible();
    await panel.typeCss(`\n${TITLE_CSS}`);
    await expect.poll(async () => vault.read(BOOK)).toContain(TITLE_CSS);
    await book.settled(BOOK);
    await shut(obsidian, panel);

    // The line of a rule in the author's CSS.
    const title = await inspect.pinLine(inspect.line(OPENING, CHAPTER_TITLE));
    await inspect.pull(-A_PULL);
    const rule = inspect.risen.locator(
      `[data-testid="orca-inspect-rule"][data-layer="own"][data-line="${String(TITLE_RULE)}"]`,
    );
    await expect(rule).toHaveCount(1);
    await rule.getByRole("button").first().click();
    await expect.poll(async () => obsidian.collapsed("right")).toBe(false);
    await expect(panel.panel).toHaveAttribute("data-viewing", "css");
    await expect(panel.editor).toBeVisible();
    await expect.poll(async () => panel.caretAt()).toBe(TITLE_RULE);
    expect((await inspect.pinned()).key).toBe(title);
    // The drawer is over the sheet, and the sheet is there when it shuts.
    const drawer = await panel.box(panel.editor);
    expect(drawer.width).toBeGreaterThan(0);
    await shut(obsidian, panel);
    await expect(inspect.risen).toBeVisible();
    await expect(inspect.risen).toHaveAttribute("data-pull", "full");

    // The control that wrote a design panel rule. The whole pane is
    // over the paragraph, so the sheet comes down for the tap.
    await inspect.grabber.click();
    await expect(inspect.risen).toHaveAttribute("data-pull", "peek");
    // The page comes back down under the shorter sheet, and the tap
    // waits for it, so it lands on the paragraph.
    await expect.poll(async () => inspect.lift()).toBe(0);
    const second = await inspect.pinAt(
      await middleOf(inspect, inspect.line(OPENING, SECOND_PARAGRAPH)),
      title,
    );
    await inspect.pull(-A_PULL);
    await expect(inspect.risen).toHaveAttribute("data-pull", "full");
    const design = inspect.risen.locator(
      `[data-testid="orca-inspect-rule"][data-layer="design"][data-keys~="${INDENT_KEY}"]`,
    );
    await expect(design).toHaveCount(1);
    await design.getByRole("button").first().click();
    await expect.poll(async () => obsidian.collapsed("right")).toBe(false);
    await expect(panel.panel).toHaveAttribute("data-viewing", "controls");
    await expect(panel.row(INDENT_KEY)).toBeInViewport();
    expect((await inspect.pinned()).key).toBe(second);
    await shut(obsidian, panel);

    // `Add a rule` writes the rule at the caret of the author's CSS.
    await expect(inspect.risenAdd).toBeVisible();
    await inspect.risenAdd.click();
    await expect.poll(async () => obsidian.collapsed("right")).toBe(false);
    await expect(panel.panel).toHaveAttribute("data-viewing", "css");
    await expect(panel.editor).toBeVisible();
    await expect.poll(async () => vault.read(BOOK)).toContain("section#chapter-twelve");
    await inspect.pinned();
  } finally {
    await obsidian.put("right");
    await book.close();
    await vault.modify(BOOK, own);
    await obsidian.emulateMobile(false);
  }
});

test("on a tablet a pin opens the right drawer when it is shut, with the pane at the top of the CSS view", async ({
  obsidian,
  book,
  inspect,
  panel,
}) => {
  await obsidian.mobile("tablet");
  try {
    await inspecting(book, inspect);
    await obsidian.put("right");
    expect(await obsidian.collapsed("right")).toBe(true);

    await inspect.pinLine(inspect.line(OPENING, SECOND_PARAGRAPH));
    const pin = await inspect.pinned();

    await expect.poll(async () => obsidian.collapsed("right")).toBe(false);
    await expect(panel.panel).toHaveAttribute("data-viewing", "css");
    await panel.inspecting(pin.key, pin.generation);
    await expect(panel.pane).toBeVisible();
    await expect(panel.editor).toBeVisible();
    const pane = await panel.box(panel.pane);
    const editor = await panel.box(panel.editor);
    expect(pane.y + pane.height).toBeLessThanOrEqual(editor.y + 1);
    // A tablet has room for the pane beside the page, so it has no sheet.
    await expect(inspect.risen).toHaveCount(0);

    // The command turns inspect mode off and on, as the header does.
    await inspect.toggle();
    await inspect.isOff();
    await inspect.toggle();
    await expect(inspect.surface).toHaveAttribute("data-inspect", "on");
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("on a phone the command turns inspect mode on and off, as the target in the header does", async ({
  obsidian,
  book,
  inspect,
}) => {
  await obsidian.mobile("phone");
  try {
    await inspecting(book, inspect);
    await expect(inspect.action).toHaveAttribute("aria-pressed", "true");
    await inspect.off();
    await inspect.toggle();
    await expect(inspect.surface).toHaveAttribute("data-inspect", "on");
    await expect(inspect.action).toHaveAttribute("aria-pressed", "true");
    await inspect.toggle();
    await inspect.isOff();
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

/**
 * Shuts the right drawer, and waits for it to slide off the screen, so
 * the next tap lands on the page.
 */
async function shut(obsidian: Obsidian, panel: Panel): Promise<void> {
  await obsidian.put("right");
  await expect(panel.panel).not.toBeInViewport();
}

/** The middle of a line on the screen, which a tap pins the box of. */
async function middleOf(inspect: Inspect, line: Locator): Promise<{ x: number; y: number }> {
  const box = await inspect.rectOf(line);
  return { x: box.x + Math.min(12, box.width / 2), y: box.y + box.height / 2 };
}

// What this spec does not cover: a touch, since emulation sends the
// mouse's pointer and a tap is its click. A swipe that opens a drawer is
// not made, so the main area is slid the way the swipe slides it. A box outlined under a finger
// that has not lifted is #274's. The header hides here by a rule that
// takes it out, where a real phone slides it away as the page scrolls,
// and the keyboard a phone raises over the drawer's editor is not
// raised. A pin on a tablet with the drawer pinned beside the page is
// not driven, because the harness leaves the drawer unpinned. The
// sheet's picture is not compared, so its shadow and its radius are
// read from the artboard alone.
