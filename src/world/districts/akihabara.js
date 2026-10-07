// Akihabara: the JR two-level station (Sobu line on top of the Yamanote / Keihin-Tohoku decks),
// Radio Kaikan's yellow crown sign, Yodobashi Akiba, UDX, Don Quijote, the mAAch brick viaduct,
// the Sobu-line girder over Chuo-dori and the green Matsuzumicho tied arch, and the wall of
// blade signs and billboards along Chuo-dori / the back streets. Spec: tools/districts/akihabara.json
// (station decks, platforms, girders and street frontages are precomputed there from the real
// track and building geometry). Everything goes into the one district Kit.
import { PAT, ringOBB, ringEdges, rectRing, insetRing, ringCentroid } from './kit.js';
import { st, plain, rnd, panel, sbox, beam, wallsBy, wallsIn, bearingOf, nearestOn } from './akihabara-parts.js';
import { text, textWidth, textV } from './akihabara-glyphs.js';

// ------------------------------------------------------------------ palette
const M = {
  concrete: plain('#b4b0a7', 0.92),
  concreteDark: plain('#8f8b84', 0.92),
  ballast: plain('#5e5a55', 0.95),
  paving: plain('#cbc6b9', 0.9, 0, 0.2),
  canopyTop: st('#9fa4a5', PAT.METAL, 1.2, 40, 0.5),
  canopyEdge: plain('#eeeeea', 0.6, 0, 0.3),
  canopyUnder: st('#f4f2ec', PAT.MEMBRANE),
  postWhite: plain('#e6e6e2', 0.5, 0.2),
  steel: st('#4f5955', PAT.METAL, 1.8, 30, 0.55),
  steelGreen: plain('#3f7556', 0.55, 0.35),
  shopGlass: st('#7d9099', PAT.GLASS, 2.4, 4.4, 0.95),
  shopGlow: plain('#fff0cf', 0.6, 0, 0.75),
  stationWall: st('#d9d2c3', PAT.BANDS, 0.32, 4.3, 0.75),
  stationRoof: plain('#9c9a94', 0.9),
  fascia: plain('#ecebe6', 0.7),
  jrGreen: plain('#2e9b45', 0.6, 0, 0.55),
  navy: plain('#1d2b49', 0.6, 0, 0.12),
  white: plain('#ffffff', 0.5, 0, 0.9),
  brick: st('#9b4a33', PAT.BRICK, 1000, 2.9, 0),
  brickTop: plain('#6a4a3c', 0.95),
  archGlass: st('#3d3830', PAT.GLASS, 1.4, 3.2, 0.95),
  glassLit: st('#5d6f78', PAT.GLASS, 1.8, 4.2, 0.85),
};
const SIGNS = (w, h, seed) => st('#ffffff', PAT.SIGNS, w, h, seed);
// blade sign colourways [background, lettering] and the words the electric town shouts
const BLADE_BG = [['#e60012', '#ffffff'], ['#0a4fb4', '#ffffff'], ['#ffd400', '#d7000f'], ['#111111', '#ffe600'],
  ['#ff3d8b', '#ffffff'], ['#00a04a', '#ffffff'], ['#ffffff', '#d7000f'], ['#ff7a00', '#ffffff'], ['#6b2fbf', '#ffffff']];
const WORDS = ['ゲーム', 'アニメ', 'カード', 'ホビー', 'パソコン', 'メイド', 'カフェ', 'フィギュア', 'ドール', 'トレカ',
  'コミック', 'プラモ', 'ゲームセンター', 'ラジオ', 'パーツ', 'カメラ', 'メイドカフェ', 'ガチャ'];
const SCREEN = (seed, w, h) => st('#202020', PAT.SCREEN, seed, w, h);

// ------------------------------------------------------------------ small builders
function prismBy(kit, ring, y0, y1, wall, roof, bottom = null) {
  kit.walls(ring, y0, y1, wall.color, wall.style);
  kit.cap(ring, y1, roof.color, roof.style);
  if (bottom) kit.cap(ring, y0, bottom.color, bottom.style, true);
}

/** Facade with a lit shop band at the bottom: storefront 0..gf, `upper` above. */
function shopBlock(kit, ring, h, upper, roof, gf = 4.4) {
  kit.walls(ring, 0, gf, M.shopGlass.color, M.shopGlass.style);
  kit.walls(ring, gf, h, upper.color, upper.style);
  kit.cap(ring, h, roof.color, roof.style);
}

