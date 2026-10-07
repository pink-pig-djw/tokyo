// Tokyo Station (Marunouchi / Yaesu): the 1914 red-brick station building with its two domes,
// the platform field with canopies and parked trains, GranRoof, the Yaesu and Marunouchi
// towers, Torch Tower under construction and the Yaesu izakaya streets.
// Data: tools/districts/tokyostation.json -> manifest.districts[] (see ./kit.js for the Kit).
import { PAT, ringArea, ringCentroid, ringEdges, ringOBB, insetRing, rectRing } from './kit.js';
import {
  DEG, makeFrame, polyRing, loft, hipRoof, ledge, arch, panelOut, oquad, bandedBox, nose, along, polyLength,
  cap, prism, box, slab,
} from './tokyostation-geom.js';

const biggest = (rings) => rings.reduce((a, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(a)) ? r : a), rings[0]);
const plain = (color, rough = 0.8, metal = 0, glow = 0) => ({ color, style: [PAT.PLAIN, rough, metal, glow] });
const S = (color, style) => ({ color, style });

// ------------------------------------------------------------------ the station building
const STATION_COLORS = {
  brick: '#ad4930', stone: '#e6dfcf', slate: '#4a4d53', dome: '#45474c', bronze: '#8a7550', granite: '#cfc8b8',
};
function station(kit, h) {
  const F = makeFrame(h.frame.cx, h.frame.cz, h.frame.bearing);
  const C = STATION_COLORS;
  const W = 10.8;
  const brick = S(C.brick, [PAT.BRICK, 3.6, 5.4, 0.8]);
  const stone = plain(C.stone, 0.6, 0, 0.5);
  const granite = plain(C.granite, 0.7, 0, 0.12);
  const slate = plain(C.slate, 0.78, 0.04, 0);
  const domeM = plain(C.dome, 0.55, 0.35, 0.22);
  const bronze = plain(C.bronze, 0.45, 0.6, 0.35);
  const westB = F.bearing - 90, eastB = F.bearing + 90;

  // a brick block: plinth, walls, cornice, hipped slate roof
  const block = (ring, eave, steps, seed) => {
    kit.seed(seed);
    ledge(kit, ring, 0.15, 0, 1.3, granite.color, granite.style);
    kit.walls(ring, 1.3, eave, brick.color, brick.style, { u0: 1.3 });
    const cr = ledge(kit, ring, 0.45, eave, eave + 0.7, stone.color, stone.style);
    hipRoof(kit, ring, eave + 0.7, steps, slate.color, slate.style);
    return cr;
  };

  // 1. the long body (straight wings + the angled south end), one continuous slate roof
  const body = F.ring([[134.8, W], [-136.5, W], [-177.0, -30.5], [-160.5, -41.6], [-128.1, -W], [134.8, -W]]);
  block(body, h.eave - 0.5, [[3.0, h.eave + 4.3], [9.5, h.ridge]], 1);

  // 2. pavilions: centre (taller hipped roof), intermediates, ends
  const rectST = (s0, s1, t0, t1) => F.ring([[s0, t0], [s1, t0], [s1, t1], [s0, t1]]);
  const cH = h.centre;
  const centre = rectST(-cH.half, cH.half, -12.2, 12.4);
  block(centre, cH.wall, [[4.4, 24.6], [7.6, cH.top - 0.8]], 2);
  // ridge cresting of the central roof
  {
    const r = rectST(-cH.half + 8.4, cH.half - 8.4, -0.5, 0.5);
    prism(kit, r, cH.top - 0.8, cH.top, bronze, bronze);
  }
  for (const s of h.pavilions) block(rectST(s - 6.5, s + 6.5, -11.8, 13.1), 17.4, [[3.0, 21.6], [5.6, 23.6]], 3);
  block(rectST(117.5, 135.6, -11.7, 11.7), 17.4, [[3.0, 21.6], [6.0, 23.6]], 4);
  {
    const end = F.ring([[-165.2, -18.9], [-178.2, -31.7], [-160.0, -43.2], [-148.6, -30.9]]);
    block(end, 17.4, [[3.0, 21.6], [6.0, 23.6]], 5);
  }

  // 3. dormers on the wing roofs (hotel rooms in the attic), front at the lower roof slope
  const dormerFront = S('#d9d2c2', [PAT.STONE, 1.9, 3.0, 0.75]);
  const dormer = (s, side, tF, tB, hw, y0, y1, yr, front) => {
    const p = (ss, tt, y) => { const q = F.P(ss, tt); return [q[0], y, q[1]]; };
    const inside = p(s, side * 2, y0);
    const a = s - hw, b = s + hw;
    oquad(kit, inside, p(a, tF, y0), p(b, tF, y0), p(b, tF, y1), p(a, tF, y1), front.color, front.style,
      [[0, 0], [2 * hw, 0], [2 * hw, y1 - y0], [0, y1 - y0]]);
    oquad(kit, inside, p(a, tF, y1), p(b, tF, y1), p(s, tF, yr), p(s, tF, yr), C.stone, stone.style);
    oquad(kit, inside, p(a, tF, y0), p(a, tB, y0), p(a, tB, y1), p(a, tF, y1), slate.color, slate.style);
    oquad(kit, inside, p(b, tF, y0), p(b, tB, y0), p(b, tB, y1), p(b, tF, y1), slate.color, slate.style);
    const o = side * 0.25;
    oquad(kit, inside, p(a - 0.15, tF + o, y1 - 0.12), p(s, tF + o, yr + 0.05), p(s, tB, yr + 0.05), p(a - 0.15, tB, y1 - 0.12), slate.color, slate.style);
    oquad(kit, inside, p(b + 0.15, tF + o, y1 - 0.12), p(s, tF + o, yr + 0.05), p(s, tB, yr + 0.05), p(b + 0.15, tB, y1 - 0.12), slate.color, slate.style);
  };
  const keep = kit.uShift;
  kit.uShift = 0;
  for (let s = -126; s <= 112; s += 7.2) {
    if (Math.abs(s) < cH.half + 2.5) continue;
    if (h.pavilions.some((p) => Math.abs(s - p) < 8.5)) continue;
    if (Math.abs(Math.abs(s) - h.hall.s) < h.hall.apothem + 2.5) continue;
    for (const side of [1, -1]) dormer(s, side, side * (W - 1.3), side * (W - 4.6), 1.0, h.eave + 1.0, h.eave + 3.2, h.eave + 4.4, dormerFront);
  }
  // big central gable over the imperial entrance (west) and its twin on the track side
  for (const side of [1, -1]) {
    dormer(0, side, side * 11.3, side * 6.0, 4.6, cH.wall + 0.9, cH.wall + 4.2, cH.wall + 7.2, S('#e6dfcf', [PAT.STONE, 3.0, 3.3, 0.85]));
  }
  kit.uShift = keep;

  // 4. the two octagonal dome halls with their domes
  for (const [i, sgn] of [[0, -1], [1, 1]]) {
    const s = sgn * h.hall.s;
    const hall = polyRing(F, s, 0, h.hall.apothem);
    kit.seed(10 + i);
    ledge(kit, hall, 0.15, 0, 1.3, granite.color, granite.style);
    kit.walls(hall, 1.3, h.hall.wall, brick.color, brick.style, { u0: 1.3 });
    const top = h.hall.wall + 0.75;
    ledge(kit, hall, 0.5, h.hall.wall, top, stone.color, stone.style);
    // concave skirt, then the convex helmet dome, lantern and finial
    const prof = [[h.hall.apothem, top], [15.4, top + 2.4], [12.9, top + 4.4], [11.3, h.hall.skirt_top]];
    const dome = [[12.2, 29.4], [12.0, 30.8], [11.0, 32.2], [9.0, 33.4], [6.2, 34.3], [2.6, h.dome.top]];
    let prev = hall, py = top;
    for (let k = 1; k < prof.length; k++) {
      const r = polyRing(F, s, 0, prof[k][0]);
      loft(kit, prev, py, r, prof[k][1], slate.color, slate.style);
      prev = r; py = prof[k][1];
    }
    // bronze band at the foot of the dome
    {
      const r = polyRing(F, s, 0, 11.6);
      loft(kit, prev, py, r, py + 0.6, bronze.color, bronze.style);
      prev = r; py += 0.6;
    }
    for (const [a, y] of dome) {
      const r = polyRing(F, s, 0, a);
      loft(kit, prev, py, r, y, domeM.color, domeM.style);
      prev = r; py = y;
    }
    cap(kit, prev, py, domeM.color, domeM.style);
    const lan = polyRing(F, s, 0, 1.5);
    kit.walls(lan, py - 0.2, py + 1.4, C.bronze, [PAT.PLAIN, 0.4, 0.5, 0.9]);
    cap(kit, lan, py + 1.4, bronze.color, bronze.style);
    const fin = polyRing(F, s, 0, 0.45);
    const tip = polyRing(F, s, 0, 0.04);
    loft(kit, fin, py + 1.4, tip, h.dome.finial, bronze.color, bronze.style);
    // round dormers (oeil-de-boeuf) on the eight faces of the skirt
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4;
      const a = 14.4;
      const [x, z] = F.P(s + a * Math.cos(ang), a * Math.sin(ang));
      // bearing of the face normal: local direction (cos, sin) in (s, t)
      const dx = Math.cos(ang) * F.ax[0] + Math.sin(ang) * F.lw[0];
      const dz = Math.cos(ang) * F.ax[1] + Math.sin(ang) * F.lw[1];
      const br = (Math.atan2(dx, -dz) / DEG + 360) % 360;
      panelOut(kit, x, top + 2.3, z, br, 1.7, 1.7, '#d9d2c2', [PAT.STONE, 1.7, 2.2, 0.8], 0.55);
    }
  }

  // 5. one-storey entrance porches wrapped around the west side of the domes (south: boarding,
  //    north: arrival), arcaded, flat roof with balustrade
  const porchBrick = S(C.brick, [PAT.BRICK, 4.2, 7.6, 0.6]);
  const opening = plain('#5a4632', 0.6, 0, 1.1);
  h.porch_xz.forEach((ring, i) => {
    kit.seed(20 + i);
    ledge(kit, ring, 0.15, 0, 1.0, granite.color, granite.style);
    kit.walls(ring, 1.0, 7.6, porchBrick.color, porchBrick.style, { u0: 1.0 });
    ledge(kit, ring, 0.45, 7.6, 8.3, stone.color, stone.style);
    const hc = F.P((i === 0 ? -1 : 1) * h.hall.s, 0);
    // pick the porch nearer to each hall
    const c = ringCentroid(ring);
    const hcc = Math.hypot(c[0] - hc[0], c[1] - hc[1]) < 40 ? hc : F.P((i === 0 ? 1 : -1) * h.hall.s, 0);
    const bal = insetRing(ring, 0.35);
    kit.walls(bal, 8.3, 9.2, stone.color, stone.style);
    for (const e of ringEdges(ring)) {
      const d = Math.hypot(e.mid[0] - hcc[0], e.mid[1] - hcc[1]);
      if (e.len < 5 || d < 24) continue;
      const br = (Math.atan2(e.n[0], -e.n[1]) / DEG + 360) % 360;
      const n = Math.max(1, Math.floor(e.len / 5.2));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        arch(kit, e.a[0] + (e.b[0] - e.a[0]) * f, e.a[1] + (e.b[1] - e.a[1]) * f, br, 3.0, 5.6, 1.0, opening.color, opening.style, 0.18);
      }
    }
  });

  // 6. imperial entrance porch at the centre (porte-cochere on four piers)
  {
    const p = (s, t) => F.P(s, t);
    for (const [s, t] of [[-3.3, 18.4], [3.1, 18.4], [-3.3, 13.2], [3.1, 13.2]]) {
      const [x, z] = p(s, t);
      box(kit, x, z, 1.1, 1.1, 0, 5.8, (F.bearing - 90) * DEG, brick, brick);
    }
    const roof = F.ring([[-3.9, 12.4], [3.7, 12.4], [3.7, 19.0], [-3.9, 19.0]]);
    prism(kit, roof, 5.8, 6.9, stone, stone, { bottom: true });
    kit.walls(insetRing(roof, 0.3), 6.9, 7.6, stone.color, stone.style);
    // glowing entrance doors behind
    const [x, z] = p(0, cH.half > 0 ? 12.4 : W);
    panelOut(kit, x, 3.0, z, westB, 4.2, 4.6, opening.color, opening.style, 0.2);
  }
  return F;
}

