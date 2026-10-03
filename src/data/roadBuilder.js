// Road / rail ribbons with mitred joins; elevated sections get parapets, girders and
// pillars. Output is grouped in 4 km tiles for frustum culling.

export const ROAD_WIDTH = {
  1: 9.5, 2: 15, 3: 13, 4: 10, 5: 7.5, 6: 4.6, 7: 3.2, 8: 4.5, 9: 4.2,
  20: 3.0, 21: 3.0, 22: 3.6, 23: 2.6,
};
const Y_OFF = { 9: 0.48, 1: 0.42, 2: 0.36, 3: 0.3, 4: 0.25, 5: 0.2, 6: 0.14, 7: 0.1, 8: 0.08, 20: 0.18, 21: 0.18, 22: 0.18, 23: 0.18 };
const TILE = 4000;

class Geo {
  constructor() {
    this.cap = 8192;
    this.pos = new Float32Array(this.cap * 3);
    this.attr = new Float32Array(this.cap * 4);
    this.idx = [];
    this.n = 0;
    this.min = [1e9, 1e9, 1e9];
    this.max = [-1e9, -1e9, -1e9];
  }

  v(x, y, z, u, vv, code, part) {
    if (this.n >= this.cap) {
      this.cap *= 2;
      const p = new Float32Array(this.cap * 3); p.set(this.pos); this.pos = p;
      const a = new Float32Array(this.cap * 4); a.set(this.attr); this.attr = a;
    }
    const n = this.n++;
    this.pos[n * 3] = x; this.pos[n * 3 + 1] = y; this.pos[n * 3 + 2] = z;
    this.attr[n * 4] = u; this.attr[n * 4 + 1] = vv; this.attr[n * 4 + 2] = code; this.attr[n * 4 + 3] = part;
    if (x < this.min[0]) this.min[0] = x; if (x > this.max[0]) this.max[0] = x;
    if (y < this.min[1]) this.min[1] = y; if (y > this.max[1]) this.max[1] = y;
    if (z < this.min[2]) this.min[2] = z; if (z > this.max[2]) this.max[2] = z;
    return n;
  }

  finish() {
    const c = [0, 1, 2].map((k) => (this.min[k] + this.max[k]) / 2);
    const r = Math.hypot(this.max[0] - this.min[0], this.max[1] - this.min[1], this.max[2] - this.min[2]) / 2;
    return {
      pos: this.pos.slice(0, this.n * 3),
      attr: this.attr.slice(0, this.n * 4),
      idx: new Uint32Array(this.idx),
      sphere: [c[0], c[1], c[2], r],
    };
  }
}

