// Cars and trains animated entirely on the GPU: every route polyline is packed into a
// float texture, each instance stores (route start, length, speed, phase) and the vertex
// shader walks the polyline. Cars keep left (Japan); trains carry their line colours.
import * as THREE from 'three';
import { U } from '../core/env.js';

// line colours by the id assigned in tools/build_world.py (TRAIN_COLORS)
const LINE_COLOR = {
  0: '#9aa0a6', 1: '#9acd32', 2: '#f15a22', 3: '#ffd400', 4: '#00b2e5', 5: '#1a4fa0', 6: '#00ac9a', 7: '#c9242f',
  8: '#00b261', 9: '#f68b1e', 10: '#1069b4', 11: '#1d6fb8', 12: '#0070bb', 13: '#2288cc', 14: '#dd0077',
  15: '#e2001b', 16: '#f5a300', 17: '#0f6cc3', 18: '#0b4ea2', 19: '#e60012', 20: '#f62e36', 21: '#ff9500',
  22: '#b5b5ac', 23: '#009bbf', 24: '#00bb85', 25: '#c1a470', 26: '#8f76d6', 27: '#00ac9b', 28: '#9c5e31',
  29: '#e85298', 30: '#0079c2', 31: '#6cbb5a', 32: '#b6007a', 33: '#e86aa0',
};
// body colour overrides: Keikyu red, Ginza line lemon, Shinkansen / Yurikamome white
const BODY = { 19: '#c8161d', 21: '#f2c300', 5: '#f4f4f2', 11: '#eef1f4', 12: '#e9eef3' };
const CAR_PAINT = ['#f2f2f0', '#e6e7e8', '#bfc3c7', '#8d9196', '#2b2e33', '#14161a', '#1f2a44', '#7a1d22', '#d9d2c2',
  '#2e4a3a', '#1c1f4a', '#f2f2f0', '#c7c9cc', '#101114'];

