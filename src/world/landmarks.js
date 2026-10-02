// Hand-built landmark models placed at their real coordinates:
// Tokyo Tower (333 m), Tokyo Skytree (634 m) and the Rainbow Bridge.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from '../core/env.js';

export function makeLL(manifest) {
  const { lon, lat, kx, ky } = manifest.origin;
  return (lo, la) => new THREE.Vector3((lo - lon) * kx, 0, -(la - lat) * ky);
}

// ------------------------------------------------------------------ helpers
const _up = new THREE.Vector3(0, 1, 0);

/** Box beam between two points with a per-vertex colour and glow weight. */
function beam(a, b, t, color, glow = 1, depth = t) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(t, depth, len);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const m = new THREE.Matrix4().lookAt(a, b, Math.abs(b.clone().sub(a).normalize().y) > 0.99 ? new THREE.Vector3(1, 0, 0) : _up);
  m.setPosition(mid);
  g.applyMatrix4(m);
  paint(g, color, glow);
  return g;
}

function paint(g, color, glow) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const w = new Float32Array(n);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; w[i] = glow; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(w, 1));
  if (g.index) return g;
  return g;
}

function clean(geoms) {
  return mergeGeometries(geoms.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'color', 'aGlow'].includes(k)) ng.deleteAttribute(k);
    return ng;
  }));
}

