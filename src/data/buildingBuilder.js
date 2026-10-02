// Turns a building chunk (footprints + attributes) into GPU-ready vertex batches.
// Runs inside a Web Worker (or on the main thread as a fallback).
//
// Vertex layout per batch (all non-normalised integers, decoded in the shader):
//   aPos   Int16x4  x, y, z in 5 cm units relative to the chunk centre; w = wall
//                   perimeter coordinate in 10 cm units (for window patterns)
//   aInfo  Uint8x4  wall palette idx, roof palette idx, style, seed
//   aInfo2 Uint16x4 building height (dm), flags | (min-height m << 8), facade archetype, random16
import earcut from 'earcut';

const MAX_VERTS = 65000;

class Batch {
  constructor(small) {
    this.small = small;
    this.cap = 16384;
    this.pos = new Int16Array(this.cap * 4);
    this.info = new Uint8Array(this.cap * 4);
    this.info2 = new Uint16Array(this.cap * 4);
    this.idx = [];
    this.n = 0;
    this.min = [1e9, 1e9, 1e9];
    this.max = [-1e9, -1e9, -1e9];
  }

  ensure(extra) {
    if (this.n + extra <= this.cap) return;
    while (this.n + extra > this.cap) this.cap *= 2;
    const p = new Int16Array(this.cap * 4); p.set(this.pos); this.pos = p;
    const i = new Uint8Array(this.cap * 4); i.set(this.info); this.info = i;
    const j = new Uint16Array(this.cap * 4); j.set(this.info2); this.info2 = j;
  }

  vert(x, y, z, u, info, info2) {
    const n = this.n++;
    const o = n * 4;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z; this.pos[o + 3] = u;
    this.info[o] = info[0]; this.info[o + 1] = info[1]; this.info[o + 2] = info[2]; this.info[o + 3] = info[3];
    this.info2[n * 4] = info2[0]; this.info2[n * 4 + 1] = info2[1]; this.info2[n * 4 + 2] = info2[2]; this.info2[n * 4 + 3] = info2[3];
    if (x < this.min[0]) this.min[0] = x; if (x > this.max[0]) this.max[0] = x;
    if (y < this.min[1]) this.min[1] = y; if (y > this.max[1]) this.max[1] = y;
    if (z < this.min[2]) this.min[2] = z; if (z > this.max[2]) this.max[2] = z;
    return n;
  }

  finish() {
    const idx = new Uint16Array(this.idx);
    const c = [0, 1, 2].map((k) => (this.min[k] + this.max[k]) / 2);
    const r = Math.hypot(this.max[0] - this.min[0], this.max[1] - this.min[1], this.max[2] - this.min[2]) / 2;
    return {
      small: this.small,
      pos: this.pos.slice(0, this.n * 4),
      info: this.info.slice(0, this.n * 4),
      info2: this.info2.slice(0, this.n * 4),
      idx,
      sphere: [c[0], c[1], c[2], r],
    };
  }
}

