// Shibuya hero buildings, modelled on their real (merged, simplified) footprints from the
// manifest: Scramble Square, QFRONT, SHIBUYA109, Hikarie, Mark City, Stream, Cerulean Tower,
// Infos Tower and MAGNET. Heights and tiers follow tools/districts/shibuya.json.
import { PAT, ringEdges, ringOBB, insetRing, ringArea } from './kit.js';
import {
  DEG, dirOf, bearingOf, mat, plain, prng, pointIn, walls, wallQuad, edgeStrip, ribbon, arcPath,
  flatRect, digit, polyRing, mountedScreen, person, panel, poster, posterArc,
} from './shibuya-util.js';

export const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
/** the main footprint of a hero: its largest ring (the pipeline may export several) */
export const mainRing = (h) => (h.rings || []).reduce((best, r) => (!best || Math.abs(ringArea(r)) > Math.abs(ringArea(best)) ? r : best), null);
const facing = (e) => bearingOf(e.n[0], e.n[1]);

/** up to four roof corners of a ring (extremes along the diagonals of its bounding rectangle) */
function roofCorners(ring, inset = 1.0) {
  const r = insetRing(ring, inset);
  const o = ringOBB(r);
  const ux = Math.cos(o.angle), uz = Math.sin(o.angle);
  const out = [];
  for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let best = null, bs = -Infinity;
    for (const p of r) {
      const a = (p[0] - o.cx) * ux + (p[1] - o.cz) * uz, b = -(p[0] - o.cx) * uz + (p[1] - o.cz) * ux;
      const s = sa * a + sb * b;
      if (s > bs) { bs = s; best = p; }
    }
    if (best && !out.includes(best)) out.push(best);
  }
  return out;
}
function aviation(kit, ring, y, inset = 1.0) {
  for (const [x, z] of roofCorners(ring, inset)) kit.aviation([x, y, z]);
}

/** consecutive edges of a ring whose outward normal faces `bearing` (within tol) as a path */
function frontPath(ring, bearing, tol = 35) {
  const E = ringEdges(ring);
  const ok = E.map((e) => angDiff(facing(e), bearing) < tol);
  if (!ok.some(Boolean)) return null;
  let start = ok.findIndex((v, i) => v && !ok[(i - 1 + E.length) % E.length]);
  if (start < 0) start = 0;
  const run = [];
  for (let k = 0; k < E.length && ok[(start + k) % E.length]; k++) run.push(E[(start + k) % E.length]);
  return { pts: [run[0].a, ...run.map((e) => e.b)], ns: run.map((e) => e.n), len: run.reduce((s, e) => s + e.len, 0), edges: run };
}