// ------------------------------------------------------------------ platforms, canopies, trains
const LIVERIES = {
  n700: { body: '#f4f6f7', roof: '#e3e7ea', bands: [[0, 0.12, '#f4f6f7'], [0.12, 0.19, '#1f4fa2'], [0.19, 0.3, '#f4f6f7'], [0.3, 0.62, 'W'], [0.62, 1, '#f4f6f7']], nose: 10.7, shin: true },
  e5: { body: '#00a37a', lower: '#f2f4f2', roof: '#008f6b', bands: [[0, 0.26, '#f2f4f2'], [0.26, 0.31, '#f2a7c3'], [0.31, 0.36, '#00a37a'], [0.36, 0.62, 'W'], [0.62, 1, '#00a37a']], nose: 15, shin: true },
  e6: { body: '#c4002b', lower: '#e8eaea', roof: '#b0001f', bands: [[0, 0.3, '#e8eaea'], [0.3, 0.36, '#9ea3a8'], [0.36, 0.4, '#c4002b'], [0.4, 0.62, 'W'], [0.62, 1, '#c4002b']], nose: 13, shin: true },
  e7: { body: '#f2efe6', roof: '#4f9fd3', bands: [[0, 0.28, '#f2efe6'], [0.28, 0.33, '#b87333'], [0.33, 0.38, '#f2efe6'], [0.38, 0.63, 'W'], [0.63, 0.7, '#f2efe6'], [0.7, 1, '#4f9fd3']], nose: 9.5, shin: true },
  chuo: { body: '#c9ccd0', roof: '#9fa3a8', bands: [[0, 0.08, '#c9ccd0'], [0.08, 0.16, '#f15a22'], [0.16, 0.28, '#c9ccd0'], [0.28, 0.62, 'W'], [0.62, 0.7, '#c9ccd0'], [0.7, 0.77, '#f15a22'], [0.77, 1, '#c9ccd0']] },
  yamanote: { body: '#c9ccd0', roof: '#9fa3a8', bands: [[0, 0.28, '#c9ccd0'], [0.28, 0.62, 'W'], [0.62, 0.66, '#c9ccd0'], [0.66, 0.8, '#80c241'], [0.8, 1, '#c9ccd0']] },
  keihin: { body: '#c9ccd0', roof: '#9fa3a8', bands: [[0, 0.08, '#c9ccd0'], [0.08, 0.16, '#00b2e5'], [0.16, 0.28, '#c9ccd0'], [0.28, 0.62, 'W'], [0.62, 0.7, '#c9ccd0'], [0.7, 0.77, '#00b2e5'], [0.77, 1, '#c9ccd0']] },
  shonan: { body: '#c9ccd0', roof: '#9fa3a8', bands: [[0, 0.07, '#c9ccd0'], [0.07, 0.13, '#f68b1f'], [0.13, 0.19, '#00a14b'], [0.19, 0.28, '#c9ccd0'], [0.28, 0.62, 'W'], [0.62, 1, '#c9ccd0']] },
};
const WIN = [PAT.GLASS, 1.4, 6.0, 0.85];

