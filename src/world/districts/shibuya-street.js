// Shibuya street scene: the scramble crossing (five crosswalks, one diagonal), Hachiko square,
// the Ginza line viaduct into Mark City and its M-arch station over Meiji-dori, the Center Gai
// gate, the LED screens around the crossing and the sign streets.
import { PAT, ringEdges, insetRing } from './kit.js';
import { mainRing } from './shibuya-heroes.js';
import {
  DEG, dirOf, bearingOf, plain, mat, prng, pointIn, ringDist, flatRect, flatQuad, mountedScreen, person, tree,
  polyRing, panel,
} from './shibuya-util.js';

const hashStr = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 100003; return h; };

// ------------------------------------------------------------------ crossing
/** convex hull of [x, z] points (monotone chain) */
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

const ASPHALT_Y = 0.66, PAINT_Y = 0.72;   // clear of the road ribbons (<= 0.48 m + their polygon offset)

export function crossing(kit, d, blockers) {
  const cws = d.street.filter((s) => s.type === 'crosswalk' && s.points && s.points.length >= 2);
  if (!cws.length) return;
  kit.seed(31);
  const asphalt = plain('#56585c', 0.8, 0, 0.35);
  const paint = plain('#e6e6e0', 0.75, 0, 0.12);
  // one clean asphalt box over the junction (hides the fragmentary mapped crosswalks and lane
  // arrows underneath), the perimeter crosswalks form its edges
  const main = cws.filter((c) => !/diagonal|aux/.test(c.id || ''));
  const box = hull(main.flatMap((c) => c.points));
  if (box.length >= 3) flatQuadFan(kit, box, ASPHALT_Y, asphalt);
  const rnd = prng(31);
  for (const c of cws) {
    const [a, b] = c.points;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 2) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const w = c.width || 8;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    // asphalt under the paint (same plane and material as the box: no fighting where they overlap)
    flatRect(kit, mx, mz, ux, uz, L / 2 + 0.6, w / 2 + 0.6, ASPHALT_Y, asphalt.color, asphalt.style);
    // Japanese zebra: 45 cm bars, 45 cm gaps, bars lie across the walking direction
    const n = Math.floor((L - 0.6) / 0.9);
    const s0 = -((n - 1) * 0.9) / 2;
    for (let i = 0; i < n; i++) {
      const s = s0 + i * 0.9;
      flatRect(kit, mx + ux * s, mz + uz * s, -uz, ux, w / 2, 0.225, PAINT_Y, paint.color, paint.style);
    }
    // crowds waiting on the kerb at both ends
    const big = /diagonal/.test(c.id || '') ? 1.5 : 1;
    for (const [e, sgn] of [[a, -1], [b, 1]]) {
      const cnt = Math.round((22 + rnd() * 16) * big * (w / 8));
      for (let k = 0; k < cnt; k++) {
        const along = 0.9 + rnd() * 3.2, across = (rnd() - 0.5) * (w + 1);
        const x = e[0] + ux * sgn * along + -uz * across, z = e[1] + uz * sgn * along + ux * across;
        if (blockers(x, z, 0.6)) continue;
        if (box.length >= 3 && pointIn(box, x, z)) continue;
        person(kit, x, z, rnd, 0);
      }
    }
  }
}

/** horizontal convex polygon as a triangle fan (facing up) */
function flatQuadFan(kit, ring, y, m) {
  kit.cap(ring, y, m.color, m.style);
}

