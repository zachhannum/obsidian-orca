// Packs the frames a take leaves under build/reel into the WebP files
// the site ships. A frame whose picture has not changed keeps the file
// it has, so a second pack of the same frames rewrites nothing.
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = fileURLToPath(new URL("../..", import.meta.url));

/** The byte limit of one packed frame. */
export const LIMIT = 300 * 1024;

/** The WebP quality a frame is packed at. */
export const QUALITY = 80;

const SCHEMES = ["dark", "light"];

/** The side of the squares two pictures are compared over, in pixels. */
const BLOCK = 8;

/**
 * The most the mean of one square can differ by, of 255, between the
 * file a frame has and the file its new picture packs to. Two takes of
 * one screen stay under it, and a control that moved does not.
 */
const TOLERANCE = 4;

/**
 * The mean of each colour over each square of a picture.
 *
 * @param {string | Buffer} source
 */
async function means(source) {
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const across = Math.ceil(info.width / BLOCK);
  const down = Math.ceil(info.height / BLOCK);
  const sums = new Float64Array(across * down * 3);
  const counts = new Uint32Array(across * down);
  for (let y = 0; y < info.height; y++) {
    const row = Math.floor(y / BLOCK) * across;
    for (let x = 0; x < info.width; x++) {
      const square = row + Math.floor(x / BLOCK);
      const at = (y * info.width + x) * 3;
      sums[square * 3] += data[at];
      sums[square * 3 + 1] += data[at + 1];
      sums[square * 3 + 2] += data[at + 2];
      counts[square] += 1;
    }
  }
  for (let square = 0; square < counts.length; square++) {
    for (let c = 0; c < 3; c++) sums[square * 3 + c] /= counts[square];
  }
  return { width: info.width, height: info.height, sums };
}

/**
 * The largest difference between two pictures, over the means of their squares.
 *
 * @param {string | Buffer} one
 * @param {string | Buffer} other
 * @returns {Promise<number>}
 */
export async function apart(one, other) {
  const [a, b] = await Promise.all([means(one), means(other)]);
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let most = 0;
  for (let i = 0; i < a.sums.length; i++) most = Math.max(most, Math.abs(a.sums[i] - b.sums[i]));
  return most;
}

/** @param {string} file */
const exists = (file) => stat(file).then(() => true, () => false);

/**
 * Packs every take under `from` into `into`. Returns the files it
 * wrote, the files it kept and the files it removed. Throws when a
 * frame's picture is missing, and when a packed frame is over the limit.
 *
 * @param {{ from: string, into: string, quality?: number }} folders
 * @returns {Promise<{ written: string[], kept: string[], removed: string[] }>}
 */
export async function pack({ from, into, quality = QUALITY }) {
  const written = [];
  const kept = [];
  const removed = [];
  const heavy = [];
  const takes = (await readdir(from)).filter((file) => file.endsWith(".json")).sort();
  if (takes.length === 0) throw new Error(`no take under ${from}`);

  for (const file of takes) {
    const text = await readFile(path.join(from, file), "utf8");
    const take = JSON.parse(text);
    const folder = path.join(into, take.take);
    await mkdir(folder, { recursive: true });
    const wanted = new Set();

    for (const frame of take.frames) {
      for (const scheme of SCHEMES) {
        const name = `${frame.name}-${scheme}`;
        const source = path.join(from, take.take, `${name}.png`);
        const target = path.join(folder, `${name}.webp`);
        wanted.add(`${name}.webp`);
        if (!(await exists(source))) throw new Error(`take ${take.take} has no picture ${name}.png`);
        // The packing loses more than a take's noise adds, so the new
        // picture is packed first and the two packed files compared.
        const packed = await sharp(source).webp({ quality, effort: 6 }).toBuffer();
        if ((await exists(target)) && (await apart(packed, target)) <= TOLERANCE) {
          kept.push(target);
        } else {
          await writeFile(target, packed);
          written.push(target);
        }
        const { size } = await stat(target);
        if (size > LIMIT) heavy.push(`${name}.webp is ${String(Math.round(size / 1024))} KB`);
      }
    }

    for (const held of await readdir(folder)) {
      if (wanted.has(held)) continue;
      await rm(path.join(folder, held));
      removed.push(path.join(folder, held));
    }

    const data = path.join(into, file);
    if ((await exists(data)) && (await readFile(data, "utf8")) === text) {
      kept.push(data);
    } else {
      await writeFile(data, text);
      written.push(data);
    }
  }

  if (heavy.length > 0) throw new Error(`a frame is over ${String(LIMIT / 1024)} KB: ${heavy.join(", ")}`);
  return { written, kept, removed };
}

if (import.meta.filename === process.argv[1]) {
  const flag = (name, otherwise) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? otherwise : path.resolve(process.argv[at + 1]);
  };
  const { written, kept, removed } = await pack({
    from: flag("--from", path.join(repo, "build/reel")),
    into: flag("--into", path.join(repo, "site/src/shots/reel")),
  });
  for (const file of written) process.stdout.write(`wrote ${path.relative(repo, file)}\n`);
  for (const file of removed) process.stdout.write(`removed ${path.relative(repo, file)}\n`);
  process.stdout.write(`pack-reel: ${String(written.length)} written, ${String(kept.length)} kept, ${String(removed.length)} removed\n`);
}