export function buildRoads(buf, opts) {
  const dv = new DataView(buf);
  const nl = dv.getUint32(4, true);
  let o = 12;
  const codes = new Uint8Array(nl), flags = new Uint8Array(nl), counts = new Uint16Array(nl);
  for (let i = 0; i < nl; i++) {
    codes[i] = dv.getUint8(o); flags[i] = dv.getUint8(o + 1); counts[i] = dv.getUint16(o + 2, true);
    o += 4;
  }
  const vbase = o;
  const tiles = new Map();
  const tileOf = (x, z, rail) => {
    const key = `${rail ? 'r' : 'd'}${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
    let t = tiles.get(key);
    if (!t) { t = { rail, g: new Geo() }; tiles.set(key, t); }
    return t.g;
  };
  const pillars = [];
  const rb = opts && opts.rainbow;
  const inRainbow = (x, z) => {
    if (!rb) return false;
    const dx = x - rb.x, dz = z - rb.z;
    const a = dx * rb.ax + dz * rb.az;
    const b = -dx * rb.az + dz * rb.ax;
    return Math.abs(a) < rb.length / 2 + 30 && Math.abs(b) < rb.width / 2 + 20;
  };

  let vi = 0;
  const X = new Float64Array(70000), Y = new Float64Array(70000), Z = new Float64Array(70000);
  const NP = new Uint8Array(70000);
  for (let i = 0; i < nl; i++) {
    const n = counts[i];
    const code = codes[i];
    for (let k = 0; k < n; k++) {
      const off = vbase + (vi + k) * 6;
      X[k] = dv.getInt16(off, true) / 2;
      Z[k] = dv.getInt16(off + 2, true) / 2;
      const yv = dv.getUint16(off + 4, true);
      Y[k] = (yv & 0x7fff) / 20;
      NP[k] = yv >> 15;              // no pillar here (it would stand inside a building)
    }
    vi += n;
    if (n < 2) continue;
    const rail = code >= 20;
    const g = tileOf(X[0], Z[0], rail);
    const half = ROAD_WIDTH[code] / 2;
    const yo = Y_OFF[code] || 0.1;
    let u = 0;
    let elevatedAny = false;
    for (let k = 0; k < n; k++) if (Y[k] > 3) { elevatedAny = true; break; }

    const base = g.n;
    const sideBase = [];
    let lastPillar = -1e9;
    for (let k = 0; k < n; k++) {
      // tangent
      let tx, tz;
      if (k === 0) { tx = X[1] - X[0]; tz = Z[1] - Z[0]; }
      else if (k === n - 1) { tx = X[k] - X[k - 1]; tz = Z[k] - Z[k - 1]; }
      else {
        let ax = X[k] - X[k - 1], az = Z[k] - Z[k - 1];
        let bx = X[k + 1] - X[k], bz = Z[k + 1] - Z[k];
        const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
        ax /= la; az /= la; bx /= lb; bz /= lb;
        tx = ax + bx; tz = az + bz;
        if (Math.hypot(tx, tz) < 1e-3) { tx = bx; tz = bz; }
      }
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      let nx = -tz, nz = tx;
      let miter = 1;
      if (k > 0 && k < n - 1) {
        const sx = X[k + 1] - X[k], sz = Z[k + 1] - Z[k];
        const sl = Math.hypot(sx, sz) || 1;
        const d = nx * (-sz / sl) + nz * (sx / sl);
        miter = 1 / Math.max(Math.abs(d), 0.45);
      }
      if (k > 0) u += Math.hypot(X[k] - X[k - 1], Z[k] - Z[k - 1]);
      const w = half * miter;
      const y = Y[k] + yo;
      g.v(X[k] + nx * w, y, Z[k] + nz * w, u, -1, code, 0);
      g.v(X[k] - nx * w, y, Z[k] - nz * w, u, 1, code, 0);
      if (elevatedAny) {
        const e = Y[k] > 3 ? 1 : 0;
        const top = y + (e ? 1.1 : 0.0);
        const bot = y - (e ? (rail ? 1.4 : 1.8) : 0.0);
        sideBase.push(g.n);
        g.v(X[k] + nx * w, top, Z[k] + nz * w, u, -2, code, 1);
        g.v(X[k] + nx * w, bot, Z[k] + nz * w, u, -2, code, 1);
        g.v(X[k] - nx * w, top, Z[k] - nz * w, u, 2, code, 1);
        g.v(X[k] - nx * w, bot, Z[k] - nz * w, u, 2, code, 1);
        g.v(X[k] + nx * w, bot, Z[k] + nz * w, u, -3, code, 2);
        g.v(X[k] - nx * w, bot, Z[k] - nz * w, u, 3, code, 2);
        if (Y[k] > 5 && Y[k] < 40 && u - lastPillar > 34 && !NP[k] && !inRainbow(X[k], Z[k])) {
          lastPillar = u;
          pillars.push(X[k], Z[k], Y[k] - (rail ? 1.4 : 1.8), Math.atan2(tz, tx), Math.min(half * 1.1, 6));
        }
      }
    }
    // top surface (both windings so it reads from below on elevated decks via sides)
    for (let k = 0; k < n - 1; k++) {
      const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
      g.idx.push(a, c, b, b, c, d);
    }
    if (elevatedAny) {
      for (let k = 0; k < n - 1; k++) {
        const s0 = sideBase[k], s1 = sideBase[k + 1];
        // left wall (outer side faces +n)
        g.idx.push(s0, s0 + 1, s1, s1, s0 + 1, s1 + 1);
        // right wall
        g.idx.push(s0 + 2, s1 + 2, s0 + 3, s1 + 2, s1 + 3, s0 + 3);
        // underside
        g.idx.push(s0 + 4, s0 + 5, s1 + 4, s1 + 4, s0 + 5, s1 + 5);
      }
    }
    if (g.n > 3_000_000) throw new Error('road tile too large');
  }
  const out = [];
  for (const [key, t] of tiles) out.push({ key, rail: t.rail, ...t.g.finish() });
  return { tiles: out, pillars: new Float32Array(pillars) };
}
