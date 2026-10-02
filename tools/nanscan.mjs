// NaN / Inf scan (headless): runs the post chain pass by pass (all but the final one) and
// counts non-finite pixels after each. A single NaN is smeared over the screen by the bloom mip chain.
// usage: node tools/nanscan.mjs <baseUrl> "<query>"
import { chromium } from 'playwright';
const [base, query] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(base + '?shot=1&' + query, { waitUntil: 'load' });
await page.waitForFunction(() => window.__tokyoReady === true, null, { timeout: 900000, polling: 1000 });
console.log(await page.evaluate(() => {
  const app = window.__tokyo; app.stop();
  app.frame(); app.frame();
  const R = app.renderer;
  const c = app.post.composer;
  const w = c.inputBuffer.width, h = c.inputBuffer.height;
  const scan = (rt, label) => {
    const buf = new Uint16Array(w * h * 4);
    R.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    let nan = 0, inf = 0, neg = 0; const where = [];
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < 3; k++) {
        const v = buf[i * 4 + k], e = (v >> 10) & 31, f = v & 1023;
        if (e === 31) { if (f) nan++; else inf++; if (where.length < 8) where.push(`${i % w},${h - 1 - Math.floor(i / w)}${f ? 'N' : 'I'}`); break; }
        if (v >> 15 && (e || f)) { neg++; if (where.length < 8) where.push(`${i % w},${h - 1 - Math.floor(i / w)}neg`); break; }
      }
    }
    return `${label.padEnd(14)} NaN ${nan}  Inf ${inf}  negative ${neg}  at ${where.join(' ')}`;
  };
  // run the chain pass by pass (all but the last, which draws to the screen) and scan each output
  const lines = [];
  let input = c.inputBuffer, output = c.outputBuffer;
  for (const p of c.passes.slice(0, -1)) {
    p.render(R, input, output, 0.016, false);
    const target = p.needsSwap ? output : input;
    lines.push(scan(target, p.name));
    if (p.needsSwap) { const t = input; input = output; output = t; }
  }
  return [...lines, `size ${w}x${h}`].join('\n');
}));
await browser.close();
