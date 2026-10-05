import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEVICES, SCHEMES, type Device, type Sidecar } from '../src/shot';

/** The screen of the phone the spec takes its phone pictures on. */
const PHONE = { width: 390, height: 844 };

/** The screen of the tablet the spec takes its tablet pictures on, held upright. */
const TABLET = { width: 820, height: 1180 };

/** A window with room for the docs column and both rails. */
const WIDE = { width: 1440, height: 900 };

/** The size of Obsidian mobile's own text, in CSS pixels of a phone picture. */
const MOBILE_TEXT = 15;

/** The pages that have a phone picture, each with the picture it opens on. */
const PICTURED: [string, string][] = [
  ['/start/the-preview/', 'mobile-preview'],
  ['/start/make-a-book/', 'mobile-navigator'],
  ['/design/overview/', 'mobile-panel'],
  ['/export/export-to-pdf/', 'mobile-export'],
  ['/reference/the-book-note/', 'mobile-book-page'],
];

/** The words the switch has for each device. */
const LABEL: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet', phone: 'Phone' };

/** The page the switch, the frame and the whole picture are read on. */
const PREVIEW = '/start/the-preview/';

/** The first docs page, and the page whose pictures are of printed pages. */
const ANATOMY = '/start/anatomy/';
const MARKDOWN = '/reference/markdown/';

const sidecar = async (name: string): Promise<Sidecar> =>
  JSON.parse(
    await readFile(fileURLToPath(new URL(`../src/shots/${name}.marks.json`, import.meta.url)), 'utf8'),
  ) as Sidecar;

/** The figure that shows this picture in one of its views. */
const figure = (page: Page, name: string): Locator =>
  page.locator('.shot-figure').filter({ has: page.locator(`img[src*="/${name}-"]`) });

/** The view of a figure that is on screen, and the picture in it. */
const shown = (within: Locator): Locator => within.locator('.shot-view:visible');
const picture = (within: Locator): Locator => shown(within).locator('img:visible');

/** Waits for the picture on screen to be loaded, and gives its file. */
async function loaded(within: Locator): Promise<string> {
  const img = picture(within);
  await img.scrollIntoViewIfNeeded();
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  return img.evaluate((el: HTMLImageElement) => el.currentSrc);
}

/** Picks a device on a figure's switch, the way a reader does. */
const pick = (within: Locator, device: Device): Promise<void> =>
  within.locator('.shot-switch label').filter({ hasText: LABEL[device] }).click();

const paint = (page: Page, scheme: string): Promise<void> =>
  page.evaluate((to) => {
    document.documentElement.dataset['theme'] = to;
  }, scheme);

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('nothing to measure');
  return found;
};

test('at 390 pixels wide, a page with a phone picture opens on it, at a size its text can be read at', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  for (const [path, name] of PICTURED) {
    await page.goto(path);
    const within = figure(page, `${name}-phone`);
    await expect(shown(within)).toHaveAttribute('data-device', 'phone');
    await expect(within.getByLabel('Phone')).toBeChecked();
    expect(await loaded(within)).toContain(`${name}-phone-`);

    const scale = (await box(picture(within))).width / PHONE.width;
    const caption = await within
      .locator('figcaption')
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(MOBILE_TEXT * scale, `${path} draws its phone picture too small`).toBeGreaterThanOrEqual(caption);
  }
});

/** Every docs page, read from the sidebar of the first one. */
async function pages(page: Page): Promise<string[]> {
  await page.goto(ANATOMY);
  const found = await page
    .locator('nav.sidebar a[href]')
    .evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).pathname));
  expect(found.length).toBeGreaterThan(10);
  return [...new Set(found)];
}

/** The shots of an Obsidian surface on the page. A picture of a printed page has one device. */
const surfaces = (page: Page): Locator => page.locator('.shot-figure:has(.shot-switch)');

test('at 390 pixels wide, every picture of a surface is its phone picture', async ({ page }) => {
  await page.setViewportSize(PHONE);
  let seen = 0;
  for (const path of await pages(page)) {
    await page.goto(path);
    for (const within of await surfaces(page).all()) {
      await expect(shown(within)).toHaveAttribute('data-device', 'phone');
      seen += 1;
    }
    // No shot of a surface is left with the desktop picture alone.
    await expect(page.locator('.shot-figure:not(:has(.shot-switch)) img[src*="/mark-"]')).toHaveCount(
      await page.locator('.shot-figure:not(:has(.shot-switch)) img').count(),
    );
  }
  expect(seen).toBeGreaterThan(20);
});

