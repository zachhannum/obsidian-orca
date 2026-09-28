// Renders the film to MP4: the score from the page's own synth, then every
// frame by seeking the timeline and taking a screenshot, in parallel
// segments that ffmpeg joins at the end.
//
//   node render.mjs [--fps 60] [--workers 6] [--sub 2] [--from 0] [--to 58.125]
//
// --sub N renders N sub-frames per output frame and blends them, for
// motion blur.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const FPS = +arg('fps', 60);
const SUB = +arg('sub', 2);
const WORKERS = +arg('workers', Math.max(2, Math.min(8, os.cpus().length - 2)));
const OUT = arg('out', 'orca.mp4');
const url = pathToFileURL('index.html').href + '?render=1';

mkdirSync('build/segments', { recursive: true });
const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--force-color-profile=srgb'] });

async function openPage(own) {
  const br = own ? await chromium.launch({ args: ['--font-render-hinting=none', '--force-color-profile=srgb'] }) : browser;
  const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(url);
  await page.evaluate(() => O.ready);
  return page;
}

// Score.
const first = await openPage();
const total = await first.evaluate(() => O.T.total);
const from = +arg('from', 0), to = +arg('to', total);
console.log('rendering score…');
const wav = await first.evaluate(() => O.audio.wavBase64());
writeFileSync('build/score.wav', Buffer.from(wav, 'base64'));
await first.context().close();

const frames = Math.round((to - from) * FPS);
const per = Math.ceil(frames / WORKERS);
console.log(`${frames} frames × ${SUB} sub-frames on ${WORKERS} workers`);
const started = Date.now();
let done = 0;

async function worker(w) {
  const a = w * per, b = Math.min(frames, a + per);
  if (a >= b) return null;
  const page = await openPage(true);
  const seg = `build/segments/seg${String(w).padStart(2, '0')}.mp4`;
  const vf = SUB > 1 ? ['-vf', `tmix=frames=${SUB}:weights=${Array(SUB).fill(1).join(' ')},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${FPS}*TB)`] : [];
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'png', '-i', '-', ...vf,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((r) => ff.on('close', r));
  for (let f = a; f < b; f++) {
    for (let s = 0; s < SUB; s++) {
      // Sub-frames sit around the frame time, spanning half a frame: a 180° shutter.
      const t = from + (f + (SUB > 1 ? ((s + 0.5) / SUB) * 0.5 - 0.25 : 0)) / FPS;
      await page.evaluate((t) => O.seek(t), Math.max(0, t));
      const png = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    done++;
    if (done % 60 === 0) {
      const el = (Date.now() - started) / 1000;
      console.log(`${done}/${frames}  ${(done / el).toFixed(1)} fps  eta ${Math.round((frames - done) / (done / el))}s`);
    }
  }
  ff.stdin.end();
  await closed;
  await page.context().browser().close();
  return seg;
}

const segs = (await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)))).filter(Boolean);
await browser.close();
writeFileSync('build/segments/list.txt', segs.map((s) => `file '${s.replace('build/segments/', '')}'`).join('\n'));

// Join the segments and lay the score under them.
const aoff = from > 0 ? ['-ss', String(from)] : [];
await new Promise((res, rej) => {
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'build/segments/list.txt', ...aoff, '-i', 'build/score.wav',
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.2:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
});
if (!process.argv.includes('--keep')) rmSync('build/segments', { recursive: true, force: true });
console.log(`wrote ${OUT} in ${Math.round((Date.now() - started) / 1000)}s`);
