// Geometry helpers for the Tokyo Station district (see ./tokyostation.js): lofted roofs between
// rings, octagons in a local frame, arched openings, simple trains. Everything goes into the
// district Kit (one mesh).
import { PAT, ringArea, ringEdges, insetRing } from './kit.js';

export const DEG = Math.PI / 180;

/** Local frame of a long building: s along `bearing` (deg), t towards bearing - 90 (left). */
export function makeFrame(cx, cz, bearingDeg) {
  const b = bearingDeg * DEG;
  const ax = [Math.sin(b), -Math.cos(b)];               // along the axis (x east, z south)
  const lw = [-Math.cos(b), -Math.sin(b)];              // left of the axis = bearing - 90
  return {
    ax, lw, bearing: bearingDeg,
    P: (s, t) => [cx + s * ax[0] + t * lw[0], cz + s * ax[1] + t * lw[1]],
    ring: (pts) => pts.map(([s, t]) => [cx + s * ax[0] + t * lw[0], cz + s * ax[1] + t * lw[1]]),
  };
}

/** Regular polygon ring (n sides) of apothem a around (s, t) in frame F; flats face +-s/+-t for n=8. */
export function polyRing(F, s, t, a, n = 8) {
  const r = a / Math.cos(Math.PI / n);
  const out = [];
  for (let k = 0; k < n; k++) {
    const ang = Math.PI / n + (k * 2 * Math.PI) / n;
    out.push(F.P(s + r * Math.cos(ang), t + r * Math.sin(ang)));
  }
  return out;
}

/** Kit.cap / prism / box / slab as plain functions of the kit. */
export const cap = (kit, ...a) => kit.cap(...a);
export const prism = (kit, ...a) => kit.prism(...a);
export const box = (kit, ...a) => kit.box(...a);
export const slab = (kit, ...a) => kit.slab(...a);

/** Sloped band between ring A at yA and ring B at yB (same vertex count), facing outwards. */
export function loft(kit, A, yA, B, yB, color, style) {
  const flip = ringArea(A) > 0;
  const n = A.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = A[i], a1 = A[j], b0 = B[i], b1 = B[j];
    const len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
    if (len < 1e-3) continue;
    const slope = Math.hypot((b0[0] + b1[0] - a0[0] - a1[0]) / 2, yB - yA, (b0[1] + b1[1] - a0[1] - a1[1]) / 2);
    if (flip) {
      kit.quad([a1[0], yA, a1[1]], [a0[0], yA, a0[1]], [b0[0], yB, b0[1]], [b1[0], yB, b1[1]], color, style,
        [[u, 0], [u + len, 0], [u + len, slope], [u, slope]]);
    } else {
      kit.quad([a0[0], yA, a0[1]], [a1[0], yA, a1[1]], [b1[0], yB, b1[1]], [b0[0], yB, b0[1]], color, style,
        [[u, 0], [u + len, 0], [u + len, slope], [u, slope]]);
    }
    u += len;
  }
}

/** Hipped / mansard roof: lofts through [inset, y] steps from the eave ring, flat cap on top. */
export function hipRoof(kit, ring, y0, steps, color, style, capColor = color, capStyle = style) {
  let prev = ring, py = y0;
  for (const [d, y] of steps) {
    const nx = insetRing(ring, d);
    loft(kit, prev, py, nx, y, color, style);
    prev = nx; py = y;
  }
  cap(kit, prev, py, capColor, capStyle);
}

/** Thin outward ledge (cornice / plinth): walls of the ring grown by `out`, from y0 to y1, + cap. */
export function ledge(kit, ring, out, y0, y1, color, style, withCap = true) {
  const r = insetRing(ring, -out);
  kit.walls(r, y0, y1, color, style);
  if (withCap) cap(kit, r, y1, color, style);
  return r;
}

/**
 * Arched opening (rectangle + half-disc top) of width w, total height h, bottom at y0, centred on
 * the wall point (x, z), facing compass `bearing`, pushed `off` m out of the wall.
 */
