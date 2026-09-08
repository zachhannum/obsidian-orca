import { expect, test } from "./harness/test";

/** The face the fixture vault ships, and the one the specs pick. */
const FIXTURE_FACE = "Alegreya";

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
