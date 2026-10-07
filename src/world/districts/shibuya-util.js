// Shibuya district: small geometry helpers on top of ./kit.js (walls per edge, path-following
// ribbons for curved screens, flat ground quads, mounted LED screens, block digits, figures).
import { PAT, ringEdges } from './kit.js';

export const DEG = Math.PI / 180;
/** unit vector (x, z) a compass bearing points to (x east, z south) */
export const dirOf = (b) => [Math.sin(b * DEG), -Math.cos(b * DEG)];
/** compass bearing of a direction (x, z) */
export const bearingOf = (x, z) => ((Math.atan2(x, -z) / DEG) % 360 + 360) % 360;

export const mat = (color, style) => ({ color, style });
export const plain = (color, rough = 0.8, metal = 0, glow = 0) => mat(color, [PAT.PLAIN, rough, metal, glow]);

/** deterministic PRNG in [0, 1) */
export function prng(seed) {
  let a = (Math.floor(seed * 7919) + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pointIn(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** distance from (x, z) to the outline of a ring */
export function ringDist(ring, x, z) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z));
  }
  return best;
}

/**
 * Vertical panel w x h centred at (x, y, z) whose front faces compass `bearing`, pushed `off`
 * along it; u, v run from its lower-left corner as seen from the front. (Kit.panel winds its
 * quad facing away from the bearing, so the district uses this one, built on Kit.quad.)
 */
export function panel(kit, x, y, z, bearing, w, h, color, style, off = 0.25, uo = 0) {
  const [nx, nz] = dirOf(bearing);
  const lx = -nz, lz = nx;                     // viewer's left when facing the panel
  const cx = x + nx * off, cz = z + nz * off;
  const keep = kit.uShift; kit.uShift = 0;
  kit.quad([cx + lx * w / 2, y - h / 2, cz + lz * w / 2], [cx - lx * w / 2, y - h / 2, cz - lz * w / 2],
    [cx - lx * w / 2, y + h / 2, cz - lz * w / 2], [cx + lx * w / 2, y + h / 2, cz + lz * w / 2], color, style,
    [[uo, 0], [uo + w, 0], [uo + w, h], [uo, h]]);
  kit.uShift = keep;
}

/** vertical quad along a -> b ([x, z]) facing the outward normal n, pushed out by `off` */
export function wallQuad(kit, a, b, n, y0, y1, color, style, u0 = 0, off = 0, localV = false) {
  const ax = a[0] + n[0] * off, az = a[1] + n[1] * off, bx = b[0] + n[0] * off, bz = b[1] + n[1] * off;
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-3 || y1 - y0 < 1e-3) return;
  const flip = (n[0] * -(bz - az) + n[1] * (bx - ax)) < 0;
  const A = flip ? [bx, bz] : [ax, az], B = flip ? [ax, az] : [bx, bz];
  const v0 = localV ? 0 : y0, v1 = localV ? y1 - y0 : y1;
  kit.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], color, style,
    [[u0, v0], [u0 + len, v0], [u0 + len, v1], [u0, v1]]);
}

/** walls of a ring with a material per edge: pick(edge, i) -> {color, style} | null */
export function walls(kit, ring, y0, y1, pick) {
  let u = 0;
  ringEdges(ring).forEach((e, i) => {
    const m = typeof pick === 'function' ? pick(e, i) : pick;
    if (m) wallQuad(kit, e.a, e.b, e.n, y0, y1, m.color, m.style, u);
    u += e.len;
  });
}

/** stretch [u0, u1] (m along the edge) of an edge, as a wall quad pushed out by off */
export function edgeStrip(kit, e, u0, u1, y0, y1, color, style, off = 0.15, localUV = false, uo = 0) {
  const a = [e.a[0] + e.dir[0] * u0, e.a[1] + e.dir[1] * u0];
  const b = [e.a[0] + e.dir[0] * u1, e.a[1] + e.dir[1] * u1];
  if (localUV) {
    const keep = kit.uShift; kit.uShift = 0;
    wallQuad(kit, a, b, e.n, y0, y1, color, style, uo, off, true);
    kit.uShift = keep;
  } else wallQuad(kit, a, b, e.n, y0, y1, color, style, u0, off);
}

