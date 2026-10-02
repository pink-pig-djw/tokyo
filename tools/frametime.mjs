// Single-frame wall time (headless, synchronised with readPixels), optionally with parts
// of the scene switched off to find what a frame spends its time on.
// usage: node tools/frametime.mjs "<query>" [baseUrl]
// env: W/H viewport (default 1280x720); CASES='[["name","js returning an undo function"], ...]'
//      e.g. CASES='[["no-trees","app.trees.group.visible=false; return ()=>app.trees.group.visible=true;"]]'
import { chromium } from 'playwright';
const [query = '', base = 'http://localhost:5173/'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog'] });
const page = await browser.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(base + '?shot=1&' + query, { waitUntil: 'load' });
await page.waitForFunction(() => window.__tokyoReady === true, null, { timeout: 900000, polling: 1000 });
const cases = JSON.parse(process.env.CASES || '[]');
for (const [name, js] of [['all', ''], ...cases]) {
  const ms = await page.evaluate(async (js) => {
    const app = window.__tokyo;
    app.stop();
    const gl = app.renderer.getContext();
    const px = new Uint8Array(4);
    const restore = js ? (new Function('app', js))(app) : null;
    const t = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      app.frame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      t.push(performance.now() - t0);
    }
    if (typeof restore === 'function') restore();
    return t.sort((a, b) => a - b)[1];
  }, js);
  console.log(`${name.padEnd(22)} ${ms.toFixed(0).padStart(6)} ms`);
}
await browser.close();
