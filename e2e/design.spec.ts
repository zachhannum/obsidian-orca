import { expect, test } from "./harness/test";
import type { Vault } from "./harness/vault";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The font the fixture vault ships, and the one the specs pick. */
const FIXTURE_FONT = "Alegreya";

/** A font no machine installs, so the filter matches nothing. */
const NOWHERE = "Zzyzx Grotesque";

/** The font the engine carries, which a book is set in until one is picked. */
const CARRIED = "EB Garamond";

/** A right sidebar narrower than the panel's artboard, in pixels. */
const NARROW = 260;

test("the picker offers the fonts the scan found, and typing narrows them", async ({
  book,
  panel,
}) => {
  await book.open();
  const painted = await book.painted();
  await panel.open();

  expect(await panel.reading()).toContain(CARRIED);

  await panel.pick();
  const all = await panel.offering();
  // Nothing crosses to fill the list, so the pages are still the ones
  // painted before the picker opened.
  expect(await book.painted()).toBe(painted);
  // The vault's own font is in the list, alongside whatever the
  // machine installs.
  expect(all).toBeGreaterThan(0);
  await expect(panel.options.filter({ hasText: FIXTURE_FONT })).toHaveCount(1);

  await panel.type("aleg");
  expect(await panel.offering()).toBeLessThan(all);
  expect(await panel.offered()).toContain(FIXTURE_FONT);
});

test("text matching nothing does not commit, so the book keeps the font it has", async ({
  book,
  panel,
}) => {
  await book.open();
  const painted = await book.painted();
  await panel.open();
  await panel.pick();

  await panel.type(NOWHERE);
  await expect(panel.nothing).toBeVisible();
  expect(await panel.offering()).toBe(0);

  await panel.filter.press("Enter");
  // The field still shows the font the book was set in, and no render
  // went out.
  expect(await panel.reading()).toContain(CARRIED);
  expect(await book.painted()).toBe(painted);
});

test("picking a font sets the book in it, and warns of nothing the machine has", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  await book.open();
  const painted = await book.painted();
  await panel.open();
  await panel.pick();

  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();

  await expect(panel.font).toContainText(FIXTURE_FONT);
  // The pick is an edit, so the pages come back under a later
  // generation than the one they were painted at.
  await expect
    .poll(async () => book.painted())
    .toBeGreaterThan(painted);

  // The machine has the font, so there is no warning.
  await expect(panel.missing).toHaveCount(0);

  await written(vault, own);
});

test("picking the font the book is set in again keeps the book in it", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();
  await expect(panel.font).toContainText(FIXTURE_FONT);

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();

  // The registry keys the bytes by content, so the second pick sends
  // nothing new. The book stays in the font, and there is no warning.
  await expect(panel.font).toContainText(FIXTURE_FONT);
  await expect(panel.missing).toHaveCount(0);

  await written(vault, own);
});

test("a book note written while a pane reads it leaves the panel designing that book", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  await book.open();
  const painted = await book.painted();
  await panel.open();
  const font = (await panel.reading()).trim();

  // A note written from outside Obsidian takes the book off the
  // composer, so the next open sets it from the notes as they now are.
  // The pane goes on reading the book it has, and that is the one the
  // panel designs.
  await vault.modify(BOOK, await vault.read(BOOK));
  await panel.focus();

  await expect(panel.panel).toBeVisible();
  await expect(panel.font).toContainText(font);

  // And a pick still reaches the book on screen.
  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();
  await expect(panel.font).toContainText(FIXTURE_FONT);
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);

  await written(vault, own);
});

test("a second preview in a background tab is deferred, and the panel designs the drawn one", async ({
  book,
  obsidian,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  await book.open();
  await book.painted();
  // A second pane on the same book, so the first is a background tab.
  await book.again();
  await expect(book.panes).toHaveCount(2);

  // A workspace reopened defers every tab nothing has asked for, so the
  // background pane's view is not the preview until it is drawn.
  const layout = await obsidian.layout();
  await obsidian.reopen(layout);
  // Only the drawn pane is in the document: the background tab is
  // deferred until something asks for it.
  await expect(book.panes).toHaveCount(1);
  await book.painted();

  await panel.open();
  await panel.focus();

  await expect(panel.panel).toBeVisible();
  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();
  await expect(panel.font).toContainText(FIXTURE_FONT);

  await written(vault, own);
});

test("a font picked is written into the book note, so the book opens in it", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();
  await expect(panel.font).toContainText(FIXTURE_FONT);

  // The design is the book note's own frontmatter, so the pick is there
  // rather than only on the engine.
  await expect.poll(async () => vault.read(BOOK)).toContain(
    `body-font: ${FIXTURE_FONT}`,
  );

  await written(vault, own);
});

test("the panel offers every group a book designer works in", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  expect(await panel.grouped()).toEqual([
    "Page",
    "Text",
    "Headings",
    "Chapter openings",
    "Scene breaks",
    "Heads & folios",
    "Page breaks",
  ]);
});