function hash32(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Facade archetypes (see FACADE_PARS in world/buildings.js)
const A = {
  HOUSE: 0, HOUSE_DARK: 1, HOUSE_TILE: 2, MANSION: 3, MANSION_GLASS: 4, DANCHI: 5, APT_PUNCHED: 6,
  OFF_RIBBON: 7, OFF_PUNCHED: 8, OFF_FINS: 9, PENCIL: 10, OFF_GRID: 11, TWR_CURTAIN: 12, TWR_SILVER: 13,
  TWR_FINS: 14, TWR_DARK: 15, TWR_STONE: 16, TWR_BANDED: 17, TWR_RESI: 18, IND_METAL: 19, IND_ALC: 20,
  TEMPLE: 21, CIVIC: 22, HOTEL: 23,
};

function pick(r, table) {
  let tot = 0;
  for (const [, w] of table) tot += w;
  let x = r * tot;
  for (const [a, w] of table) { if ((x -= w) <= 0) return a; }
  return table[table.length - 1][0];
}

function archetype(style, h, area, asp, r, zone) {
  switch (style) {
    case 0: return pick(r, [[A.HOUSE, 5], [A.HOUSE_DARK, 2], [A.HOUSE_TILE, 3]]);
    case 1:
      if (h > 60) return pick(r, [[A.TWR_RESI, 6], [A.MANSION_GLASS, 2], [A.HOTEL, 1]]);
      if (asp > 2.6 && area > 350 && h < 45) return pick(r, [[A.DANCHI, 6], [A.MANSION, 3], [A.APT_PUNCHED, 1]]);
      return pick(r, [[A.MANSION, 4], [A.MANSION_GLASS, 2.5], [A.APT_PUNCHED, 2.5], [A.HOTEL, zone ? 1.5 : 0.6], [A.PENCIL, zone ? 1.5 : 0.3]]);
    case 2:
      if (h > 80) return pick(r, [[A.TWR_STONE, 3], [A.TWR_BANDED, 2], [A.OFF_FINS, 2], [A.OFF_PUNCHED, 1.5], [A.TWR_SILVER, 1.5], [A.HOTEL, 1]]);
      if (area < 180 && h > 12) return pick(r, [[A.PENCIL, 7], [A.OFF_PUNCHED, 2], [A.OFF_RIBBON, 1]]);
      return pick(r, [[A.OFF_RIBBON, 2.5], [A.OFF_PUNCHED, 2.5], [A.OFF_FINS, 1.5], [A.OFF_GRID, 2], [A.HOTEL, 1], [A.PENCIL, zone ? 2 : 0.5], [A.TWR_STONE, 0.5]]);
    case 3:
      return pick(r, [[A.TWR_CURTAIN, 2.2], [A.TWR_SILVER, 2.2], [A.TWR_FINS, 1.4], [A.TWR_DARK, 1.4], [A.TWR_BANDED, 1.4], [A.OFF_GRID, 1.2], [A.TWR_STONE, 0.8]]);
    case 4: return pick(r, [[A.IND_METAL, 1], [A.IND_ALC, 1]]);
    case 5: return A.TEMPLE;
    case 6: return A.CIVIC;
    default: return A.OFF_PUNCHED;
  }
}

function ringArea(xs, zs) {
  let a = 0;
  for (let i = 0, n = xs.length; i < n; i++) {
    const j = (i + 1) % n;
    a += xs[i] * zs[j] - xs[j] * zs[i];
  }
  return a / 2;
}

function isConvex(xs, zs) {
  const n = xs.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n, c = (i + 2) % n;
    const cr = (xs[b] - xs[a]) * (zs[c] - zs[b]) - (zs[b] - zs[a]) * (xs[c] - xs[b]);
    if (Math.abs(cr) < 1e-6) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function buildChunk(buf) {
  const dv = new DataView(buf);
  const cx = dv.getFloat32(4, true);
  const cz = dv.getFloat32(8, true);
  const nB = dv.getUint32(12, true);
  const nR = dv.getUint32(16, true);
  const nV = dv.getUint32(20, true);
  let o = 24;
  const H = new Uint16Array(buf.slice(o, o + nB * 2)); o += nB * 2;
  const MINH = new Uint16Array(buf.slice(o, o + nB * 2)); o += nB * 2;
  const WALL = new Uint8Array(buf, o, nB); o += nB;
  const ROOF = new Uint8Array(buf, o, nB); o += nB;
  const STYLE = new Uint8Array(buf, o, nB); o += nB;
  const FLAGS = new Uint8Array(buf, o, nB); o += nB;
  const SEED = new Uint8Array(buf, o, nB); o += nB;
  const NRINGS = new Uint8Array(buf, o, nB); o += nB;
  o = (o + 3) & ~3;
  const RLEN = new Uint16Array(buf.slice(o, o + nR * 2)); o += nR * 2;
  o = (o + 3) & ~3;
  const V = new Int16Array(buf.slice(o, o + nV * 4));

  const batches = [];
  const open = { small: new Batch(true), big: new Batch(false) };
  const flush = (key) => {
    if (open[key].n) batches.push(open[key].finish());
    open[key] = new Batch(key === 'small');
  };

  let ri = 0, vi = 0;
  const info = [0, 0, 0, 0];
  const info2 = [0, 0, 0, 0];
  const cxi = Math.round(cx), czi = Math.round(cz);

  for (let b = 0; b < nB; b++) {
    const nr = NRINGS[b];
    // decode rings (delta-encoded, 5 cm units, relative to chunk centre)
    const rings = [];
    let total = 0;
    for (let r = 0; r < nr; r++) {
      const len = RLEN[ri++];
      const xs = new Float64Array(len), zs = new Float64Array(len);
      let x = 0, z = 0;
      for (let k = 0; k < len; k++) {
        x += V[vi * 2]; z += V[vi * 2 + 1]; vi++;
        xs[k] = x; zs[k] = z;
      }
      rings.push({ xs, zs });
      total += len;
    }
    if (!rings.length || rings[0].xs.length < 3) continue;

    const hq = Math.round(H[b] * 2);        // dm -> 5 cm
    const minq = Math.round(MINH[b] * 2);
    const style = STYLE[b];
    const flags = FLAGS[b];
    info[0] = WALL[b]; info[1] = ROOF[b]; info[2] = style; info[3] = SEED[b];
    info2[0] = H[b];
    info2[1] = flags | (Math.min(255, Math.round(MINH[b] / 10)) << 8);

    const outer = rings[0];
    const area = Math.abs(ringArea(outer.xs, outer.zs)) / 400; // m^2
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (let k = 0; k < outer.xs.length; k++) {
      mnx = Math.min(mnx, outer.xs[k]); mxx = Math.max(mxx, outer.xs[k]);
      mnz = Math.min(mnz, outer.zs[k]); mxz = Math.max(mxz, outer.zs[k]);
    }
    const asp = Math.max(mxx - mnx, mxz - mnz) / Math.max(1, Math.min(mxx - mnx, mxz - mnz));
    // parts of one building share the parent's random stream via its position
    const rnd = hash32(cxi + Math.round(mnx / 200), czi + Math.round(mnz / 200), SEED[b] * 7 + b);
    info2[2] = archetype(style, H[b] / 10, area, asp, (rnd & 0xffff) / 65536, (flags & 2) !== 0);
    info2[3] = (rnd >>> 16) & 0xffff;
    const small = H[b] < 250 && area < 500 && style !== 3;
    const key = small ? 'small' : 'big';

    // decide roof shape
    let roofKind = 0; // 0 flat, 1 hip (4 corners), 2 pyramid
    if ((flags & 1) && nr === 1) {
      if (outer.xs.length === 4) roofKind = 1;
      else if (outer.xs.length <= 7 && isConvex(outer.xs, outer.zs)) roofKind = 2;
    }
    const roofH = roofKind ? Math.min(Math.sqrt(area) * 0.22, 2.6) : 0;
    const eaveQ = roofKind ? Math.max(minq + 20, hq - Math.round(roofH * 20)) : hq;

    const needed = total * 2 + nr * 2 + 8;
    if (open[key].n + needed > MAX_VERTS) flush(key);
    const B = open[key];
    B.ensure(needed);

    const topStart = [];
    for (let r = 0; r < nr; r++) {
      const { xs, zs } = rings[r];
      const n = xs.length;
      const base = B.n;
      let u = (SEED[b] * 7) % 300;
      // bottom ring (n+1 with closing duplicate for continuous u)
      for (let k = 0; k <= n; k++) {
        const kk = k % n;
        if (k > 0) {
          const dx = xs[kk] - xs[k - 1], dz = zs[kk] - zs[k - 1];
          u += Math.sqrt(dx * dx + dz * dz) / 2; // 5 cm -> 10 cm units
        }
        B.vert(xs[kk], minq, zs[kk], Math.round(u) % 32000, info, info2);
      }
      const top = B.n;
      topStart.push(top);
      for (let k = 0; k <= n; k++) {
        const kk = k % n;
        B.vert(xs[kk], eaveQ, zs[kk], B.pos[(base + k) * 4 + 3], info, info2);
      }
      for (let k = 0; k < n; k++) {
        const b0 = base + k, b1 = base + k + 1, t0 = top + k, t1 = top + k + 1;
        B.idx.push(b0, b1, t1, b0, t1, t0);
      }
    }

    if (roofKind === 0) {
      // earcut on the top rings
      const coords = [];
      const holes = [];
      for (let r = 0; r < nr; r++) {
        if (r > 0) holes.push(coords.length / 2);
        const { xs, zs } = rings[r];
        for (let k = 0; k < xs.length; k++) coords.push(xs[k], zs[k]);
      }
      const tri = earcut(coords, holes.length ? holes : null, 2);
      // map flattened index -> top vertex
      const map = new Int32Array(coords.length / 2);
      let m = 0;
      for (let r = 0; r < nr; r++) {
        for (let k = 0; k < rings[r].xs.length; k++) map[m++] = topStart[r] + k;
      }
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t], bb = tri[t + 1], c = tri[t + 2];
        const ax = coords[a * 2], az = coords[a * 2 + 1];
        const bx = coords[bb * 2], bz = coords[bb * 2 + 1];
        const qx = coords[c * 2], qz = coords[c * 2 + 1];
        // normal +y requires (b-a) x (c-a) to have positive y
        const cr = (bz - az) * (qx - ax) - (bx - ax) * (qz - az);
        if (cr >= 0) B.idx.push(map[a], map[bb], map[c]);
        else B.idx.push(map[a], map[c], map[bb]);
      }
    } else if (roofKind === 1) {
      // hipped roof over a quadrilateral
      const { xs, zs } = outer;
      const e0 = Math.hypot(xs[1] - xs[0], zs[1] - zs[0]);
      const e1 = Math.hypot(xs[2] - xs[1], zs[2] - zs[1]);
      const s = e0 >= e1 ? 0 : 1; // long edge starts at corner s
      const c = [0, 1, 2, 3].map((i) => (i + s) % 4);
      const L = Math.max(e0, e1), W = Math.min(e0, e1);
      const ax = (xs[c[1]] - xs[c[0]]) / L, az = (zs[c[1]] - zs[c[0]]) / L;
      const mA = [(xs[c[3]] + xs[c[0]]) / 2, (zs[c[3]] + zs[c[0]]) / 2];
      const mB = [(xs[c[1]] + xs[c[2]]) / 2, (zs[c[1]] + zs[c[2]]) / 2];
      const inset = Math.min(W / 2, L / 2 - 1);
      const r0 = [mA[0] + ax * inset, mA[1] + az * inset];
      const r1 = [mB[0] - ax * inset, mB[1] - az * inset];
      const k0 = B.vert(xs[c[0]], eaveQ, zs[c[0]], 0, info, info2);
      const k1 = B.vert(xs[c[1]], eaveQ, zs[c[1]], 0, info, info2);
      const k2 = B.vert(xs[c[2]], eaveQ, zs[c[2]], 0, info, info2);
      const k3 = B.vert(xs[c[3]], eaveQ, zs[c[3]], 0, info, info2);
      const q0 = B.vert(r0[0], hq, r0[1], 0, info, info2);
      const q1 = B.vert(r1[0], hq, r1[1], 0, info, info2);
      const up = (a, bb, cc) => {
        const p = (i) => [B.pos[i * 4], B.pos[i * 4 + 1], B.pos[i * 4 + 2]];
        const A = p(a), Bv = p(bb), C = p(cc);
        const ux = Bv[0] - A[0], uy = Bv[1] - A[1], uz = Bv[2] - A[2];
        const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        const ny = uz * vx - ux * vz;
        void uy; void vy;
        if (ny >= 0) B.idx.push(a, bb, cc); else B.idx.push(a, cc, bb);
      };
      up(k0, k1, q1); up(k0, q1, q0);
      up(k1, k2, q1);
      up(k2, k3, q0); up(k2, q0, q1);
      up(k3, k0, q0);
    } else {
      // pyramid roof over a small convex polygon
      const { xs, zs } = outer;
      let mx = 0, mz = 0;
      for (let k = 0; k < xs.length; k++) { mx += xs[k]; mz += zs[k]; }
      mx /= xs.length; mz /= xs.length;
      const apex = B.vert(mx, hq, mz, 0, info, info2);
      const t = topStart[0];
      for (let k = 0; k < xs.length; k++) {
        const a = t + k, bb = t + k + 1;
        const ax = B.pos[a * 4], az = B.pos[a * 4 + 2];
        const bx = B.pos[bb * 4], bz = B.pos[bb * 4 + 2];
        const cr = (bz - az) * (mx - ax) - (bx - ax) * (mz - az);
        if (cr >= 0) B.idx.push(a, bb, apex); else B.idx.push(a, apex, bb);
      }
    }
  }
  flush('small');
  flush('big');
  return { cx, cz, batches };
}