function train(kit, t) {
  const L = LIVERIES[t.livery] || LIVERIES.chuo;
  const y0 = t.rail + 1.42, y1 = t.rail + (L.shin ? 3.95 : 4.05);
  const hw = L.shin ? 1.6 : 1.42;
  const bodyS = [PAT.PLAIN, 0.35, 0.25, 0];
  const bands = L.bands.map(([a, b, c]) => (c === 'W' ? [a, b, '#2a3138', WIN] : [a, b, c, bodyS]));
  const total = polyLength(t.pts);
  const gap = 0.6;
  for (let k = 0; k < t.cars; k++) {
    let d0 = k * (t.car + gap), d1 = d0 + t.car;
    if (d1 > total) break;
    const lastCar = k === t.cars - 1 || (k + 1) * (t.car + gap) + t.car > total;
    let noseStart = null, noseEnd = null;
    if (L.nose && k === 0) { noseStart = d0; d0 += L.nose; }
    if (L.nose && lastCar) { noseEnd = d1; d1 -= L.nose; }
    const A = along(t.pts, d0), B = along(t.pts, d1);
    bandedBox(kit, A.p, B.p, hw, y0, y1, bands, plain(L.roof, 0.4, 0.3), { ...plain(L.body, 0.4, 0.2), start: !L.nose || k !== 0, end: !L.nose || !lastCar });
    const bodyM = plain(L.body, 0.35, 0.25), lowM = plain(L.lower || L.body, 0.35, 0.25), glass = plain('#1d242b', 0.1, 0.6);
    if (noseStart !== null) nose(kit, A.p, [-A.dir[0], -A.dir[1]], hw, y0, y1, L.nose, 0.3, 0.35, bodyM, glass, lowM);
    if (noseEnd !== null) nose(kit, B.p, B.dir, hw, y0, y1, L.nose, 0.3, 0.35, bodyM, glass, lowM);
    if (lastCar) break;
  }
}

