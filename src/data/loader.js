// Fetching + parsing of the compact binary city data written by tools/build_world.py.

const BASE = 'data/';

async function gunzip(buf) {
  const u8 = new Uint8Array(buf);
  // the host may already have decoded Content-Encoding: gzip for us
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return buf;
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

async function fetchRetry(url, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      err = new Error(`${url}: HTTP ${res.status}`);
    } catch (e) {
      err = e;
    }
    await new Promise((r) => setTimeout(r, 400 * 2 ** i));
  }
  throw err;
}

function decodeBase64(text) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(text.trim());
  const bin = atob(text.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function fetchBinary(name, onProgress) {
  // the published artifact serves the binaries as base64 text (.b64.txt)
  if (globalThis.__TOKYO_DATA_B64) {
    const res = await fetchRetry(BASE + name.replace(/\.bin\.gz$/, '.b64.txt'));
    const bytes = decodeBase64(await res.text());
    onProgress?.(1);
    return gunzip(bytes.buffer);
  }
  const res = await fetchRetry(BASE + name);
  let buf;
  if (onProgress && res.body && res.headers.get('content-length')) {
    const total = +res.headers.get('content-length');
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(got / total);
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    buf = all.buffer;
  } else {
    buf = await res.arrayBuffer();
  }
  return gunzip(buf);
}

export async function fetchJSON(name) {
  const res = await fetchRetry(BASE + name);
  return res.json();
}

function magic(dv, s) {
  const m = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (m !== s) throw new Error(`bad magic ${m}, expected ${s}`);
}

const align4 = (o) => (o + 3) & ~3;

/** ground.bin: triangulated land-cover layers, int16 xz in 0.5 m units. */
export function parseGround(buf) {
  const dv = new DataView(buf);
  magic(dv, 'TKG1');
  const n = dv.getUint32(4, true);
  let o = 8;
  const layers = [];
  for (let i = 0; i < n; i++) {
    const id = dv.getUint8(o);
    const nv = dv.getUint32(o + 4, true);
    const ni = dv.getUint32(o + 8, true);
    o += 12;
    const xz = new Int16Array(buf, o, nv * 2);
    o = align4(o + nv * 4);
    const idx = new Uint32Array(buf, o, ni);
    o += ni * 4;
    layers.push({ id, xz, idx });
  }
  return layers;
}

/** far.bin: land + water meshes (4 m units) and sprawl boxes. */
export function parseFar(buf) {
  const dv = new DataView(buf);
  magic(dv, 'TKF1');
  let o = 4;
  const meshes = [];
  for (let i = 0; i < 2; i++) {
    const nv = dv.getUint32(o, true);
    const ni = dv.getUint32(o + 4, true);
    o += 8;
    const xz = new Int16Array(buf, o, nv * 2);
    o = align4(o + nv * 4);
    const idx = new Uint32Array(buf, o, ni);
    o += ni * 4;
    meshes.push({ xz, idx });
  }
  const nb = dv.getUint32(o, true);
  o += 4;
  const boxes = new DataView(buf, o, nb * 6);
  return { land: meshes[0], water: meshes[1], boxes, nBoxes: nb };
}

/** roads.bin: polylines with class code, flags and per-vertex elevation. */
export function parseRoads(buf) {
  const dv = new DataView(buf);
  magic(dv, 'TKR1');
  const nl = dv.getUint32(4, true);
  const nv = dv.getUint32(8, true);
  let o = 12;
  const lines = new Array(nl);
  for (let i = 0; i < nl; i++) {
    lines[i] = { code: dv.getUint8(o), flags: dv.getUint8(o + 1), n: dv.getUint16(o + 2, true) };
    o += 4;
  }
  const verts = new DataView(buf, o, nv * 6);
  return { lines, verts, nv };
}

/** routes.bin: resampled polylines for cars and trains. */
export function parseRoutes(buf) {
  const dv = new DataView(buf);
  magic(dv, 'TKO1');
  const nr = dv.getUint32(4, true);
  const np = dv.getUint32(8, true);
  let o = 12;
  const routes = new Array(nr);
  for (let i = 0; i < nr; i++) {
    routes[i] = { kind: dv.getUint8(o), color: dv.getUint8(o + 1), n: dv.getUint16(o + 2, true) };
    o += 4;
  }
  const pts = new DataView(buf, o, np * 6);
  return { routes, pts, np };
}

/** extras.bin: trees, lamps, roof units, aviation lights, signs. */
export function parseExtras(buf) {
  const dv = new DataView(buf);
  magic(dv, 'TKE1');
  let o = 4;
  const sections = [];
  const sizes = [6, 6, 10, 6, 18];
  for (const sz of sizes) {
    const n = dv.getUint32(o, true);
    o += 4;
    sections.push({ n, dv: new DataView(buf, o, n * sz), stride: sz });
    o = align4(o + n * sz);
  }
  const [trees, lamps, roofUnits, aviation, signs] = sections;
  return { trees, lamps, roofUnits, aviation, signs };
}