/**
 * Ribbon following an open path along a facade (curved screens, banners): pts [[x, z], ...],
 * ns outward normal per segment; only the stretch [from, to] (m along the path) is drawn; u, v
 * start at 0 at (from, y0) so SCREEN / SIGNS content spans the whole ribbon.
 */
export function ribbon(kit, pts, ns, y0, y1, off, color, style, from = 0, to = Infinity, uo = 0) {
  const P = pts.map((p, i) => {
    const n0 = ns[Math.max(0, i - 1)], n1 = ns[Math.min(ns.length - 1, i)];
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = off / Math.max(0.5, mx * n1[0] + mz * n1[1]);
    return [p[0] + mx * k, p[1] + mz * k];
  });
  const keep = kit.uShift; kit.uShift = 0;
  let u = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const s0 = Math.max(u, from), s1 = Math.min(u + L, to);
    if (L > 1e-4 && s1 > s0 + 1e-3) {
      const t0 = (s0 - u) / L, t1 = (s1 - u) / L;
      const A = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const B = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const n = ns[i];
      const flip = (n[0] * -(B[1] - A[1]) + n[1] * (B[0] - A[0])) < 0;
      const u0 = s0 - from + uo, u1 = s1 - from + uo, h = y1 - y0;
      if (!flip) kit.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], color, style, [[u0, 0], [u1, 0], [u1, h], [u0, h]]);
      else kit.quad([B[0], y0, B[1]], [A[0], y0, A[1]], [A[0], y1, A[1]], [B[0], y1, B[1]], color, style, [[u1, 0], [u0, 0], [u0, h], [u1, h]]);
    }
    u += L;
  }
  kit.uShift = keep;
  return u;
}

/** points and outward normals of an arc of a circle (bearings b0 -> b1, clockwise) */
export function arcPath(cx, cz, r, b0, b1, seg = 10) {
  const pts = [], ns = [];
  for (let i = 0; i <= seg; i++) {
    const [dx, dz] = dirOf(b0 + ((b1 - b0) * i) / seg);
    pts.push([cx + dx * r, cz + dz * r]);
  }
  for (let i = 0; i < seg; i++) {
    const [dx, dz] = dirOf(b0 + ((b1 - b0) * (i + 0.5)) / seg);
    ns.push([dx, dz]);
  }
  return { pts, ns };
}

/** horizontal rectangle (facing up) centred at (cx, cz): half-length hu along unit (ux, uz), half-width hv */
export function flatRect(kit, cx, cz, ux, uz, hu, hv, y, color, style) {
  const vx = uz, vz = -ux;   // u x v points up
  const c = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([a, b]) => [cx + ux * a + vx * b, y, cz + uz * a + vz * b]);
  kit.quad(c[0], c[1], c[2], c[3], color, style, c.map((p) => [p[0], p[2]]));
}

