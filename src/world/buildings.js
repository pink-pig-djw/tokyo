// City buildings: MeshStandardMaterial extended with a procedural facade shader
// (window grids per building style, balcony bands, curtain walls, lit windows at night,
// glowing street-level shops, crown lighting, snow on roofs, wet facades).
import * as THREE from 'three';
import { U } from '../core/env.js';

const FACADE_PARS = /* glsl */`
uniform float uNight;
uniform float uLitRes;
uniform float uLitOff;
uniform float uTime;
uniform float uSnow;
uniform float uWet;
uniform vec3 uWallPal[36];
uniform vec3 uRoofPal[16];
varying vec3 vWPos;
varying float vU;
varying vec4 vInfo;
varying vec2 vInfo2;

float fh11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float fh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fh31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

// returns: rgb = albedo, a = window mask; also writes rough/metal/emissive
vec4 facade(out float rough, out float metal, out vec3 emis) {
  vec3 fdx = dFdx(vWPos), fdy = dFdy(vWPos);
  vec3 wN = normalize(cross(fdx, fdy));
  bool roof = abs(wN.y) > 0.45;
  int wallIdx = int(vInfo.x + 0.5);
  int roofIdx = int(vInfo.y + 0.5);
  int style = int(vInfo.z + 0.5);
  float seed = vInfo.w / 255.0;
  float bh = vInfo2.x * 0.1;
  int flags = int(vInfo2.y + 0.5);
  float minh = float(flags >> 8);
  flags = flags & 255;
  bool nightZone = (flags & 2) != 0;
  emis = vec3(0.0);

  if (roof) {
    vec3 c = uRoofPal[roofIdx];
    // subtle variation and rooftop grime
    c *= 0.86 + 0.28 * fh11(seed * 91.0);
    float snowAmt = uSnow * smoothstep(0.35, 0.8, abs(wN.y));
    c = mix(c, vec3(0.93, 0.95, 0.98), snowAmt);
    rough = mix(0.85, 0.35, uWet);
    metal = (style == 4 && roofIdx == 4) ? 0.35 : 0.0;
    if ((flags & 8) != 0 && uNight > 0.0) {
      // helipad / crown glow on supertall roofs
      emis += vec3(1.0, 0.85, 0.6) * 0.05 * uNight;
    }
    return vec4(c, 0.0);
  }

  vec3 wall = uWallPal[wallIdx];
  wall *= 0.9 + 0.2 * fh11(seed * 53.0);
  float y = vWPos.y;
  float u = vU;

  float floorH = 3.0, winW = 3.4, ground = 3.2;
  if (style == 0) { floorH = 2.85; winW = 3.3; ground = 0.0; }
  else if (style == 1) { floorH = 2.95; winW = 3.6 + seed * 1.6; ground = 3.4; }
  else if (style == 2) { floorH = 3.7 + seed * 0.4; winW = 1.6 + seed * 0.9; ground = 4.6; }
  else if (style == 3) { floorH = 4.0; winW = 1.5; ground = 6.0; }
  else if (style == 4) { floorH = 6.0; winW = 7.0; ground = 0.0; }
  else if (style == 6) { floorH = 5.0; winW = 4.0; ground = 0.0; }

  float yy = y - minh - ground;
  vec2 cell = vec2(u / winW, yy / floorH);
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  vec2 fw = fwidth(cell);
  float pix = max(fw.x, fw.y);
  float far = smoothstep(0.4, 1.1, pix);   // pattern too small to resolve -> average

  float topLimit = bh - (style == 3 ? 1.0 : 1.4);
  float inBody = step(0.0, yy) * step(y, topLimit);

  float win = 0.0;
  float avgWin = 0.0;
  vec3 frame = wall;
  if (style == 0) {
    float present = step(0.35, fh21(id + seed * 17.0));
    vec2 lo = vec2(0.28, 0.32), hi = vec2(0.72, 0.82);
    vec2 m = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
    win = m.x * m.y * present;
    avgWin = 0.65 * 0.2 * 0.5;
  } else if (style == 1) {
    // Japanese "mansion": balcony parapet band + recessed sliding windows
    float band = 1.0 - smoothstep(0.36 - fw.y, 0.36 + fw.y, f.y);
    vec2 lo = vec2(0.08, 0.40), hi = vec2(0.92, 0.95);
    vec2 m = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
    win = m.x * m.y;
    frame = mix(wall, vec3(0.88, 0.88, 0.86) * (0.8 + 0.2 * seed), band * 0.75);
    // thin dividers between units
    float div = smoothstep(0.03 + fw.x, 0.03, abs(f.x - 0.5) - 0.47);
    frame = mix(frame, wall * 0.75, div * 0.6);
    avgWin = 0.84 * 0.55;
  } else if (style == 2) {
    vec2 lo = vec2(0.12, 0.26), hi = vec2(0.88, 0.86);
    vec2 m = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
    win = m.x * m.y;
    avgWin = 0.76 * 0.6;
  } else if (style == 3) {
    // curtain wall: mostly glass, mullions + spandrel
    vec2 lo = vec2(0.035, 0.16), hi = vec2(0.965, 0.97);
    vec2 m = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
    win = m.x * m.y;
    frame = wall * 0.75;
    avgWin = 0.93 * 0.81;
  } else if (style == 4) {
    float rowOn = step(0.55, fh11(id.y + seed * 31.0));
    vec2 lo = vec2(0.05, 0.62), hi = vec2(0.95, 0.84);
    vec2 m = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
    win = m.x * m.y * rowOn;
    avgWin = 0.2;
  } else if (style == 6) {
    vec2 lo = vec2(0.1, 0.3), hi = vec2(0.9, 0.85);
    vec2 m = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
    win = m.x * m.y;
    avgWin = 0.45;
  }
  win *= inBody;
  avgWin *= inBody;
  float wm = mix(win, avgWin, far);

  // window glass colour by day: dark, tinted, reflective
  vec3 glass = (style == 3) ? wall * 0.55 + vec3(0.02, 0.03, 0.04) : vec3(0.10, 0.12, 0.14) + wall * 0.08;
  vec3 col = mix(frame, glass, wm);

  // night: lit windows
  float lit = 0.0;
  vec3 litCol = vec3(0.0);
  if (uNight > 0.0 || style == 2 || style == 3) {
    bool office = style == 2 || style == 3 || style == 6;
    float frac = office ? uLitOff : uLitRes;
    if (nightZone) frac = min(1.0, frac * 1.35 + 0.08);
    if (style == 4) frac *= 0.4;
    float r = fh21(id + vec2(seed * 113.0, seed * 7.0));
    float rowR = fh11(id.y * 1.7 + seed * 41.0);
    float on = office ? step(r * 0.5 + rowR * 0.5, frac) : step(r, frac);
    float tone = fh11(id.y * 0.37 + floor(id.x / 6.0) * 1.3 + seed * 19.0);
    vec3 cWarm = vec3(1.0, 0.6, 0.28), cWhite = vec3(1.0, 0.84, 0.62), cCool = vec3(0.72, 0.86, 1.0);
    vec3 lc = office ? (tone < 0.3 ? cCool : cWhite) : (r < frac * 0.25 ? cWhite : cWarm);
    float inten = (office ? 1.05 : 0.8) * (0.35 + 0.65 * fh21(id * 1.31 + seed));
    // far away: floors light up in bands (offices) or speckle (homes)
    float band = fh11(floor(cell.y) * 3.1 + seed * 9.0);
    float bandLit = office ? smoothstep(0.0, 0.35, frac - band * 0.8) : frac;
    float avgLit = bandLit * (office ? 0.75 : 0.55) * (0.7 + 0.6 * fh11(floor(cell.y / 3.0) + seed));
    lit = mix(on * win * inten, avgWin * avgLit, far);
    litCol = lc;
  }
  float nightW = max(uNight, (style == 2 || style == 3) ? 0.12 : 0.0);
  emis += litCol * lit * nightW * (style == 3 ? 1.1 : 1.0);

  // street-level shops: lit shopfronts at night, dark glass by day
  if ((flags & 16) != 0 && minh < 1.0 && y < 3.6 && y > 0.4) {
    float seg = floor(u / 5.5);
    float shop = step(0.25, fh21(vec2(seg, seed * 77.0)));
    vec3 sc = mix(vec3(1.0, 0.92, 0.8), vec3(0.85, 0.95, 1.0), fh11(seg + seed));
    if (fh11(seg * 3.1 + seed) > 0.8) sc = vec3(1.0, 0.55, 0.3);
    float sm = shop * smoothstep(0.02, 0.1, fract(u / 5.5)) * smoothstep(0.98, 0.9, fract(u / 5.5));
    col = mix(col, vec3(0.08, 0.09, 0.1), sm * 0.8);
    emis += sc * sm * 2.4 * max(uNight, 0.15);
    wm = max(wm, sm);
  }

  // crown lighting on supertall towers
  if ((flags & 8) != 0 && y > bh - 3.2) {
    float band = smoothstep(bh - 3.2, bh - 2.4, y) * (1.0 - smoothstep(bh - 1.2, bh - 0.6, y));
    emis += vec3(1.0, 0.88, 0.7) * band * 0.9 * uNight;
  }

  // contact darkening near the ground
  col *= mix(0.62, 1.0, smoothstep(0.0, 9.0, y - minh));
  col *= 1.0 - uWet * 0.18;
  rough = mix(0.88, (style == 3) ? 0.06 : 0.14, wm);
  rough = mix(rough, rough * 0.45, uWet);
  metal = mix(0.0, (style == 3) ? 0.75 : 0.35, wm);
  return vec4(col, wm);
}
`;