// ------------------------------------------------------------------ Shibuya Scramble Square
export function scrambleSquare(kit, h) {
  const ring = mainRing(h);
  if (!ring) return;
  const R0 = insetRing(ring, 0.3);                 // the station block shares the west wall
  kit.seed(11);
  const top = h.h || 229.7, pod = h.podium_top || 66;
  const [deck0, deck1] = h.deck_glass_band || [211, 226];
  // low-rise (Kengo Kuma): champagne aluminium fins over glass
  kit.prism(R0, 0, pod, mat('#9aa3a6', [PAT.FINS, 0.85, 4.4, 0.6]), plain('#6f7479', 0.85));
  // high-rise (Nikken Sekkei): pale blue-grey reflective glass
  const T = insetRing(R0, h.tower_inset ?? 1.8);
  kit.prism(T, pod, deck0, mat('#9fb6c6', [PAT.GLASS, 1.5, 4.4, 0.45]), plain('#7b8288'));
  // 45-46F SHIBUYA SKY gallery: recessed, clearer glass, glowing at night
  kit.prism(insetRing(T, 0.8), deck0, deck1, mat('#b5cdd8', [PAT.GLASS, 3.0, 7.5, 0.95]), plain('#5d6369'));
  // roof rim, frameless glass parapet of the open-air deck, helipad
  const roofY = deck1 + 1.7;
  kit.prism(T, deck1, roofY, plain('#d3d8db', 0.45, 0.5), plain('#474c52', 0.9));
  walls(kit, insetRing(T, 0.25), roofY, top, plain('#d6edf4', 0.06, 0.4, 0.22));
  const o = ringOBB(T);
  const hp = Math.min(22, o.wid - 10);
  const ux = Math.cos(o.angle), uz = Math.sin(o.angle);
  kit.box(o.cx, o.cz, hp, hp, roofY, roofY + 0.9, o.angle, plain('#3c4045', 0.9), plain('#43484e', 0.9));
  const y = roofY + 0.96;
  const W = plain('#ecece6', 0.7, 0, 0.08);
  for (const s of [-1, 1]) flatRect(kit, o.cx + ux * s * 2.3, o.cz + uz * s * 2.3, -uz, ux, 3.1, 0.42, y, W.color, W.style);
  flatRect(kit, o.cx, o.cz, ux, uz, 1.9, 0.38, y, W.color, W.style);
  const rr = hp * 0.36;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    flatRect(kit, o.cx + Math.cos(a) * rr, o.cz + Math.sin(a) * rr, -Math.sin(a), Math.cos(a), (Math.PI * rr) / 24 * 0.92, 0.32, y, W.color, W.style);
  }
  // random vertical slits (white louvres) breaking up the glass; lit lines at night
  const rnd = prng(229);
  const slit = plain('#eef3f6', 0.45, 0.1, 0.65);
  for (const e of ringEdges(T)) {
    const n = Math.round(e.len / 7.5);
    for (let i = 0; i < n; i++) {
      const u = 2 + rnd() * (e.len - 4);
      const w = 0.8 + rnd() * 0.8;
      const y0 = pod + 1 + rnd() * rnd() * 60;
      const y1 = Math.min(deck0 - 1, y0 + 30 + rnd() * 120);
      edgeStrip(kit, e, u - w / 2, u + w / 2, y0, y1, slit.color, slit.style, 0.16);
    }
  }
  aviation(kit, T, top + 0.6, 1.2);
}