export function arch(kit, x, z, bearing, w, h, y0, color, style, off = 0.18, seg = 6) {
  const b = bearing * DEG;
  const nx = Math.sin(b), nz = -Math.cos(b);
  const tx = -nz, tz = nx;
  const cx = x + nx * off, cz = z + nz * off;
  const inside = [x - nx * 2, y0 + h / 2, z - nz * 2];
  const r = w / 2, ys = y0 + h - r;
  const P = (a, y) => [cx + tx * a, y, cz + tz * a];
  oquad(kit, inside, P(-r, y0), P(r, y0), P(r, ys), P(-r, ys), color, style, [[0, 0], [w, 0], [w, ys - y0], [0, ys - y0]]);
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI, a1 = ((k + 1) / seg) * Math.PI;
    oquad(kit, inside, P(0, ys), P(r * Math.cos(a0), ys + r * Math.sin(a0)), P(r * Math.cos(a1), ys + r * Math.sin(a1)),
      P(r * Math.cos(a1), ys + r * Math.sin(a1)), color, style);
  }
}

/**
 * Vertical panel like Kit.panel (centre x, y, z; faces compass `bearing`; pushed `off` out of the
 * wall) but wound so its front really faces `bearing` (u runs left to right seen from the front).
 */
export function panelOut(kit, x, y, z, bearing, w, h, color, style, off = 0.25) {
  const b = bearing * DEG;
  const nx = Math.sin(b), nz = -Math.cos(b);
  const rx = nz, rz = -nx;                               // right-hand direction seen from the front
  const cx = x + nx * off, cz = z + nz * off;
  const keep = kit.uShift; kit.uShift = 0;
  kit.quad([cx - rx * w / 2, y - h / 2, cz - rz * w / 2], [cx + rx * w / 2, y - h / 2, cz + rz * w / 2],
    [cx + rx * w / 2, y + h / 2, cz + rz * w / 2], [cx - rx * w / 2, y + h / 2, cz - rz * w / 2], color, style,
    [[0, 0], [w, 0], [w, h], [0, h]]);
  kit.uShift = keep;
}

/** Points along a polyline [[x,z],...] at distance d: { p:[x,z], dir:[dx,dz] }. */
export function along(pts, d) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    if (acc + L >= d || i === pts.length - 2) {
      const t = Math.min(1, Math.max(0, (d - acc) / L));
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
    }
    acc += L;
  }
  return { p: pts[0], dir: [1, 0] };
}

export function polyLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
}

/** Quad whose winding is chosen so its normal points away from `inside` ([x, y, z]). */
export function oquad(kit, inside, p0, p1, p2, p3, color, style, uv) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  if (Math.hypot(nx, ny, nz) < 1e-9) {       // degenerate first corner: use the other diagonal
    const cx = p2[0] - p0[0], cy = p2[1] - p0[1], cz = p2[2] - p0[2];
    nx = ay * cz - az * cy; ny = az * cx - ax * cz; nz = ax * cy - ay * cx;
  }
  const mx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4 - inside[0];
  const my = (p0[1] + p1[1] + p2[1] + p3[1]) / 4 - inside[1];
  const mz = (p0[2] + p1[2] + p2[2] + p3[2]) / 4 - inside[2];
  if (nx * mx + ny * my + nz * mz >= 0) kit.quad(p0, p1, p2, p3, color, style, uv);
  else kit.quad(p3, p2, p1, p0, color, style, uv && [uv[3], uv[2], uv[1], uv[0]]);
}

/**
 * Box between two ground points p0 -> p1 (centreline), half width hw, y0..y1, side walls split into
 * horizontal colour bands [[v0, v1, color, style], ...] (v in 0..1 of the height): liveries.
 */