function trackField(kit, h) {
  const deckTop = plain('#9c9ea2', 0.85, 0, 0.1);
  const deckSide = plain('#7d8086', 0.85, 0, 0);
  const canTop = plain('#d4d7da', 0.6, 0.2, 0);
  const canTopS = plain('#c4c9ce', 0.55, 0.3, 0);
  const canUnder = plain('#f3f1ea', 0.7, 0, 0.55);
  const col = plain('#e4e5e1', 0.5, 0.3, 0);
  const sky = S('#dfe8ec', [PAT.MEMBRANE, 0, 0, 0]);
  for (const p of h.platforms) {
    const rail = p.rail;
    const top = rail + 1.35;
    const shin = p.group === 'tohoku' || p.group === 'tokaido';
    // raised Chuo deck: a solid structure under the upper platform, between the lower tracks
    if (p.group === 'chuo') {
      const base = insetRing(p.deck_xz, -1.0);
      kit.seed(31);
      kit.walls(base, 7.3, 12.5, '#a7a9ab', [PAT.STONE, 4.0, 5.2, 0.3]);
      cap(kit, base, 12.5, deckSide.color, deckSide.style);
    }
    kit.walls(p.deck_xz, rail - 0.25, top, deckSide.color, deckSide.style);
    cap(kit, p.deck_xz, top, deckTop.color, deckTop.style);
    // canopy: thin slab on columns along the platform spine, glowing underside at night
    const cb = p.group === 'chuo' ? rail + 5.2 : shin ? rail + 6.3 : rail + 4.9;
    const ct = cb + (shin ? 0.9 : 0.7);
    const can = p.canopy_xz;
    kit.walls(can, cb, ct, canTop.color, canTop.style);
    cap(kit, can, ct, shin ? canTopS.color : canTop.color, shin ? canTopS.style : canTop.style);
    cap(kit, can, cb, canUnder.color, canUnder.style, true);
    if (shin) {
      // translucent ridge skylight along the middle of the Shinkansen canopies
      const o = ringOBB(can);
      const spine = p.spine_xz || [];
      for (let i = 0; i + 1 < spine.length; i++) {
        const a = spine[i], b = spine[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 2) continue;
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        box(kit, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, L, Math.min(4, o.wid * 0.18), ct, ct + 0.55, ang, sky, sky);
      }
    }
    // columns
    const spine = p.spine_xz || [];
    const SL = polyLength(spine);
    const rows = shin ? [-2.6, 2.6] : [0];
    for (let d = 6; d < SL - 3; d += 12) {
      const q = along(spine, d);
      const nx = -q.dir[1], nz = q.dir[0];
      for (const r of rows) box(kit, q.p[0] + nx * r, q.p[1] + nz * r, 0.5, 0.5, top, cb, Math.atan2(q.dir[1], q.dir[0]), col, col);
    }
  }
  for (const t of h.trains || []) train(kit, t);
}

// ------------------------------------------------------------------ GranRoof (Yaesu)
function strut(kit, a, b, w, m) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz) || 1;
  // two perpendicular offsets
  let px = -dz, pz = dx; const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
  const qx = (dy * pz) / L, qy = (dz * px - dx * pz) / L, qz = (-dy * px) / L;
  const o = [[px * w / 2, 0, pz * w / 2], [qx * w / 2, qy * w / 2, qz * w / 2]];
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const cs = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([s, t]) => [s * o[0][0] + t * o[1][0], s * o[0][1] + t * o[1][1], s * o[0][2] + t * o[1][2]]);
  for (let k = 0; k < 4; k++) {
    const u = cs[k], v = cs[(k + 1) % 4];
    oquad(kit, c, [a[0] + u[0], a[1] + u[1], a[2] + u[2]], [a[0] + v[0], a[1] + v[1], a[2] + v[2]],
      [b[0] + v[0], b[1] + v[1], b[2] + v[2]], [b[0] + u[0], b[1] + u[1], b[2] + u[2]], m.color, m.style);
  }
}