let sharedMaterial = null;
let depthMaterial = null;

export function buildingMaterial(manifest) {
  if (sharedMaterial) return sharedMaterial;
  const wallPal = manifest.wallPalette.map((h) => new THREE.Color(h));
  const roofPal = manifest.roofPalette.map((h) => new THREE.Color(h));
  while (wallPal.length < 36) wallPal.push(new THREE.Color(0.8, 0.8, 0.8));
  while (roofPal.length < 16) roofPal.push(new THREE.Color(0.5, 0.5, 0.5));

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uNight: U.uNight, uLitRes: U.uLitRes, uLitOff: U.uLitOff, uTime: U.uTime, uSnow: U.uSnow, uWet: U.uWet,
      uWallPal: { value: wallPal }, uRoofPal: { value: roofPal },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aU;
        attribute vec4 aInfo;
        attribute vec2 aInfo2;
        varying vec3 vWPos;
        varying float vU;
        varying vec4 vInfo;
        varying vec2 vInfo2;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vU = aU * 0.1;
        vInfo = aInfo;
        vInfo2 = aInfo2;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fRough, fMetal; vec3 fEmis;
        vec4 fac = facade(fRough, fMetal, fEmis);
        diffuseColor.rgb = fac.rgb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = fEmis;');
  };
  mat.customProgramCacheKey = () => 'tokyo-building-v1';
  sharedMaterial = mat;

  depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  return mat;
}