/** horizontal quad between two segments (a0 -> a1 on one side, b0 -> b1 on the other) */
export function flatQuad(kit, p, y, color, style) {
  // p: 4 corners [x, z]; orient so the normal points up
  const cross = (p[1][0] - p[0][0]) * (p[3][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[3][0] - p[0][0]);
  const q = cross < 0 ? p : [p[0], p[3], p[2], p[1]];
  kit.quad(...q.map(([x, z]) => [x, y, z]), color, style, q.map(([x, z]) => [x, z]));
}

/**
 * LED screen of w x h whose bottom is at `bottom`, centred on the wall point (x, z) facing
 * `bearing`: a dark casing box `depth` deep standing `gap` off the wall, the SCREEN quad 0.12 m in
 * front of it, and a dark back so a free-standing (rooftop) screen reads from behind too.
 */
export function mountedScreen(kit, x, z, bearing, w, h, bottom, seed, { depth = 0.5, gap = 0.08, casingFrom = null, casingLen = null, back = false, glowSeed = null } = {}) {
  const [nx, nz] = dirOf(bearing);
  const ang = bearing * DEG;
  const bx = x + nx * (gap + depth / 2), bz = z + nz * (gap + depth / 2);
  const y0 = casingFrom ?? bottom - 0.25;
  const casing = plain('#16171a', 0.6, 0.4);
  kit.box(bx, bz, casingLen ?? w + 0.4, depth, y0, bottom + h + 0.25, ang, casing, casing);
  const off = gap + depth + 0.12;
  panel(kit, x, bottom + h / 2, z, bearing, w, h, '#202020', [PAT.SCREEN, glowSeed ?? seed, w, h], off);
  if (back) panel(kit, x, bottom + h / 2, z, (bearing + 180) % 360, w + 0.4, h + 0.5, '#1d1e21', [PAT.PLAIN, 0.7, 0.3, 0], -(gap - 0.02));
}

// block digits for signs: rectangles [x0, y0, x1, y1] in a unit cell
const GLYPH = {
  1: [[0.38, 0, 0.64, 1], [0.12, 0.74, 0.38, 0.9]],
  0: [[0, 0, 0.26, 1], [0.74, 0, 1, 1], [0.26, 0, 0.74, 0.18], [0.26, 0.82, 0.74, 1]],
  9: [[0.74, 0, 1, 1], [0, 0.44, 0.26, 1], [0.26, 0.82, 0.74, 1], [0.26, 0.44, 0.74, 0.6], [0, 0, 0.74, 0.17]],
};
/** a block digit of w x h centred at (x, y, z) on a plane facing `bearing`, pushed out by off */
export function digit(kit, ch, x, y, z, bearing, w, h, m, off) {
  const [tx, tz] = [-Math.cos(bearing * DEG), -Math.sin(bearing * DEG)];   // viewer's right
  for (const [x0, y0, x1, y1] of GLYPH[ch] || []) {
    const cx = (x0 + x1) / 2 - 0.5, cy = (y0 + y1) / 2 - 0.5;
    panel(kit, x + tx * cx * w, y + cy * h, z + tz * cx * w, bearing, (x1 - x0) * w, (y1 - y0) * h, m.color, m.style, off);
  }
}

// printed / backlit billboard palettes: background, picture, lettering
const POSTERS = [
  ['#e8317a', '#ffd3e6', '#ffffff'],
  ['#1d4ed8', '#a5d8ff', '#ffffff'],
  ['#f2c40f', '#262626', '#1a1a1a'],
  ['#151515', '#e23b3b', '#ffffff'],
  ['#7a2fe0', '#f6c2ff', '#ffffff'],
  ['#0f9f9a', '#e8fff8', '#ffffff'],
  ['#f4f1ea', '#d92d6b', '#222222'],
];
/** a billboard of w x h (centre x, y, z) facing `bearing`: backlit ground, picture, lettering */
export function poster(kit, x, y, z, bearing, w, h, k, off = 0.2) {
  const [bg, img, txt] = POSTERS[((k % POSTERS.length) + POSTERS.length) % POSTERS.length];
  const [nx, nz] = dirOf(bearing);
  const rx = nz, rz = -nx;                     // viewer's right
  panel(kit, x, y, z, bearing, w, h, bg, [PAT.PLAIN, 0.6, 0, 0.5], off);
  const s = k % 2 ? 1 : -1;
  const at = (dx, dy) => [x + rx * dx * w, y + dy * h, z + rz * dx * w];
  const [ix, iy, iz] = at(s * 0.2, 0.04);
  panel(kit, ix, iy, iz, bearing, w * 0.5, h * 0.78, img, [PAT.PLAIN, 0.5, 0, 0.6], off + 0.15);
  [[0.3, 0.3], [0.22, 0.16], [0.26, 0.02]].forEach(([lw, dy]) => {
    const [tx, ty, tz] = at(-s * 0.27, dy);
    panel(kit, tx, ty, tz, bearing, w * lw, h * 0.06, txt, [PAT.PLAIN, 0.5, 0, 0.8], off + 0.15);
  });
  const [lx, ly, lz] = at(-s * 0.3, -0.3);
  panel(kit, lx, ly, lz, bearing, Math.min(w, h) * 0.18, Math.min(w, h) * 0.18, img, [PAT.PLAIN, 0.5, 0, 0.7], off + 0.15);
}

/** a poster wrapped on a cylinder (arc b0 -> b1 at radius r) */
export function posterArc(kit, cx, cz, r, b0, b1, y0, y1, k) {
  const [bg, img, txt] = POSTERS[k % POSTERS.length];
  const a = arcPath(cx, cz, r, b0, b1, 8), a2 = arcPath(cx, cz, r + 0.15, b0, b1, 8);
  const L = ((b1 - b0) * DEG) * (r + 0.15), h = y1 - y0;
  ribbon(kit, a.pts, a.ns, y0, y1, 0, bg, [PAT.PLAIN, 0.6, 0, 0.5]);
  ribbon(kit, a2.pts, a2.ns, y0 + h * 0.3, y1 - h * 0.05, 0, img, [PAT.PLAIN, 0.5, 0, 0.6], L * 0.12, L * 0.88);
  for (const [f0, f1, yy] of [[0.15, 0.85, 0.2], [0.25, 0.75, 0.13], [0.3, 0.7, 0.07]]) {
    ribbon(kit, a2.pts, a2.ns, y0 + h * yy, y0 + h * (yy + 0.035), 0, txt, [PAT.PLAIN, 0.5, 0, 0.8], L * f0, L * f1);
  }
}

const CLOTHES = ['#1b1c20', '#26282e', '#3a3d44', '#e9e6df', '#2c3a55', '#5b4636', '#7d2a2a', '#c9b79c', '#111214', '#4a5a3a', '#d8d4cc', '#8a8f96'];
/** a standing figure (body + head), ~1.7 m */
export function person(kit, x, z, rnd, y0 = 0) {
  const h = 1.5 + rnd() * 0.3;
  const a = rnd() * Math.PI;
  const c = CLOTHES[Math.floor(rnd() * CLOTHES.length)];
  const m = plain(c, 0.9);
  kit.box(x, z, 0.46, 0.28, y0, y0 + h - 0.25, a, m, m);
  const hm = plain(rnd() < 0.7 ? '#1a1612' : '#5a4632', 0.9);
  kit.box(x, z, 0.2, 0.22, y0 + h - 0.25, y0 + h, a, hm, hm);
}

/** simple low-poly broadleaf tree (trunk + two-tier crown) */
export function tree(kit, x, z, s, rnd) {
  const trunk = plain('#4a3b2c', 0.95);
  kit.box(x, z, 0.32 * s, 0.32 * s, 0, 3.0 * s, rnd() * 3, trunk, trunk);
  // zelkova: a broad, rounded crown (sloped bands between rings, jittered radii)
  const g = plain(rnd() < 0.5 ? '#5d7f3c' : '#668a42', 0.95);
  const seg = 9, ph = rnd() * 3;
  const prof = [[0.45, 2.7], [0.95, 3.6], [1.0, 4.9], [0.72, 6.0], [0.3, 6.6]];
  const rings = prof.map(([f, y]) => {
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = ph + (i / seg) * Math.PI * 2, rr = 2.6 * s * f * (0.88 + 0.24 * rnd());
      pts.push([x + Math.cos(a) * rr, y * s, z + Math.sin(a) * rr]);
    }
    return pts;
  });
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      // outward: counter-clockwise seen from outside (angles grow towards +z = clockwise from above)
      kit.quad(A[j], A[i], B[i], B[j], g.color, g.style);
    }
  }
  kit.cap(rings[0].map((p) => [p[0], p[2]]), rings[0][0][1], g.color, g.style, true);
  kit.cap(rings[rings.length - 1].map((p) => [p[0], p[2]]), rings[rings.length - 1][0][1], g.color, g.style);
}

export function polyRing(cx, cz, r, seg, phase = 0) {
  const ring = [];
  for (let i = 0; i < seg; i++) {
    const a = phase + (i / seg) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return ring;
}