function granRoof(kit, h) {
  if (!h.rings.length) return;
  const ring = biggest(h.rings);
  const o = ringOBB(ring);
  let ux = Math.cos(o.angle), uz = Math.sin(o.angle);
  let nx = -uz, nz = ux;
  if (nx < 0) { nx = -nx; nz = -nz; }                    // n points east (to the Yaesu plaza)
  const P = (s, t) => [o.cx + ux * s + nx * t, o.cz + uz * s + nz * t];
  const L = o.len, Wd = o.wid;
  const glass = S('#8fa3b1', [PAT.GLASS, 1.8, 4.8, 0.7]);
  kit.seed(41);
  // two-storey glazed concourse under the roof (west part), deck on top
  const base = [P(-L / 2 + 1, -Wd / 2 + 0.5), P(L / 2 - 1, -Wd / 2 + 0.5), P(L / 2 - 1, Wd / 2 - 9), P(-L / 2 + 1, Wd / 2 - 9)];
  kit.walls(base, 0, 9.4, glass.color, glass.style);
  const deck = [P(-L / 2, -Wd / 2), P(L / 2, -Wd / 2), P(L / 2, Wd / 2 - 3), P(-L / 2, Wd / 2 - 3)];
  prism(kit, deck, 9.4, 10.3, plain('#d6d8d9', 0.7), plain('#bfc3c6', 0.8), { bottom: true });
  const rail = [P(-L / 2 + 0.3, Wd / 2 - 3.3), P(L / 2 - 0.3, Wd / 2 - 3.3), P(L / 2 - 0.3, Wd / 2 - 3.25), P(-L / 2 + 0.3, Wd / 2 - 3.25)];
  kit.walls(rail, 10.3, 11.4, '#b8c8d2', [PAT.GLASS, 1.5, 3, 0]);
  // membrane: bays between masts; plaza edge waves between 27 m (masts) and 22 m
  const bays = h.bays || 10;
  const nS = bays * 4, nT = 4;
  const yW = h.membrane_low_edge || 14, yPk = h.membrane_peak || 27;
  const tW = -Wd / 2, tE = Wd / 2 + 4;
  const mem = S('#f4f6f6', [PAT.MEMBRANE, 0, 0, 0]);
  const grid = [];
  for (let i = 0; i <= nS; i++) {
    const s = -L / 2 + (L * i) / nS;
    const ph = (i % 4) / 4;
    const ye = yPk - 5 * Math.sin(ph * Math.PI);
    const row = [];
    for (let j = 0; j <= nT; j++) {
      const f = j / nT;
      const [x, z] = P(s, tW + (tE - tW) * f);
      row.push([x, yW + (ye - yW) * Math.pow(f, 1.5) - 0.8 * Math.sin(ph * Math.PI) * Math.sin(f * Math.PI), z]);
    }
    grid.push(row);
  }
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nT; j++) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
      kit.quad(a, b, c, d, mem.color, mem.style);
      kit.quad(d, c, b, a, mem.color, mem.style);
    }
  }
  // masts at the plaza edge and the beam on the track side
  const steel = plain('#e2e4e6', 0.4, 0.5);
  for (let i = 0; i <= nS; i += 4) {
    const top = grid[i][nT];
    const [fx, fz] = P(-L / 2 + (L * i) / nS, Wd / 2 - 4);
    strut(kit, [fx, 0, fz], [fx, 10.3, fz], 0.7, steel);
    strut(kit, [fx, 10.3, fz], [top[0], top[1] + 0.2, top[2]], 0.5, steel);
    const w = grid[i][0];
    strut(kit, [w[0], 10.3, w[2]], [w[0], w[1], w[2]], 0.6, steel);
  }
}

// ------------------------------------------------------------------ towers
function sail(ring, bow) {
  // bow the long edges of a ring outwards (sail-like faces)
  const out = [];
  const edges = ringEdges(ring);
  const maxL = Math.max(...edges.map((e) => e.len));
  for (const e of edges) {
    out.push(e.a);
    if (e.len > 0.6 * maxL) {
      for (let k = 1; k < 6; k++) {
        const f = k / 6;
        const b = bow * Math.sin(f * Math.PI);
        out.push([e.a[0] + (e.b[0] - e.a[0]) * f + e.n[0] * b, e.a[1] + (e.b[1] - e.a[1]) * f + e.n[1] * b]);
      }
    }
  }
  return out;
}

function corners(kit, ring, y, n = 2) {
  const o = ringOBB(ring);
  const pts = rectRing(o.cx, o.cz, o.len - 2, o.wid - 2, o.angle);
  for (let k = 0; k < Math.min(n, 4); k++) kit.aviation([pts[k * (n === 2 ? 2 : 1)][0], y + 1.2, pts[k * (n === 2 ? 2 : 1)][1]]);
}

function tofrom(kit, h) {
  const block = biggest(h.rings);
  const tower = h.tower_ring_xz;
  kit.seed(51);
  // podium: a stack of offset boxes in stone and metal tones with glazed gaps
  const o = ringOBB(block);
  const podTones = ['#c9c2b6', '#a9a49c', '#d8d3ca', '#b9b2a6'];
  kit.walls(insetRing(block, 0.3), 0, 12, '#5f6f7a', [PAT.GLASS, 2.2, 6, 0.7]);
  cap(kit, insetRing(block, 0.3), 12, '#8a8d8f', [PAT.PLAIN, 0.8, 0, 0]);
  const boxes = [[-0.28, -0.1, 0.42, 0.78, 12.4, 25], [0.2, 0.12, 0.5, 0.7, 12.4, 31], [-0.25, 0.05, 0.4, 0.65, 25.4, 38], [0.22, -0.12, 0.45, 0.6, 31.4, 45]];
  boxes.forEach(([fs, ft, fl, fw, y0, y1], k) => {
    const cx = o.cx + Math.cos(o.angle) * fs * o.len - Math.sin(o.angle) * ft * o.wid;
    const cz = o.cz + Math.sin(o.angle) * fs * o.len + Math.cos(o.angle) * ft * o.wid;
    box(kit, cx, cz, fl * o.len, fw * o.wid, y0, y1, o.angle, S(podTones[k], [PAT.STONE, 2.4, 4.6, 0.5]), plain('#7f8a73', 0.9));
  });
  // tower: bluish glass shaft, crown with vertical slits lit at night
  kit.seed(52);
  kit.walls(tower, 12, h.h - 30, '#7f98aa', [PAT.GLASS, 1.5, 4.4, 0.55]);
  kit.walls(tower, h.h - 30, h.h - 3, '#9fb3c1', [PAT.FINS, 1.2, 4.4, 0.95]);
  const par = insetRing(tower, 0.6);
  kit.walls(tower, h.h - 3, h.h, '#d3d8dc', [PAT.PLAIN, 0.5, 0.4, 0.3]);
  cap(kit, tower, h.h, '#6d7378', [PAT.PLAIN, 0.8, 0.2, 0]);
  prism(kit, insetRing(par, 6), h.h, h.h + 4, plain('#8d9398', 0.7, 0.3));
  corners(kit, tower, h.h, 4);
}