// ------------------------------------------------------------------ QFRONT (Q's EYE)
export function qfront(kit, h, sc) {
  const ring = mainRing(h);
  if (!ring) return;
  const R = insetRing(ring, 0.15);
  kit.seed(12);
  const roof = h.body_roof || 36, front = h.front_bearing || 168;
  const isFront = (e) => angDiff(facing(e), front) < 35;
  // TSUTAYA at street level and the Starbucks 2F: clear, bright glass
  walls(kit, R, 0, 10, mat('#c4cdd0', [PAT.GLASS, 1.6, 3.3, 0.8]));
  walls(kit, R, 10, roof, (e) => (isFront(e) ? plain('#17191c', 0.6, 0.3) : mat('#394550', [PAT.GLASS, 1.3, 3.65, 0.55])));
  kit.cap(R, roof, '#55595e', [PAT.PLAIN, 0.85, 0.1, 0]);
  const fp = frontPath(R, front);
  if (fp) {
    const qs = sc.qs_eye || {};
    const y0 = qs.bottom ?? 10, y1 = Math.min(roof - 1.5, y0 + (qs.height ?? 23.9));
    // the whole crossing front is the LED "art vision", the sharp 16:9 main screen and the banner
    // screen sit in it
    ribbon(kit, fp.pts, fp.ns, y0, y1, 0.45, '#202020', [PAT.SCREEN, 41, fp.len, y1 - y0]);
    const mid = fp.len / 2, hw = Math.min(6.48, mid - 0.4);
    const mTop = y1 - 3.0, mBot = mTop - 7.29, bTop = mBot - 0.5, bBot = bTop - 5.33;
    ribbon(kit, fp.pts, fp.ns, bBot - 0.3, mTop + 0.3, 0.6, '#0d0d0f', [PAT.PLAIN, 0.5, 0.2, 0], mid - hw - 0.3, mid + hw + 0.3);
    ribbon(kit, fp.pts, fp.ns, mBot, mTop, 0.75, '#202020', [PAT.SCREEN, 7, hw * 2, 7.29], mid - hw, mid + hw);
    ribbon(kit, fp.pts, fp.ns, bBot, bTop, 0.75, '#202020', [PAT.SCREEN, 43, hw * 2, 5.33], mid - hw, mid + hw);
  }
  // Center Gai side: big printed banners
  for (const e of ringEdges(R)) {
    if (angDiff(facing(e), 224) < 30 && e.len > 8) {
      const w = Math.min(e.len - 3, 11);
      const u0 = (e.len - w) / 2;
      const [mx, mz] = [e.a[0] + e.dir[0] * (u0 + w / 2), e.a[1] + e.dir[1] * (u0 + w / 2)];
      poster(kit, mx, 22, mz, facing(e), w, 17, 0, 0.2);
    }
    if (angDiff(facing(e), 104) < 30 && e.len > 8) {
      const w = Math.min(e.len - 4, 10);
      const [mx, mz] = [e.a[0] + e.dir[0] * (2 + w / 2), e.a[1] + e.dir[1] * (2 + w / 2)];
      poster(kit, mx, 28, mz, facing(e), w, 3.6, 6, 0.2);
    }
  }
  // transparent-LED "Coke" vision standing on the roof, facing the crossing
  const cv = sc.coke_vision;
  if (cv) {
    const br = cv.wallBearing ?? cv.bearing;
    const [nx, nz] = dirOf(br);
    const tx = -nz, tz = nx, w = cv.width;
    let cx = cv.x - nx * 2.0, cz = cv.z - nz * 2.0;
    for (let k = 0; k < 60; k++) {
      const inL = pointIn(R, cx - tx * (w / 2 - 0.4) - nx * 0.8, cz - tz * (w / 2 - 0.4) - nz * 0.8);
      const inR = pointIn(R, cx + tx * (w / 2 - 0.4) - nx * 0.8, cz + tz * (w / 2 - 0.4) - nz * 0.8);
      if (inL && inR) break;
      if (inL === inR) { cx -= nx * 0.25; cz -= nz * 0.25; } else { const s = inL ? -0.25 : 0.25; cx += tx * s; cz += tz * s; }
    }
    const bottom = roof + 0.25, ht = Math.min(cv.height, Math.max(4, (h.h || 45.9) - bottom));
    const st = plain('#1c1e21', 0.6, 0.5);
    const ang = br * DEG;
    for (const s of [-1, -0.33, 0.33, 1]) {
      kit.box(cx + tx * s * (w / 2 - 0.3) - nx * 0.7, cz + tz * s * (w / 2 - 0.3) - nz * 0.7, 0.3, 0.5, roof, bottom + ht, ang, st, st);
    }
    kit.box(cx - nx * 0.7, cz - nz * 0.7, w, 0.5, bottom + ht - 0.3, bottom + ht + 0.1, ang, st, st);
    panel(kit, cx, bottom + ht / 2, cz, br, w, ht, '#202020', [PAT.SCREEN, 44, w, ht], 0);
    panel(kit, cx, bottom + ht / 2, cz, (br + 180) % 360, w, ht, '#1b1c1f', [PAT.PLAIN, 0.7, 0.3, 0], 0.03);
  }
}