function edgeToward(ring, bearing, minLen = 4) {
  let best = null, bs = -2;
  const b = (bearing * Math.PI) / 180;
  const w = [Math.sin(b), -Math.cos(b)];
  for (const e of ringEdges(ring)) {
    if (e.len < minLen) continue;
    const s = e.n[0] * w[0] + e.n[1] * w[1] + Math.min(e.len, 60) / 600;
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}

/**
 * Lettering that follows a facade made of several edges (e.g. a curved front): the run of
 * consecutive edges facing within `tol` deg of `bearing`, characters spread along it, centred.
 */
function textOnFacade(kit, ring, bearing, str, y, h, m, off = 0.3, gap = 0.18, fill = 0.9) {
  const E = ringEdges(ring);
  const ok = E.map((e) => Math.abs(((bearingOf(e.n) - bearing + 540) % 360) - 180) < 38);
  // longest cyclic run of ok edges
  let best = null;
  for (let i = 0; i < E.length; i++) {
    if (!ok[i] || ok[(i - 1 + E.length) % E.length]) continue;
    const run = [];
    for (let k = 0; k < E.length && ok[(i + k) % E.length]; k++) run.push(E[(i + k) % E.length]);
    const L = run.reduce((a, e) => a + e.len, 0);
    if (!best || L > best.L) best = { run, L };
  }
  if (!best && ok.every(Boolean)) best = { run: E, L: E.reduce((a, e) => a + e.len, 0) };
  if (!best) return 0;
  const b = (bearing * Math.PI) / 180;
  const t = [-Math.cos(b), -Math.sin(b)];
  let pts = [best.run[0].a, ...best.run.map((e) => e.b)];
  let segs = best.run.map((e) => ({ a: e.a, b: e.b, n: e.n, len: e.len }));
  if ((pts[pts.length - 1][0] - pts[0][0]) * t[0] + (pts[pts.length - 1][1] - pts[0][1]) * t[1] < 0) {
    segs = segs.reverse().map((e) => ({ a: e.b, b: e.a, n: e.n, len: e.len }));
  }
  const chars = [...str];
  const ws = chars.map((ch) => textWidth(ch, h, 0));
  let W = ws.reduce((a, w) => a + w, 0) + gap * h * (chars.length - 1);
  let hh = h;
  if (W > best.L * fill) { hh = h * (best.L * fill) / W; W = best.L * fill; }
  let sPos = (best.L - W) / 2;
  const pointAt = (sv) => {
    let acc = 0;
    for (const e of segs) {
      if (sv <= acc + e.len || e === segs[segs.length - 1]) {
        const k = Math.max(0, Math.min(1, (sv - acc) / e.len));
        return { x: e.a[0] + (e.b[0] - e.a[0]) * k, z: e.a[1] + (e.b[1] - e.a[1]) * k, br: bearingOf(e.n) };
      }
      acc += e.len;
    }
    return null;
  };
  chars.forEach((ch, i) => {
    const w = ws[i] * hh / h;
    const p = pointAt(sPos + w / 2);
    if (p) text(kit, ch, p.x, y, p.z, p.br, hh, m.color, m.style, off, 0);
    sPos += w + gap * hh;
  });
  return hh;
}

// ------------------------------------------------------------------ JR Akihabara station
function station(kit, d) {
  kit.seed(11);
  const F = d.street;
  const pieces = F.filter((f) => f.type === 'st_piece');
  for (const f of F) {
    const r = f.points;
    if (f.type === 'st_slab') {
      kit.walls(r, f.y0, f.y1, M.concrete.color, M.concrete.style);
      kit.cap(r, f.y1, M.ballast.color, M.ballast.style);
      kit.cap(r, f.y0, M.concreteDark.color, M.concreteDark.style, true);
    } else if (f.type === 'st_platform') {
      const side = f.role === 'sobu' ? st('#cfc9bd', PAT.METAL, 6, 40, 0.8) : M.concrete;
      kit.walls(r, f.y0, f.y1, side.color, side.style);
      kit.cap(r, f.y1, M.paving.color, M.paving.style);
      if (f.role === 'sobu') kit.cap(r, f.y0, M.concreteDark.color, M.concreteDark.style, true);
    } else if (f.type === 'st_canopy') {
      kit.walls(r, f.y0, f.y1, M.canopyEdge.color, M.canopyEdge.style);
      kit.cap(r, f.y1, M.canopyTop.color, M.canopyTop.style);
      kit.cap(r, f.y0, M.canopyUnder.color, M.canopyUnder.style, true);
    } else if (f.type === 'st_posts') {
      const m = f.role === 'sobucol' ? M.concrete : M.postWhite;
      for (const [x, z] of f.points) kit.box(x, z, f.size, f.size, f.y0, f.y1, 0, m, m);
    } else if (f.type === 'girder' && f.role === 'crossing') {
      const [a, b] = f.points;
      sbox(kit, a, b, f.thick, f.y0a, f.y1a, f.y0b, f.y1b, M.steel, M.steel);
    }
  }
  // station buildings (pieces of the real footprints: under the low decks, under the Sobu
  // platforms, and the free parts: Atre 1 under the Electric Town exit, Atre 2 by Yodobashi)
  for (const f of pieces) {
    const r = f.points;
    if (f.role === 'concourse') {
      kit.walls(r, 0, 4.2, M.shopGlass.color, M.shopGlass.style);
      kit.walls(r, 4.2, f.h, M.fascia.color, M.fascia.style);
      kit.cap(r, f.h, M.stationRoof.color, M.stationRoof.style);
    } else if (f.role === 'atre2') {
      shopBlock(kit, r, f.h, st('#d8cfbf', PAT.BANDS, 0.4, 4.6, 0.8), M.stationRoof, 5.0);
    } else {
      shopBlock(kit, r, f.h, M.stationWall, M.stationRoof);
    }
  }
  stationSigns(kit, d, pieces);
}

function stationSigns(kit, d, pieces) {
  // Electric Town exit (電気街口): north face of Atre 1 toward the plaza, and its south face
  const atre = pieces.filter((p) => p.role === 'atre1' || (p.role === 'sobubase' && p.ring === 4));
  const north = atre.map((p) => edgeToward(p.points, 354)).filter(Boolean).sort((a, b) => a.mid[1] - b.mid[1])[0];
  const south = atre.map((p) => edgeToward(p.points, 174)).filter(Boolean).sort((a, b) => b.mid[1] - a.mid[1])[0];
  for (const e of [north, south]) {
    if (!e) continue;
    const br = bearingOf(e.n);
    const [mx, mz] = e.mid;
    // navy name board with the green JR square and white lettering
    const w = Math.min(e.len - 2, 21);
    panel(kit, mx, 6.7, mz, br, w, 2.6, M.navy, 0.35);
    const tw = textWidth('秋葉原駅', 1.7);
    const t = (-Math.cos((br * Math.PI) / 180)), tz = (-Math.sin((br * Math.PI) / 180));
    const sx = (w / 2 - 1.9);
    panel(kit, mx - t * sx, 6.7, mz - tz * sx, br, 2.0, 2.0, M.jrGreen, 0.5);
    text(kit, 'JR', mx - t * sx, 6.05, mz - tz * sx, br, 1.2, '#ffffff', M.white.style, 0.62);
    text(kit, '秋葉原駅', mx - t * 1.2, 5.85, mz - tz * 1.2, br, 1.7, '#ffffff', M.white.style, 0.5);
    text(kit, '電気街口', mx + t * (tw / 2 + 2.6), 5.95, mz + tz * (tw / 2 + 2.6), br, 1.1, '#ffd84a', plain('#ffd84a', 0.5, 0, 0.9).style, 0.5);
    // anime / game banners on the upper station facade
    const nb = Math.max(1, Math.min(4, Math.floor(e.len / 11)));
    for (let i = 0; i < nb; i++) {
      const s = (i - (nb - 1) / 2) * (e.len / nb);
      panel(kit, mx + t * s, 10.4, mz + tz * s, br, Math.min(9, e.len / nb - 1.2), 4.4, SIGNS(4.4, 4.4, 30 + i * 7), 0.4);
    }
  }
  // central gate side: name board on the east building facing the plaza / Yodobashi
  const east = pieces.filter((p) => p.role === 'building' && ringCentroid(p.points)[0] > 1230)
    .map((p) => edgeToward(p.points, 90, 8)).filter(Boolean).sort((a, b) => b.len - a.len)[0];
  if (east) {
    const br = bearingOf(east.n);
    panel(kit, east.mid[0], 6.6, east.mid[1], br, Math.min(east.len - 1, 13), 2.4, M.navy, 0.35);
    text(kit, '秋葉原駅', east.mid[0], 5.8, east.mid[1], br, 1.6, '#ffffff', M.white.style, 0.5);
  }
  // Atre 2 logo
  const a2 = pieces.find((p) => p.role === 'atre2');
  if (a2) {
    const e = edgeToward(a2.points, 90, 6) || edgeToward(a2.points, 0, 6);
    const br = bearingOf(e.n);
    text(kit, 'atre', e.mid[0], a2.h - 4.6, e.mid[1], br, 3.2, '#e8336b', plain('#e8336b', 0.5, 0, 0.9).style, 0.35);
  }
}

// ------------------------------------------------------------------ Sobu girder, piers, tied arch
function sobuStructures(kit, d) {
  const F = d.street;
  const gs = F.filter((f) => f.type === 'girder' && f.role === 'chuodori');
  if (gs.length === 2) {
    for (const g of gs) {
      const [a, b] = g.points;
      sbox(kit, a, b, g.thick, g.y0a, g.y1a, g.y0b, g.y1b, M.steel, M.steel);
    }
    // soffit plate between the girders, just under the track decks
    const [p, q] = gs;
    const a = [(p.points[0][0] + q.points[0][0]) / 2, (p.points[0][1] + q.points[0][1]) / 2];
    const b = [(p.points[1][0] + q.points[1][0]) / 2, (p.points[1][1] + q.points[1][1]) / 2];
    const w = Math.hypot(p.points[0][0] - q.points[0][0], p.points[0][1] - q.points[0][1]) - p.thick - 0.1;
    sbox(kit, a, b, w, p.y0a + 1.2, p.y0a + 1.7, p.y0b + 1.2, p.y0b + 1.7, M.steel, M.steel, false);
    // the "JR 秋葉原" band is not there in reality; keep the girder plain
  }
  for (const f of F) {
    if (f.type === 'pier') {
      const [x, z] = f.points[0];
      kit.box(x, z, f.len, f.wid, f.y0, f.y1, 0.103, M.concrete, M.concrete);
    } else if (f.type === 'sobu_piers') {
      f.points.forEach(([x, z], i) => kit.box(x, z, 2.2, 8.4, 0, f.tops[i], 0.103, M.concrete, M.concrete));
    } else if (f.type === 'tied_arch') {
      tiedArch(kit, f);
    }
  }
}

/** 松住町架道橋: braced-rib tied arch (1932), span 72 m, rib top 22.4 m, painted green. */
function tiedArch(kit, f) {
  const [s0, s1, n0, n1] = f.points;
  const N = 14;
  const ribs = [[s0, s1], [n0, n1]];
  const at = (rib, t, y) => [rib[0][0] + (rib[1][0] - rib[0][0]) * t, y, rib[0][1] + (rib[1][1] - rib[0][1]) * t];
  const deck = (t) => f.ya + (f.yb - f.ya) * t;
  const upper = (t) => deck(t) + 0.6 + (f.top - deck(0.5) - 0.6) * (1 - (2 * t - 1) ** 2);
  const lower = (t) => Math.min(upper(t) - 0.6, deck(t) + 0.6 + (f.top - 2.6 - deck(0.5) - 0.6) * (1 - (2 * t - 1) ** 2));
  const G = M.steelGreen;
  for (const rib of ribs) {
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      beam(kit, at(rib, t0, upper(t0)), at(rib, t1, upper(t1)), 0.9, 0.8, G);
      if (i > 0 && i < N - 1) beam(kit, at(rib, t0, lower(t0)), at(rib, t1, lower(t1)), 0.7, 0.6, G);
      // lattice web between the chords
      if (i > 0 && i < N - 1) beam(kit, at(rib, t0, lower(t0)), at(rib, t1, upper(t1)), 0.35, 0.35, G);
      if (i > 0) beam(kit, at(rib, t0, lower(t0)), at(rib, t0, upper(t0)), 0.4, 0.4, G);
      // hangers down to the tie
      if (i > 0) beam(kit, at(rib, t0, deck(t0) + 0.9), at(rib, t0, lower(t0)), 0.25, 0.25, G);
    }
    // tie girder along the deck
    sbox(kit, [rib[0][0], rib[0][1]], [rib[1][0], rib[1][1]], 0.7, f.ya - 1.6, f.ya + 1.0, f.yb - 1.6, f.yb + 1.0, G, G);
  }
  // portal / lateral bracing between the ribs near the crown
  for (let i = 3; i <= N - 3; i += 2) {
    const t = i / N;
    beam(kit, at(ribs[0], t, upper(t)), at(ribs[1], t, upper(t)), 0.5, 0.6, G);
  }
}

