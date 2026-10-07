import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { pack } from '../scripts/pack-reel.mjs';

const WIDTH = 400;
const HEIGHT = 200;

/**
 * A picture of a ground with a few boxes on it, as a frame of a window
 * is. `moved` shifts one box, and `noise` changes scattered pixels by
 * one level, as two takes of one screen differ.
 */
async function picture(file: string, ground: number, { moved = 0, noise = false } = {}): Promise<void> {
  const data = Buffer.alloc(WIDTH * HEIGHT * 3, ground);
  const fill = (x0: number, y0: number, w: number, h: number, level: number): void => {
    for (let y = y0; y < y0 + h; y++) data.fill(level, (y * WIDTH + x0) * 3, (y * WIDTH + x0 + w) * 3);
  };
  fill(20, 20, 160, 12, 200);
  fill(20, 44, 120, 12, 200);
  fill(240 + moved, 120, 24, 24, 120);
  if (noise) for (let at = 0; at < data.length; at += 997) data[at] = (data[at] ?? 0) + 1;
  await sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(file);
}

/** Writes a take of one frame, and returns the folders a pack reads and writes. */
async function take(folder: string): Promise<{ from: string; into: string }> {
  const from = path.join(folder, 'raw');
  const into = path.join(folder, 'packed');
  await mkdir(path.join(from, 't'), { recursive: true });
  const said = { take: 't', window: { w: WIDTH / 2, h: HEIGHT / 2 }, density: 2, paint: {}, frames: [{ name: 'a', marks: {} }] };
  await writeFile(path.join(from, 't.json'), JSON.stringify(said));
  await picture(path.join(from, 't/a-dark.png'), 20);
  await picture(path.join(from, 't/a-light.png'), 240);
  return { from, into };
}

const changed = async (file: string): Promise<number> => (await stat(file)).mtimeMs;

test('a second pack of the same frames rewrites nothing', async ({}, info) => {
  const folders = await take(info.outputPath());
  const first = await pack(folders);
  expect(first.written.map((file) => path.basename(file)).sort()).toEqual(['a-dark.webp', 'a-light.webp', 't.json']);
  const dark = path.join(folders.into, 't/a-dark.webp');
  const before = await changed(dark);

  const second = await pack(folders);
  expect(second.written).toEqual([]);
  expect(second.kept).toHaveLength(3);
  expect(await changed(dark)).toBe(before);

  // Another take of the same screen differs by a level here and there.
  await picture(path.join(folders.from, 't/a-dark.png'), 20, { noise: true });
  expect((await pack(folders)).written).toEqual([]);
  expect(await changed(dark)).toBe(before);
});

test('a frame with a changed region is packed again, and no other is', async ({}, info) => {
  const folders = await take(info.outputPath());
  await pack(folders);
  await picture(path.join(folders.from, 't/a-dark.png'), 20, { moved: 10 });
  const again = await pack(folders);
  expect(again.written).toEqual([path.join(folders.into, 't/a-dark.webp')]);
  expect(again.kept).toHaveLength(2);
});

test('a frame the take no longer has is removed, and a missing picture stops the pack', async ({}, info) => {
  const folders = await take(info.outputPath());
  await pack(folders);
  const said = { take: 't', window: { w: 200, h: 100 }, density: 2, paint: {}, frames: [{ name: 'b', marks: {} }] };
  await writeFile(path.join(folders.from, 't.json'), JSON.stringify(said));
  await expect(pack(folders)).rejects.toThrow(/no picture b-dark\.png/);

  await picture(path.join(folders.from, 't/b-dark.png'), 20);
  await picture(path.join(folders.from, 't/b-light.png'), 240);
  const { removed } = await pack(folders);
  expect(removed.map((file) => path.basename(file)).sort()).toEqual(['a-dark.webp', 'a-light.webp']);
  expect((await readdir(path.join(folders.into, 't'))).sort()).toEqual(['b-dark.webp', 'b-light.webp']);
});

test('a frame over 300 KB stops the pack', async ({}, info) => {
  const folders = await take(info.outputPath());
  // Noise does not pack, so a window of it is far over the limit.
  const noise = Buffer.alloc(2400 * 1500 * 3);
  let seed = 7;
  for (let at = 0; at < noise.length; at++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    noise[at] = seed % 256;
  }
  await sharp(noise, { raw: { width: 2400, height: 1500, channels: 3 } })
    .png()
    .toFile(path.join(folders.from, 't/a-dark.png'));
  await expect(pack(folders)).rejects.toThrow(/over 300 KB: a-dark\.webp is \d+ KB/);
});

// What this file does not cover: the frames of a real take, which the
// Node tier weighs where they are committed. It does not cover a pack on
// a machine with another build of libwebp, where a kept file is compared
// to a file packed a little differently.
