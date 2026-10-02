// Turn dist/index.html (full document) into an Artifact page body: the host wraps it in
// its own <!doctype>/<html>/<head>/<body>, so we keep title, links, styles, scripts and
// the body markup, and copy the data files next to it.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1];
const body = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
const keepHead = head
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '');
const bodyClass = (body[1].match(/class="([^"]*)"/) || [])[1] || '';
// move any module script from head to the end so the DOM exists when it runs
const scripts = [];
const headNoScripts = keepHead.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => { scripts.push(m); return ''; });
const out = `${headNoScripts.trim()}
<script>document.body.className = ${JSON.stringify(bodyClass)}; window.__TOKYO_DATA_B64 = true;</script>
${body[2].trim()}
${scripts.join('\n')}
`;
const outDir = path.join(root, 'artifact');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), out);
const files = {};
for (const f of fs.readdirSync(path.join(root, 'dist/data'))) {
  const src = path.join(root, 'dist/data', f);
  if (f.endsWith('.bin.gz')) {
    // artifacts serve text, not arbitrary binaries: ship base64 text instead
    const name = f.replace(/\.bin\.gz$/, '.b64.txt');
    fs.writeFileSync(path.join(outDir, 'data', name), fs.readFileSync(src).toString('base64'));
    files[`data/${name}`] = `artifact/data/${name}`;
  } else {
    fs.copyFileSync(src, path.join(outDir, 'data', f));
    files[`data/${f}`] = `artifact/data/${f}`;
  }
}
fs.writeFileSync(path.join(outDir, 'files.json'), JSON.stringify(files, null, 1));
console.log('artifact page', (out.length / 1e6).toFixed(2), 'MB,', Object.keys(files).length, 'data files');
