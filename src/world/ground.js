// Ground: urban base plane, land-cover layers (parks, forest, cemeteries...),
// animated water for Tokyo Bay / rivers / moats, and the coarse far field.
import * as THREE from 'three';
import { U } from '../core/env.js';

const LAYER_STYLE = {
  // id: [colour, roughness, polygonOffsetUnits]
  1: ['#26361e', 0.95, -2],   // forest floor
  2: ['#4d6234', 0.92, -2],   // grass / parks
  3: ['#6b6f62', 0.9, -2],    // cemetery
  4: ['#58703e', 0.9, -2],    // pitches
  5: ['#b8a988', 0.95, -2],   // sand
  6: ['#9b968d', 0.85, -2],   // plazas
  7: ['#6a625a', 0.95, -2],   // rail yards
};

const NOISE_GLSL = /* glsl */`
float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh(i), gh(i + vec2(1, 0)), u.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), u.x), u.y);
}
`;

function groundMaterial(color, rough, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = U.uNight;
    shader.uniforms.uWet = U.uWet;
    shader.uniforms.uSnow = U.uSnow;
    shader.uniforms.uSakura = U.uSakura;
    shader.uniforms.uAutumn = U.uAutumn;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGW;
        uniform float uNight; uniform float uWet; uniform float uSnow; uniform float uSakura; uniform float uAutumn;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float camD = length(vGW - cameraPosition);
        float fine = 1.0 - smoothstep(150.0, 900.0, camD);
        float gn = gnoise(vGW.xz * 0.004) * 0.55 + gnoise(vGW.xz * 0.02) * 0.45;
        diffuseColor.rgb *= 0.86 + 0.28 * gn;
        ${opts.urban ? `
          // urban fabric: paving / alleys / car parks (only resolved up close)
          float blocks = gnoise(vGW.xz * 0.35);
          diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * blocks, fine);
        ` : ''}
        ${opts.green ? `
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 0.95, 0.6), uAutumn * 0.25);
        ` : ''}
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96), uSnow * 0.85);
        diffuseColor.rgb *= 1.0 - uWet * 0.35;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.25, uWet * ${opts.urban ? '0.9' : '0.5'});`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${opts.urban ? `
          // diffuse spill of street lights on the pavement at night
          float spill = gnoise(vGW.xz * 0.02) * 0.7 + gnoise(vGW.xz * 0.06) * 0.3;
          totalEmissiveRadiance += vec3(1.0, 0.7, 0.42) * uNight * (0.012 + 0.03 * spill) * (1.0 + uWet * 1.5);
        ` : ''}`);
  };
  mat.customProgramCacheKey = () => `ground-${opts.urban ? 'u' : ''}${opts.green ? 'g' : ''}`;
  return mat;
}