// ------------------------------------------------------------------ Hachiko square
export function hachikoSquare(kit, sq, blockers) {
  if (!sq || !sq.points || sq.points.length < 3) return;
  kit.seed(32);
  const ring = sq.points;
  kit.cap(ring, 0.04, '#9c9a94', [PAT.STONE, 1.2, 0.6, 0]);
  // the statue: bronze Akita dog sitting on a stone plinth, facing the crossing
  const cx = sq.x, cz = sq.z;
  let sx = cx, sz = cz;
  for (let k = 0; k < 30 && (!pointIn(ring, sx, sz) || ringDist(ring, sx, sz) < 4 || blockers(sx, sz, 2)); k++) {
    // walk towards the square's middle until clear
    const [mx, mz] = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
    sx += (mx - sx) * 0.15; sz += (mz - sz) * 0.15;
  }
  const stone = plain('#8e8d88', 0.85), bronze = plain('#4d3f31', 0.45, 0.6);
  kit.box(sx, sz, 1.7, 1.1, 0, 1.45, 0.3, stone, stone);
  const ang = 0.3;
  const ux = Math.cos(ang), uz = Math.sin(ang);
  kit.box(sx - ux * 0.2, sz - uz * 0.2, 0.75, 0.42, 1.45, 2.05, ang, bronze, bronze);   // haunches + body
  kit.box(sx + ux * 0.22, sz + uz * 0.22, 0.32, 0.36, 1.45, 2.35, ang, bronze, bronze); // chest, front legs
  kit.box(sx + ux * 0.32, sz + uz * 0.32, 0.36, 0.28, 2.3, 2.62, ang, bronze, bronze);  // head
  const rnd = prng(8);
  // zelkova trees with seating rings, people meeting at the statue
  const [mx, mz] = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
  let placed = 0;
  for (let k = 0; k < 40 && placed < 6; k++) {
    const x = mx + (rnd() - 0.5) * 34, z = mz + (rnd() - 0.5) * 40;
    if (!pointIn(ring, x, z) || ringDist(ring, x, z) < 3 || blockers(x, z, 3.2) || Math.hypot(x - sx, z - sz) < 5) continue;
    tree(kit, x, z, 1.0 + rnd() * 0.25, rnd);
    const seat = plain('#b8b2a6', 0.85);
    kit.prism(polyRing(x, z, 1.5, 8), 0.04, 0.45, seat, seat);
    blockersAdd(blockers, x, z, 3.2);
    placed++;
  }
  for (let k = 0; k < 40; k++) {
    const a = rnd() * Math.PI * 2, r = 2.0 + rnd() * 6;
    const x = sx + Math.cos(a) * r, z = sz + Math.sin(a) * r;
    if (pointIn(ring, x, z) && !blockers(x, z, 0.6)) person(kit, x, z, rnd, 0.04);
  }
}
function blockersAdd(blockers, x, z, r) { if (blockers.add) blockers.add(x, z, r); }

// ------------------------------------------------------------------ Ginza line
/** offset polyline (left = +1 / right = -1 of travel) with mitred joints */
function offsetPath(P, off) {
  return P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const p0 = i > 0 ? P[i - 1] : p, p1 = i < P.length - 1 ? P[i + 1] : p;
    const n0 = segN(i > 0 ? p0 : p, i > 0 ? p : p1), n1 = segN(i < P.length - 1 ? p : p0, i < P.length - 1 ? p1 : p);
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = off / Math.max(0.5, mx * n1[0] + mz * n1[1]);
    void a; void b;
    return [p[0] + mx * k, p[1] + mz * k];
  });
}
function segN(a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; }

/** box girder with parapets along a level polyline */
function girder(kit, P, half, y0, y1, para, m, deckM) {
  const L = offsetPath(P, half), R = offsetPath(P, -half);
  const Li = offsetPath(P, half - 0.25), Ri = offsetPath(P, -(half - 0.25));
  let u = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const len = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    const uv = (y) => [[u, y0], [u + len, y0], [u + len, y], [u, y]];
    // outer sides (girder + parapet), facing out
    sideQuad(kit, L[i], L[i + 1], y0, y1 + para, m, P[i], u, len);
    sideQuad(kit, R[i], R[i + 1], y0, y1 + para, m, P[i], u, len);
    // parapet inner faces and tops
    sideQuad(kit, Li[i], Li[i + 1], y1, y1 + para, m, P[i], u, len, true, L[i]);
    sideQuad(kit, Ri[i], Ri[i + 1], y1, y1 + para, m, P[i], u, len, true, R[i]);
    flatQuad(kit, [L[i], L[i + 1], Li[i + 1], Li[i]], y1 + para, m.color, m.style);
    flatQuad(kit, [R[i], R[i + 1], Ri[i + 1], Ri[i]], y1 + para, m.color, m.style);
    // deck and soffit
    flatQuad(kit, [Li[i], Li[i + 1], Ri[i + 1], Ri[i]], y1, deckM.color, deckM.style);
    const s = [L[i], L[i + 1], R[i + 1], R[i]].map(([x, z]) => [x, y0, z]);
    // soffit faces down
    const cross = (s[1][0] - s[0][0]) * (s[3][2] - s[0][2]) - (s[1][2] - s[0][2]) * (s[3][0] - s[0][0]);
    const q = cross > 0 ? s : [s[0], s[3], s[2], s[1]];
    kit.quad(q[0], q[1], q[2], q[3], m.color, m.style, q.map((p) => [p[0], p[2]]));
    void uv;
    u += len;
  }
}
/** vertical quad a -> b facing away from `inner` (or towards it when `towards`) */
function sideQuad(kit, a, b, y0, y1, m, c, u, len, towards = false, ref = null) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  let n = [-dz, dx];
  const r = ref || c;
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  // outward = away from the centre line point c; inner faces point away from the outer edge `ref`
  const away = (n[0] * (mx - r[0]) + n[1] * (mz - r[1])) > 0;
  const want = towards ? !away : away;
  const A = want ? a : b, B = want ? b : a;
  kit.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], m.color, m.style, [[u, y0], [u + len, y0], [u + len, y1], [u, y1]]);
}