function midtown(kit, h) {
  const block = biggest(h.rings);
  kit.seed(61);
  kit.walls(block, 0, h.podium_h, '#cfc8bc', [PAT.STONE, 2.0, 4.6, 0.55]);
  cap(kit, block, h.podium_h, '#7d8f5e', [PAT.PLAIN, 0.95, 0, 0]);
  ledge(kit, block, 0.4, h.podium_h - 0.6, h.podium_h + 0.3, '#e3e1da', [PAT.PLAIN, 0.6, 0, 0.1], false);
  const tw = sail(h.tower_ring_xz, 2.6);
  kit.seed(62);
  const crown = h.h - 26;
  kit.walls(tw, h.podium_h, crown, '#8aa0ae', [PAT.FINS, 1.5, 4.6, 0.55]);
  kit.walls(tw, crown, h.h - 2, '#a3b3bc', [PAT.GLASS, 1.6, 4.6, 0.85]);
  kit.walls(tw, h.h - 2, h.h, '#e3e6e8', [PAT.PLAIN, 0.5, 0.3, 0.3]);
  cap(kit, tw, h.h, '#6d7378', [PAT.PLAIN, 0.8, 0.2, 0]);
  corners(kit, h.tower_ring_xz, h.h, 4);
}

function jpKitte(kit, h) {
  const kitte = h.kitte_rings_xz[0];
  const atrium = h.kitte_rings_xz[1];
  kit.seed(71);
  ledge(kit, kitte, 0.12, 0, 1.2, '#cfcac0', [PAT.PLAIN, 0.7, 0, 0.1]);
  kit.walls(kitte, 1.2, h.kitte_h, '#f1efe8', [PAT.STONE, 2.9, 5.2, 0.6]);
  ledge(kit, kitte, 0.35, h.kitte_h, h.kitte_h + 0.6, '#f6f4ee', [PAT.PLAIN, 0.6, 0, 0.15], false);
  cap(kit, kitte, h.kitte_h + 0.6, '#7f9a5c', [PAT.PLAIN, 0.95, 0, 0]);          // roof garden lawn
  kit.walls(insetRing(kitte, 0.3), h.kitte_h + 0.6, h.kitte_h + 1.7, '#e9ece9', [PAT.PLAIN, 0.4, 0.3, 0.2]);
  if (atrium) prism(kit, atrium, h.kitte_h - 1.5, h.kitte_h - 0.4, plain('#9fb4c0', 0.15, 0.6, 0.3), plain('#9fb4c0', 0.15, 0.6, 0.3));
  kit.seed(72);
  const tw = h.tower_ring_xz;
  kit.walls(tw, 0, h.tower_h - 1.5, '#7d93a3', [PAT.GLASS, 1.2, 4.3, 0.55]);
  kit.walls(tw, h.tower_h - 1.5, h.tower_h, '#e6e8ea', [PAT.PLAIN, 0.5, 0.3, 0.4]);
  cap(kit, tw, h.tower_h, '#70777d', [PAT.PLAIN, 0.8, 0.2, 0]);
  corners(kit, tw, h.tower_h, 2);
}

function podiumTower(kit, h, rings, seed) {
  // Marunouchi "100-shaku" massing: stone podium (31-34 m) with a cornice, glass tower above
  const pod = biggest(h.rings);
  kit.seed(seed);
  ledge(kit, pod, 0.12, 0, 1.5, '#b9ab96', [PAT.PLAIN, 0.7, 0, 0.1]);
  kit.walls(pod, 1.5, h.podium_h, '#cbb89a', [PAT.STONE, 3.0, 4.3, 0.6]);
  ledge(kit, pod, 0.5, h.podium_h - 0.8, h.podium_h, '#ddd2bf', [PAT.PLAIN, 0.6, 0, 0.15], false);
  cap(kit, pod, h.podium_h, '#8f8e8a', [PAT.PLAIN, 0.9, 0, 0]);
  kit.seed(seed + 1);
  for (const [ring, y1, crown] of rings) {
    kit.walls(ring, h.podium_h, y1 - (crown ? 9 : 0), '#8c9aa4', [PAT.GLASS, 1.5, 4.3, 0.55]);
    if (crown) kit.walls(ring, y1 - 9, y1, '#d8d2c6', [PAT.FINS, 1.8, 4.3, 0.9]);
    cap(kit, ring, y1, '#757a7e', [PAT.PLAIN, 0.8, 0.2, 0]);
  }
}

