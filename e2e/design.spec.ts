import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The face the fixture vault ships, and the one the specs pick. */
const FIXTURE_FACE = "Alegreya";

/** The note `Extract design to a shared note` writes beside the book. */
const SHARED = "Pride and Prejudice design.md";

/** The commands that move a design between the book and a shared note. */
const EXTRACT = "orca:extract-design";
const ABSORB = "orca:absorb-design";

/** A family no machine installs, so the filter matches nothing. */
const NOWHERE = "Zzyzx Grotesque";

/** The face the engine carries, which a book is set in until one is picked. */
const CARRIED = "EB Garamond";

test("the picker offers the families the scan found, and typing narrows them", async ({
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
  // The vault's own face is in the list, alongside whatever the
  // machine installs.
  expect(all).toBeGreaterThan(0);
  await expect(panel.options.filter({ hasText: FIXTURE_FACE })).toHaveCount(1);

  await panel.type("aleg");
  expect(await panel.offering()).toBeLessThan(all);
  expect(await panel.offered()).toContain(FIXTURE_FACE);
});

test("text matching nothing does not commit, so the book keeps the face it has", async ({
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
  // The field still shows the face the book was set in, and no render
  // went out.
  expect(await panel.reading()).toContain(CARRIED);
  expect(await book.painted()).toBe(painted);
});

test("picking a family sets the book in it, and the styles are the cuts the engine registered", async ({
  book,
  panel,
}) => {
  await book.open();
  const painted = await book.painted();
  await panel.open();
  await panel.pick();

  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FACE }).first().click();

  await expect(panel.face).toContainText(FIXTURE_FACE);
  // The pick is an edit, so the pages come back under a later
  // generation than the one they were painted at.
  await expect
    .poll(async () => book.painted())
    .toBeGreaterThan(painted);

  // Alegreya is one variable file, and the engine registers every
  // instance in it.
  const styles = await panel.styles();
  expect(styles).toContain("Regular");
  expect(styles.length).toBeGreaterThan(1);
  // A cut off a variable file sits somewhere on the file's axes, and
  // the painter pins it there.
  expect(await panel.axes("Medium")).toContain("wght");

  // The machine has the family, so there is no warning.
  await expect(panel.missing).toHaveCount(0);
});

test("a face crosses once, so picking the same family again sends the sheet alone", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FACE }).first().click();
  await expect(panel.face).toContainText(FIXTURE_FACE);
  const cuts = await panel.styles();

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FACE }).first().click();

  // The registry keys the bytes by content, so the second pick
  // registers nothing new and the engine returns the same cuts under
  // the same ids.
  await expect(panel.face).toContainText(FIXTURE_FACE);
  expect(await panel.styles()).toEqual(cuts);
});

test("a book note written while a pane reads it leaves the panel designing that book", async ({
  book,
  panel,
  vault,
}) => {
  await book.open();
  const painted = await book.painted();
  await panel.open();
  const face = (await panel.reading()).trim();

  // A note written from outside Obsidian takes the book off the
  // composer, so the next open sets it from the notes as they now are.
  // The pane goes on reading the book it has, and that is the one the
  // panel designs.
  await vault.modify(BOOK, await vault.read(BOOK));
  await panel.focus();

  await expect(panel.panel).toBeVisible();
  await expect(panel.face).toContainText(face);

  // And a pick still reaches the book on screen.
  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FACE }).first().click();
  await expect(panel.face).toContainText(FIXTURE_FACE);
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
});

test("a second preview in a background tab is deferred, and the panel designs the drawn one", async ({
  book,
  obsidian,
  panel,
}) => {
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
  await panel.options.filter({ hasText: FIXTURE_FACE }).first().click();
  await expect(panel.face).toContainText(FIXTURE_FACE);
});

test("`Extract design to a shared note` moves the design between the two notes", async ({
  note,
  obsidian,
  vault,
}) => {
  await note.open(BOOK);
  vault.touch(BOOK);
  vault.touch(SHARED);

  // With no `design` key the book's own frontmatter is the design, so
  // there is a design to extract and none to bring back.
  expect(await obsidian.offers(EXTRACT)).toBe(true);
  expect(await obsidian.offers(ABSORB)).toBe(false);

  await obsidian.command(EXTRACT);

  await expect.poll(async () => vault.read(SHARED)).toContain("orca-design: 1");
  const shared = await vault.read(SHARED);
  expect(shared).toContain("leading: 14pt");
  expect(shared).toContain("ornament: ⁂");

  // The book keeps the link and none of the keys the note now holds.
  await expect.poll(async () => vault.read(BOOK)).toContain(
    "Pride and Prejudice design",
  );
  expect(await vault.read(BOOK)).not.toContain("leading:");

  await expect.poll(async () => obsidian.offers(ABSORB)).toBe(true);
  expect(await obsidian.offers(EXTRACT)).toBe(false);

  await obsidian.command(ABSORB);

  await expect.poll(async () => vault.read(BOOK)).toContain("leading: 14pt");
  expect(await vault.read(BOOK)).not.toContain("Pride and Prejudice design");
});

test("a book that points at a design note is set in the face that note names", async ({
  book,
  obsidian,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(SHARED);
  await vault.write(
    SHARED,
    `---\norca-design: 1\nface: ${FIXTURE_FACE}\n---\n`,
  );
  // The link is resolved through the cache, so the spec waits for the
  // note to reach it rather than on a clock.
  await obsidian.open(SHARED);
  await vault.modify(
    BOOK,
    own.replace(
      "orca-book: 1\n",
      'orca-book: 1\ndesign: "[[Pride and Prejudice design]]"\n',
    ),
  );

  await book.open();
  await book.painted();
  await panel.open();

  // The book sets nothing of its own, so the face is the shared note's.
  expect(await panel.reading()).toContain(FIXTURE_FACE);

  // The book note goes back through the vault, so the book is taken off
  // the composer and the next spec sets it from the notes as they are.
  await vault.modify(BOOK, own);
});

test("the panel designs a shared design note, and a pick is written to it", async ({
  obsidian,
  panel,
  vault,
}) => {
  vault.touch(SHARED);
  await vault.write(SHARED, "---\norca-design: 1\n---\n");
  await obsidian.open(SHARED);
  await panel.open();

  // The note is the design, and it sets no face, so the panel reads the
  // one the engine carries.
  await expect(panel.panel).toBeVisible();
  await expect(panel.face).toContainText(CARRIED);
  // No book is under the note, so the engine registered no cuts for it.
  await expect(panel.cuts).toHaveCount(0);

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FACE }).first().click();

  await expect(panel.face).toContainText(FIXTURE_FACE);
  await expect.poll(async () => vault.read(SHARED)).toContain(
    `face: ${FIXTURE_FACE}`,
  );
});
