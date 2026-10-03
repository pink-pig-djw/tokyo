// Kit for the hand-styled "hero" buildings and street dressing of the refined districts
// (Shibuya, Akihabara, Tokyo Station). Masses are built from real footprints (exported by
// tools/build_world.py from tools/districts/*.json) or from simple solids; every vertex carries
// a facade pattern id + three parameters, evaluated in metres on the surface (u along the wall,
// v up), so windows, mullions and fins keep their real size on any mass. One shared material,
// explicit normals (no screen-space derivatives), one draw call per district.
import * as THREE from 'three';
import { U } from '../../core/env.js';

/** Facade patterns and the meaning of their parameters [p1, p2, p3]. */
export const PAT = {
  GLASS: 0,     // curtain wall: [mullion spacing m, floor height m, lit share at night 0..1]
  FINS: 1,      // glass behind light vertical fins: [fin spacing m, floor height m, lit share]
  BANDS: 2,     // ribbon windows between spandrels: [window share of floor 0..1, floor height m, lit share]
  BRICK: 3,     // red brick, white stone string courses and framed windows: [window spacing m, floor height m, lit share]
  STONE: 4,     // stone / tile with punched windows: [window spacing m, floor height m, lit share]
  PLAIN: 5,     // flat colour: [roughness, metalness, night glow 0..1 (emissive = colour x glow)]
  SCREEN: 6,    // animated LED screen: [content seed, width m, height m]   (u, v from the panel's corner)
  SIGNS: 7,     // mosaic of lit shop signs / billboards: [panel width m, panel height m, seed]
  MEMBRANE: 8,  // fabric canopy, glows softly at night: [0, 0, 0]
  METAL: 9,     // aluminium / steel panels: [panel width m, panel height m, roughness]
};

const _c = new THREE.Color();

/** Shoelace area of a ring of [x, z] (positive = counter-clockwise when looking down -y). */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

export function ringCentroid(ring) {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}

/** Edges with outward normals (in x/z), lengths and midpoints. */
export function ringEdges(ring) {
  const s = ringArea(ring) > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    // with z pointing south, a counter-clockwise ring in x/z has its outside on the right
    out.push({ a, b, len, dir: [dx / len, dz / len], n: [s * dz / len, -s * dx / len], mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
  }
  return out;
}

/** The edge whose outside faces the point (x, z) best (longer edges preferred). */
export function edgeFacing(ring, x, z, minLen = 6) {
  let best = null, bs = -Infinity;
  for (const e of ringEdges(ring)) {
    if (e.len < minLen) continue;
    const tx = x - e.mid[0], tz = z - e.mid[1];
    const d = Math.hypot(tx, tz) || 1;
    const facing = (tx * e.n[0] + tz * e.n[1]) / d;
    const s = facing * 2 + Math.min(e.len, 60) / 60 - d / 400;
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}

/** Oriented bounding rectangle: { cx, cz, angle (rad, of the long axis in x/z), len, wid }. */
export function ringOBB(ring) {
  let best = null;
  for (const e of ringEdges(ring)) {
    const [ux, uz] = e.dir;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ring) {
      const a = x * ux + z * uz, b = -x * uz + z * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      best = { area, cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, angle: Math.atan2(uz, ux), len: a1 - a0, wid: b1 - b0 };
    }
  }
  if (best && best.wid > best.len) {
    best = { ...best, angle: best.angle + Math.PI / 2, len: best.wid, wid: best.len };
  }
  return best;
}

/** Ring moved inwards (d > 0) or outwards (d < 0) with mitred corners (simple polygons). */
export function insetRing(ring, d) {
  const s = ringArea(ring) > 0 ? 1 : -1;
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n], c = ring[i], q = ring[(i + 1) % n];
    const e0 = norm2([c[0] - p[0], c[1] - p[1]]), e1 = norm2([q[0] - c[0], q[1] - c[1]]);
    // inward normals (left of the edge for an outward-right ring)
    const n0 = [-s * e0[1], s * e0[0]], n1 = [-s * e1[1], s * e1[0]];
    const m = norm2([n0[0] + n1[0], n0[1] + n1[1]]);
    const k = d / Math.max(0.35, m[0] * n0[0] + m[1] * n0[1]);
    out.push([c[0] + m[0] * k, c[1] + m[1] * k]);
  }
  return out;
}

