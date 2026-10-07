// Geometry helpers for the Akihabara district (on top of ./kit.js): correctly facing panels,
// sloped boxes, beams between two 3D points, triangles and per-edge walls.
import { PAT, ringEdges, ringArea } from './kit.js';

export const st = (color, pat, p1 = 0, p2 = 0, p3 = 0) => ({ color, style: [pat, p1, p2, p3] });
export const plain = (color, rough = 0.85, metal = 0, glow = 0) => st(color, PAT.PLAIN, rough, metal, glow);

export function rnd(i) {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Vertical quad facing compass `bearing`, centre (x, y, z), width w, height h; `off` pushes it out
 * along the facing direction. Seen from the front, u runs left -> right (SCREEN/SIGNS patterns).
 */
export function panel(kit, x, y, z, bearing, w, h, m, off = 0.3) {
  const b = (bearing * Math.PI) / 180;
  const nx = Math.sin(b), nz = -Math.cos(b);
  const tx = -Math.cos(b), tz = -Math.sin(b);
  const cx = x + nx * off, cz = z + nz * off;
  const keep = kit.uShift; kit.uShift = 0;
  kit.quad([cx - tx * w / 2, y - h / 2, cz - tz * w / 2], [cx + tx * w / 2, y - h / 2, cz + tz * w / 2],
    [cx + tx * w / 2, y + h / 2, cz + tz * w / 2], [cx - tx * w / 2, y + h / 2, cz - tz * w / 2], m.color, m.style,
    [[0, 0], [w, 0], [w, h], [0, h]]);
  kit.uShift = keep;
}

export function tri(kit, a, b, c, m, uv) {
  kit.quad(a, b, c, c, m.color, m.style, uv ? [uv[0], uv[1], uv[2], uv[2]] : undefined);
}

/**
 * Box along the horizontal segment a -> b ([x, z]) with thickness `thick` across it and a
 * bottom/top that may slope (y0a..y1a at a, y0b..y1b at b). u runs in metres along a -> b.
 */
export function sbox(kit, a, b, thick, y0a, y1a, y0b, y1b, side, top = side, ends = true, bottom = true) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || 1;
  const tx = dx / L, tz = dz / L;
  const nx = -tz * thick / 2, nz = tx * thick / 2;
  const A = (s, y) => [a[0] + nx * s, y, a[1] + nz * s];
  const B = (s, y) => [b[0] + nx * s, y, b[1] + nz * s];
  kit.quad(A(1, y0a), B(1, y0b), B(1, y1b), A(1, y1a), side.color, side.style, [[0, y0a], [L, y0b], [L, y1b], [0, y1a]]);
  kit.quad(B(-1, y0b), A(-1, y0a), A(-1, y1a), B(-1, y1b), side.color, side.style, [[0, y0b], [L, y0a], [L, y1a], [0, y1b]]);
  kit.quad(A(-1, y1a), A(1, y1a), B(1, y1b), B(-1, y1b), top.color, top.style, [[0, 0], [thick, 0], [thick, L], [0, L]]);
  if (bottom) kit.quad(A(1, y0a), A(-1, y0a), B(-1, y0b), B(1, y0b), side.color, side.style);
  if (ends) {
    kit.quad(A(-1, y0a), A(1, y0a), A(1, y1a), A(-1, y1a), side.color, side.style, [[0, y0a], [thick, y0a], [thick, y1a], [0, y1a]]);
    kit.quad(B(1, y0b), B(-1, y0b), B(-1, y1b), B(1, y1b), side.color, side.style, [[0, y0b], [thick, y0b], [thick, y1b], [0, y1b]]);
  }
}

/** Rectangular beam between 3D points p and q: width w (horizontal), height h; 4 long faces. */
export function beam(kit, p, q, w, h, m) {
  let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const L = Math.hypot(dx, dy, dz) || 1;
  dx /= L; dy /= L; dz /= L;
  // side = d x up (horizontal), up' = side x d
  let sx = -dz, sy = 0, sz = dx;
  let sl = Math.hypot(sx, sz);
  if (sl < 1e-4) { sx = 1; sz = 0; sl = 1; }
  sx /= sl; sz /= sl;
  const ux = sy * dz - sz * dy, uy = sz * dx - sx * dz, uz = sx * dy - sy * dx;
  const P = (s, u, e) => [e[0] + sx * s * w / 2 + ux * u * h / 2, e[1] + sy * s * w / 2 + uy * u * h / 2, e[2] + sz * s * w / 2 + uz * u * h / 2];
  kit.quad(P(1, -1, p), P(1, -1, q), P(1, 1, q), P(1, 1, p), m.color, m.style, [[0, 0], [L, 0], [L, h], [0, h]]);
  kit.quad(P(-1, -1, q), P(-1, -1, p), P(-1, 1, p), P(-1, 1, q), m.color, m.style, [[0, 0], [L, 0], [L, h], [0, h]]);
  kit.quad(P(-1, 1, p), P(1, 1, p), P(1, 1, q), P(-1, 1, q), m.color, m.style, [[0, 0], [w, 0], [w, L], [0, L]]);
  kit.quad(P(1, -1, p), P(-1, -1, p), P(-1, -1, q), P(1, -1, q), m.color, m.style, [[0, 0], [w, 0], [w, L], [0, L]]);
}

/** Walls along a ring with a material chosen per edge: fn(edge, index) -> {color, style} or null. */
export function wallsBy(kit, ring, y0, y1, fn) {
  let u = 0;
  ringEdges(ring).forEach((e, i) => {
    const m = fn(e, i);
    if (m) {
      const [ax, az] = e.a, [bx, bz] = e.b;
      const flip = (e.n[0] * -(bz - az) + e.n[1] * (bx - ax)) < 0;
      const A = flip ? [bx, bz] : [ax, az], B = flip ? [ax, az] : [bx, bz];
      kit.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], m.color, m.style,
        [[u, y0], [u + e.len, y0], [u + e.len, y1], [u, y1]]);
    }
    u += e.len;
  });
}

/** Inside faces of the walls along a ring (for open cages / courtyards seen from within). */
export function wallsIn(kit, ring, y0, y1, m) {
  for (const e of ringEdges(ring)) {
    const [ax, az] = e.a, [bx, bz] = e.b;
    const flip = (e.n[0] * -(bz - az) + e.n[1] * (bx - ax)) < 0;
    const A = flip ? [bx, bz] : [ax, az], B = flip ? [ax, az] : [bx, bz];
    kit.quad([B[0], y0, B[1]], [A[0], y0, A[1]], [A[0], y1, A[1]], [B[0], y1, B[1]], m.color, m.style,
      [[0, y0], [e.len, y0], [e.len, y1], [0, y1]]);
  }
}

/** Facade bearing (deg, compass) of an outward normal [nx, nz]. */
export const bearingOf = (n) => ((Math.atan2(n[0], -n[1]) * 180) / Math.PI + 360) % 360;

/** Nearest point on a polyline [[x, z], ...] to (x, z): { x, z, d, i, t } */
export function nearestOn(pts, x, z) {
  let best = { d: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { x: px, z: pz, d, i, t };
  }
  return best;
}

export { ringArea };