/** a Ginza line train (1000 series, lemon yellow) of `cars` cars along the path from s0 */
function train(kit, P, s0, cars, yRail, dirSign = 1) {
  const body = plain('#f2b705', 0.45, 0.2, 0.0), roof = plain('#d9dadb', 0.6, 0.3);
  const win = mat('#1d252c', [PAT.GLASS, 1.4, 3.0, 0.95]);
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const at = (s) => {
    s = Math.max(0, Math.min(cum[cum.length - 1], s));
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t];
  };
  for (let c = 0; c < cars; c++) {
    const a = at(s0 + dirSign * c * 16.0), b = at(s0 + dirSign * (c * 16.0 + 15.4));
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) continue;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    kit.box(cx, cz, len, 2.55, yRail + 0.35, yRail + 3.45, ang, body, roof);
    const br = bearingOf(-Math.sin(ang), Math.cos(ang));
    for (const s of [0, 180]) panel(kit, cx, yRail + 2.25, cz, (br + s) % 360, len - 1.2, 1.0, win.color, win.style, 1.275 + 0.15);
  }
}

export function ginzaViaduct(kit, via, portal) {
  if (!via || !via.points || via.points.length < 2) return;
  kit.seed(33);
  const P = via.points;
  const top = via.deck_y || 15.0, bot = top - 3.0, half = via.half_width || 3.6;
  const steel = plain('#5d646b', 0.55, 0.55), deck = plain('#3e3d3b', 0.95);
  girder(kit, P, half, bot, top, 1.0, steel, deck);
  // slim piers (positions along the path, avoiding the roads below)
  const pier = plain('#7b8085', 0.7, 0.3);
  for (const pt of via.piers || []) {
    kit.box(pt[0], pt[1], 2.4, 2.4, 0, bot + 0.05, (pt[2] || 0) * DEG, pier, pier);
  }
  // a train half-way into the Mark City portal
  train(kit, P, 1.0, 4, top, 1);
  void portal;
}

