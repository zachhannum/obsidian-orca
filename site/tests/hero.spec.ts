import { expect, test, type Locator, type Page } from '@playwright/test';

/** The screens of the phone and the tablet the film spec takes its frames on, and a desktop window. */
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1180, height: 820 };
const WIDE = { width: 1440, height: 900 };

/** The clip a device plays in a scheme, by the name the shots job gives it. */
const clipOf = (device: string, scheme: string): RegExp =>
  new RegExp(device === 'desktop' ? `/loop-${scheme}\\.` : `/loop-${device}-${scheme}\\.`);

/** The key the site keeps the reader's scheme under, and the page's own address. */
const KEY = 'starlight-theme';
const ORIGIN = 'http://localhost:4329';

/** A browser that has picked a scheme on the site before. */
const picked = (scheme: string) => ({
  cookies: [],
  origins: [{ origin: ORIGIN, localStorage: [{ name: KEY, value: scheme }] }],
});

/** Opens the landing page and gathers every clip the page asks the network for. */
async function landing(page: Page, scheme = 'dark'): Promise<string[]> {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('.mp4')) asked.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
  return asked;
}

const hero = (page: Page): Locator => page.locator('[data-hero]');
const shown = (page: Page): Locator => hero(page).locator('.device:visible');

/** Waits for the page to ask for one clip, and holds it to the device and the scheme. */
async function plays(page: Page, asked: string[], device: string, scheme: string): Promise<void> {
  await expect(shown(page)).toHaveAttribute('data-device', device);
  const clip = shown(page).locator('video:visible');
  await expect(clip).toHaveCount(1);
  await expect.poll(() => asked.some((url) => clipOf(device, scheme).test(url))).toBe(true);
  expect(await clip.evaluate((video: HTMLVideoElement) => video.currentSrc)).toMatch(clipOf(device, scheme));
  // No other clip on the page is playing.
  expect(await hero(page).locator('video').evaluateAll((all) => all.filter((video) => !(video as HTMLVideoElement).paused).length)).toBeLessThanOrEqual(1);
}

for (const scheme of ['dark', 'light']) {
  test.describe(`in ${scheme}`, () => {
    test.use({ storageState: picked(scheme) });

    test('at 390 pixels wide, the hero plays the phone loop', async ({ page }) => {
      await page.setViewportSize(PHONE);
      const asked = await landing(page, scheme);
      await plays(page, asked, 'phone', scheme);
      await expect(hero(page).locator('[data-pick][value=phone]')).toBeChecked();
      expect(asked).toHaveLength(1);
    });

    test('on a desktop, the hero plays the desktop loop', async ({ page }) => {
      await page.setViewportSize(WIDE);
      const asked = await landing(page, scheme);
      await plays(page, asked, 'desktop', scheme);
      await expect(hero(page).locator('[data-pick][value=desktop]')).toBeChecked();
      expect(asked).toHaveLength(1);
    });

    test.describe('on a tablet', () => {
      test.use({ viewport: TABLET, hasTouch: true, isMobile: true });

      test('the hero plays the tablet loop', async ({ page }) => {
        const asked = await landing(page, scheme);
        await plays(page, asked, 'tablet', scheme);
        await expect(hero(page).locator('[data-pick][value=tablet]')).toBeChecked();
        expect(asked).toHaveLength(1);
      });
    });
  });
}

test('the switch shows each of the three loops, and a change of scheme keeps the device', async ({ page }) => {
  await page.setViewportSize(WIDE);
  const asked = await landing(page);
  await plays(page, asked, 'desktop', 'dark');
  for (const [label, device] of [
    ['Phone', 'phone'],
    ['Tablet', 'tablet'],
    ['Desktop', 'desktop'],
    ['Phone', 'phone'],
  ] as const) {
    await hero(page).locator('label', { hasText: label }).click();
    await plays(page, asked, device, 'dark');
  }
  await page.locator('[data-theme-toggle]:visible').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await plays(page, asked, 'phone', 'light');
  await expect(hero(page).locator('[data-pick][value=phone]')).toBeChecked();
});

test.describe('under reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the hero shows a still of the device and loads no clip', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const asked = await landing(page);
    await expect(shown(page)).toHaveAttribute('data-device', 'phone');
    const still = shown(page).locator('img:visible');
    await expect(still).toHaveCount(1);
    await expect
      .poll(async () => still.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    expect(await still.evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(/loop-phone-dark/);
    await expect(shown(page).locator('video:visible')).toHaveCount(0);

    await hero(page).locator('label', { hasText: 'Tablet' }).click();
    await expect(shown(page).locator('img:visible')).toHaveCount(1);
    expect(asked).toHaveLength(0);
  });
});

test('at 390 pixels wide, the page does not scroll sideways and no heading wraps past three lines', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await landing(page);
  const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(spill).toBeLessThanOrEqual(0);

  const headings = await page.locator('main h1 > span:not([aria-hidden]), main h2').all();
  expect(headings.length).toBeGreaterThan(3);
  for (const heading of headings) {
    const lines = await heading.evaluate((el) => {
      const tops = new Set<number>();
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
      return tops.size;
    });
    expect(lines, `${(await heading.textContent()) ?? ''} wraps to ${String(lines)} lines`).toBeLessThanOrEqual(3);
  }
});

// What this file does not cover: whether a clip plays to its end, since
// the browser the suite runs has no H.264 and the suite reads the
// request for the clip; what a loop shows, which the film spec and the
// renderer settle; a tablet with a mouse, which reads as a desktop; and
// a browser other than Chromium.
