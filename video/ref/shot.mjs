import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:8765/');
await p.waitForTimeout(2500);
await p.screenshot({ path: 'video/ref/landing.png' });
await p.screenshot({ path: 'video/ref/landing-full.png', fullPage: true });
await b.close();