// ------------------------------------------------------------------ SHIBUYA109
export function shibuya109(kit, h, center) {
  const ring = mainRing(h);
  if (!ring) return;
  const R = insetRing(ring, 0.12);
  kit.seed(13);
  const roof = h.body_roof || h.h || 33.6;
  const [cx, cz] = h.cyl_center || [h.x, h.z];
  const r = (h.cyl_radius || 7) + 0.4, ctop = h.cyl_top || 41;
  const shop = mat('#dccfb4', [PAT.GLASS, 1.8, 2.3, 0.8]);
  walls(kit, R, 0, 4.6, shop);
  walls(kit, R, 4.6, roof, mat('#a3a9af', [PAT.METAL, 1.25, 0.95, 0.38]));
  kit.cap(R, roof, '#8b8f93', [PAT.PLAIN, 0.8, 0.2, 0]);
  // big printed fashion banners on the long street facades (Dogenzaka / Bunkamura-dori)
  let k = 0;
  for (const e of ringEdges(R)) {
    if (e.len < 18) continue;
    const w = Math.min(e.len * 0.55, 22);
    const u0 = (e.len - w) / 2;
    const [mx, mz] = [e.a[0] + e.dir[0] * (u0 + w / 2), e.a[1] + e.dir[1] * (u0 + w / 2)];
    poster(kit, mx, 19.5, mz, facing(e), w, 21, [0, 4, 3, 1][k % 4], 0.18);
    k++;
  }
  // the silver cylinder at the fork, rising above the main roof
  const cyl = polyRing(cx, cz, r, 28);
  walls(kit, cyl, 0, 4.6, shop);
  walls(kit, cyl, 4.6, ctop, mat('#e3e6e9', [PAT.METAL, 1.6, 2.2, 0.2]));
  kit.cap(cyl, ctop, '#7f8388', [PAT.PLAIN, 0.7, 0.4, 0]);
  const bx = bearingOf(center.x - cx, center.z - cz);
  // full-height vertical ad wrap on the crossing side of the cylinder
  const half = 30;
  posterArc(kit, cx, cz, r + 0.22, bx - half, bx + half, 6, ctop - 7.6, 6);
  // "109" logo boards on the cylinder top (pink -> purple gradient, LED lit at night)
  const plate = plain('#17151b', 0.6, 0.3);
  const glyph = [plain('#ff5cae', 0.4, 0, 1.25), plain('#e352c9', 0.4, 0, 1.25), plain('#a957ea', 0.4, 0, 1.25)];
  const white = plain('#f4f0f6', 0.4, 0, 0.9);
  for (const b of [bx, bx - 62, bx + 62]) {
    const [nx, nz] = dirOf(b);
    const tx = nz, tz = -nx;          // viewer's right
    panel(kit, cx, ctop - 3.2, cz, b, 7.4, 5.6, plate.color, plate.style, r + 0.4);
    ['1', '0', '9'].forEach((ch, i) => {
      digit(kit, ch, cx + tx * (i - 1) * 2.3, ctop - 2.7, cz + tz * (i - 1) * 2.3, b, 1.85, 3.6, glyph[i], r + 0.58);
    });
    panel(kit, cx, ctop - 5.25, cz, b, 4.6, 0.5, white.color, white.style, r + 0.58);
  }
}

// ------------------------------------------------------------------ Shibuya Hikarie
export function hikarie(kit, h) {
  const baseRing = h.tower_ring ? insetRing(h.tower_ring, 0.1) : mainRing(h);
  if (!baseRing) return;
  const hull = h.tower_hull || baseRing;
  kit.seed(14);
  const top = h.h || 182.5;
  // "stacked blocks": setbacks at 6F, 11F and 17F
  kit.prism(baseRing, 0, 31, mat('#e8e7e1', [PAT.BANDS, 0.6, 4.4, 0.75]), plain('#9a9d9f', 0.85));
  const t2 = insetRing(hull, 2.6);
  kit.prism(t2, 31, 55, mat('#2f3b45', [PAT.GLASS, 1.6, 4.0, 0.7]), plain('#8e9396'), { bottom: true });
  const t3 = insetRing(hull, 0.9);
  kit.prism(t3, 55, 60, mat('#26303a', [PAT.GLASS, 2.0, 5.0, 0.85]), plain('#9a9d9f'), { bottom: true });
  kit.prism(t3, 60, 86, mat('#e7e7e2', [PAT.METAL, 2.4, 1.1, 0.45]), plain('#a3a6a8'));
  const t4 = insetRing(hull, 4.6);
  kit.prism(t4, 86, top - 3, mat('#25303a', [PAT.FINS, 1.05, 4.2, 0.55]), plain('#7d8287'));
  kit.prism(insetRing(t4, 0.5), top - 3, top, plain('#dcdedf', 0.5, 0.4), plain('#5b6066', 0.85));
  const o = ringOBB(t4);
  kit.box(o.cx, o.cz, o.len * 0.45, o.wid * 0.4, top, top + 3.5, o.angle, plain('#c9ccce', 0.6, 0.3), plain('#6a6f74'));
  if (h.wing9_ring) kit.prism(insetRing(h.wing9_ring, 0.1), 0, h.east_wing_9f || 36, mat('#e3e2dc', [PAT.BANDS, 0.55, 4.4, 0.7]), plain('#94979a', 0.85));
  if (h.wing6_ring) kit.prism(insetRing(h.wing6_ring, 0.1), 0, h.east_wing_6f || 24, mat('#dddcd6', [PAT.BANDS, 0.5, 4.2, 0.65]), plain('#94979a', 0.85));
  aviation(kit, t4, top + 0.6, 1.0);
}