function glowMaterial(glowColor, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.rough ?? 0.55, metalness: opts.metal ?? 0.25 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = U.uNight;
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uGlowColor = opts.uniform || { value: new THREE.Color(glowColor) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying vec3 vLW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvLW = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; uniform float uTime; uniform vec3 uGlowColor; varying float vGlow; varying vec3 vLW;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${opts.emissiveGLSL || 'totalEmissiveRadiance += uGlowColor * vGlow * uNight;'}`);
  };
  mat.customProgramCacheKey = () => `glow-${opts.key || glowColor}`;
  return mat;
}

// ------------------------------------------------------------------ Tokyo Tower
function tokyoTower() {
  const parts = [];
  const ORANGE = '#e0531f', WHITE = '#eceae4';
  const H = 333;
  const halfW = (y) => {
    if (y <= 250) return 4.6 + 35.4 * Math.exp(-y / 58) - 0.6 * (y / 250);
    return Math.max(0.7, 4.0 - (y - 250) * 0.045);
  };
  const bandColor = (y) => {
    if (y > 253) return Math.floor((y - 253) / 9) % 2 === 0 ? ORANGE : WHITE;
    return Math.floor(y / (253 / 9)) % 2 === 0 ? ORANGE : WHITE;
  };
  const levels = [];
  for (let y = 0; y <= 296; y += y < 60 ? 8 : y < 150 ? 10 : 9) levels.push(y);
  const corner = (y, sx, sz) => new THREE.Vector3(sx * halfW(y), y, sz * halfW(y));
  const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i], y1 = levels[i + 1];
    const col = bandColor((y0 + y1) / 2);
    const t = y0 < 100 ? 2.4 : y0 < 200 ? 1.6 : 1.0;
    for (let c = 0; c < 4; c++) {
      const [sx, sz] = C[c];
      const [nx, nz] = C[(c + 1) % 4];
      // leg chords (doubled near the base)
      parts.push(beam(corner(y0, sx, sz), corner(y1, sx, sz), t * 1.6, col, 1.0));
      // horizontal girt
      if (y0 > 44 || i === 0) parts.push(beam(corner(y1, sx, sz), corner(y1, nx, nz), t * 0.7, col, 0.6));
      // X bracing on each face
      if (y0 >= 44) {
        parts.push(beam(corner(y0, sx, sz), corner(y1, nx, nz), t * 0.5, col, 0.5));
        parts.push(beam(corner(y0, nx, nz), corner(y1, sx, sz), t * 0.5, col, 0.5));
      } else {
        // the four splayed feet: each leg is a lattice column of its own
        const inner = (y, s, f) => new THREE.Vector3(s[0] * (halfW(y) - f), y, s[1] * (halfW(y) - f));
        const off = 9 - y0 * 0.12;
        parts.push(beam(inner(y0, [sx, sz], off), inner(y1, [sx, sz], off - 1), t, col, 1.0));
        parts.push(beam(corner(y0, sx, sz), inner(y1, [sx, sz], off - 1), t * 0.4, col, 0.5));
      }
    }
  }
  // arches between the feet
  for (let c = 0; c < 4; c++) {
    const [sx, sz] = C[c];
    const [nx, nz] = C[(c + 1) % 4];
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const x = THREE.MathUtils.lerp(sx, nx, t), z = THREE.MathUtils.lerp(sz, nz, t);
      const y = 44 * Math.sin(Math.PI * t) * 0.9 + 4;
      const w = halfW(y);
      pts.push(new THREE.Vector3(x * w, y, z * w));
    }
    for (let k = 0; k < pts.length - 1; k++) parts.push(beam(pts[k], pts[k + 1], 2.2, ORANGE, 0.9));
  }
  // main deck (145-157 m) and top deck (~250 m)
  const deck = (y0, h, w, color, glow) => {
    const g = new THREE.BoxGeometry(w * 2, h, w * 2);
    g.translate(0, y0 + h / 2, 0);
    return paint(g, color, glow);
  };
  parts.push(deck(144, 7, 14.5, '#dfe3e6', 1.6));
  parts.push(deck(151, 6, 13.5, '#cfd6db', 1.6));
  parts.push(deck(247, 6, 6.2, '#dfe3e6', 1.6));
  // antenna mast
  for (let y = 296; y < H; y += 6) {
    parts.push(beam(new THREE.Vector3(0, y, 0), new THREE.Vector3(0, Math.min(H, y + 6), 0), 1.4 - (y - 296) * 0.025,
      Math.floor(y / 6) % 2 ? ORANGE : WHITE, 0.8));
  }
  // Foot Town podium sits between the legs
  const ft = new THREE.BoxGeometry(70, 22, 50);
  ft.translate(0, 11, 0);
  parts.push(paint(ft, '#d9d4cb', 0.0));
  const geo = clean(parts);
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------------ Skytree
function skytreeRadius(y) {
  const T = [[0, 39.5], [60, 33], [150, 25], [300, 18.5], [340, 17.5], [360, 17], [440, 13], [495, 9.5]];
  for (let i = 0; i < T.length - 1; i++) {
    if (y <= T[i + 1][0]) {
      const t = (y - T[i][0]) / (T[i + 1][0] - T[i][0]);
      return THREE.MathUtils.lerp(T[i][1], T[i + 1][1], t);
    }
  }
  return T[T.length - 1][1];
}

function skytreeShell() {
  const segs = 72, rings = 100, H = 495;
  const pos = [], uv = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const y = H * r / rings;
    const R = skytreeRadius(y);
    const blend = THREE.MathUtils.smoothstep(y, 0, 320);
    for (let s = 0; s <= segs; s++) {
      const th = s / segs * Math.PI * 2;
      // rounded triangle at the base morphing into a circle
      const k = ((th + Math.PI / 6) % (Math.PI * 2 / 3)) - Math.PI / 3;
      const tri = Math.cos(Math.PI / 3) / Math.cos(k);
      const rr = R * THREE.MathUtils.lerp(Math.min(tri * 1.12, 1.35), 1, blend);
      pos.push(Math.cos(th) * rr, y, Math.sin(th) * rr);
      uv.push(s / segs, y);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function skytreeLatticeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: '#e9f0f4', roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uNight: U.uNight, uTime: U.uTime, uMode: U.uSkytreeMode });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSU;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSU = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vSU; uniform float uNight; uniform float uTime; uniform float uMode;
        float sline(float x, float w) { float f = abs(fract(x) - 0.5); float fw = fwidth(x); return 1.0 - smoothstep(w, w + fw * 1.5, 0.5 - f); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float y = vSU.y;
        float circ = 6.2831853 * 18.0;
        float a = vSU.x * circ;
        float d1 = sline((a + y * 0.55) / 9.0, 0.06);
        float d2 = sline((a - y * 0.55) / 9.0, 0.06);
        float ring = sline(y / 16.0, 0.05);
        float vert = sline(vSU.x * 36.0, 0.05);
        float solid = max(max(d1, d2), max(ring, vert));
        float far = smoothstep(0.08, 0.3, max(fwidth(a / 9.0), fwidth(y / 16.0)));
        if (solid < 0.5 && far < 0.5) discard;
        diffuseColor.rgb *= 0.95;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Iki: pale "Sumida" blue; Miyabi: Edo purple with gold
        vec3 iki = vec3(0.45, 0.78, 1.0);
        vec3 miyabi = mix(vec3(0.62, 0.25, 1.0), vec3(1.0, 0.78, 0.35), step(0.86, fract(y / 37.0)));
        vec3 gc = mix(iki, miyabi, uMode);
        float grad = 0.55 + 0.45 * smoothstep(0.0, 495.0, y);
        float shimmer = 0.85 + 0.15 * sin(uTime * 1.7 + y * 0.05);
        totalEmissiveRadiance += gc * uNight * 0.75 * grad * shimmer;`);
  };
  mat.customProgramCacheKey = () => 'skytree-lattice';
  return mat;
}