test("a click on a switch flips it, and the note is written", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  // The fixture hyphenates, so the switch starts on.
  const hyphens = panel.control("body-hyphens");
  await expect(hyphens).toHaveAttribute("aria-checked", "true");
  await hyphens.click();

  await expect(hyphens).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => vault.read(BOOK)).toContain(
    "body-hyphens: false",
  );

  await written(vault, own);
});

test("at the width of a narrow sidebar every control fits the panel", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  const had = await panel.resize(NARROW);
  try {
    await expect.poll(async () => panel.width()).toBeLessThanOrEqual(NARROW);
    expect(await panel.overflowing()).toEqual([]);
    expect(await panel.beyond()).toEqual([]);
  } finally {
    await panel.resize(had);
  }
});

test("a key the book does not set is drawn at its default, in faint type", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  // The fixture sets no space below a chapter's title.
  const below = panel.control("chapter-space-below");
  await expect(below).toHaveValue("0");
  await expect(below).toHaveAttribute("data-default", "true");
  await expect(below).toHaveClass(/is-default/);
  await expect(panel.reset("chapter-space-below")).toHaveCount(0);

  // A key the fixture sets shows its own value and a reset.
  await expect(panel.control("chapter-drop-cap")).toHaveAttribute(
    "data-default",
    "false",
  );
  await expect(panel.reset("chapter-drop-cap")).toBeVisible();
});

test("the reset takes a key out of the note, and the field shows the default", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  const size = panel.control("body-size");
  await expect(size).toHaveValue("10.5pt");
  await expect(panel.reset("body-size")).toHaveAttribute(
    "aria-label",
    "Reset to default (11pt)",
  );
  await panel.reset("body-size").click();

  await expect.poll(async () => vault.read(BOOK)).not.toContain("body-size:");
  await expect(size).toHaveValue("11pt");
  await expect(size).toHaveAttribute("data-default", "true");
  await expect(panel.reset("body-size")).toHaveCount(0);

  await written(vault, own);
});

test("the stepper moves a count by one line, and the note is written", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await expect(panel.control("chapter-space-above")).toHaveValue("7");
  await expect(panel.up("chapter-space-above")).toHaveAttribute(
    "aria-label",
    "Increase by 1 line",
  );
  await panel.up("chapter-space-above").click();

  await expect.poll(async () => vault.read(BOOK)).toContain(
    "chapter-space-above: 8",
  );
  await expect(panel.control("chapter-space-above")).toHaveValue("8");

  await written(vault, own);
});

test("text a number field cannot read says what is wrong and writes nothing", async ({
  book,
  panel,
  vault,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  const top = panel.control("margin-top");
  await top.fill("12px");
  await top.press("Enter");

  await expect(panel.invalid("margin-top")).toHaveText(
    "Use one of these units: pt, pc, in, mm, cm, em.",
  );
  // The text stays in the field and is marked as not valid.
  await expect(top).toHaveValue("12px");
  await expect(top).toHaveAttribute("aria-invalid", "true");
  // Orca wrote nothing, so the note keeps the margin it had.
  expect(await vault.read(BOOK)).toContain("margin-top: 0.8in");

  // Escape restores the value the field had.
  await top.press("Escape");
  await expect(panel.invalid("margin-top")).toHaveCount(0);
  await expect(top).toHaveValue("0.8in");
});

test("the Headings group sets the level its tab is on", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  // A level is a tab over the rows under it, not a setting of its own.
  const levels = panel.control("heading-level");
  await expect(levels).toHaveAttribute("role", "tablist");
  await expect(levels).toHaveAttribute("data-on", "1");
  await expect(panel.choice("heading-level", "1")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panel.choice("heading-level", "6")).toHaveAttribute(
    "role",
    "tab",
  );

  await panel.choice("heading-level", "2").click();
  await expect(levels).toHaveAttribute("data-on", "2");
  await expect(panel.choice("heading-level", "2")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panel.choice("heading-level", "1")).toHaveAttribute(
    "aria-selected",
    "false",
  );

  const size = panel.control("heading-2-size");
  await expect(size).toHaveValue("13pt");
  await size.fill("15pt");
  await size.press("Enter");

  await expect.poll(async () => vault.read(BOOK)).toContain(
    "heading-2-size: 15pt",
  );

  await written(vault, own);
});

test("a control writes its key into the note, and the book is set again under it", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  const painted = await book.painted();
  await panel.open();

  // The fixture is set justified, so ragged right is a change the
  // pages show.
  await expect(panel.control("body-align")).toHaveAttribute(
    "data-on",
    "justify",
  );
  await panel.choice("body-align", "left").click();

  await expect(panel.control("body-align")).toHaveAttribute("data-on", "left");
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  await expect.poll(async () => vault.read(BOOK)).toContain("body-align: left");

  await written(vault, own);
});

