import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-watchdog'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/?shot=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__tokyoReady === true, null, { timeout: 600000, polling: 1000 });
const log = await page.evaluate(() => {
  const app = window.__tokyo; app.stop();
  app.startTour();
  const out = [];
  let last = -1;
  for (let k = 0; k < 4000 && app.tour.active; k++) {
    app.tour.update(0.1); app.director.update(0.1);
    if (app.tour.i !== last && app.tour.phase === 'holding') {
      last = app.tour.i;
      const c = app.camera.position, t = app.controls.target;
      out.push(`${app.tour.i} ${document.getElementById('capTitle').textContent} h=${app.env.hours.toFixed(2)} cam=(${c.x.toFixed(0)},${c.y.toFixed(0)},${c.z.toFixed(0)}) t=(${t.x.toFixed(0)},${t.y.toFixed(0)},${t.z.toFixed(0)}) sim=${(k/10).toFixed(0)}s`);
    }
  }
  out.push('active after loop: ' + app.tour.active + ' mode ' + app.director.mode);
  return out.join('\n');
});
console.log(log);
// replay to the Shibuya stop and capture with captions
await page.evaluate(() => {
  const app = window.__tokyo;
  app.startTour();
  for (let k = 0; k < 4000; k++) { app.tour.update(0.1); app.director.update(0.1); if (app.tour.i === 9 && app.tour.phase === 'holding') break; }
  app.capture(2);
});
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/claude-0/shots/tour_shibuya.png' });
await browser.close();
