// Captures single frames at given times, for review.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const times = process.argv.slice(2).map(Number);
mkdirSync('build/stills', { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('console', (m) => console.log('console:', m.text()));
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(pathToFileURL('index.html').href + '?render=1');
await p.evaluate(() => O.ready);
for (const t of times) {
  await p.evaluate((t) => O.seek(t), t);
  await p.screenshot({ path: `build/stills/t${t.toFixed(2).padStart(6, '0')}.png` });
}
const fonts = await p.evaluate(() => Array.from(document.fonts).map((f) => f.family + ':' + f.status).join(' '));
console.log(fonts);
await b.close();
