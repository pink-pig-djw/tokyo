// Per-frame workload profiler (headless): counts renderer.render() calls, draw calls,
// triangles/points/lines across one whole frame, and wall time per frame.
// usage: node tools/profile.mjs "<query>" [label] [js run once before measuring, gets `app`]
import { chromium } from 'playwright';
const [query = '', label = '', pre = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto((process.env.BASE || 'http://localhost:5173/') + '?shot=1&' + query, { waitUntil: 'load' });
await page.waitForFunction(() => window.__tokyoReady === true, null, { timeout: 600000, polling: 1000 });
const r = await page.evaluate((pre) => {
  const app = window.__tokyo;
  app.stop();
  if (pre) (new Function('app', pre))(app);
  const R = app.renderer;
  R.info.autoReset = false;
  let renders = 0;
  const per = {};
  const orig = R.render.bind(R);
  R.render = (s, c) => {
    renders++;
    const t0 = R.info.render.triangles;
    const r = orig(s, c);
    const key = s === app.scene ? (c === app.camera ? 'scene/main-cam' : 'scene/other-cam') : (s.children.length > 2 ? 'other-scene' : 'fullscreen');
    per[key] = (per[key] || 0) + (R.info.render.triangles - t0);
    per[key + '#'] = (per[key + '#'] || 0) + 1;
    return r;
  };
  for (let i = 0; i < 2; i++) app.frame();          // warm-up (shader compiles)
  const out = [];
  for (let i = 0; i < 3; i++) {
    R.info.reset(); renders = 0; for (const k in per) delete per[k];
    const t0 = performance.now();
    app.frame();
    R.getContext().finish();
    out.push({ ms: performance.now() - t0, renders, calls: R.info.render.calls, tris: R.info.render.triangles, pts: R.info.render.points, lines: R.info.render.lines, per: JSON.parse(JSON.stringify(per)) });
  }
  R.render = orig;
  const med = out.sort((a, b) => a.ms - b.ms)[1];
  return { ...med, geometries: R.info.memory.geometries, textures: R.info.memory.textures, programs: R.info.programs.length };
}, pre);
const M = (n) => (n / 1e6).toFixed(2) + 'M';
console.log('   breakdown', Object.entries(r.per).map(([k, v]) => k.endsWith('#') ? `${k}${v}` : `${k}=${M(v)}`).join('  '));
console.log(`${label.padEnd(28)} frame ${r.ms.toFixed(0).padStart(6)} ms | render() x${r.renders} | draws ${r.calls} | tris ${M(r.tris)} | points ${M(r.pts)} | lines ${M(r.lines)} | programs ${r.programs}`);
await browser.close();