// ------------------------------------------------------------------ Mark City East / West
export function markCity(kit, h, seed, portal) {
  const slabRing = h.slab_ring || mainRing(h);
  if (!slabRing) return;
  kit.seed(seed);
  const top = h.h || 99.67, podTop = h.podium_top || 25;
  const pod = h.podium_ring ? insetRing(h.podium_ring, 0.6) : null;   // clear of the abutting neighbours
  if (pod) kit.prism(pod, 0, podTop, mat('#d5cbb8', [PAT.BANDS, 0.36, 4.6, 0.6]), plain('#8f8b84', 0.85));
  const slab = insetRing(slabRing, 0.1);
  kit.prism(slab, pod ? podTop : (h.dataMinH || 0), top - 3.5, mat('#ddd4c3', [PAT.BANDS, 0.46, 3.9, 0.6]), plain('#8f8b84'), { bottom: !pod });
  kit.prism(insetRing(slab, -0.15), top - 3.5, top, plain('#cbc2b1', 0.7), plain('#77746d', 0.85), { bottom: true });
  aviation(kit, slab, top + 0.6, 0.8);
  // the Ginza line runs into the east end of Mark City East: a dark portal in the podium face
  if (pod && portal) {
    let best = null, bd = Infinity;
    for (const e of ringEdges(pod)) {
      const t = Math.max(0, Math.min(e.len, (portal.x - e.a[0]) * e.dir[0] + (portal.z - e.a[1]) * e.dir[1]));
      const d = Math.hypot(e.a[0] + e.dir[0] * t - portal.x, e.a[1] + e.dir[1] * t - portal.z);
      if (d < bd) { bd = d; best = { e, t }; }
    }
    if (best && bd < 6) {
      const { e, t } = best;
      const hw = portal.width / 2;
      edgeStrip(kit, e, Math.max(0.3, t - hw), Math.min(e.len - 0.3, t + hw), portal.y0, portal.y1, '#08090a', [PAT.PLAIN, 0.9, 0, 0], 0.15);
    }
  }
}

// ------------------------------------------------------------------ Shibuya Stream
export function stream(kit, h) {
  const ring = mainRing(h);
  if (!ring) return;
  const R = insetRing(ring, 0.35);
  kit.seed(15);
  const top = h.h || 179.95, baseTop = h.base_top || 30;
  kit.prism(R, 0, baseTop, mat('#a3b3ba', [PAT.GLASS, 2.4, 5.0, 0.9]), plain('#8d9296'));
  kit.prism(R, baseTop, top - 2.2, mat('#7d909b', [PAT.GLASS, 1.8, 4.4, 0.5]), plain('#8d9296'));
  kit.prism(insetRing(R, -0.1), top - 2.2, top, plain('#efeeea', 0.6, 0.05), plain('#7a7f84', 0.85), { bottom: true });
  kit.box(...(() => { const o = ringOBB(R); return [o.cx, o.cz, o.len * 0.5, o.wid * 0.45, top, top + 3.2, o.angle]; })(), plain('#d8d9d7', 0.6, 0.2), plain('#6c7176'));
  // CAt's porous facade: white vertical panels in random runs over the glass, dense at the base
  // and thinning towards the sky
  const rnd = prng(180);
  const white = plain('#f1f0ec', 0.6, 0.05, 0.04);
  const [p0, p1] = [h.white_ratio_bottom ?? 0.65, h.white_ratio_top ?? 0.25];
  for (const e of ringEdges(R)) {
    const cols = Math.max(1, Math.floor(e.len / 1.8));
    const cw = e.len / cols;
    for (let c = 0; c < cols; c++) {
      let y = 4.4;
      while (y < top - 6) {
        const f = Math.max(0, (y - baseTop) / (top - baseTop));
        const p = p0 + (p1 - p0) * f;
        const y1 = Math.min(top - 4, y + (1 + Math.floor(rnd() * 3.5)) * 4.4);
        if (rnd() < p && c * cw > 0.4 && (c + 1) * cw < e.len - 0.4) {
          edgeStrip(kit, e, c * cw + 0.12, (c + 1) * cw - 0.12, y + 0.12, y1 - 0.12, white.color, white.style, 0.16);
        }
        y = y1;
      }
    }
  }
  aviation(kit, R, top + 0.6, 1.0);
}

