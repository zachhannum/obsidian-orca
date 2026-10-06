import { expect, test, type Locator, type Page } from '@playwright/test';

/** A phone's screen, and a window with room for the docs column and both rails. */
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };

/** A page with a picture of the whole window, and its picture. */
const ANATOMY = '/start/anatomy/';

/** A page with a picture narrower than the docs column, and that picture. */
const PREVIEW = '/start/the-preview/';
const SMALL = 'preview-warnings';

/** The figure that shows this picture. */
const figure = (page: Page, name: string): Locator =>
  page.locator('.shot-figure').filter({ has: page.locator(`img[src*="/${name}-"]`) });

const width = async (locator: Locator): Promise<number> => {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('nothing to measure');
  return found.width;
};

test('at 390 pixels wide, a tap on a picture opens the whole picture at its own size', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto(ANATOMY);
  const within = figure(page, 'anatomy');
  const whole = within.locator('.shot-whole');
  const full = Number(await within.locator('.shot-frame').first().getAttribute('data-width'));
  expect(await width(within.locator('.shot-desk img:visible'))).toBeLessThan(full / 2);

  await within.locator('.shot-open').click();
  await expect(whole).toBeVisible();
  // The picture is wider than the screen, and the dialog scrolls to the rest of it.
  expect(await width(whole.locator('img:visible'))).toBeCloseTo(full, 0);
  expect(await whole.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  // The marks come with it, each where the page has it.
  await expect(whole.locator('.shot-mark')).toHaveCount(await within.locator('.shot-desk .shot-mark').count());
});

test('the whole picture closes with a tap, the button and the Escape key', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto(ANATOMY);
  const within = figure(page, 'anatomy');
  const whole = within.locator('.shot-whole');
  const closes = [
    () => whole.locator('img:visible').click(),
    () => whole.getByRole('button', { name: 'Close' }).click(),
    () => page.keyboard.press('Escape'),
  ];
  for (const close of closes) {
    await within.locator('.shot-open').click();
    await expect(whole).toBeVisible();
    await close();
    await expect(whole).toBeHidden();
  }
});

test('a picture drawn at its own size has nothing to open', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await page.goto(PREVIEW);
  const within = figure(page, SMALL);
  await within.scrollIntoViewIfNeeded();
  await expect(within.locator('.shot-desk img:visible')).toBeVisible();
  await expect(within.locator('.shot-open')).toBeHidden();
});

// What this file does not cover: a browser other than Chromium; a real
// touch, since a tap here is a click; a pinch inside the whole picture;
// and the pictures of the landing page, which are not shots of this kind.