function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

/** Rectangle ring around (cx, cz), long side `len` along angle `ang` (rad, in x/z). */
export function rectRing(cx, cz, len, wid, ang = 0) {
  const ux = Math.cos(ang), uz = Math.sin(ang);
  const h = len / 2, w = wid / 2;
  return [[-h, -w], [h, -w], [h, w], [-h, w]].map(([a, b]) => [cx + a * ux - b * uz, cz + a * uz + b * ux]);
}

export class Kit {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.sty = []; this.idx = [];
    this.lights = [];       // aviation light positions (x, y, z)
    this.uShift = 0;        // per-building offset of u so lit-window patterns differ
  }

  /** Start a new building: different window lighting pattern. */
  seed(n) { this.uShift = ((Math.abs(Math.sin(n * 91.345 + 3.1)) * 1e4) % 997) * 3; return this; }

  _v(x, y, z, nx, ny, nz, color, u, v, s) {
    _c.set(color);
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.col.push(_c.r, _c.g, _c.b);
    this.uv.push(u + this.uShift, v); this.sty.push(s[0], s[1] ?? 0, s[2] ?? 0, s[3] ?? 0);
    return this.pos.length / 3 - 1;
  }

  /** Quad from four corners [x,y,z] in counter-clockwise order seen from the front. */
  quad(p0, p1, p2, p3, color, style, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i = [p0, p1, p2, p3].map((p, k) => this._v(p[0], p[1], p[2], nx, ny, nz, color, uv[k][0], uv[k][1], style));
    this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
  }

  /** Vertical walls along a closed ring from y0 to y1, facing out. u runs along the perimeter. */
  walls(ring, y0, y1, color, style, { u0 = 0 } = {}) {
    let u = u0;
    for (const e of ringEdges(ring)) {
      const [ax, az] = e.a, [bx, bz] = e.b;
      // keep the outward winding whichever way the ring turns
      const flip = (e.n[0] * -(bz - az) + e.n[1] * (bx - ax)) < 0;
      const A = flip ? [bx, bz] : [ax, az], B = flip ? [ax, az] : [bx, bz];
      this.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], color, style,
        [[u, y0], [u + e.len, y0], [u + e.len, y1], [u, y1]]);
      u += e.len;
    }
  }

  /** Horizontal cap over a ring at height y (facing up, or down). u, v = world x, z. */
  cap(ring, y, color, style, down = false) {
    const pts = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const ny = down ? -1 : 1;
    const base = this.pos.length / 3;
    for (const [x, z] of ring) this._v(x, y, z, 0, ny, 0, color, x, z, style);
    // ShapeUtils returns triangles wound for a y-up 2D plane (x, y); in x/z with normal +y the
    // winding has to be reversed unless the ring is clockwise in x/z
    const ccw = ringArea(ring) > 0;
    for (const t of tris) {
      const up = !down;
      if (ccw === up) this.idx.push(base + t[0], base + t[2], base + t[1]);
      else this.idx.push(base + t[0], base + t[1], base + t[2]);
    }
  }

  /** Extruded footprint: walls + roof (+ optional underside for raised masses). */
  prism(ring, y0, y1, wall, roof = wall, { bottom = false, u0 = 0 } = {}) {
    this.walls(ring, y0, y1, wall.color, wall.style, { u0 });
    this.cap(ring, y1, roof.color, roof.style);
    if (bottom) this.cap(ring, y0, roof.color, roof.style, true);
  }

  box(cx, cz, len, wid, y0, y1, ang, wall, roof = wall, opts) {
    this.prism(rectRing(cx, cz, len, wid, ang), y0, y1, wall, roof, opts);
  }

  /** Cylinder (or prism with `seg` sides) with a flat top. */
  cylinder(cx, cz, r, y0, y1, wall, roof = wall, seg = 24, phase = 0) {
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const a = phase + (i / seg) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    this.prism(ring, y0, y1, wall, roof);
    return ring;
  }

  /**
   * Flat vertical panel (screen, sign, billboard) of width w and height h, its centre at
   * (x, y, z), facing compass bearing `bearing` (deg, 0 = north, 90 = east). For SCREEN the
   * pattern sees u, v from its lower-left corner; `off` pushes it out of the wall it sits on.
   */
  panel(x, y, z, bearing, w, h, color, style, off = 0.25) {
    const b = THREE.MathUtils.degToRad(bearing);
    const nx = Math.sin(b), nz = -Math.cos(b);           // facing direction in x/z
    const tx = -nz, tz = nx;                              // right-hand direction seen from the front
    const cx = x + nx * off, cz = z + nz * off;
    const keep = this.uShift; this.uShift = 0;
    this.quad([cx - tx * w / 2, y - h / 2, cz - tz * w / 2], [cx + tx * w / 2, y - h / 2, cz + tz * w / 2],
      [cx + tx * w / 2, y + h / 2, cz + tz * w / 2], [cx - tx * w / 2, y + h / 2, cz - tz * w / 2], color, style,
      [[0, 0], [w, 0], [w, h], [0, h]]);
    this.uShift = keep;
  }

  /** Thin slab (canopy, deck, roof plate) over a ring between y0 and y1. */
  slab(ring, y0, y1, color, style) { this.prism(ring, y0, y1, { color, style }, { color, style }, { bottom: true }); }

  /** Red obstruction lights at the given points (tops of tall buildings). */
  aviation(...pts) { for (const p of pts) this.lights.push(p[0], p[1], p[2]); }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.sty, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }

  get triangles() { return this.idx.length / 3; }
}