function skytree() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(skytreeShell(), skytreeLatticeMaterial()));
  const parts = [];
  // central reinforced-concrete core column ("shinbashira")
  const core = new THREE.CylinderGeometry(4.2, 5.2, 375, 20, 1);
  core.translate(0, 187.5, 0);
  parts.push(paint(core, '#cfd6da', 0.7));
  const ring = (y0, h, r, color, glow) => {
    const g = new THREE.CylinderGeometry(r, r, h, 48, 1);
    g.translate(0, y0 + h / 2, 0);
    return paint(g, color, glow);
  };
  // Tembo Deck (350 m) - three floors with a glass band
  parts.push(ring(337, 3, 21.5, '#d8e0e4', 0.4));
  parts.push(ring(340, 13, 20.5, '#6f8796', 2.2));
  parts.push(ring(353, 3, 21, '#d8e0e4', 0.4));
  // Tembo Galleria (450 m)
  parts.push(ring(442, 2, 15, '#d8e0e4', 0.4));
  parts.push(ring(444, 8, 14.2, '#6f8796', 2.2));
  parts.push(ring(452, 2, 14.6, '#d8e0e4', 0.4));
  // gain tower (antenna) 495 -> 634 m
  const gt = new THREE.CylinderGeometry(2.0, 6.2, 125, 16, 8, true);
  gt.translate(0, 495 + 62.5, 0);
  parts.push(paint(gt, '#e6eef2', 0.9));
  const mast = new THREE.CylinderGeometry(0.6, 1.6, 14, 8);
  mast.translate(0, 627, 0);
  parts.push(paint(mast, '#e6eef2', 1.2));
  const geo = clean(parts);
  geo.computeVertexNormals();
  const mat = glowMaterial('#9fdcff', {
    key: 'skytree-solid',
    uniform: { value: new THREE.Color('#bfe6ff') },
    emissiveGLSL: `
      vec3 iki = vec3(0.55, 0.85, 1.0);
      vec3 miyabi = vec3(0.75, 0.45, 1.0);
      totalEmissiveRadiance += mix(iki, miyabi, uSkyMode) * vGlow * uNight * 1.1;`,
  });
  const ob = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    ob(shader, r);
    shader.uniforms.uSkyMode = U.uSkytreeMode;
    shader.fragmentShader = shader.fragmentShader.replace('uniform float uNight;', 'uniform float uSkyMode; uniform float uNight;');
  };
  group.add(new THREE.Mesh(geo, mat));
  return group;
}