export function bandedBox(kit, p0, p1, hw, y0, y1, bands, roof, ends) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const L = Math.hypot(dx, dz) || 1;
  const nx = -dz / L, nz = dx / L;
  const H = y1 - y0;
  const inside = [(p0[0] + p1[0]) / 2, (y0 + y1) / 2, (p0[1] + p1[1]) / 2];
  const c = (p, s) => [p[0] + nx * hw * s, p[1] + nz * hw * s];
  const l0 = c(p0, 1), l1 = c(p1, 1), r0 = c(p0, -1), r1 = c(p1, -1);
  for (const [v0, v1, col, sty] of bands) {
    const ya = y0 + v0 * H, yb = y0 + v1 * H;
    const uv = [[0, ya - y0], [L, ya - y0], [L, yb - y0], [0, yb - y0]];
    oquad(kit, inside, [l0[0], ya, l0[1]], [l1[0], ya, l1[1]], [l1[0], yb, l1[1]], [l0[0], yb, l0[1]], col, sty, uv);
    oquad(kit, inside, [r0[0], ya, r0[1]], [r1[0], ya, r1[1]], [r1[0], yb, r1[1]], [r0[0], yb, r0[1]], col, sty, uv);
  }
  oquad(kit, inside, [r0[0], y1, r0[1]], [r1[0], y1, r1[1]], [l1[0], y1, l1[1]], [l0[0], y1, l0[1]], roof.color, roof.style);
  if (ends) {
    if (ends.start !== false) oquad(kit, inside, [l0[0], y0, l0[1]], [r0[0], y0, r0[1]], [r0[0], y1, r0[1]], [l0[0], y1, l0[1]], ends.color, ends.style);
    if (ends.end !== false) oquad(kit, inside, [r1[0], y0, r1[1]], [l1[0], y0, l1[1]], [l1[0], y1, l1[1]], [r1[0], y1, r1[1]], ends.color, ends.style);
  }
}

/**
 * Tapered nose (Shinkansen / cab front) from the full section at `base` running `len` m along
 * `dir`: the roof slopes down to a tip at `tipH` of the body height; sides narrow to `tipW`.
 */
export function nose(kit, base, dir, hw, y0, y1, len, tipH, tipW, body, glass, lower = body) {
  const nx = -dir[1], nz = dir[0];
  const tip = [base[0] + dir[0] * len, base[1] + dir[1] * len];
  const yT = y0 + (y1 - y0) * tipH;
  const mid = [base[0] + dir[0] * len * 0.4, base[1] + dir[1] * len * 0.4];
  const yM = y0 + (y1 - y0) * 0.86, wM = hw * 0.93;
  const inside = [base[0] + dir[0] * len * 0.3, y0 + (y1 - y0) * 0.3, base[1] + dir[1] * len * 0.3];
  const P = (p, s, w, y) => [p[0] + nx * w * s, y, p[1] + nz * w * s];
  const BL = P(base, 1, hw, y0), BR = P(base, -1, hw, y0), TL = P(base, 1, hw, y1), TR = P(base, -1, hw, y1);
  const ML = P(mid, 1, wM, y0), MR = P(mid, -1, wM, y0), MTL = P(mid, 1, wM * 0.78, yM), MTR = P(mid, -1, wM * 0.78, yM);
  const XL = P(tip, 1, tipW, y0), XR = P(tip, -1, tipW, y0), XT = P(tip, 0, 0, yT);
  oquad(kit, inside, BL, ML, MTL, TL, lower.color, lower.style);
  oquad(kit, inside, BR, MR, MTR, TR, lower.color, lower.style);
  oquad(kit, inside, ML, XL, XT, MTL, body.color, body.style);
  oquad(kit, inside, MR, XR, XT, MTR, body.color, body.style);
  oquad(kit, inside, TL, TR, MTR, MTL, glass.color, glass.style);
  oquad(kit, inside, MTL, MTR, XT, XT, body.color, body.style);
  oquad(kit, inside, XL, XR, XT, XT, body.color, body.style);
}

export { PAT, ringEdges };