// ------------------------------------------------------------------ material
const PATTERN_GLSL = /* glsl */`
uniform float uNight;
uniform float uTime;
varying vec2 vHUV;
flat varying vec4 vHStyle;
varying vec3 vHN;

float hh1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// anti-aliased bars of width w (in periods) centred on integers; average coverage when unresolvable
float hbar(float x, float w) {
  float fw = max(fwidth(x), 1e-4);
  float d = abs(fract(x + 0.5) - 0.5);
  float m = 1.0 - smoothstep(w * 0.5 - fw, w * 0.5 + fw, d);
  return mix(m, w, smoothstep(0.2, 0.55, fw));
}
// box inside a cell: 1 where |cell-local - c| < half extents
float hbox(vec2 x, vec2 c, vec2 hs) {
  vec2 fw = max(fwidth(x), vec2(1e-4));
  vec2 d = abs(fract(x) - c) - hs;
  vec2 m = 1.0 - smoothstep(-fw, fw, d);
  float r = m.x * m.y;
  return mix(r, 4.0 * hs.x * hs.y, smoothstep(0.2, 0.55, max(fw.x, fw.y)));
}
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
vec3 warmCool(float r) {
  return r < 0.45 ? vec3(1.0, 0.78, 0.52) : r < 0.8 ? vec3(1.0, 0.92, 0.8) : vec3(0.82, 0.9, 1.0);
}
// lit windows: cell id -> emissive
vec3 litCell(vec2 id, float share) {
  float r = hh1(id * vec2(1.0, 7.31) + floor(id.y / 3.0) * 0.37);
  float on = step(r, share);
  return warmCool(hh1(id + 5.17)) * on * (0.3 + 0.5 * hh1(id + 9.3));
}
`;