// ------------------------------------------------------------------ Radio Kaikan
function radioKaikan(kit, h, d) {
  if (!h || !h.rings.length) return;
  kit.seed(21);
  const ring = h.rings[0];
  const H = 41.0;
  const body = st('#c9cbc8', PAT.STONE, 3.0, 4.0, 0.7);
  shopBlock(kit, ring, H, body, plain('#8e8f8c'), 4.6);
  const o = ringOBB(ring);
  // penthouse + plant to 46.5 m (set back from the sign end)
  const c = ringCentroid(ring);
  kit.box(c[0], c[1] + 6, 12, 15, H, 46.0, o.angle, plain('#b9bab6'), plain('#8a8b88'));
  const N = edgeToward(ring, 0), E = edgeToward(ring, 90), W = edgeToward(ring, 270);
  const brN = bearingOf(N.n), brE = bearingOf(E.n);
  const tN = [-Math.cos((brN * Math.PI) / 180), -Math.sin((brN * Math.PI) / 180)];
  // tenant billboards: east face (toward the Electric Town exit lane) and north face
  const tE = [-Math.cos((brE * Math.PI) / 180), -Math.sin((brE * Math.PI) / 180)];
  const nbE = 3;
  for (let i = 0; i < nbE; i++) {
    const s = (i - 1) * (E.len / nbE);
    panel(kit, E.mid[0] + tE[0] * s, 22, E.mid[1] + tE[1] * s, brE, E.len / nbE - 1.4, 30, SIGNS((E.len / nbE - 1.4) / 3, 30 / 6, 61 + i * 3), 0.45);
  }
  panel(kit, N.mid[0] - tN[0] * 4.5, 27, N.mid[1] - tN[1] * 4.5, brN, 13, 24, SIGNS(13 / 3, 24 / 5, 71), 0.45);
  panel(kit, N.mid[0] + tN[0] * 7.5, 26.5, N.mid[1] + tN[1] * 7.5, brN, 7.5, 27, SIGNS(7.5 / 2, 27 / 6, 75), 0.45);
  // Radikan vision sits at 9-12 m (screens list); a lit band of floor signs between
  panel(kit, W.mid[0], 18, W.mid[1], bearingOf(W.n), W.len - 4, 16, SIGNS(4.5, 4, 81), 0.45);
  // the yellow crown sign along the north edge, with its return on the east side
  const Y = plain('#ffd21a', 0.5, 0, 0.85);
  const R = plain('#e3101b', 0.5, 0, 1.0), Bl = plain('#1f4fbf', 0.5, 0, 0.9);
  const ins = 0.8;
  const nA = [N.a[0] - N.n[0] * ins, N.a[1] - N.n[1] * ins], nB = [N.b[0] - N.n[0] * ins, N.b[1] - N.n[1] * ins];
  sbox(kit, nA, nB, 1.0, H, H + 6.0, H, H + 6.0, Y, plain('#d8b000'));
  const sx = N.mid[0] - N.n[0] * (ins - 0.5), sz = N.mid[1] - N.n[1] * (ins - 0.5);
  text(kit, 'ラジオ会館', sx + tN[0] * 2.4, H + 1.0, sz + tN[1] * 2.4, brN, 3.4, R.color, R.style, 0.18, 0.12);
  text(kit, '世界の', sx - tN[0] * 9.5, H + 3.1, sz - tN[1] * 9.5, brN, 1.5, Bl.color, Bl.style, 0.18, 0.08);
  text(kit, '秋葉原', sx - tN[0] * 9.5, H + 0.9, sz - tN[1] * 9.5, brN, 1.5, Bl.color, Bl.style, 0.18, 0.08);
  // back of the sign (seen from Chuo-dori side / south): plain yellow with the name
  text(kit, 'ラジオ会館', sx - N.n[0] * 1.0, H + 1.4, sz - N.n[1] * 1.0, (brN + 180) % 360, 3.0, R.color, R.style, 0.18, 0.12);
  // east return: a shorter box along the east edge from the north corner
  const eDir = [E.b[0] - E.a[0], E.b[1] - E.a[1]];
  const eL = Math.hypot(...eDir);
  const toN = (E.a[1] < E.b[1]) ? E.a : E.b, other = toN === E.a ? E.b : E.a;
  const u = [(other[0] - toN[0]) / eL, (other[1] - toN[1]) / eL];
  const e0 = [toN[0] - E.n[0] * ins + u[0] * 1.6, toN[1] - E.n[1] * ins + u[1] * 1.6];
  const e1 = [e0[0] + u[0] * 15, e0[1] + u[1] * 15];
  sbox(kit, e0, e1, 1.0, H, H + 6.0, H, H + 6.0, Y, plain('#d8b000'));
  const em = [(e0[0] + e1[0]) / 2 + E.n[0] * 0.5, (e0[1] + e1[1]) / 2 + E.n[1] * 0.5];
  text(kit, 'ラジオ会館', em[0], H + 1.3, em[1], brE, 2.6, R.color, R.style, 0.18, 0.12);
}