/** Ginza line Shibuya station over Meiji-dori: trackbed, island platform, white M-arch ribs */
export function ginzaStation(kit, h, via) {
  const ring0 = mainRing(h);
  if (!ring0) return;
  kit.seed(34);
  const R = insetRing(ring0, 0.3);
  const yT = h.platform_y || 15.0;            // rail level
  const slab = plain('#9a9b98', 0.85);
  kit.prism(R, yT - 1.6, yT, slab, plain('#4a4a48', 0.95), { bottom: true });
  // station axis from the OBB of the footprint
  let best = null;
  for (const e of ringEdges(R)) if (!best || e.len > best.len) best = e;
  const ux = best.dir[0], uz = best.dir[1];
  const nx = -uz, nz = ux;
  const pr = R.map(([x, z]) => [x * ux + z * uz, x * nx + z * nz]);
  const a0 = Math.min(...pr.map((p) => p[0])), a1 = Math.max(...pr.map((p) => p[0]));
  // width of the footprint at axis position a
  const span = (a) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pr.length; i++) {
      const p = pr[i], q = pr[(i + 1) % pr.length];
      if ((p[0] - a) * (q[0] - a) <= 0 && p[0] !== q[0]) {
        const t = (a - p[0]) / (q[0] - p[0]);
        const b = p[1] + (q[1] - p[1]) * t;
        lo = Math.min(lo, b); hi = Math.max(hi, b);
      }
    }
    return [lo, hi];
  };
  const W = (a, b) => [a * ux + b * nx, a * uz + b * nz];      // axis coords -> world x, z
  // island platform between the two tracks; the mapped south track (drawn by the road builder at
  // rail level) runs along its south edge, which hides that track's inner parapet
  const [lm0, hm0] = span((a0 + a1) / 2);
  let mid = (lm0 + hm0) / 2;
  const PW = 9.5;
  let sgn = 1, bPlat = mid;
  if (h.south_track && h.south_track.length) {
    const bt = h.south_track.reduce((s, [x, z]) => s + x * nx + z * nz, 0) / h.south_track.length;
    sgn = mid > bt ? 1 : -1;
    bPlat = bt + sgn * (1.3 + PW / 2);
  }
  const plat = plain('#bdbcb6', 0.85);
  const pa0 = a0 + 14, pa1 = a1 - 6;
  const pc = W((pa0 + pa1) / 2, bPlat);
  kit.box(pc[0], pc[1], pa1 - pa0, PW, yT, yT + 1.35, Math.atan2(uz, ux), plat, plain('#c9c8c2', 0.85));
  // a train at the other face of the platform
  const bTrain = bPlat + sgn * (PW / 2 + 1.65);
  const tp = [W(pa0 - 4, bTrain), W(pa1, bTrain)];
  train(kit, tp, 2, 6, yT, 1);
  const rnd = prng(34);
  for (let i = 0; i < 30; i++) {
    const p = W(pa0 + 2 + rnd() * (pa1 - pa0 - 4), bPlat + (rnd() - 0.5) * 8);
    person(kit, p[0], p[1], rnd, yT + 1.35);
  }
  void mid;
  // M-arch ribs: two humps across the station, white steel, spaced along the axis
  const prof = [[-1, 0], [-0.95, 0.52], [-0.82, 0.86], [-0.55, 1.0], [-0.28, 0.86], [0, 0.6], [0.28, 0.86], [0.55, 1.0], [0.82, 0.86], [0.95, 0.52], [1, 0]];
  const rib = plain('#f1f1ee', 0.5, 0.3, 0.12);
  const skin = mat('#e9ece9', [PAT.MEMBRANE, 0, 0, 0]);
  const nR = Math.max(6, Math.round((a1 - a0 - 4) / 5.2));
  const ribs = [];
  for (let k = 0; k <= nR; k++) {
    const a = a0 + 2 + ((a1 - a0 - 4) * k) / nR;
    const [lo, hi] = span(a);
    if (!isFinite(lo) || hi - lo < 8) { ribs.push(null); continue; }
    const c = (lo + hi) / 2, hw = (hi - lo) / 2 - 0.4;
    const H = 7.2 + 1.8 * Math.sin((Math.PI * (a - a0)) / (a1 - a0));
    const pts = prof.map(([s, f]) => { const p = W(a, c + s * hw); return [p[0], yT + f * H, p[1]]; });
    for (let i = 0; i < pts.length - 1; i++) beam(kit, pts[i], pts[i + 1], [ux, uz], 0.6, 1.0, rib);
    ribs.push(pts);
  }
  for (let k = 0; k < ribs.length - 1; k++) {
    const A = ribs[k], B = ribs[k + 1];
    if (!A || !B) continue;
    for (let i = 1; i < prof.length - 2; i++) {
      const q = [A[i], B[i], B[i + 1], A[i + 1]];
      kit.quad(q[0], q[1], q[2], q[3], skin.color, skin.style);
      kit.quad(q[0], q[3], q[2], q[1], skin.color, skin.style);
    }
  }
  // supports at the footprint ends and along the edges
  const col = plain('#cfd0cd', 0.7, 0.2);
  for (const a of [a0 + 3, (a0 + a1) / 2, a1 - 3]) {
    const [lo, hi] = span(a);
    if (!isFinite(lo)) continue;
    for (const b of [lo + 1.2, hi - 1.2]) {
      const p = W(a, b);
      kit.box(p[0], p[1], 1.2, 1.2, 0, yT - 1.6, Math.atan2(uz, ux), col, col);
    }
  }
  void via;
}

