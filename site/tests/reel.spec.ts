import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ReelData } from '../src/reel/stage';

const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };

/** The key the site keeps the reader's scheme under, and the page's own address. */
const KEY = 'starlight-theme';
const ORIGIN = 'http://localhost:4329';

/** A browser that has picked a scheme on the site before. */
const picked = (scheme: string) => ({
  cookies: [],
  origins: [{ origin: ORIGIN, localStorage: [{ name: KEY, value: scheme }] }],
});

const stageOf = (page: Page, id: string): Locator => page.locator(`[data-reel="${id}"]`);

/** Reads the reel a stage carries. */
const dataOf = (stage: Locator): Promise<ReelData> =>
  stage.locator('[data-reel-data]').evaluate((el) => JSON.parse(el.textContent) as ReelData);

/** The name of the frame a request is for, when it is for one. */
const frameIn = (url: string): string | null => /\/([a-z0-9-]+)-(?:dark|light)\.[^/]+\.webp$/.exec(new URL(url).pathname)?.[1] ?? null;

/** Opens the landing page and gathers the frame each request for a packed picture names. With no names, it gathers every one. */
async function landing(page: Page, names: string[]): Promise<string[]> {
  const asked: string[] = [];
  page.on('request', (request) => {
    const frame = frameIn(request.url());
    if (frame !== null && (names.length === 0 || names.includes(frame))) asked.push(frame);
  });
  await page.goto('/');
  return asked;
}

/** Holds a stage at a time, with no clock, and waits for it to draw that time. */
async function pin(stage: Locator, at: number): Promise<void> {
  await stage.scrollIntoViewIfNeeded();
  await stage.evaluate((el, time) => el.setAttribute('data-reel-hold', time), at.toFixed(3));
  await expect(stage).toHaveAttribute('data-reel-at', at.toFixed(3));
  await expect(stage).toHaveAttribute('data-reel-state', 'playing');
}

/** The file each picture on screen in a stage shows. */
const sources = (stage: Locator): Promise<string[]> =>
  stage.locator('img:visible').evaluateAll((all) => all.map((img) => (img as HTMLImageElement).currentSrc));

/** The frames of the hero take, which both reels on the page play. */
const FRAMES = ['notes', 'write-empty', 'write', 'read', 'design-0', 'design-7', 'scroll-down', 'design-8', 'css-2', 'export-0'];

for (const scheme of ['dark', 'light']) {
  test.describe(`in ${scheme}`, () => {
    test.use({ storageState: picked(scheme), viewport: WIDE });

    test('the hero plays from frames of its scheme, and its time moves', async ({ page }) => {
      await landing(page, FRAMES);
      const hero = stageOf(page, 'hero');
      await expect(hero).toHaveAttribute('data-reel-state', 'playing');
      await expect(hero).toHaveAttribute('data-reel-view', 'wide');
      const { timeline } = await dataOf(hero);
      const first = await hero.getAttribute('data-reel-at');
      expect(Number(first)).toBeGreaterThanOrEqual(timeline.still);
      await expect(hero).not.toHaveAttribute('data-reel-at', first ?? '');
      for (const file of await sources(hero)) expect(file).toMatch(new RegExp(`-${scheme}\\.`));
      await expect(hero.locator('video')).toHaveCount(0);
      // Each stage is as wide as its section lets it be, and has the window's shape.
      for (const [id, width] of [['hero', 1200], ['write', 936]] as const) {
        const box = await stageOf(page, id).locator('.reel-view').boundingBox();
        expect(box?.width).toBe(width);
        expect(box?.height).toBeCloseTo((width * 750) / 1200, 0);
      }
    });
  });
}