// ------------------------------------------------------------------ Yodobashi Akiba
function yodobashi(kit, h) {
  if (!h || !h.rings.length) return;
  kit.seed(31);
  const ring = h.rings[0];
  const H = 43.7;
  const body = st('#34373c', PAT.METAL, 3.2, 4.85, 0.42);
  kit.walls(ring, 0, 5.6, M.shopGlass.color, M.shopGlass.style);
  kit.walls(ring, 5.6, H, body.color, body.style);
  kit.cap(ring, H, plain('#55585c').color, plain('#55585c').style);
  // parapet band
  kit.walls(insetRing(ring, 0.01), H, H + 1.2, '#2a2c30', [PAT.PLAIN, 0.7, 0.1, 0]);
  // rooftop golf range / batting centre: green net cage on the north part of the roof
  const o = ringOBB(ring);
  const ux = Math.cos(o.angle), uz = Math.sin(o.angle);
  const cn = [o.cx + ux * (o.len * 0.2), o.cz + uz * (o.len * 0.2)];
  const L = o.len * 0.5, W = o.wid - 8;
  const net = plain('#5f7a66', 0.95, 0, 0.32);
  const cage = rectRing(cn[0], cn[1], L, W, o.angle);
  kit.walls(cage, H, H + 14.5, net.color, net.style);
  wallsIn(kit, cage, H, H + 14.5, net);
  kit.cap(cage, H + 14.5, '#6b8572', [PAT.PLAIN, 0.95, 0, 0.25]);
  // poles of the net frame (outside the net) every ~9 m
  const pole = plain('#e2e2de', 0.5, 0.3);
  for (const e of ringEdges(cage)) {
    const n = Math.max(1, Math.round(e.len / 9));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = e.a[0] + (e.b[0] - e.a[0]) * t + e.n[0] * 0.45, z = e.a[1] + (e.b[1] - e.a[1]) * t + e.n[1] * 0.45;
      kit.box(x, z, 0.5, 0.5, H, H + 15.4, o.angle, pole, pole);
    }
  }
  // plant on the south part
  const cs = [o.cx - ux * (o.len * 0.28), o.cz - uz * (o.len * 0.28)];
  kit.box(cs[0], cs[1], o.len * 0.25, o.wid * 0.5, H, H + 5, o.angle, plain('#8d8f90'), plain('#6f7173'));
  // red ヨドバシカメラ letters near the top of the west (station) and south (Sobu line) faces
  const R = plain('#e60012', 0.45, 0, 1.0);
  for (const [br, hh] of [[270, 6.2], [180, 4.6], [0, 4.6]]) {
    const hs = textOnFacade(kit, ring, br, 'ヨドバシカメラ', H - 8.6, hh, R, 0.35, 0.16, 0.86);
    if (hs) textOnFacade(kit, ring, br, 'Akiba', H - 8.6 - hs * 0.55 - 1.2, hs * 0.55, M.white, 0.35, 0.2, 0.4);
  }
}