function torchTower(kit, h) {
  const ring = h.points;
  if (!ring || ring.length < 3) return;
  const o = ringOBB(ring);
  const progress = h.steel_top || 192;
  kit.seed(81);
  // diagrid podium, glazed shaft, bare steel floors, concrete core, tower cranes
  kit.walls(ring, 0, h.diagrid_podium_h, '#8d9aa4', [PAT.METAL, 6.5, 6.5, 0.4]);
  kit.walls(ring, h.diagrid_podium_h, h.curtain_wall_top, '#7d90a0', [PAT.GLASS, 1.5, 4.2, 0.05]);
  cap(kit, ring, h.curtain_wall_top, '#9a9c9e', [PAT.PLAIN, 0.9, 0, 0]);
  const steel = plain('#8a8f94', 0.6, 0.5);
  const slabM = plain('#c8c4bc', 0.9, 0);
  for (let y = h.curtain_wall_top + 4.2; y <= progress; y += 4.2) slab(kit, insetRing(ring, 0.2), y - 0.35, y, slabM.color, slabM.style);
  const cr = rectRing(o.cx, o.cz, o.len - 1, o.wid - 1, o.angle);
  for (const [x, z] of cr) box(kit, x, z, 1.2, 1.2, h.curtain_wall_top, progress, o.angle, steel, steel);
  const edge = rectRing(o.cx, o.cz, o.len, o.wid, o.angle);
  for (let k = 0; k < 4; k++) {
    const a = edge[k], b = edge[(k + 1) % 4];
    for (let f = 1; f < 6; f++) {
      const x = a[0] + (b[0] - a[0]) * f / 6, z = a[1] + (b[1] - a[1]) * f / 6;
      box(kit, x, z, 0.8, 0.8, h.curtain_wall_top, progress - 4.2, o.angle, steel, steel);
    }
  }
  // safety screen at the top working floors
  kit.walls(insetRing(ring, -0.3), progress - 6, progress + 1.5, '#d5643a', [PAT.METAL, 1.5, 1.5, 0.8]);
  box(kit, o.cx, o.cz, o.len * 0.42, o.wid * 0.42, h.curtain_wall_top, h.core_top || progress + 8, o.angle, plain('#b9b6ae', 0.95), plain('#a8a59e', 0.95));
  crane: for (const c of h.cranes || []) {
    const [ox, oz] = c.xz_offset;
    const x = o.cx + ox * Math.cos(o.angle) - oz * Math.sin(o.angle);
    const z = o.cz + ox * Math.sin(o.angle) + oz * Math.cos(o.angle);
    tower_crane(kit, x, z, progress - 4, c.height, c.jib, Math.atan2(-oz, -ox) + o.angle + Math.PI);
    if (!Number.isFinite(x)) break crane;
  }
}

function tower_crane(kit, x, z, y0, y1, jib, ang) {
  const white = plain('#e3e2da', 0.6, 0.3);
  const red = plain('#c24a2b', 0.7, 0.1);
  box(kit, x, z, 2.0, 2.0, y0, y1, ang, S('#e3e2da', [PAT.METAL, 0.9, 1.6, 0.6]), white);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  box(kit, x + ux * (jib / 2 - 1), z + uz * (jib / 2 - 1), jib, 1.4, y1, y1 + 1.6, ang, white, white);
  box(kit, x - ux * 8, z - uz * 8, 14, 1.6, y1, y1 + 1.4, ang, white, white);
  box(kit, x - ux * 13, z - uz * 13, 3.5, 2.4, y1 - 1.8, y1 + 1.4, ang, red, red);
  box(kit, x, z, 2.4, 2.4, y1 + 1.6, y1 + 5.5, ang, white, white);
  kit.aviation([x, y1 + 6.2, z], [x + ux * (jib - 1.5), y1 + 2.2, z + uz * (jib - 1.5)]);
}

function sites(kit, h) {
  const hoard = S('#e9ece8', [PAT.METAL, 1.8, 3.0, 0.7]);
  const ground = plain('#8a8073', 0.95, 0);
  (h.sites || []).forEach((st, i) => {
    const ring = st.polygon_xz;
    kit.walls(ring, 0, h.hoarding_h || 3, hoard.color, hoard.style);
    cap(kit, insetRing(ring, 0.2), 0.12, ground.color, ground.style);
    // site offices and cranes
    const o = ringOBB(ring);
    box(kit, o.cx - Math.cos(o.angle) * o.len * 0.3, o.cz - Math.sin(o.angle) * o.len * 0.3, 12, 5, 0.12, 5.6, o.angle, S('#dfe3e6', [PAT.STONE, 2.2, 2.8, 0.4]), plain('#8f9aa3'));
    for (let k = 0; k < (st.cranes || 0); k++) {
      const f = (k + 1) / (st.cranes + 1) - 0.5;
      const x = o.cx + Math.cos(o.angle) * o.len * f * 0.8, z = o.cz + Math.sin(o.angle) * o.len * f * 0.8;
      tower_crane(kit, x, z, 0.12, 62 + 9 * k, 45, o.angle + 1.2 + k * 1.9);
    }
    void i;
  });
}

// ------------------------------------------------------------------ street dressing
function signStreet(kit, st, seed) {
  // anchors: [x, z, bearing the wall faces, max height] precomputed on real building walls
  let k = 0;
  for (const a of st.anchors || []) {
    const [x, z, br, hmax, kind] = a;
    const r = Math.abs(Math.sin((k + 1) * 12.9898 + seed * 78.233) * 43758.5453) % 1;
    k++;
    if (kind === 1) {
      // vertical blade sign perpendicular to the wall, 0.9 m out
      const top = Math.min(hmax - 0.5, 9 + r * 14);
      const bot = Math.max(3.2, top - (5 + r * 8));
      if (top - bot < 2) continue;
      const b = br * DEG;
      const nx = Math.sin(b), nz = -Math.cos(b);
      const cx = x + nx * 0.75, cz = z + nz * 0.75;
      box(kit, cx, cz, 1.0, 0.35, bot, top, b, S('#ffffff', [PAT.SIGNS, 1.0, 1.6 + r, seed * 13 + k]), plain('#202020'));
    } else {
      // flat box sign / shop fascia on the wall
      const y = 3.4 + Math.floor(r * 4) * 3.2;
      if (y + 1.2 > hmax) continue;
      panelOut(kit, x, y, z, br, 3.5 + r * 3, 1.1 + r * 0.6, '#ffffff', [PAT.SIGNS, 3.0, 1.2, seed * 7 + k], 0.3);
    }
  }
}