/** straight member between two 3D points: w wide along `side` (horizontal unit), t thick */
function beam(kit, p, q, side, w, t, m) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  const s = [side[0], 0, side[1]];
  // in-plane normal: d x s
  let nn = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]];
  const nl = Math.hypot(...nn) || 1; nn = nn.map((v) => v / nl);
  if (nn[1] < 0) nn = nn.map((v) => -v);
  const c = (P, a, b) => [P[0] + s[0] * a + nn[0] * b, P[1] + s[1] * a + nn[1] * b, P[2] + s[2] * a + nn[2] * b];
  const hw = w / 2, ht = t / 2;
  const corners = [[-hw, -ht], [hw, -ht], [hw, ht], [-hw, ht]];
  for (let i = 0; i < 4; i++) {
    const [a0, b0] = corners[i], [a1, b1] = corners[(i + 1) % 4];
    const v = [c(p, a0, b0), c(p, a1, b1), c(q, a1, b1), c(q, a0, b0)];
    // face normal should point away from the beam axis
    const mxp = [(v[0][0] + v[1][0]) / 2 - p[0], (v[0][1] + v[1][1]) / 2 - p[1], (v[0][2] + v[1][2]) / 2 - p[2]];
    const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[3][0] - v[0][0], v[3][1] - v[0][1], v[3][2] - v[0][2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const out = fn[0] * mxp[0] + fn[1] * mxp[1] + fn[2] * mxp[2] > 0;
    if (out) kit.quad(v[0], v[1], v[2], v[3], m.color, m.style, [[0, 0], [w, 0], [w, L], [0, L]]);
    else kit.quad(v[0], v[3], v[2], v[1], m.color, m.style, [[0, 0], [0, L], [w, L], [w, 0]]);
  }
}

// ------------------------------------------------------------------ Center Gai gate
export function centerGaiGate(kit, g) {
  if (!g || !g.posts || g.posts.length !== 2) return;
  kit.seed(35);
  const [p, q] = g.posts;
  const span = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
  const steel = plain('#2a2c30', 0.5, 0.6);
  for (const s of [p, q]) kit.box(s[0], s[1], 0.45, 0.45, 0, 7.6, ang, steel, steel);
  const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
  kit.box(mx, mz, span + 0.6, 0.7, 5.8, 7.8, ang, plain('#efece2', 0.5, 0, 0.45), steel);
  // 渋谷センター街: seven dark characters on each face
  const br = bearingOf(-Math.sin(ang), Math.cos(ang));
  const ink = plain('#1b2a5a', 0.5, 0, 0.0);
  const cw = Math.min(0.95, (span - 1) / 7.6);
  for (const face of [br, (br + 180) % 360]) {
    const [tx, tz] = [Math.cos(face * DEG), Math.sin(face * DEG)];
    for (let i = 0; i < 7; i++) {
      const o = (i - 3) * cw * 1.08;
      panel(kit, mx + tx * o, 6.8, mz + tz * o, face, cw * 0.86, 1.2, ink.color, ink.style, 0.35 + 0.16);
    }
  }
}

// ------------------------------------------------------------------ screens
/** screens from the spec, except those modelled with their host (Q's EYE, Coke vision) */
export function screens(kit, list, skip, seeds = {}) {
  kit.seed(36);
  for (const s of list) {
    if (skip.has(s.key) || s.x == null) continue;
    const br = s.wallBearing ?? s.bearing;
    const w = s.width, ht = s.height;
    const bH = s.buildingH ?? 0;
    const seed = seeds[s.key] ?? s.seed ?? (hashStr(s.key) % 97) + 0.5;
    const rooftop = bH > 0 && s.bottom + ht > bH + 2 && s.bottom > bH - 4;
    // optional shift along the wall (towards the viewer's left)
    const al = s.along || 0;
    const sx = s.x + Math.cos(br * DEG) * al, sz = s.z + Math.sin(br * DEG) * al;
    if (rooftop) {
      const [nx, nz] = dirOf(br);
      const sb = 1.2, depth = 0.8;
      const bottom = Math.max(s.bottom, bH + 0.7);
      const x = sx - nx * (sb + depth + 0.2), z = sz - nz * (sb + depth + 0.2);
      mountedScreen(kit, x, z, br, w, ht, bottom, seed, { depth, gap: 0.08, casingFrom: bH, casingLen: Math.min(w, Math.max(2, (s.wallLength || w) - 1.5)) });
      backPanel(kit, x, z, br, w, ht, bottom, 0.08 + depth + 0.09);
    } else {
      const bottom = Math.max(0.5, s.bottom);
      const top = bH > 0 ? Math.min(bottom + ht, bH - 0.4) : bottom + ht;
      const hh = top - bottom;
      if (hh < 1) continue;
      mountedScreen(kit, sx, sz, br, w, hh, bottom, seed, { depth: 0.45, gap: 0.08 });
      backPanel(kit, sx, sz, br, w, hh, bottom, 0.08 + 0.45 + 0.09);
    }
  }
}
function backPanel(kit, x, z, br, w, h, bottom, at) {
  panel(kit, x, bottom + h / 2, z, (br + 180) % 360, w, h, '#1b1c1f', [PAT.PLAIN, 0.7, 0.3, 0], -at);
}