// ------------------------------------------------------------------ Akihabara UDX
function udx(kit, h) {
  if (!h || !h.rings.length) return;
  kit.seed(41);
  const ring = h.rings[0];
  const o = ringOBB(ring);
  const H = 99.7;
  const white = st('#e7e5df', PAT.BANDS, 0.42, 4.6, 0.8);
  const longEdge = (e) => e.len > o.wid + 10;
  // podium 0..7 (shops on the plaza level), deck level at 6-7 m
  kit.walls(ring, 0, 4.6, M.shopGlass.color, M.shopGlass.style);
  kit.walls(ring, 4.6, 7.0, white.color, white.style);
  kit.cap(ring, 7.0, '#b9b7b1', [PAT.PLAIN, 0.9, 0, 0]);
  // loggia 7..27: glass recessed behind a colonnade on the long faces, solid ends
  const inner = rectRing(o.cx, o.cz, o.len, o.wid - 7, o.angle);
  wallsBy(kit, inner, 7.0, 26.6, (e) => (e.len > o.wid ? st('#8a9a96', PAT.GLASS, 2.0, 4.4, 0.9) : st('#e9e7e2', PAT.STONE, 3.0, 4.4, 0.6)));
  const ux = Math.cos(o.angle), uz = Math.sin(o.angle);
  const vx = -uz, vz = ux;
  const nC = Math.round(o.len / 9.2);
  for (const side of [-1, 1]) {
    for (let i = 0; i <= nC; i++) {
      const a = -o.len / 2 + 0.9 + (o.len - 1.8) * (i / nC);
      const x = o.cx + ux * a + vx * side * (o.wid / 2 - 0.9), z = o.cz + uz * a + vz * side * (o.wid / 2 - 0.9);
      kit.box(x, z, 1.4, 1.4, 7.0, 26.6, o.angle, plain('#4d4545', 0.6, 0.2), plain('#4d4545'));
    }
  }
  // office slab 26.6..H: vertical aluminium louvres on the long faces, plain glass ends
  const glass = '#6fa59d';
  wallsBy(kit, ring, 26.6, H, (e) => (longEdge(e) ? st(glass, PAT.FINS, 1.25, 4.2, 0.62) : st(glass, PAT.GLASS, 1.6, 4.2, 0.55)));
  kit.cap(ring, 26.6, '#d5d3cd', [PAT.PLAIN, 0.8, 0, 0], true);
  kit.cap(ring, H, '#7b7f80', [PAT.PLAIN, 0.9, 0, 0]);
  wallsBy(kit, insetRing(ring, -0.15), 26.0, 27.6, () => plain('#eceae4', 0.6));
  // projecting aluminium louvres on the long faces (every third shader fin is real geometry)
  const fin = plain('#d6dad8', 0.45, 0.55);
  for (const e of ringEdges(ring)) {
    if (!longEdge(e)) continue;
    const nF = Math.floor(e.len / 3.6);
    for (let k = 1; k < nF; k++) {
      const t = k / nF;
      const x = e.a[0] + (e.b[0] - e.a[0]) * t, z = e.a[1] + (e.b[1] - e.a[1]) * t;
      sbox(kit, [x + e.n[0] * 0.05, z + e.n[1] * 0.05], [x + e.n[0] * 0.8, z + e.n[1] * 0.8], 0.16, 27.6, H - 0.4, 27.6, H - 0.4, fin, fin, false, true);
    }
  }
  // crown
  const crown = rectRing(o.cx, o.cz, o.len - 14, o.wid - 12, o.angle);
  kit.prism(crown, H, H + 4.6, st('#5c6264', PAT.METAL, 2.5, 2.3, 0.5), plain('#6a6f71'));
  kit.box(o.cx + ux * (o.len * 0.18), o.cz + uz * (o.len * 0.18), 10, 9, H + 4.6, H + 7.2, o.angle, plain('#8b8f90'), plain('#777b7c'));
  for (const [x, z] of rectRing(o.cx, o.cz, o.len - 1, o.wid - 1, o.angle)) kit.aviation([x, H + 0.8, z]);
  for (const [x, z] of crown) kit.aviation([x, H + 5.2, z]);
}