function plaza(kit, st, F) {
  const ring = st.points;
  if (!ring || ring.length < 3) return;
  cap(kit, ring, 0.16, '#d9d4c9', [PAT.PLAIN, 0.85, 0, 0.25]);
  // the two lawns either side of the central walk (OSM: 654 / 619 m2), kerbed
  const lawn = plain('#6f9a4a', 0.95, 0, 0);
  const kerb = plain('#c9c3b6', 0.8);
  for (const sc of [-22, 14]) prism(kit, F.ring([[sc - 11, 73], [sc + 11, 73], [sc + 11, 101], [sc - 11, 101]]), 0.16, 0.3, kerb, lawn);
  // low warm bollard lights along the walk
  const lamp = plain('#fff1d6', 0.5, 0, 1.2);
  for (let t = 75; t <= 100; t += 6.25) {
    for (const s of [-10.4, 2.4]) {
      const [x, z] = F.P(s, t);
      box(kit, x, z, 0.3, 0.3, 0.16, 1.1, F.bearing * DEG, plain('#2b2b2b', 0.6, 0.4), lamp);
    }
  }
}

function gyokoDori(kit, st) {
  const pts = (st.points || []).concat(st.continues_xz || []);
  if (pts.length < 2) return;
  const w = (st.width || 30) / 2;
  const pave = plain('#d6d0c4', 0.85, 0, 0.25);
  const post = plain('#1f2022', 0.5, 0.5);
  const lampHead = plain('#ffe7c2', 0.5, 0, 1.3);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const r = rectRing((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, L + 0.5, 2 * w, ang);
    cap(kit, r, 0.16, pave.color, pave.style);
    // classic lamp posts along both edges of the strip
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    for (let d = 10; d < L; d += 20) {
      for (const sgn of [1, -1]) {
        const x = a[0] + ux * d - uz * sgn * (w - 1.5), z = a[1] + uz * d + ux * sgn * (w - 1.5);
        box(kit, x, z, 0.22, 0.22, 0.16, 4.2, ang, post, post);
        box(kit, x, z, 0.55, 0.55, 4.2, 4.9, ang, lampHead, post);
      }
    }
  }
}

function brickViaduct(kit, st) {
  // 1910 red-brick arcade under the Yamanote / Keihin-Tohoku tracks towards Yurakucho: brick
  // bays with lit openings (shops and bars under the arches), white coping under the girders
  const top = (st.deck || 7.5) - 1.25;
  const style = [PAT.BRICK, 6.5, top, 0.75];
  kit.seed(99);
  for (const seg of st.segments_xz || []) {
    let u = 0;
    for (let i = 0; i + 1 < seg.length; i++) {
      const a = seg[i], b = seg[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05) continue;
      let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
      if (nx > 0) { nx = -nx; nz = -nz; }                  // the arcade faces west (Marunouchi side)
      const inside = [(a[0] + b[0]) / 2 - nx * 2, top / 2, (a[1] + b[1]) / 2 - nz * 2];
      oquad(kit, inside, [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], '#9a4a35', style,
        [[u, 0], [u + L, 0], [u + L, top], [u, top]]);
      u += L;
    }
  }
}

export default {
  build(kit, d) {
    const H = Object.fromEntries((d.heroes || []).map((h) => [h.key, h]));
    let F = null;
    if (H.marunouchi_station) F = station(kit, H.marunouchi_station);
    if (H.track_field) trackField(kit, H.track_field);
    if (H.granroof) granRoof(kit, H.granroof);
    if (H.tofrom_yaesu_tower) tofrom(kit, H.tofrom_yaesu_tower);
    if (H.tokyo_midtown_yaesu) midtown(kit, H.tokyo_midtown_yaesu);
    if (H.jp_tower_kitte) jpKitte(kit, H.jp_tower_kitte);
    const mb = H.marunouchi_building;
    if (mb) {
      podiumTower(kit, mb, [[mb.tower_shaft_ring_xz, mb.tower_shaft_h, false], [mb.tower_top_ring_xz, mb.tower_top_h, true]], 91);
      corners(kit, mb.tower_top_ring_xz, mb.tower_top_h, 2);
    }
    const sm = H.shin_marunouchi_building;
    if (sm) {
      podiumTower(kit, sm, [[sm.tower_south_ring_xz, sm.tower_south_h, false], ...sm.fin_rings_xz.map((r) => [r, sm.fin_h, false]), [sm.tower_main_ring_xz, sm.tower_main_h, true]], 95);
      corners(kit, sm.tower_main_ring_xz, sm.tower_main_h, 2);
    }
    if (H.torch_tower_construction) torchTower(kit, H.torch_tower_construction);
    if (H.redevelopment_sites) sites(kit, H.redevelopment_sites);
    (d.signStreets || []).forEach((st, i) => signStreet(kit, st, i + 1));
    for (const st of d.street || []) {
      if (st.type === 'marunouchi_ekimae_plaza' && F) plaza(kit, st, F);
      else if (st.type === 'gyoko_dori_promenade') gyokoDori(kit, st);
      else if (st.type === 'brick_viaduct') brickViaduct(kit, st);
    }
  },
};