const PATTERN_MAIN = /* glsl */`
  {
    int pat = int(vHStyle.x + 0.5);
    float p1 = vHStyle.y, p2 = vHStyle.z, p3 = vHStyle.w;
    vec3 base = diffuseColor.rgb;
    vec3 col = base;
    float rough = 0.7, metal = 0.05;
    vec3 emis = vec3(0.0);
    float u = vHUV.x, v = vHUV.y;
    bool wall = abs(vHN.y) < 0.5;
    if (pat == 0 || pat == 1) {
      // curtain wall (1: with light vertical fins)
      vec2 cell = vec2(u / max(p1, 0.5), v / max(p2, 1.0));
      float fr = max(hbar(cell.x, pat == 1 ? 0.2 : 0.07), hbar(cell.y, 0.09));
      vec3 glass = base * (0.8 + 0.25 * hh1(floor(cell) + 2.0));
      vec3 frame = pat == 1 ? vec3(0.86, 0.87, 0.86) : mix(base, vec3(0.75), 0.6);
      col = mix(glass, frame, fr);
      rough = mix(0.06, 0.55, fr); metal = mix(0.85, 0.2, fr);
      if (wall) emis = litCell(floor(cell), p3) * (1.0 - fr) * uNight * 1.3;
    } else if (pat == 2) {
      // ribbon windows
      float f = fract(v / max(p2, 1.0));
      float fw = fwidth(v / max(p2, 1.0));
      float win = smoothstep(1.0 - p1 - fw, 1.0 - p1 + fw, f) * (1.0 - smoothstep(0.97 - fw, 0.97 + fw, f));
      win = mix(win, p1 * 0.95, smoothstep(0.2, 0.55, fw));
      vec3 glass = vec3(0.12, 0.15, 0.19) + base * 0.08;
      col = mix(base, glass, win);
      rough = mix(0.75, 0.1, win); metal = mix(0.05, 0.7, win);
      vec2 id = floor(vec2(u / 3.2, v / max(p2, 1.0)));
      if (wall) emis = litCell(id, p3) * win * uNight * 1.2;
    } else if (pat == 3) {
      // red brick + white stone string courses and window surrounds (Tokyo Station)
      vec2 cell = vec2(u / max(p1, 1.0), v / max(p2, 1.0));
      float n = hh1(floor(vec2(u * 4.0, v * 13.0))) * 0.08 * (1.0 - smoothstep(0.0, 0.4, fwidth(u * 4.0)));
      vec3 brick = base * (0.92 + n);
      float course = hbar(cell.y, 0.07);
      float frame = hbox(cell, vec2(0.5, 0.52), vec2(0.21, 0.31));
      float glassM = hbox(cell, vec2(0.5, 0.52), vec2(0.16, 0.26));
      vec3 stone = vec3(0.88, 0.85, 0.78);
      col = mix(brick, stone, max(course, frame - glassM));
      col = mix(col, vec3(0.1, 0.12, 0.13), glassM);
      rough = mix(0.85, 0.15, glassM); metal = mix(0.0, 0.5, glassM);
      if (wall) {
        // warm floodlighting from below + lit windows
        float flood = 0.18 + 0.32 * (1.0 - smoothstep(0.0, 28.0, v));
        emis = (col * flood * (1.0 - glassM) + litCell(floor(cell), p3) * glassM * 1.4) * uNight;
      }
    } else if (pat == 4) {
      // stone / tile with punched windows
      vec2 cell = vec2(u / max(p1, 1.0), v / max(p2, 1.0));
      float win = hbox(cell, vec2(0.5, 0.55), vec2(0.27, 0.3));
      col = mix(base, vec3(0.13, 0.15, 0.18), win);
      rough = mix(0.8, 0.12, win); metal = mix(0.02, 0.6, win);
      if (wall) emis = litCell(floor(cell), p3) * win * uNight * 1.3;
    } else if (pat == 5) {
      rough = p1; metal = p2;
      emis = base * p3 * (0.25 + uNight);
    } else if (pat == 6) {
      // LED screen: cycling procedural content, always lit
      vec2 q = vec2(u / max(p2, 1.0), v / max(p3, 1.0));
      float t = uTime * 0.12 + p1 * 3.7;
      float slot = floor(t);
      float k = fract(t);
      float r = hh1(vec2(slot, p1));
      vec3 c1 = hsv(fract(r + 0.1), 0.75, 1.0), c2 = hsv(fract(r + 0.55), 0.85, 0.9);
      vec3 img;
      if (r < 0.33) {
        // big product shot: gradient + circle
        float d = length((q - vec2(0.62, 0.5)) * vec2(p2 / max(p3, 1.0), 1.0));
        img = mix(c2 * 0.35, c1, smoothstep(0.42, 0.38, d)) + 0.15 * q.y;
      } else if (r < 0.66) {
        // title card: dark ground with text lines sliding in
        float line = step(0.55, fract(q.y * 6.0)) * step(fract(q.y * 6.0), 0.85);
        float len = step(q.x, 0.15 + 0.7 * hh1(vec2(floor(q.y * 6.0), slot)) * smoothstep(0.0, 0.25, k));
        img = mix(c2 * 0.15, vec3(1.0), line * len * step(0.1, q.x)) + c1 * 0.25 * step(0.82, q.y);
      } else {
        // colour wipe / stripes
        float s = step(0.5, fract(q.x * 3.0 - uTime * 0.3 + q.y));
        img = mix(c1, c2, s) * (0.7 + 0.3 * q.y);
      }
      // cut between clips
      img *= smoothstep(0.0, 0.04, k) * (1.0 - smoothstep(0.96, 1.0, k)) * 0.85 + 0.15;
      float pix = 1.0 - 0.3 * max(hbar(u / 0.12, 0.3), hbar(v / 0.12, 0.3));
      col = img * 0.25;
      rough = 0.35; metal = 0.0;
      emis = img * pix * (0.9 + 2.0 * uNight);
    } else if (pat == 7) {
      // mosaic of shop signs and billboards
      vec2 cell = vec2(u / max(p1, 0.5), v / max(p2, 0.5));
      vec2 id = floor(cell);
      float r = hh1(id + p3);
      vec3 c = hsv(r < 0.3 ? 0.0 + 0.04 * r : r < 0.5 ? 0.13 : r < 0.65 ? 0.58 : fract(r * 3.1), 0.55 + 0.4 * hh1(id + 1.3), 1.0);
      if (hh1(id + 4.0) < 0.25) c = vec3(0.95);
      vec2 f = fract(cell);
      float gap = max(hbar(cell.x, 0.06), hbar(cell.y, 0.08));
      float txt = step(0.3, f.y) * step(f.y, 0.7) * step(0.5, fract(f.x * (3.0 + floor(r * 5.0))));
      vec3 face = mix(c, c * 0.25 + vec3(0.02), txt * 0.8);
      col = mix(face * 0.8, vec3(0.08), gap);
      rough = 0.5; metal = 0.0;
      emis = face * (1.0 - gap) * (0.18 + 1.9 * uNight);
    } else if (pat == 8) {
      rough = 0.9; metal = 0.0;
      emis = vec3(1.0, 0.95, 0.85) * 0.55 * uNight;
    } else if (pat == 9) {
      float j = max(hbar(u / max(p1, 0.3), 0.04), hbar(v / max(p2, 0.3), 0.05));
      col = mix(base, base * 0.6, j);
      rough = p3 > 0.0 ? p3 : 0.35; metal = 0.75;
    }
    diffuseColor.rgb = col;
    hRough = rough; hMetal = metal; hEmis = emis;
  }
`;

let _material = null;
export function heroMaterial() {
  if (_material) return _material;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = U.uNight;
    shader.uniforms.uTime = U.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aUV;
        attribute vec4 aStyle;
        varying vec2 vHUV;
        flat varying vec4 vHStyle;
        varying vec3 vHN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vHUV = aUV;
        vHStyle = aStyle;
        vHN = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PATTERN_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float hRough = 0.7, hMetal = 0.05; vec3 hEmis = vec3(0.0);
        ${PATTERN_MAIN}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = hRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = hMetal;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = hEmis;');
  };
  mat.customProgramCacheKey = () => 'tokyo-hero-v1';
  _material = mat;
  return mat;
}