// ------------------------------------------------------------------ Don Quijote / AKB48 Theater bldg
function donki(kit, h) {
  if (!h || !h.rings.length) return;
  kit.seed(51);
  const ring = h.rings[0];
  const H = h.h || 34;
  shopBlock(kit, ring, H, st('#cfccc4', PAT.STONE, 2.8, 4.2, 0.65), plain('#8c8b87'), 4.8);
  const W = edgeToward(ring, 275, 10), Nn = edgeToward(ring, 5, 10);
  // dense lit signs on the lower floors of both street faces
  for (const e of [W, Nn]) {
    if (!e) continue;
    const br = bearingOf(e.n);
    panel(kit, e.mid[0], 9.4, e.mid[1], br, e.len - 1.0, 8.6, SIGNS(3.2, 2.15, 91 + e.len), 0.4);
  }
  // tall yellow blade with red ドン・キホーテ at the Chuo-dori / side-street corner
  if (W) {
    const corner = (W.a[1] < W.b[1]) ? W.a : W.b;             // north end of the west face
    const br = bearingOf(W.n);
    const t = [-Math.cos((br * Math.PI) / 180), -Math.sin((br * Math.PI) / 180)];
    const dirIn = corner === W.a ? 1 : -1;                     // along the wall away from the corner
    const sAlong = [(W.b[0] - W.a[0]) / W.len * dirIn, (W.b[1] - W.a[1]) / W.len * dirIn];
    const base = [corner[0] + sAlong[0] * 2.2, corner[1] + sAlong[1] * 2.2];
    const a = [base[0] + W.n[0] * 0.2, base[1] + W.n[1] * 0.2], b = [base[0] + W.n[0] * 3.0, base[1] + W.n[1] * 3.0];
    const Y = plain('#ffd800', 0.5, 0, 0.8);
    sbox(kit, a, b, 0.6, 14.4, H - 1.0, 14.4, H - 1.0, Y, Y);
    // lettering on both faces of the blade, top to bottom
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const bl = bearingOf([sAlong[0], sAlong[1]]);
    const R = plain('#e30613', 0.5, 0, 1.0);
    textV(kit, 'ドン・キホーテ', mid[0], H - 2.5, mid[1], bl, 2.1, R.color, R.style, 0.45);
    textV(kit, 'ドン・キホーテ', mid[0], H - 2.5, mid[1], (bl + 180) % 360, 2.1, R.color, R.style, 0.45);
    void t;
  }
}

// ------------------------------------------------------------------ mAAch ecute (1912 brick viaduct)
function arcade(kit, e, yTop, span, pier, spring) {
  // e: edge with outward normal; facade on the ring line, arches recessed 0.9 m
  const nb = Math.max(1, Math.floor((e.len - pier) / (span + pier)));
  const used = nb * (span + pier) + pier;
  const pad = (e.len - used) / 2;
  const dir = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
  // orientation: walk so that the outside is on the viewer's front: right-hand t = -cos/-sin(bearing)
  const br = bearingOf(e.n);
  const t = [-Math.cos((br * Math.PI) / 180), -Math.sin((br * Math.PI) / 180)];
  const start = (dir[0] * t[0] + dir[1] * t[1]) > 0 ? e.a : e.b;
  const P = (u, y, dIn = 0) => [start[0] + t[0] * u - e.n[0] * dIn, y, start[1] + t[1] * u - e.n[1] * dIn];
  const B = M.brick, Gl = M.archGlass;
  const r = span / 2;
  const K = 7;
  const q = (a, b, c, d, m, uv) => kit.quad(a, b, c, d, m.color, m.style, uv);
  const keep = kit.uShift; kit.uShift = 0;
  let u = 0;
  const pierQ = (u0, u1) => q(P(u0, 0), P(u1, 0), P(u1, yTop), P(u0, yTop), B, [[u0, 0], [u1, 0], [u1, yTop], [u0, yTop]]);
  pierQ(0, pad + pier);
  u = pad + pier;
  for (let i = 0; i < nb; i++) {
    const u0 = u, u1 = u + span, uc = u0 + r;
    const arc = [];
    for (let k = 0; k <= K; k++) {
      const a = Math.PI - (Math.PI * k) / K;
      arc.push([uc + Math.cos(a) * r, spring + Math.sin(a) * r]);
    }
    for (let k = 0; k < K; k++) {
      const [ua, ya] = arc[k], [ub, yb] = arc[k + 1];
      // spandrel strip above the arch
      q(P(ua, ya), P(ub, yb), P(ub, yTop), P(ua, yTop), B, [[ua, ya], [ub, yb], [ub, yTop], [ua, yTop]]);
      // recessed glazing below the arch
      q(P(ua, 0, 0.9), P(ub, 0, 0.9), P(ub, yb, 0.9), P(ua, ya, 0.9), Gl, [[ua, 0], [ub, 0], [ub, yb], [ua, ya]]);
      // soffit of the arch (faces down/in)
      q(P(ub, yb, 0), P(ua, ya, 0), P(ua, ya, 0.9), P(ub, yb, 0.9), B, [[ub, yb], [ua, ya], [ua, ya + 0.9], [ub, yb + 0.9]]);
    }
    // jambs
    q(P(u0, 0, 0.9), P(u0, 0, 0), P(u0, spring, 0), P(u0, spring, 0.9), B, [[u0, 0], [u0 + 0.9, 0], [u0 + 0.9, spring], [u0, spring]]);
    q(P(u1, 0, 0), P(u1, 0, 0.9), P(u1, spring, 0.9), P(u1, spring, 0), B, [[u1, 0], [u1 + 0.9, 0], [u1 + 0.9, spring], [u1, spring]]);
    u = u1;
    pierQ(u, i === nb - 1 ? e.len : u + pier);
    u += pier;
  }
  kit.uShift = keep;
}

function maach(kit, h, d) {
  if (!h) return;
  const ring = h.points && h.points.length > 3 ? h.points : (h.rings[0] || null);
  if (!ring) return;
  kit.seed(61);
  const yTop = 6.1;
  const edges = ringEdges(ring);
  edges.forEach((e) => {
    if (e.len > 50) arcade(kit, e, yTop, 5.2, 1.9, 2.7);
  });
  wallsBy(kit, ring, 0, yTop, (e) => (e.len > 50 ? null : M.brick));
  kit.cap(ring, yTop, M.ballast.color, M.ballast.style);
  // brick parapets along the long sides
  for (const e of edges) {
    if (e.len < 50) continue;
    const a = [e.a[0] - e.n[0] * 0.3, e.a[1] - e.n[1] * 0.3], b = [e.b[0] - e.n[0] * 0.3, e.b[1] - e.n[1] * 0.3];
    const dx = (b[0] - a[0]) / e.len, dz = (b[1] - a[1]) / e.len;
    const a2 = [a[0] + dx * 3, a[1] + dz * 3], b2 = [b[0] - dx * 3, b[1] - dz * 3];
    sbox(kit, a2, b2, 0.5, yTop, 8.4, yTop, 8.4, M.brick, plain('#d8d2c4'), true, false);
  }
  // "2013 Platform": glass deck on the old island platform between the Chuo line tracks
  const pf = d.street.find((f) => f.type === 'maach_platform');
  if (pf && pf.points.length === 2) {
    const [a, b] = pf.points;
    sbox(kit, a, b, 7.0, yTop, 9.3, yTop, 9.3, st('#8fa7ad', PAT.GLASS, 1.5, 3.2, 0.9), plain('#d9d9d4'), true, false);
  }
}