// ------------------------------------------------------------------ Cerulean Tower
export function cerulean(kit, h) {
  const ring = h.tower_ring || mainRing(h);
  if (!ring) return;
  const T = insetRing(ring, 0.1);
  kit.seed(16);
  const podTop = h.podium_top || 24;
  const [cr0, top] = h.crown || [172, h.h || 184];
  if (h.podium_ring) kit.prism(insetRing(h.podium_ring, 0.15), 0, podTop, mat('#d6d3cb', [PAT.STONE, 3.2, 4.6, 0.6]), plain('#8d8a85', 0.85));
  const cut = h.cut_bearing || 45;
  walls(kit, T, h.podium_ring ? podTop : 0, cr0, (e) => (angDiff(facing(e), cut) < 25
    ? mat('#e2e2dd', [PAT.BANDS, 0.52, 3.9, 0.6])
    : mat('#e4e4df', [PAT.STONE, 1.8, 3.9, 0.55])));
  kit.cap(T, cr0, '#7f8489', [PAT.PLAIN, 0.85, 0.1, 0]);
  // crown: the facade carries on above the roof as an open frame (posts + ring beam)
  const fr = plain('#e6e6e1', 0.6, 0.2, 0.35);
  for (const e of ringEdges(T)) {
    const n = Math.max(2, Math.round(e.len / 5.5));
    for (let i = 0; i <= n; i++) {
      const u = 0.6 + ((e.len - 1.2) * i) / n;
      const px = e.a[0] + e.dir[0] * u - e.n[0] * 0.5, pz = e.a[1] + e.dir[1] * u - e.n[1] * 0.5;
      kit.box(px, pz, 0.9, 0.9, cr0, top - 1.5, Math.atan2(e.dir[1], e.dir[0]), fr, fr);
    }
    const mx = (e.a[0] + e.b[0]) / 2 - e.n[0] * 0.5, mz = (e.a[1] + e.b[1]) / 2 - e.n[1] * 0.5;
    kit.box(mx, mz, e.len + 0.2, 1.0, top - 1.5, top, Math.atan2(e.dir[1], e.dir[0]), fr, fr);
  }
  const o = ringOBB(T);
  kit.box(o.cx, o.cz, o.len * 0.5, o.wid * 0.5, cr0, cr0 + 5, o.angle, plain('#b9bcbe', 0.7, 0.3), plain('#6e7378'));
  aviation(kit, T, top + 0.6, 0.6);
}

// ------------------------------------------------------------------ Infos Tower
export function infosTower(kit, h) {
  const ring = h.outline_ring || mainRing(h);
  if (!ring) return;
  const R = insetRing(ring, 0.15);
  kit.seed(17);
  const top = h.h || 89.2;
  kit.prism(R, 0, top - 2.5, mat('#5d7182', [PAT.GLASS, 1.5, 3.9, 0.5]), plain('#80868b'));
  kit.prism(insetRing(R, 0.25), top - 2.5, top, plain('#c9cdd0', 0.6, 0.3), plain('#62676c', 0.85));
  aviation(kit, R, top + 0.6, 1.0);
}