function packRoutes(data) {
  const W = 2048;
  const n = data.np;
  const H = Math.ceil(n / W);
  const tex = new Float32Array(W * H * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    tex[i * 4] = data.pts.getInt16(o, true) / 2;
    tex[i * 4 + 1] = data.pts.getUint16(o + 4, true) / 20;
    tex[i * 4 + 2] = data.pts.getInt16(o + 2, true) / 2;
    tex[i * 4 + 3] = 1;
  }
  const t = new THREE.DataTexture(tex, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  // per-route start index and length
  let start = 0;
  const info = data.routes.map((r) => {
    let len = 0;
    const s = start;
    for (let k = 1; k < r.n; k++) {
      const a = (s + k - 1) * 4, b = (s + k) * 4;
      len += Math.hypot(tex[b] - tex[a], tex[b + 2] - tex[a + 2]);
    }
    start += r.n;
    return { ...r, start: s, len };
  });
  return { tex: t, W, info };
}

const WALK_GLSL = /* glsl */`
attribute vec4 aRoute;   // start, count, length, speed
attribute vec4 aCar;     // phase, lateral offset, seed, direction (+1 / -1)
attribute vec3 aSize;    // length, height, width
uniform sampler2D uRouteTex;
uniform float uTexW;
uniform float uTime;
uniform float uMaxDist;
varying vec3 vLocal;
varying float vSeed;
varying float vFade;
vec4 fetchP(float i) {
  return texelFetch(uRouteTex, ivec2(int(mod(i, uTexW)), int(floor(i / uTexW))), 0);
}
vec3 gFwd, gRight, gPos;
void walk() {
  float L = aRoute.z;
  float s = mod(aCar.x + uTime * aRoute.w, L);
  float dir = aCar.w;
  float sw = dir > 0.0 ? s : L - s;
  float stepL = L / max(aRoute.y - 1.0, 1.0);
  float fi = sw / stepL;
  float i0 = min(floor(fi), aRoute.y - 2.0);
  float f = fi - i0;
  vec4 a = fetchP(aRoute.x + i0);
  vec4 b = fetchP(aRoute.x + i0 + 1.0);
  vec3 p = mix(a.xyz, b.xyz, f);
  vec3 t = b.xyz - a.xyz;
  t = length(t) > 1e-4 ? normalize(t) : vec3(1.0, 0.0, 0.0);
  t *= dir;
  vec3 r = normalize(vec3(-t.z, 0.0, t.x));
  gFwd = t;
  gRight = r;
  gPos = p - r * aCar.y;   // keep left
  vFade = smoothstep(0.0, 25.0, s) * smoothstep(0.0, 25.0, L - s);
  // beyond the LOD distance the instance collapses to a point (no rasterisation)
  vFade *= step(distance(gPos, cameraPosition), uMaxDist);
  vSeed = aCar.z;
}
`;

function vehicleMaterial(kind, routeTex, W) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.4 });
  mat.userData.maxDist = { value: 1e9 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMaxDist = mat.userData.maxDist;
    shader.uniforms.uRouteTex = { value: routeTex };
    shader.uniforms.uTexW = { value: W };
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uNight = U.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WALK_GLSL}\nattribute vec3 aColor;\nattribute vec3 aStripe;\nvarying vec3 vBody;\nvarying vec3 vStripe;`)
      .replace('#include <beginnormal_vertex>', `walk();
        vec3 objectNormal = gFwd * normal.x + vec3(0.0, 1.0, 0.0) * normal.y + gRight * normal.z;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `
        vLocal = position * aSize;
        vBody = aColor;
        vStripe = aStripe;
        vec3 lp = position * aSize * vFade;
        vec3 transformed = gPos + gFwd * lp.x + vec3(0.0, 1.0, 0.0) * (lp.y + aSize.y * 0.5 * vFade) + gRight * lp.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocal; varying float vSeed; varying float vFade; varying vec3 vBody; varying vec3 vStripe;
        uniform float uNight;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 c = vBody;
        vec3 e = vec3(0.0);
        ${kind === 'ped' ? '' : kind === 'car' ? `
          float L = 4.4;
          float front = smoothstep(L * 0.5 - 0.06, L * 0.5, vLocal.x);
          float rear = smoothstep(-L * 0.5 + 0.06, -L * 0.5, vLocal.x);
          float lampH = smoothstep(-0.1, 0.0, vLocal.y + 0.05) * (1.0 - smoothstep(0.25, 0.35, vLocal.y));
          float side = smoothstep(0.35, 0.6, abs(vLocal.z));
          // glasshouse
          float glassBand = step(0.12, vLocal.y) * (1.0 - step(0.6, vLocal.y));
          c = mix(c, vec3(0.06, 0.07, 0.08), glassBand * 0.85);
          e += vec3(1.0, 0.95, 0.85) * front * lampH * side * 7.0 * (0.15 + uNight);
          e += vec3(1.0, 0.05, 0.03) * rear * lampH * side * 4.0 * (0.05 + uNight);
        ` : `
          float y = vLocal.y;
          float stripe = smoothstep(-0.55, -0.5, y) * (1.0 - smoothstep(-0.2, -0.15, y));
          float win = smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.75, 0.8, y));
          float pane = step(0.18, fract(vLocal.x / 2.6));
          c = mix(c, vStripe, stripe);
          c = mix(c, vec3(0.05, 0.06, 0.07), win * pane * 0.9);
          e += vec3(1.0, 0.96, 0.88) * win * pane * uNight * 1.6;
        `}
        diffuseColor.rgb = c;
        vec3 vehEmis = e;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vehEmis;');
  };
  mat.customProgramCacheKey = () => `tokyo-${kind}`;
  return mat;
}

export function createTraffic(data, quality) {
  const { tex, W, info } = packRoutes(data);
  const group = new THREE.Group();
  const lodMats = [];
  group.userData.setLod = (lod) => {
    for (const [m, kind] of lodMats) m.userData.maxDist.value = kind === 'ped' ? lod.ped : kind === 'train' ? lod.car * 2.2 : lod.car;
  };
  const rnd = (i) => Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;
  const density = 1;

  // ---------------------------------------------------------------- cars
  const SPACING = { 1: 38, 2: 55, 3: 65, 4: 90 };
  const SPEED = { 1: 22, 2: 14, 3: 12, 4: 10 };
  const cars = [];
  info.forEach((r, ri) => {
    if (r.kind >= 2 || r.len < 50) return;
    const code = r.color;
    const n = Math.floor(r.len / SPACING[code] * density);
    for (let k = 0; k < n; k++) {
      const seed = rnd(ri * 131 + k);
      const dir = r.kind === 0 ? 1 : (k % 2 ? 1 : -1);
      const lane = r.kind === 0 ? (seed < 0.5 ? -1.7 : 1.7) : (code <= 3 ? 2.0 + (seed > 0.5 ? 3.2 : 0) : 1.9);
      cars.push([r.start, r.n, r.len, SPEED[code] * (0.75 + 0.5 * rnd(ri + k * 7)), rnd(k * 3.1 + ri) * r.len, lane, seed, dir]);
    }
  });
  if (cars.length) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, box.attributes[k]);
    const n = cars.length;
    const aRoute = new Float32Array(n * 4), aCar = new Float32Array(n * 4), aSize = new Float32Array(n * 3);
    const aColor = new Float32Array(n * 3), aStripe = new Float32Array(n * 3);
    const col = new THREE.Color();
    cars.forEach((c, i) => {
      aRoute.set([c[0], c[1], c[2], c[3]], i * 4);
      aCar.set([c[4], c[5], c[6], c[7]], i * 4);
      const s = c[6];
      const truck = s > 0.9;
      aSize.set(truck ? [8, 2.8, 2.3] : s > 0.8 ? [4.8, 1.9, 1.8] : [4.4, 1.45, 1.75], i * 3);
      col.set(CAR_PAINT[Math.floor(rnd(i * 5.3) * CAR_PAINT.length)]);
      if (s < 0.06) col.set(s < 0.03 ? '#1e2a52' : '#e9d64a');   // taxis
      if (truck) col.set('#d8dadc');
      aColor.set([col.r, col.g, col.b], i * 3);
    });
    geo.setAttribute('aRoute', new THREE.InstancedBufferAttribute(aRoute, 4));
    geo.setAttribute('aCar', new THREE.InstancedBufferAttribute(aCar, 4));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.setAttribute('aStripe', new THREE.InstancedBufferAttribute(aStripe, 3));
    geo.instanceCount = n;
    const mesh = new THREE.Mesh(geo, vehicleMaterial('car', tex, W));
    lodMats.push([mesh.material, 'car']);
    mesh.frustumCulled = false;
    group.add(mesh);
    group.userData.cars = n;
  }

  // ---------------------------------------------------------------- trains
  const trains = [];
  info.forEach((r, ri) => {
    if (r.kind !== 2 || r.len < 900) return;
    const id = r.color;
    const consist = id === 5 ? 16 : id === 11 || id === 12 || id === 33 ? 6 : id >= 20 ? 8 : 10;
    const carLen = id === 33 ? 13 : id === 11 ? 16 : 20;
    const nTrains = Math.max(1, Math.round(r.len / 2600 * density));
    const speed = id === 5 ? 30 : id === 33 ? 8 : 17;
    for (let t = 0; t < nTrains; t++) {
      const base = (t / nTrains + rnd(ri * 17) * 0.3) * r.len;
      const dir = t % 2 ? 1 : -1;
      for (let k = 0; k < consist; k++) {
        trains.push([r.start, r.n, r.len, speed, base - k * (carLen + 0.6) * dir * -1, 0, rnd(ri + t), dir, id, carLen]);
      }
    }
  });
  if (trains.length) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, box.attributes[k]);
    const n = trains.length;
    const aRoute = new Float32Array(n * 4), aCar = new Float32Array(n * 4), aSize = new Float32Array(n * 3);
    const aColor = new Float32Array(n * 3), aStripe = new Float32Array(n * 3);
    const col = new THREE.Color();
    trains.forEach((c, i) => {
      aRoute.set([c[0], c[1], c[2], c[3]], i * 4);
      aCar.set([((c[4] % c[2]) + c[2]) % c[2], c[5], c[6], c[7]], i * 4);
      aSize.set([c[9], 3.6, 2.9], i * 3);
      col.set(BODY[c[8]] || '#c9ccd0');
      aColor.set([col.r, col.g, col.b], i * 3);
      col.set(LINE_COLOR[c[8]] || '#888888');
      aStripe.set([col.r, col.g, col.b], i * 3);
    });
    geo.setAttribute('aRoute', new THREE.InstancedBufferAttribute(aRoute, 4));
    geo.setAttribute('aCar', new THREE.InstancedBufferAttribute(aCar, 4));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.setAttribute('aStripe', new THREE.InstancedBufferAttribute(aStripe, 3));
    geo.instanceCount = n;
    const mesh = new THREE.Mesh(geo, vehicleMaterial('train', tex, W));
    lodMats.push([mesh.material, 'train']);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    group.add(mesh);
    group.userData.trainCars = n;
  }
  // ---------------------------------------------------------------- pedestrians
  const peds = [];
  info.forEach((r, ri) => {
    if (r.kind !== 3 || r.len < 4) return;
    const n = Math.round(r.len * (r.color / 10) * 0.9 * density);
    for (let k = 0; k < n; k++) {
      const seed = rnd(ri * 977 + k * 13);
      peds.push([r.start, r.n, r.len, 1.0 + seed * 0.7, rnd(k * 7.7 + ri) * r.len, (rnd(k + ri * 3) - 0.5) * 3.2, seed, k % 2 ? 1 : -1]);
    }
  });
  if (peds.length) {
    const body = new THREE.CylinderGeometry(0.22, 0.2, 1, 6);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = body.index;
    for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, body.attributes[k]);
    const n = peds.length;
    const aRoute = new Float32Array(n * 4), aCar = new Float32Array(n * 4), aSize = new Float32Array(n * 3);
    const aColor = new Float32Array(n * 3), aStripe = new Float32Array(n * 3);
    const CLOTHES = ['#1b1c20', '#26282e', '#3a3d44', '#e9e6df', '#2c3a55', '#5b4636', '#7d2a2a', '#c9b79c', '#111214', '#4a5a3a'];
    const col = new THREE.Color();
    peds.forEach((c, i) => {
      aRoute.set([c[0], c[1], c[2], c[3]], i * 4);
      aCar.set([c[4], c[5], c[6], c[7]], i * 4);
      aSize.set([1, 1.55 + c[6] * 0.3, 1], i * 3);
      col.set(CLOTHES[Math.floor(rnd(i * 3.3) * CLOTHES.length)]);
      aColor.set([col.r, col.g, col.b], i * 3);
    });
    geo.setAttribute('aRoute', new THREE.InstancedBufferAttribute(aRoute, 4));
    geo.setAttribute('aCar', new THREE.InstancedBufferAttribute(aCar, 4));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.setAttribute('aStripe', new THREE.InstancedBufferAttribute(aStripe, 3));
    geo.instanceCount = n;
    const mesh = new THREE.Mesh(geo, vehicleMaterial('ped', tex, W));
    lodMats.push([mesh.material, 'ped']);
    mesh.frustumCulled = false;
    group.add(mesh);
    group.userData.pedestrians = n;
  }
  return group;
}