// ------------------------------------------------------------------ screens and billboards
function screens(kit, d) {
  d.screens.forEach((s, i) => {
    const br = s.wallBearing ?? s.bearing;
    const y = s.bottom + s.height / 2;
    const stat = /static/.test(s.theme || '');
    if (stat) {
      panel(kit, s.x, y, s.z, br, s.width + 0.6, s.height + 0.6, plain('#2a2a2a', 0.6), 0.42);
      panel(kit, s.x, y, s.z, br, s.width, s.height, SIGNS(s.width / 2, s.height / 2, 200 + i * 13), 0.55);
    } else {
      panel(kit, s.x, y, s.z, br, s.width + 0.5, s.height + 0.5, plain('#1b1b1b', 0.5, 0.3), 0.42);
      panel(kit, s.x, y, s.z, br, s.width, s.height, SCREEN(i * 1.7 + 0.3, s.width, s.height), 0.55);
    }
  });
}

// ------------------------------------------------------------------ printed posters
const POSTER_BG = ['#ff4f9a', '#2a7de1', '#ffcf1f', '#7a3fd0', '#ff6a2a', '#16b39a', '#e8f1ff', '#1b2a5a', '#ff2e3e'];
const POSTER_INK = ['#ffffff', '#ffe94d', '#ff2e6e', '#1a1a1a', '#5ad1ff'];
/** A lit character / game poster: key-visual colour blocks, a title band and a katakana title. */
function poster(kit, x, y, z, br, w, h, r) {
  const b = (br * Math.PI) / 180;
  const t = [-Math.cos(b), -Math.sin(b)];
  const at = (u) => [x + t[0] * u, z + t[1] * u];
  const bg = POSTER_BG[Math.floor(r(0) * POSTER_BG.length)];
  panel(kit, x, y, z, br, w, h, plain(bg, 0.6, 0, 0.42), 0.62);
  // key visual: two overlapping blocks of other colours (figure + backdrop)
  const c1 = POSTER_BG[Math.floor(r(1) * POSTER_BG.length)], c2 = POSTER_BG[Math.floor(r(2) * POSTER_BG.length)];
  const fw = w * (0.35 + r(3) * 0.25), fh = h * (0.55 + r(4) * 0.25);
  const fu = (r(5) - 0.5) * (w - fw) * 0.8;
  const [ax, az] = at(fu);
  panel(kit, ax, y - h / 2 + fh / 2 + h * 0.04, az, br, fw, fh, plain(c1, 0.6, 0, 0.5), 0.7);
  const [bx, bz] = at(fu + (r(6) - 0.5) * fw * 0.5);
  panel(kit, bx, y - h / 2 + fh * 0.75 + h * 0.04, bz, br, fw * 0.45, fh * 0.32, plain(c2, 0.6, 0, 0.55), 0.78);
  // title band with a short katakana title
  const ink = POSTER_INK[Math.floor(r(7) * POSTER_INK.length)];
  const word = WORDS[Math.floor(r(8) * WORDS.length)];
  const th = Math.min(h * 0.14, (w * 0.8) / Math.max(1, [...word].length * 1.2));
  if (th > 0.35) {
    panel(kit, x, y + h / 2 - th * 0.9, z, br, w * 0.94, th * 1.4, plain(ink === '#1a1a1a' ? '#ffffff' : '#141414', 0.6, 0, 0.3), 0.7);
    const im = plain(ink === '#ffffff' || ink === '#1a1a1a' ? (ink === '#1a1a1a' ? '#e8102e' : '#ffffff') : ink, 0.5, 0, 0.9);
    text(kit, word, x, y + h / 2 - th * 1.5, z, br, th, im.color, im.style, 0.86, 0.14);
  }
}