export function waterMaterial(refl) {
  const mat = new THREE.MeshStandardMaterial({ color: '#0b222b', roughness: 0.06, metalness: 0.0 });
  if (refl && refl.scale) mat.envMapIntensity = 0.35;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uNight = U.uNight;
    shader.uniforms.uWet = U.uWet;
    const R = refl ? refl.uniforms : { tReflect: { value: null }, uReflMatrix: { value: new THREE.Matrix4() }, uReflStrength: { value: 0 } };
    shader.uniforms.tReflect = R.tReflect;
    shader.uniforms.uReflMatrix = R.uReflMatrix;
    shader.uniforms.uReflStrength = R.uReflStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nvarying vec4 vReflUv;\nuniform mat4 uReflMatrix;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvReflUv = uReflMatrix * vec4(vGW, 1.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGW;
        varying vec4 vReflUv;
        uniform sampler2D tReflect;
        uniform float uReflStrength;
        uniform float uTime; uniform float uNight; uniform float uWet;
        ${NOISE_GLSL}
        vec2 waveGrad(vec2 p, float t, float mpp) {
          // sum of directional waves; octaves finer than ~3 px are faded out (no moire)
          vec2 g = vec2(0.0);
          float a = 1.0;
          vec2 dirs[5] = vec2[5](vec2(1.0, 0.3), vec2(-0.6, 1.0), vec2(0.8, -0.9), vec2(-1.0, -0.2), vec2(0.2, 1.0));
          float fr = 0.045;
          for (int i = 0; i < 5; i++) {
            vec2 d = normalize(dirs[i]);
            float ph = dot(d, p) * fr + t * (0.9 + float(i) * 0.37);
            float nyq = 1.0 - smoothstep(0.08, 0.3, fr * mpp);
            g += d * cos(ph) * a * fr * nyq;
            fr *= 1.9; a *= 0.62;
          }
          return g;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 wDist = vec2(0.0);
        {
          float dist = length(vGW - cameraPosition);
          float detail = 1.0 - smoothstep(300.0, 6000.0, dist);
          float mpp = length(fwidth(vGW.xz));
          vec2 g = waveGrad(vGW.xz, uTime, mpp) * (1.2 + uWet * 1.5);
          float nyqN = 1.0 - smoothstep(0.15, 0.6, 0.6 * mpp);
          g += vec2(gnoise(vGW.xz * 0.6 + uTime * 0.7) - 0.5, gnoise(vGW.zx * 0.6 - uTime * 0.6) - 0.5) * 0.22 * detail * nyqN;
          g *= mix(0.25, 1.0, detail);
          vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          wDist = g * mix(0.6, 1.0, detail);
        }`)
      .replace('#include <opaque_fragment>', `
        if (uReflStrength > 0.0) {
          vec2 ruv = vReflUv.xy / vReflUv.w + wDist * 0.35;
          vec3 refl = texture2D(tReflect, clamp(ruv, 0.001, 0.999)).rgb;
          vec3 V = normalize(vViewPosition);
          float F = 0.02 + 0.98 * pow(1.0 - max(dot(normal, V), 0.0), 5.0);
          outgoingLight = mix(outgoingLight, refl * 0.9, clamp(F * 1.15 + 0.1, 0.0, 1.0) * uReflStrength);
        }
        #include <opaque_fragment>`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 0.85 + 0.3 * gnoise(vGW.xz * 0.003);`);
  };
  mat.customProgramCacheKey = () => 'tokyo-water';
  return mat;
}

function layerGeometry(xz, idx, scale, y) {
  const n = xz.length / 2;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = xz[i * 2] * scale;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = xz[i * 2 + 1] * scale;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) nrm[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  // earcut output from the pipeline is CCW in (x, north); flip for three's (x, z=-north)
  const fixed = new Uint32Array(idx.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = pos[a * 3], az = pos[a * 3 + 2];
    const bx = pos[b * 3], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cz = pos[c * 3 + 2];
    const cr = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    fixed[t] = a;
    if (cr >= 0) { fixed[t + 1] = b; fixed[t + 2] = c; } else { fixed[t + 1] = c; fixed[t + 2] = b; }
  }
  g.setIndex(new THREE.BufferAttribute(fixed, 1));
  g.computeBoundingSphere();
  return g;
}

export function createGround(manifest, groundLayers, far, refl) {
  const group = new THREE.Group();
  const core = manifest.core;
  const water = waterMaterial(refl);
  group.userData.waterMeshes = [];

  // urban base plane over the core
  const w = core.x1 - core.x0, d = core.z1 - core.z0;
  const baseGeo = new THREE.PlaneGeometry(w, d, 1, 1);
  baseGeo.rotateX(-Math.PI / 2);
  baseGeo.translate((core.x0 + core.x1) / 2, 0, (core.z0 + core.z1) / 2);
  const base = new THREE.Mesh(baseGeo, groundMaterial('#8a857c', 0.95, { urban: true }));
  base.receiveShadow = true;
  base.renderOrder = -10;
  group.add(base);

  for (const L of groundLayers) {
    const g = layerGeometry(L.xz, L.idx, 0.5, 0);
    let mat;
    if (L.id === 0) {
      mat = water;
    } else {
      const [c, r, off] = LAYER_STYLE[L.id] || ['#777', 0.9, -2];
      mat = groundMaterial(c, r, { green: L.id === 1 || L.id === 2 || L.id === 4 });
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits = off;
    }
    if (L.id === 0) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits = -3;
    }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.renderOrder = -9;
    group.add(m);
    if (L.id === 0) group.userData.waterMeshes.push(m);
  }

  // far field (beyond the detailed core)
  const farLandMat = groundMaterial('#6e6a63', 0.95, { urban: true });
  const fl = new THREE.Mesh(layerGeometry(far.land.xz, far.land.idx, 4, -0.05), farLandMat);
  fl.renderOrder = -10;
  group.add(fl);
  const fw = new THREE.Mesh(layerGeometry(far.water.xz, far.water.idx, 4, -0.05), water);
  fw.renderOrder = -10;
  group.add(fw);

  // a huge sea plane under everything to the horizon
  // (a square ring around the 120 km far-field box, so it never z-fights with it)
  const shape = new THREE.Shape([new THREE.Vector2(-200000, -200000), new THREE.Vector2(200000, -200000),
    new THREE.Vector2(200000, 200000), new THREE.Vector2(-200000, 200000)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-59990, -59990), new THREE.Vector2(-59990, 59990),
    new THREE.Vector2(59990, 59990), new THREE.Vector2(59990, -59990)]));
  const oceanGeo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const ocean = new THREE.Mesh(oceanGeo, water);
  ocean.position.y = -0.05;
  ocean.renderOrder = -11;
  group.add(ocean);
  return group;
}
