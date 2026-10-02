// Headless screenshot helper: node tools/shot.mjs <out.png> "<query>" [waitMs] [width] [height]
import { chromium } from 'playwright';
const [out, query = '', waitMs = '4000', W = '1600', H = '900'] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:5173/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-watchdog', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(base + '?shot=1&' + query, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction(() => window.__tokyoReady === true, null, { timeout: 600000, polling: 1000 });
} catch (e) { logs.push('timeout waiting ready'); }
const tReady = Date.now();
await page.waitForTimeout(+waitMs);
const fs = await import('node:fs');
if (process.env.UI) {
  await page.evaluate(() => { window.__tokyo.capture(3); });
  await page.evaluate(() => window.__tokyo.ui && window.__tokyo.ui.update());
  await page.screenshot({ path: out });
} else {
  const data = await page.evaluate(() => window.__tokyo.capture(4));
  fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
}
console.log(`ready ${(tReady - t0) / 1000}s, shot ${out}`);
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 40).join('\n'));
await browser.close();