// ------------------------------------------------------------------ sign streets
function signStreets(kit, d) {
  const streets = d.signStreets;
  let n = 0;
  for (const f of d.street) {
    if (f.type !== 'frontage' || f.points.length < 2) continue;
    const S = streets[f.street];
    if (!S) continue;
    const dens = S.density ?? 0.7;
    const [a, b] = f.points;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 3) continue;
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let nrm = [dir[1], -dir[0]];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const q = nearestOn(S.points, mid[0], mid[1]);
    if ((q.x - mid[0]) * nrm[0] + (q.z - mid[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
    const br = bearingOf(nrm);
    const H = f.h;
    const r = (k) => rnd(n * 17.3 + k * 3.1 + f.street * 101);
    n++;
    const at = (t) => [a[0] + dir[0] * L * t, a[1] + dir[1] * L * t];
    // bright open shop fronts and the fascia band above them
    const m0 = at(0.5);
    panel(kit, m0[0], 1.9, m0[1], br, L - 0.8, 3.0, M.shopGlow, 0.2);
    if (r(1) < 0.85) panel(kit, m0[0], 4.15, m0[1], br, L - 0.6, 1.2, SIGNS(2.4 + r(2) * 2.5, 1.2, r(3) * 90), 0.45);
    if (H < 7) continue;
    // a big character billboard / multi-tenant signboard in the middle of the upper floors
    const bb = H > 12 && L > 6 && r(30) < dens * 0.7;
    if (bb) {
      const w = Math.min(L * 0.4, 4 + r(31) * 10);
      const hh = Math.min(H - 6.5, 5 + r(32) * 12);
      const y = 5.8 + hh / 2 + r(33) * Math.max(0, Math.min(H, 38) - 6.5 - hh);
      const p = at(0.5);
      if (r(34) < 0.22 && dens > 0.8) panel(kit, p[0], y, p[1], br, w, hh * 0.62, SCREEN(n * 0.37, w, hh * 0.62), 0.62);
      else if (r(34) < 0.5) {
        const cw = w / Math.max(1, Math.round(w / (2.6 + r(35) * 2.2))), ch = hh / Math.max(1, Math.round(hh / (2.2 + r(36) * 2.4)));
        panel(kit, p[0], y, p[1], br, w, hh, SIGNS(cw, ch, r(37) * 77), 0.62);
      } else poster(kit, p[0], y, p[1], br, w, hh, (k) => r(50 + k));
    }
    // vertical blade signs (tate-kanban) sticking out from the wall, clear of the billboard
    // (middle) and of the generic blades (near the wall ends)
    const nBl = L < 7 ? 1 : (L < 16 ? 2 : 3);
    let blades = 0;
    for (let k = 0; k < nBl; k++) {
      const tpos = nBl === 1 ? 0.5 : (nBl === 2 ? (k === 0 ? 0.26 : 0.74) : [0.26, 0.5, 0.74][k]);
      if (bb && tpos === 0.5) continue;
      if (r(10 + k) > dens * 0.95) continue;
      const p = at(tpos);
      const w = 1.1 + r(12 + k) * 0.9;
      const y0 = 4.95 + r(14 + k) * 1.2;
      const y1 = Math.min(H - 0.6, y0 + 5 + r(16 + k) * Math.min(18, H));
      if (y1 - y0 < 2.5) continue;
      const pa = [p[0] + nrm[0] * 0.2, p[1] + nrm[1] * 0.2], pb = [p[0] + nrm[0] * (0.2 + w), p[1] + nrm[1] * (0.2 + w)];
      if (r(22 + k) < 0.45) {
        // stacked floor-directory blade
        sbox(kit, pa, pb, 0.34, y0, y1, y0, y1, SIGNS(w, 1.4 + r(18 + k) * 1.4, r(20 + k) * 97), plain('#3a3a3a'));
      } else {
        // single-colour blade with big katakana, lettered on both faces
        const ci = Math.floor(r(24 + k) * BLADE_BG.length);
        const [bg, fg] = BLADE_BG[ci];
        sbox(kit, pa, pb, 0.34, y0, y1, y0, y1, plain(bg, 0.55, 0, 0.55), plain('#3a3a3a'));
        const word = WORDS[Math.floor(r(26 + k) * WORDS.length)];
        const nCh = [...word].length;
        const gh = Math.min(w * 0.72, (y1 - y0 - 0.8) / (nCh * 1.14));
        if (gh > 0.45) {
          const cm = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
          const fgM = plain(fg, 0.5, 0, 0.95);
          for (const sgn of [1, -1]) {
            const brF = bearingOf([dir[0] * sgn, dir[1] * sgn]);
            textV(kit, word, cm[0], y1 - 0.4, cm[1], brF, gh, fgM.color, fgM.style, 0.17 + 0.16, 0.14);
          }
        }
      }
      blades++;
    }
    // otherwise a couple of horizontal box signs on random floors, between the blades
    if (!bb && H > 9 && nBl === 2) {
      for (let k = 0; k < 2; k++) {
        if (r(40 + k) > dens * 0.9) continue;
        const w = Math.min(L * 0.36, 2.5 + r(42 + k) * 4);
        const y = 6.2 + Math.floor(r(44 + k) * Math.max(1, (Math.min(H, 30) - 8) / 3.4)) * 3.4 + k * 1.9;
        if (y + 0.8 > H - 0.4) continue;
        const p = at(0.5);
        panel(kit, p[0], y, p[1], br, w, 1.5, SIGNS(w, 1.5, r(46 + k) * 50), 0.6 + k * 0.15);
      }
    }
  }
}

// ------------------------------------------------------------------ pedestrian deck to UDX
function deck(kit, d) {
  const f = d.street.find((s) => s.type === 'pedestrian_deck');
  if (!f || !f.points || f.points.length < 2) return;
  const P = f.points;
  const y0 = 5.7, y1 = 6.35, W = 7.0;
  const glass = st('#9fb6bb', PAT.GLASS, 1.2, 1.2, 0);
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1) continue;
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    sbox(kit, a, b, W, y0, y1, y0, y1, M.concrete, M.paving, true);
    for (const s of [-1, 1]) {
      const o = [-dz * s * (W / 2 - 0.15), dx * s * (W / 2 - 0.15)];
      const t0 = i > 0 ? W / 2 : 0, t1 = i < P.length - 2 ? W / 2 : 0;
      if (L - t0 - t1 < 1) continue;
      sbox(kit, [a[0] + o[0] + dx * t0, a[1] + o[1] + dz * t0], [b[0] + o[0] - dx * t1, b[1] + o[1] - dz * t1], 0.08,
        y1, y1 + 1.1, y1, y1 + 1.1, glass, plain('#d0d0d0'), false, false);
    }
  }
  // columns (precomputed clear of carriageways and buildings)
  const cols = d.street.find((s) => s.type === 'deck_columns');
  if (cols) for (const [x, z] of cols.points) kit.box(x, z, 1.1, 1.1, 0, y0, 0, M.concrete, M.concrete);
  // stairs down at both ends
  for (const [e, n] of [[P[0], P[1]], [P[P.length - 1], P[P.length - 2]]]) {
    const L = Math.hypot(e[0] - n[0], e[1] - n[1]) || 1;
    const ux = (e[0] - n[0]) / L, uz = (e[1] - n[1]) / L;
    const f = [e[0] + ux * 12, e[1] + uz * 12];
    sbox(kit, e, f, 3.2, y0, y1, 0.02, 0.32, M.concrete, M.paving, true, true);
  }
  // landings at the bends (a step up so the overlapping segment ends never share a plane)
  for (let i = 1; i < P.length - 1; i++) kit.cylinder(P[i][0], P[i][1], W / 2 + 0.35, y0 - 0.08, y1 + 0.08, M.concrete, M.paving, 10, 0.1);
}

export default {
  build(kit, d) {
    const H = Object.fromEntries(d.heroes.map((h) => [h.key, h]));
    station(kit, d);
    sobuStructures(kit, d);
    radioKaikan(kit, H.radiokaikan, d);
    yodobashi(kit, H.yodobashi);
    udx(kit, H.udx);
    donki(kit, H.donki);
    maach(kit, H.maach, d);
    deck(kit, d);
    screens(kit, d);
    signStreets(kit, d);
  },
};
