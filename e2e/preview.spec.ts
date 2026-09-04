import { expect, test } from "./harness/test";

test("the ribbon sets the book and paints its first page", async ({ book }) => {
  await book.open();

  expect(await book.painted()).toBeGreaterThan(0);
  await expect(book.page).toHaveAttribute("data-page", "1");
  await expect(book.page).toContainText("In consequence of an agreement");

  const stages = await book.stages();
  for (const [stage, runs] of Object.entries(stages)) {
    expect(runs, stage).toBeGreaterThan(0);
  }
});

test("the page matches the one checked in beside the spec", async ({ book }) => {
  await book.open();
  await book.painted();

  await expect(book.page).toHaveScreenshot("page-one.png");
});
