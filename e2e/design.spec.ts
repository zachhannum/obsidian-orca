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

test("picking a font sets the book in it, and the styles are the ones the engine registered", async ({
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

  // Alegreya is one variable file, and the engine registers every
  // instance in it.
  const styles = await panel.styleNames();
  expect(styles).toContain("Regular");
  expect(styles.length).toBeGreaterThan(1);
  // A style off a variable file sits somewhere on the file's axes, and
  // the painter pins it there.
  expect(await panel.axes("Medium")).toContain("wght");

  // The machine has the font, so there is no warning.
  await expect(panel.missing).toHaveCount(0);

  await written(vault, own);
});

test("a font crosses once, so picking it again sends the sheet alone", async ({
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
  const registered = await panel.styleNames();

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();

  // The registry keys the bytes by content, so the second pick
  // registers nothing new and the engine returns the same styles under
  // the same ids.
  await expect(panel.font).toContainText(FIXTURE_FONT);
  expect(await panel.styleNames()).toEqual(registered);

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
    "Chapter openings",
    "Scene breaks",
    "Heads & folios",
    "Discipline",
  ]);
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

  // The engine reads no language property, so the panel reports the
  // book's own rather than anything the design sets.
  await expect(panel.said("body-hyphens")).toContainText("en-GB");
  await expect(panel.said("body-hyphens")).toContainText("English");
});

test("the book note's page mounts the same panel, and an edit there reaches the note", async ({
  note,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await note.open(BOOK);
  await note.painted();

  await expect(note.design.panel).toBeVisible();
  expect(await note.design.grouped()).toContain("Chapter openings");

  await note.design.control("chapter-drop-cap").fill("4");
  await note.design.control("chapter-drop-cap").press("Enter");

  await expect.poll(async () => vault.read(BOOK)).toContain(
    "chapter-drop-cap: 4",
  );

  await written(vault, own);
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

  // The leaf is still in the sidebar, holding no book rather than
  // going away with the pane that had one.
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