test.describe('on a desktop', () => {
  test.use({ viewport: WIDE });

  test('a change of scheme keeps the time and changes every picture', async ({ page }) => {
    await landing(page, FRAMES);
    const hero = stageOf(page, 'hero');
    // The panel is in the middle of a scroll, so four frames are on screen.
    await pin(hero, 12.95);
    await expect(hero).toHaveAttribute('data-reel-frames', 'design-7 scroll-down design-8');
    const before = await sources(hero);
    expect(before.length).toBe(5);
    for (const file of before) expect(file).toMatch(/-dark\./);

    await page.locator('[data-theme-toggle]:visible').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(async () => (await sources(hero)).every((file) => /-light\./.test(file))).toBe(true);
    const after = await sources(hero);
    expect(after.length).toBe(before.length);
    for (const file of after) expect(before).not.toContain(file);
    await expect(hero).toHaveAttribute('data-reel-at', '12.950');
    await expect(hero).toHaveAttribute('data-reel-frames', 'design-7 scroll-down design-8');
  });

  test('a stage off screen asks for no frame but its picture, and plays once it is on screen', async ({ page }) => {
    const asked = await landing(page, ['write-empty', 'write', 'read']);
    const hero = stageOf(page, 'hero');
    const write = stageOf(page, 'write');
    // The hero is held where it shows none of the frames the write reel plays.
    await pin(hero, 12);
    await expect(write).toHaveAttribute('data-reel-state', 'still');
    const { timeline } = await dataOf(write);
    expect(timeline.stillFrame).toBe('read');
    expect(asked.filter((frame) => frame !== timeline.stillFrame)).toEqual([]);

    await write.scrollIntoViewIfNeeded();
    await expect(write).toHaveAttribute('data-reel-state', 'playing');
    expect(asked).toContain('read');
    await expect.poll(() => asked.includes('write-empty') && asked.includes('write')).toBe(true);
  });

  test('held just past a click, a stage shows the frame the click brings up', async ({ page }) => {
    await landing(page, FRAMES);
    for (const id of ['hero', 'write']) {
      const stage = stageOf(page, id);
      const { timeline } = await dataOf(stage);
      for (const click of timeline.clicks.slice(0, 3)) {
        const cut = timeline.cuts.find((held) => held.t >= click);
        if (cut === undefined) throw new Error(`no frame follows the click at ${String(click)}`);
        await pin(stage, cut.t + cut.fade + 0.01);
        await expect(stage).toHaveAttribute('data-reel-frames', cut.frame);
        // The ring is still spreading from where the pointer clicked.
        await expect(stage.locator('.reel-ring')).toBeVisible();
      }
    }
  });
});

test.describe('under reduced motion', () => {
  test.use({ viewport: WIDE, contextOptions: { reducedMotion: 'reduce' } });

  test('each stage is its picture, and the page asks for one frame for each', async ({ page }) => {
    const asked = await landing(page, []);
    const stages = await page.locator('[data-reel]').all();
    expect(stages.length).toBeGreaterThanOrEqual(2);
    const stills: string[] = [];
    for (const stage of stages) {
      stills.push((await dataOf(stage)).timeline.stillFrame);
      await stage.scrollIntoViewIfNeeded();
      await expect(stage).toHaveAttribute('data-reel-state', 'still');
      const still = stage.locator('.reel-still:visible');
      await expect(still).toHaveCount(1);
      await expect.poll(() => still.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(stage.locator('.reel-win')).toHaveCount(0);
    }
    expect([...asked].sort()).toEqual([...stills].sort());
  });
});

test.describe('at 390 pixels wide', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('the page does not scroll sideways, and every click of every reel is inside its stage', async ({ page }) => {
    await landing(page, FRAMES);
    const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(spill).toBeLessThanOrEqual(0);

    const ids = await page.locator('[data-reel]').evaluateAll((all) => all.map((el) => el.getAttribute('data-reel') ?? ''));
    for (const id of ['hero', 'write', 'design', 'css']) expect(ids).toContain(id);
    for (const id of ids) {
      const stage = stageOf(page, id);
      await stage.scrollIntoViewIfNeeded();
      await expect(stage).toHaveAttribute('data-reel-view', 'narrow');
      const view = stage.locator('.reel-view');
      const { timeline, frames } = await dataOf(stage);
      expect(timeline.clicks.length).toBeGreaterThan(0);
      for (const click of timeline.clicks) {
        await pin(stage, click + 0.02);
        const box = await view.boundingBox();
        const ring = await stage.locator('.reel-ring').boundingBox();
        if (box === null || ring === null) throw new Error(`no ring at the click at ${String(click)}`);
        // The ring is drawn around the point the pointer clicked.
        const x = ring.x + ring.width / 2;
        const y = ring.y + ring.height / 2;
        expect(x, `the click at ${String(click)}`).toBeGreaterThan(box.x);
        expect(x, `the click at ${String(click)}`).toBeLessThan(box.x + box.width);
        expect(y, `the click at ${String(click)}`).toBeGreaterThan(box.y);
        expect(y, `the click at ${String(click)}`).toBeLessThan(box.y + box.height);
      }
      // A phone is given the smaller file of each frame.
      const small = Object.values(frames.dark).map((files) => files[0]);
      const shown = await sources(stage);
      expect(shown.length).toBeGreaterThan(1);
      for (const file of shown) expect(small).toContain(new URL(file).pathname);
    }
    const again = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(again).toBeLessThanOrEqual(0);
  });

  test('the picture under the player is placed where the player draws the window', async ({ page }) => {
    await landing(page, FRAMES);
    const stage = stageOf(page, 'write');
    const { timeline } = await dataOf(stage);
    await pin(stage, timeline.still);
    const still = await stage.locator('.reel-still:visible').boundingBox();
    const win = await stage.locator('.reel-win').boundingBox();
    if (still === null || win === null) throw new Error('the stage has no picture');
    for (const side of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(still[side] - win[side])).toBeLessThan(1);
  });
});

// What this file does not cover: a reel that plays to its end at the
// speed of a clock, because every time here is held. It does not cover
// what a frame shows, which the spec that takes the frames settles. It
// does not cover a browser other than Chromium, or a page with no script
// at all, where the stylesheet alone places the picture.