// ------------------------------------------------------------------ MAGNET by SHIBUYA109
export function magnet(kit, h) {
  const ring = mainRing(h);
  if (!ring) return;
  const R = insetRing(ring, 0.15);
  kit.seed(18);
  const top = h.h || 34.2;
  walls(kit, R, 0, 4.5, mat('#d4c8b0', [PAT.GLASS, 1.8, 2.25, 0.8]));
  walls(kit, R, 4.5, top - 1.3, mat('#2b2e33', [PAT.BANDS, 0.42, 4.1, 0.4]));
  walls(kit, R, top - 1.3, top, plain('#1c1e22', 0.6, 0.3));
  kit.cap(R, top, '#55595e', [PAT.PLAIN, 0.85, 0.1, 0]);
  // big billboard on the south face over the eye-level screen
  for (const e of ringEdges(R)) {
    if (angDiff(facing(e), 183) < 25 && e.len > 10) {
      const w = Math.min(e.len - 2, 13);
      const [mx, mz] = [e.a[0] + e.dir[0] * (e.len / 2), e.a[1] + e.dir[1] * (e.len / 2)];
      poster(kit, mx, 19.5, mz, facing(e), w, 13, 1, 0.2);
    }
  }
  // MAG8 / CROSSING VIEW rooftop deck: timber deck, glass rim, a few onlookers
  const deck = insetRing(R, 1.2);
  kit.prism(deck, top, top + 0.25, plain('#7c6249', 0.9), plain('#8a6d50', 0.9));
  walls(kit, insetRing(R, 0.35), top, top + 1.4, plain('#cfe3ea', 0.06, 0.4, 0.14));
  const rnd = prng(88);
  const o = ringOBB(deck);
  for (let i = 0; i < 14; i++) {
    const a = (rnd() - 0.5) * o.len * 0.8, b = (rnd() - 0.5) * o.wid * 0.8;
    const x = o.cx + Math.cos(o.angle) * a - Math.sin(o.angle) * b, z = o.cz + Math.sin(o.angle) * a + Math.cos(o.angle) * b;
    if (pointIn(deck, x, z)) person(kit, x, z, rnd, top + 0.25);
  }
}

// ------------------------------------------------------------------ JR Shibuya station block
export function jrStation(kit, h) {
  const ring = mainRing(h);
  if (!ring) return;
  const R = insetRing(ring, 0.15);
  kit.seed(21);
  const top = h.h || 10.7;
  // concourse glazing below, station-building bands above; lit concourses at night
  walls(kit, R, 0, 4.6, mat('#c7cdcf', [PAT.GLASS, 2.4, 4.6, 0.95]));
  walls(kit, R, 4.6, top, mat('#cfccc4', [PAT.BANDS, 0.45, 3.0, 0.85]));
  kit.cap(R, top, '#5f6266', [PAT.PLAIN, 0.9, 0.1, 0]);
  // Hachiko exit: lit canopy and the station sign facing the square
  const exitB = h.exit_bearing ?? 265;
  let best = null;
  for (const e of ringEdges(R)) if (angDiff(facing(e), exitB) < 30 && (!best || e.len > best.len)) best = e;
  if (best) {
    const e = best;
    const w = Math.min(e.len - 4, 24), u0 = (e.len - w) / 2;
    const cx = e.a[0] + e.dir[0] * (u0 + w / 2) + e.n[0] * 1.35, cz = e.a[1] + e.dir[1] * (u0 + w / 2) + e.n[1] * 1.35;
    const ang = Math.atan2(e.dir[1], e.dir[0]);
    kit.box(cx, cz, w, 2.5, 4.3, 4.75, ang, plain('#e9ebe8', 0.6, 0.2, 0.55), plain('#8c9094', 0.7, 0.3));
    const b = facing(e);
    const mx = e.a[0] + e.dir[0] * (u0 + w / 2), mz = e.a[1] + e.dir[1] * (u0 + w / 2);
    panel(kit, mx, 6.6, mz, b, 10, 1.5, '#f2f1ea', [PAT.PLAIN, 0.5, 0, 0.95], 0.2);
    // JR green tile at the sign's left end
    const [rx, rz] = [e.n[1], -e.n[0]];
    const sl = Math.sign(rx * e.dir[0] + rz * e.dir[1]) || 1;
    panel(kit, mx - e.dir[0] * sl * 4.2, 6.6, mz - e.dir[1] * sl * 4.2, b, 1.2, 1.2, '#16a34a', [PAT.PLAIN, 0.5, 0, 0.8], 0.36);
    for (let i = 0; i < 6; i++) {
      panel(kit, mx + e.dir[0] * sl * (-2.6 + i * 1.25), 6.6, mz + e.dir[1] * sl * (-2.6 + i * 1.25), b, 0.85, 0.9, '#1f2937', [PAT.PLAIN, 0.6, 0, 0], 0.36);
    }
  }
}

export { wallQuad, mountedScreen };