export function buildingDepthMaterial() {
  return depthMaterial;
}

/** Create THREE meshes for one processed chunk. */
export function createChunkMeshes(chunkRes, material) {
  const meshes = [];
  for (const b of chunkRes.batches) {
    const g = new THREE.BufferGeometry();
    const ib = new THREE.InterleavedBuffer(b.pos, 4);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0, false));
    g.setAttribute('aU', new THREE.InterleavedBufferAttribute(ib, 1, 3, false));
    g.setAttribute('aInfo', new THREE.BufferAttribute(b.info, 4, false));
    g.setAttribute('aInfo2', new THREE.BufferAttribute(b.info2, 2, false));
    g.setIndex(new THREE.BufferAttribute(b.idx, 1));
    const [cx, cy, cz, r] = b.sphere;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(cx - r, cy - r, cz - r), new THREE.Vector3(cx + r, cy + r, cz + r));
    const m = new THREE.Mesh(g, material);
    m.position.set(chunkRes.cx, 0, chunkRes.cz);
    m.scale.setScalar(0.05);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.userData.small = b.small;
    m.userData.center = new THREE.Vector3(chunkRes.cx + cx * 0.05, cy * 0.05, chunkRes.cz + cz * 0.05);
    m.userData.radius = r * 0.05;
    meshes.push(m);
  }
  return meshes;
}
