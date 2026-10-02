// Turn dist/ into the GitHub Pages site in docs/: the single-file page plus the data files,
// with a favicon and link-preview (Open Graph) tags. docs/preview.jpg is kept as is.
// usage: npm run pages   (vite build + this script)
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://pink-pig-djw.github.io/tokyo/';
const TITLE = '东京 3D 全景漫游';
const DESC = '用真实地图数据还原的东京 3D 城市：66 万栋建筑、真实的日出日落与天气，从黄昏到夜景的自动巡游。';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'docs');
let html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');

const icon = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#0b1020'/><path d='M32 7 41 57h-5l-4-24-4 24h-5z' fill='#e8542b'/><path d='M25 41h14v4H25z' fill='#ece7dc'/></svg>`;
const meta = `
  <meta name="description" content="${DESC}" />
  <meta name="theme-color" content="#0b1020" />
  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${TITLE}" />
  <meta property="og:description" content="${DESC}" />
  <meta property="og:url" content="${SITE}" />
  <meta property="og:image" content="${SITE}preview.jpg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />`;
if (!/<\/title>/i.test(html)) throw new Error('no <title> in dist/index.html');
html = html.replace(/<\/title>/i, `</title>${meta}`);

fs.mkdirSync(out, { recursive: true });
fs.rmSync(path.join(out, 'data'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'data'));
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');   // serve files as they are
let bytes = 0;
const files = fs.readdirSync(path.join(root, 'dist/data'));
for (const f of files) {
  fs.copyFileSync(path.join(root, 'dist/data', f), path.join(out, 'data', f));
  bytes += fs.statSync(path.join(out, 'data', f)).size;
}
if (!fs.existsSync(path.join(out, 'preview.jpg'))) console.warn('docs/preview.jpg is missing (link previews)');
console.log(`docs/: page ${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB, ${files.length} data files ${(bytes / 1e6).toFixed(1)} MB`);