test("the hyphenation switch says which language the engine will hyphenate in", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  // The engine reads no language property, so the panel shows the
  // book's own language and not one from the design.
  await expect(panel.said("body-hyphens")).toContainText("en-GB");
  await expect(panel.said("body-hyphens")).toContainText("English");
});

test("the book note's page draws the design read-only, in the panel's words", async ({
  note,
}) => {
  await note.open(BOOK);
  await note.painted();

  await expect(note.summed("Trim")).toContainText("Digest");
  await expect(note.summed("Margins")).toContainText("0.95in inside");
  await expect(note.summed("Chapters begin on")).toContainText(
    "Right-hand page",
  );
  // Nothing on the page edits the design. The button opens the panel.
  await expect(
    note.design.locator("input, select, [role='switch']"),
  ).toHaveCount(0);
  await expect(note.openDesign).toBeVisible();
});

test("the book page's button opens the design panel, and reveals it once open", async ({
  note,
  obsidian,
  panel,
}) => {
  // The spec begins with no panel leaf, so the first click makes one.
  await panel.close();
  await note.open(BOOK);
  await note.painted();
  await expect(panel.leaf).toHaveCount(0);

  await note.openDesign.click();
  await expect(panel.leaf).toBeVisible();

  // If the sidebar is collapsed, the same click reveals the leaf that
  // is there and does not open a second one.
  await obsidian.collapse("right");
  expect(await obsidian.collapsed("right")).toEqual(true);
  await note.openDesign.click();
  await expect.poll(async () => obsidian.collapsed("right")).toEqual(false);
  await expect(panel.leaf).toBeVisible();
  await expect(panel.leaf).toHaveCount(1);
});

test("a click low in the panel leaves it scrolled where it was", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  let painted = await book.painted();
  await panel.open();

  // A switch in Page breaks, the last group.
  const keep = panel.control("keep-heading-with-text");
  const was = await keep.getAttribute("aria-checked");
  const at = await panel.scrollTo(keep);
  expect(at).toBeGreaterThan(0);
  await keep.click();
  await expect(keep).not.toHaveAttribute("aria-checked", was ?? "");
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  await expect.poll(async () => vault.read(BOOK)).toContain(
    "keep-heading-with-text:",
  );
  expect(await panel.scrolled()).toEqual(at);

  // A segment in Heads & folios.
  painted = await book.painted();
  const format = panel.control("page-number-format");
  const there = await panel.scrollTo(format);
  expect(there).toBeGreaterThan(0);
  await panel.choice("page-number-format", "roman").click();
  await expect(format).toHaveAttribute("data-on", "roman");
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  await expect.poll(async () => vault.read(BOOK)).toContain(
    "page-number-format: roman",
  );
  expect(await panel.scrolled()).toEqual(there);

  await written(vault, own);
});

test("picking a custom trim shows the trim's sides, and a width typed writes the trim", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  const painted = await book.painted();
  await panel.open();

  const width = panel.control("trim-width");
  const height = panel.control("trim-height");
  await expect(width).toHaveCount(0);

  await panel.control("trim").selectOption({ label: "Custom" });

  // The fields start from the trim the book is in, in inches.
  await expect(width).toHaveValue("5.5in");
  await expect(height).toHaveValue("8.5in");

  await width.fill("6in");
  await width.press("Enter");

  await expect.poll(async () => vault.read(BOOK)).toContain("trim: 6in 8.5in");
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  await expect(width).toHaveValue("6in");

  await written(vault, own);
});

test("setting a key draws its reset without moving the control", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  // The fixture sets no header position.
  const position = panel.control("header-position");
  await expect(position).toHaveAttribute("data-default", "true");
  await expect(panel.reset("header-position")).toHaveCount(0);
  const before = await panel.placed("header-position");

  await panel.choice("header-position", "center").click();

  await expect(position).toHaveAttribute("data-on", "center");
  await expect(panel.reset("header-position")).toBeVisible();
  expect(await panel.placed("header-position")).toEqual(before);

  await written(vault, own);
});

test("with pages measured in millimeters, a margin field reads in millimeters", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  const top = panel.control("margin-top");
  await expect(top).toHaveValue("0.8in");

  // The unit is an orca setting, not a book setting, so the spec sets it
  // back to inches in every case.
  await panel.measure("mm");
  try {
    await expect(top).toHaveValue("20.32mm");
  } finally {
    await panel.measure("in");
  }
  await expect(top).toHaveValue("0.8in");
});

test("the panel is not a mode, so it stays when the book it designed closes", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();
  await expect(panel.panel).toBeVisible();

  await book.close();

  // The leaf stays in the sidebar with no book. It does not close with
  // the pane that had the book.
  await expect(panel.empty).toBeVisible();
});

/**
 * Puts the book note back through the vault, so a pick written into it
 * does not reach the next spec. The write takes the book off the
 * composer, and the next open sets it from the notes as they now are.
 */
async function written(vault: Vault, own: string): Promise<void> {
  vault.touch(BOOK);
  await vault.modify(BOOK, own);
}