// ------------------------------------------------------------------ Rainbow Bridge
function rainbowBridge(rb) {
  const parts = [];
  const WHITE = '#f1f1ec';
  const L = rb.length / 2;            // half length of the suspended structure
  const tower = 285;                   // towers are 570 m apart
  const deckLo = rb.deck, deckHi = rb.deck + 9;
  const halfW = 15.5;
  const TOP = 126;
  // deck truss: top slab, bottom slab, side trusses
  const slab = (y, th, color, glow) => {
    const g = new THREE.BoxGeometry(L * 2, th, halfW * 2);
    g.translate(0, y, 0);
    return paint(g, color, glow);
  };
  parts.push(slab(deckHi - 0.6, 1.2, '#b9bcbc', 0.0));
  parts.push(slab(deckLo - 1.2, 1.2, '#b9bcbc', 0.0));
  for (const side of [-1, 1]) {
    const z = side * halfW;
    parts.push(beam(new THREE.Vector3(-L, deckHi, z), new THREE.Vector3(L, deckHi, z), 1.2, WHITE, 0.3));
    parts.push(beam(new THREE.Vector3(-L, deckLo - 1.2, z), new THREE.Vector3(L, deckLo - 1.2, z), 1.2, WHITE, 0.2));
    for (let x = -L; x < L; x += 12) {
      parts.push(beam(new THREE.Vector3(x, deckLo - 1.2, z), new THREE.Vector3(x + 12, deckHi, z), 0.5, WHITE, 0.15));
      parts.push(beam(new THREE.Vector3(x, deckLo - 1.2, z), new THREE.Vector3(x, deckHi, z), 0.45, WHITE, 0.15));
    }
  }
  // towers: two legs + three struts
  for (const tx of [-tower, tower]) {
    for (const side of [-1, 1]) {
      const z0 = side * (halfW + 4), z1 = side * (halfW + 1.5);
      const leg = beam(new THREE.Vector3(tx, 0, z0), new THREE.Vector3(tx, TOP, z1), 6, WHITE, 0.6, 8);
      parts.push(leg);
    }
    for (const y of [deckLo - 3, 92, TOP - 4]) {
      const w = y > 100 ? halfW + 2 : halfW + 3.5;
      parts.push(beam(new THREE.Vector3(tx, y, -w), new THREE.Vector3(tx, y, w), 4.5, WHITE, 0.6, 5));
    }
    const pier = new THREE.BoxGeometry(30, 8, halfW * 2 + 18);
    pier.translate(tx, 2, 0);
    parts.push(paint(pier, '#a7a8a5', 0));
  }
  // anchorages
  for (const ax of [-L, L]) {
    const a = new THREE.BoxGeometry(46, deckHi + 4, halfW * 2 + 16);
    a.translate(ax + Math.sign(ax) * 18, (deckHi + 4) / 2, 0);
    parts.push(paint(a, '#bdbcb6', 0.05));
  }
  // main cables + hangers
  const cableY = (x) => {
    const ax = Math.abs(x);
    if (ax <= tower) return deckHi + 4 + (TOP - deckHi - 4) * Math.pow(ax / tower, 2);
    const t = (ax - tower) / (L - tower);
    return TOP + (deckHi + 2 - TOP) * t + 10 * t * (1 - t) * -1;
  };
  const lightPts = [];
  for (const side of [-1, 1]) {
    const z = side * (halfW + 1.5);
    let prev = null;
    for (let x = -L; x <= L + 0.1; x += 6) {
      const p = new THREE.Vector3(x, cableY(x), z);
      if (prev) parts.push(beam(prev, p, 1.0, '#e8e8e2', 0.0));
      if (Math.abs(x) < L - 8 && Math.abs(Math.abs(x) - tower) > 4 && Math.round(x / 6) % 2 === 0) {
        parts.push(beam(new THREE.Vector3(x, deckHi, z), p, 0.22, '#d8d8d2', 0.0));
      }
      if (Math.round(x / 6) % 2 === 0) lightPts.push(p.x, p.y + 0.8, p.z);
      prev = p;
    }
  }
  const geo = clean(parts);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, glowMaterial('#cfe6ff', { key: 'rainbow', rough: 0.5, metal: 0.2 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // necklace lights along the cables
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lightPts, 3));
  const lmat = new THREE.ShaderMaterial({
    uniforms: { uNight: U.uNight, uTime: U.uTime },
    vertexShader: /* glsl */`
      uniform float uNight; uniform float uTime;
      varying float vA; varying vec3 vC;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(5200.0 / -mv.z, 2.0, 16.0);
        gl_Position = projectionMatrix * mv;
        vA = uNight;
        // gentle travelling rainbow shimmer over the base white
        float h = fract(position.x * 0.0015 - uTime * 0.05);
        vec3 rainbow = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        vC = mix(vec3(1.0, 0.97, 0.9), rainbow, 0.35);
        if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying vec3 vC;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (exp(-r * r * 5.0) + exp(-r * 3.0) * 0.3) * vA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vC * 6.0 * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const lights = new THREE.Points(lg, lmat);

  const group = new THREE.Group();
  group.add(mesh, lights);
  // orient: local +x along the bridge axis
  group.position.set(rb.x, 0, rb.z);
  group.rotation.y = -Math.atan2(rb.az, rb.ax);
  return group;
}

export function createLandmarks(manifest) {
  const ll = makeLL(manifest);
  const group = new THREE.Group();

  // Landmark Light: orange in the cold season, white in summer (Jul 7 - early Oct)
  const tt = new THREE.Mesh(tokyoTower(), glowMaterial('#ff8a2e', {
    key: 'tokyotower',
    uniform: U.uTowerGlow || (U.uTowerGlow = { value: new THREE.Color('#ff8a2e') }),
    emissiveGLSL: `
      float up = smoothstep(0.0, 260.0, vLW.y);
      float k = vGlow * (1.25 - 0.45 * up);
      totalEmissiveRadiance += uGlowColor * k * uNight * 1.25;`,
    rough: 0.6, metal: 0.1,
  }));
  tt.castShadow = true;
  tt.receiveShadow = true;
  tt.position.copy(ll(139.74543, 35.65859));
  tt.rotation.y = THREE.MathUtils.degToRad(-8);
  group.add(tt);

  const st = skytree();
  st.position.copy(ll(139.81072, 35.71004));
  st.rotation.y = THREE.MathUtils.degToRad(12);
  st.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(st);

  group.add(rainbowBridge(manifest.rainbow));

  // red/white aviation lights at the tips
  const tips = [
    [tt.position.x, 334, tt.position.z], [st.position.x, 636, st.position.z],
    [st.position.x, 498, st.position.z], [st.position.x, 455, st.position.z],
  ];
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(tips.flat(), 3));
  lg.setAttribute('aSeed', new THREE.Float32BufferAttribute(tips.map(() => 0.1), 1));
  return { group, tips: lg, positions: { tokyoTower: tt.position.clone(), skytree: st.position.clone() } };
}