// ------------------------------------------------------------------ sign streets
/** dense blade signs and fascia light boxes on the building line along each sign street */
export function signStreets(kit, streets) {
  for (const st of streets) {
    const anchors = st.anchors || [];
    if (!anchors.length) continue;
    const seed = hashStr(st.name);
    kit.seed(seed);
    const rnd = prng(seed);
    const dens = st.density ?? 0.5;
    const lanterns = /Nonbei|のんべい/.test(st.name);
    for (const [x, z, b, hw] of anchors) {
      const [nx, nz] = dirOf(b);
      const ang = b * DEG;
      if (lanterns) {
        // red paper lanterns and lit noren boxes of the tiny bars
        const red = plain('#d2261c', 0.8, 0, 1.3);
        const lx = x + nx * 0.75, lz = z + nz * 0.75;
        kit.prism(polyRing(lx, lz, 0.24, 6), 2.25, 2.75, red, red, { bottom: true });
        kit.box(x + nx * 0.3, z + nz * 0.3, 1.6, 0.4, 2.8, 3.25, ang, plain('#f1e6c8', 0.7, 0, 0.9), plain('#333'));
        continue;
      }
      // fascia light box over the shopfront
      if (rnd() < 0.45 + 0.5 * dens) {
        const w = 1.4 + rnd() * 0.8, h = 0.65 + rnd() * 0.35;
        const sty = [PAT.SIGNS, w, h, Math.floor(rnd() * 200)];
        kit.box(x + nx * 0.28, z + nz * 0.28, w, 0.36, 2.5, 2.5 + h, ang, mat('#999', sty), plain('#2a2a2a'));
      }
      // vertical blade sign (tate-kanban) stacked with tenant panels
      if (hw > 8 && rnd() < 0.12 + 0.5 * dens) {
        const bw = 0.8 + rnd() * 0.6;
        const y0 = 3.7 + rnd() * 1.2;
        const y1 = Math.min(hw - 0.8, 25, y0 + 2.5 + rnd() * (4 + 9 * dens));
        if (y1 - y0 < 2.2) continue;
        blade(kit, x, z, b, bw, y0, y1, [PAT.SIGNS, bw, 1.1 + rnd() * 1.0, Math.floor(rnd() * 200)]);
      }
    }
  }
}
function blade(kit, x, z, b, bw, y0, y1, sty) {
  const [nx, nz] = dirOf(b);
  const cx = x + nx * (0.45 + bw / 2), cz = z + nz * (0.45 + bw / 2);
  const tb = bearingOf(-nz, nx), yc = (y0 + y1) / 2, h = y1 - y0;
  const uo = ((sty[3] % 41) + 1) * bw;          // start at a random sign column (the shader's colours hash on the cell id)
  panel(kit, cx, yc, cz, tb, bw, h, '#999', sty, 0.14, uo);
  panel(kit, cx, yc, cz, (tb + 180) % 360, bw, h, '#999', sty, 0.14, uo);
  panel(kit, x + nx * (0.45 + bw), yc, z + nz * (0.45 + bw), b, 0.28, h, '#26272a', [PAT.PLAIN, 0.6, 0.4, 0], 0);
  kit.box(x + nx * 0.25, z + nz * 0.25, 0.25, 0.42, y0 + 0.3, y1 - 0.3, b * DEG, plain('#3a3b3e', 0.6, 0.5), plain('#3a3b3e'));
}