test.describe('on a tablet', () => {
  test.use({ viewport: TABLET, hasTouch: true, isMobile: true });

  test('every picture of a surface is its tablet picture, drawn without a frame', async ({ page }) => {
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    let seen = 0;
    for (const path of await pages(page)) {
      await page.goto(path);
      for (const within of await surfaces(page).all()) {
        await expect(shown(within)).toHaveAttribute('data-device', 'tablet');
        await expect(within.getByLabel('Tablet')).toBeChecked();
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(20);

    await page.goto(PREVIEW);
    const within = figure(page, 'mobile-preview-tablet');
    await loaded(within);
    const body = await box(shown(within));
    const screen = await box(picture(within));
    expect(screen.width).toBeCloseTo(body.width, 0);
  });
});

test('a wider screen opens on the desktop picture', async ({ page }) => {
  await page.setViewportSize(WIDE);
  for (const [path, name] of PICTURED) {
    await page.goto(path);
    const within = figure(page, `${name}-phone`);
    await expect(shown(within)).toHaveAttribute('data-device', 'desktop');
    await expect(within.getByLabel('Desktop')).toBeChecked();
  }
});

test('the switch shows each device a picture has, in both schemes, and one device has no switch', async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  for (const [path, name] of PICTURED) {
    await page.goto(path);
    const within = figure(page, `${name}-phone`);
    await expect(within.locator('.shot-switch label')).toHaveText(['Desktop', 'Tablet', 'Phone']);
    for (const scheme of SCHEMES) {
      await paint(page, scheme);
      for (const device of DEVICES) {
        await pick(within, device);
        await expect(shown(within)).toHaveAttribute('data-device', device);
        const file = await loaded(within);
        expect(file).toContain(`-${scheme}.`);
        if (device !== 'desktop') expect(file).toContain(`${name}-${device}-${scheme}.`);
      }
    }
  }

  // A picture of a printed page is of no device.
  await page.goto(MARKDOWN);
  const printed = figure(page, 'mark-span');
  await expect(printed).toHaveCount(1);
  await expect(printed.locator('.shot-switch')).toHaveCount(0);
  await loaded(printed);
});

test('at desktop width, a phone picture and a tablet picture are drawn in the device frame', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await page.goto(PREVIEW);
  const within = figure(page, 'mobile-preview-phone');
  for (const device of ['tablet', 'phone'] as Device[]) {
    await pick(within, device);
    const frame = shown(within).getByTestId('device-frame');
    await loaded(within);
    // The frame is a body around the screen: it has a box of its own,
    // and the picture sits inside it with the bezel on every side.
    const body = await box(frame);
    const screen = await box(picture(within));
    expect(screen.x).toBeGreaterThan(body.x);
    expect(screen.y).toBeGreaterThan(body.y);
    expect(screen.x + screen.width).toBeLessThan(body.x + body.width);
    expect(screen.y + screen.height).toBeLessThan(body.y + body.height);
  }
  // The desktop picture has no frame.
  await pick(within, 'desktop');
  await expect(shown(within).getByTestId('device-frame')).toHaveCount(0);
});

test('a tap on a shrunken picture opens the whole picture, and a tap, the button and Escape close it', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto(PREVIEW);
  // A phone draws the tablet and the desktop picture whole and small.
  const within = figure(page, 'mobile-preview-phone');
  for (const device of ['tablet', 'desktop'] as Device[]) {
    await pick(within, device);
    await loaded(within);
    const whole = within.locator('.shot-whole');
    const open = shown(within).locator('.shot-open');
    const full = Number(await shown(within).locator('.shot-frame').getAttribute('data-width'));
    const closes = [
      () => whole.locator('img:visible').click(),
      () => whole.getByRole('button', { name: 'Close' }).click(),
      () => page.keyboard.press('Escape'),
    ];
    for (const close of closes) {
      await open.click();
      await expect(whole).toBeVisible();
      // The picture is at its own size, which is wider than the screen,
      // and the dialog scrolls to the rest of it.
      expect((await box(whole.locator('img:visible'))).width).toBeCloseTo(full, 0);
      expect(await whole.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await close();
      await expect(whole).toBeHidden();
    }
  }

  // A picture drawn at its own size has nothing to open. This one is
  // narrower than the column.
  await page.setViewportSize(WIDE);
  await page.goto(PREVIEW);
  const small = figure(page, 'preview-warnings');
  await loaded(small);
  await expect(shown(small).locator('.shot-open')).toBeHidden();
});

test('a mark on a phone picture is drawn where the spec measured its control', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const marked: [string, string, string[]][] = [
    [PREVIEW, 'mobile-preview-phone', ['inspect', 'as-markdown', 'export']],
    ['/start/make-a-book/', 'mobile-navigator-phone', ['book', 'note']],
  ];
  for (const [path, name, ids] of marked) {
    await page.goto(path);
    const within = figure(page, name);
    await loaded(within);
    const measured = await sidecar(name);
    const drawn = await box(picture(within));
    const scale = drawn.width / measured.width;
    const rings = shown(within).locator('.shot-mark');
    await expect(rings).toHaveCount(ids.length);
    for (const [at, id] of ids.entries()) {
      const want = measured.marks[id];
      if (want === undefined) throw new Error(`${name} has no mark ${id}`);
      const ring = await box(rings.nth(at));
      expect(Math.abs(ring.x - drawn.x - want.x * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(ring.y - drawn.y - want.y * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(ring.width - want.width * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(ring.height - want.height * scale)).toBeLessThanOrEqual(1);
    }
  }
});

// What this file does not cover: whether a mark's box is on the control
// it names in Obsidian, which the screenshot spec holds as it measures;
// a build that stops on a missing picture, which the Node tier holds
// against the lookup the component calls; a browser other than
// Chromium; a real touch, since a tap here is a click; and how the
// frame looks, which is a reader's call; and a tablet with a mouse,
// which reads as a desktop.
