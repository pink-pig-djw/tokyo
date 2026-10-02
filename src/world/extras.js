// Instanced city details: trees (with seasons and wind), street lamps, red aviation
// obstruction lights, rooftop plant rooms, neon blade signs / light boxes, big LED
// screens and the endless low-rise sprawl beyond the detailed core.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from '../core/env.js';

// ------------------------------------------------------------------ trees
function treeGeometries() {
  // broadleaf: jittered icosahedron crown + trunk
  const crown = new THREE.IcosahedronGeometry(1, 1);
  const p = crown.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.18 * Math.sin(x * 5.1 + y * 3.7) * Math.cos(z * 4.3 + x * 1.3);
    p.setXYZ(i, x * n, y * n * 0.82, z * n);
  }
  crown.translate(0, 1.55, 0);
  crown.scale(0.36, 0.5, 0.36);
  const trunk = new THREE.CylinderGeometry(0.03, 0.045, 0.62, 5, 1, true);
  trunk.translate(0, 0.31, 0);
  const tag = (g, v) => {
    const a = new Float32Array(g.attributes.position.count).fill(v);
    g.setAttribute('aPart', new THREE.BufferAttribute(a, 1));
    return g.toNonIndexed();
  };
  const broad = mergeGeometries([tag(trunk.clone(), 0), tag(crown, 1)]);
  const cone = new THREE.ConeGeometry(0.3, 0.85, 7, 2);
  cone.translate(0, 0.62, 0);
  const cone2 = new THREE.ConeGeometry(0.22, 0.5, 7, 1);
  cone2.translate(0, 0.9, 0);
  const conifer = mergeGeometries([tag(trunk, 0), tag(cone, 1), tag(cone2, 1)]);
  broad.computeVertexNormals();
  conifer.computeVertexNormals();
  return { broad, conifer };
}

function treeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTime: U.uTime, uSakura: U.uSakura, uAutumn: U.uAutumn, uSnow: U.uSnow, uNight: U.uNight,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPart;
        attribute float aType;
        varying float vPart;
        varying float vType;
        varying float vSeed;
        uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPart = aPart;
        vType = aType;
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vSeed = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float sway = sin(uTime * 1.3 + ip.x * 0.05 + ip.z * 0.07) * 0.025 * aPart * transformed.y;
        transformed.x += sway;
        transformed.z += sway * 0.6;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vPart; varying float vType; varying float vSeed;
        uniform float uSakura; uniform float uAutumn; uniform float uSnow; uniform float uNight;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        int t = int(vType + 0.5);
        vec3 c;
        if (vPart < 0.5) c = vec3(0.22, 0.17, 0.13);
        else {
          vec3 g0 = vec3(0.13, 0.22, 0.09), g1 = vec3(0.07, 0.15, 0.07), g2 = vec3(0.24, 0.32, 0.1), g4 = vec3(0.17, 0.25, 0.1);
          if (t == 1) c = g1;
          else if (t == 2) c = mix(g2, vec3(0.86, 0.66, 0.1), uAutumn * (0.6 + 0.4 * vSeed));
          else if (t == 3) c = mix(mix(g4, vec3(0.55, 0.22, 0.12), uAutumn * 0.7), vec3(1.0, 0.72, 0.8), uSakura);
          else if (t == 4) c = mix(g4, vec3(0.62, 0.32, 0.1), uAutumn * (0.5 + 0.5 * vSeed));
          else c = mix(g0, g0 * vec3(1.3, 1.05, 0.7), uAutumn * 0.3 * vSeed);
          c *= 0.8 + 0.4 * vSeed;
          c = mix(c, vec3(0.88, 0.9, 0.94), uSnow * 0.65 * smoothstep(0.0, 0.8, vNormal.y));
        }
        diffuseColor.rgb = c;`);
  };
  mat.customProgramCacheKey = () => 'tokyo-tree';
  return mat;
}

export function createTrees(sec, quality) {
  const { broad, conifer } = treeGeometries();
  const step = quality.level === 'low' ? 3 : quality.level === 'medium' ? 2 : 1;
  const counts = [0, 0];
  for (let i = 0; i < sec.n; i += step) counts[sec.dv.getUint8(i * 6 + 4) === 1 ? 1 : 0]++;
  const mat = treeMaterial();
  const meshes = [new THREE.InstancedMesh(broad, mat, counts[0]), new THREE.InstancedMesh(conifer, mat, counts[1])];
  const types = [new Float32Array(counts[0]), new Float32Array(counts[1])];
  const k = [0, 0];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < sec.n; i += step) {
    const o = i * 6;
    const x = sec.dv.getInt16(o, true) / 2;
    const z = sec.dv.getInt16(o + 2, true) / 2;
    const t = sec.dv.getUint8(o + 4);
    const sc = sec.dv.getUint8(o + 5) / 255;
    const h = 6 + sc * 13 * (t === 1 ? 1.1 : 1);
    const which = t === 1 ? 1 : 0;
    q.setFromAxisAngle(up, (i * 2.399) % (Math.PI * 2));
    const wide = 0.85 + ((i * 7919) % 100) / 300;
    s.set(h * wide, h, h * wide);
    p.set(x, 0, z);
    m4.compose(p, q, s);
    meshes[which].setMatrixAt(k[which], m4);
    types[which][k[which]] = t;
    k[which]++;
  }
  const group = new THREE.Group();
  meshes.forEach((m, i) => {
    m.geometry.setAttribute('aType', new THREE.InstancedBufferAttribute(types[i], 1));
    m.receiveShadow = true;
    m.castShadow = quality.level === 'high';
    m.computeBoundingSphere();
    group.add(m);
  });
  return group;
}

// ------------------------------------------------------------------ point lights (lamps, aviation)
function pointsMaterial(kind) {
  return new THREE.ShaderMaterial({
    uniforms: { uNight: U.uNight, uTime: U.uTime, uScale: { value: 800 }, uWet: U.uWet },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uScale;
      uniform float uTime;
      uniform float uNight;
      varying float vA;
      varying float vSeed;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        vSeed = aSeed;
        ${kind === 'aviation' ? `
          // obstruction lights flash in sync per building (~40 per minute)
          float ph = fract(uTime * 0.68 + aSeed * 0.15);
          float on = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.45, 0.6, ph));
          float steady = step(0.6, aSeed);
          vA = mix(on, 1.0, steady) * uNight;
          gl_PointSize = clamp(uScale * 2.8 / d, 1.5, 18.0);
        ` : `
          vA = uNight;
          gl_PointSize = clamp(uScale * 1.15 / d, 0.8, 14.0);
        `}
        gl_Position = projectionMatrix * mv;
        if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      varying float vSeed;
      uniform float uWet;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        float core = exp(-r * r * 6.0);
        float halo = exp(-r * 3.0) * 0.35;
        ${kind === 'aviation'
    ? 'vec3 col = vec3(1.0, 0.08, 0.04) * 9.0;'
    : 'vec3 col = mix(vec3(1.0, 0.72, 0.42), vec3(0.95, 0.97, 1.0), step(0.55, vSeed)) * 4.0;'}
        float a = (core + halo) * vA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function pointCloud(sec, kind, yScale = 10) {
  const pos = new Float32Array(sec.n * 3);
  const seed = new Float32Array(sec.n);
  for (let i = 0; i < sec.n; i++) {
    const o = i * 6;
    const x = sec.dv.getInt16(o, true) / 2;
    const z = sec.dv.getInt16(o + 2, true) / 2;
    pos[i * 3] = x;
    pos[i * 3 + 1] = sec.dv.getUint16(o + 4, true) / yScale;
    pos[i * 3 + 2] = z;
    // aviation lights on one building share a phase
    const gx = Math.round(x / 40), gz = Math.round(z / 40);
    seed[i] = kind === 'aviation' ? (Math.abs(Math.sin(gx * 12.9898 + gz * 78.233) * 43758.5453) % 1) : Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.computeBoundingSphere();
  const pts = new THREE.Points(g, pointsMaterial(kind));
  pts.renderOrder = 5;
  return pts;
}

export function createLamps(sec) { return pointCloud(sec, 'lamp'); }
export function createAviation(sec) { return pointCloud(sec, 'aviation'); }

// ------------------------------------------------------------------ rooftop units
export function createRoofUnits(sec) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8b8b2, roughness: 0.7, metalness: 0.2 });
  const inst = new THREE.InstancedMesh(geo, mat, sec.n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  for (let i = 0; i < sec.n; i++) {
    const o = i * 10;
    const dv = sec.dv;
    p.set(dv.getInt16(o, true) / 2, dv.getUint16(o + 4, true) / 10, dv.getInt16(o + 2, true) / 2);
    s.set(dv.getUint8(o + 6) / 10, dv.getUint8(o + 8) / 20, dv.getUint8(o + 7) / 10);
    q.setFromAxisAngle(up, dv.getUint8(o + 9) / 255 * Math.PI);
    m4.compose(p, q, s);
    inst.setMatrixAt(i, m4);
    const v = 0.6 + ((i * 2654435761) % 1000) / 2500;
    col.setRGB(v, v, v * 0.98);
    inst.setColorAt(i, col);
  }
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.computeBoundingSphere();
  return inst;
}

// ------------------------------------------------------------------ signs
const BLADE_TEXT = ['居酒屋', 'ラーメン', 'カラオケ', '焼肉', '寿司', 'やきとり', '喫茶', '中華料理', '漫画喫茶', 'ホテル',
  '薬', 'BAR', '餃子', '天ぷら', 'うどん', 'そば', '串カツ', '酒場', 'ゲーム', '古着', '歯科', '整体', '占い', '牛丼',
  'たこ焼', 'もんじゃ', 'スナック', '本', '麻雀', 'カフェ', '鉄板焼', 'おでん'];
const FLAT_TEXT = ['居酒屋 さくら', 'ラーメン 一番', 'KARAOKE', 'BAR & GRILL', '24H 営業', '焼肉 炎', 'カラオケ', 'CAFE',
  'ドラッグストア', '寿司 銀', '中華 龍', 'ゲームセンター', 'HOTEL', '酒場 まる', '回転寿司', '牛丼', 'ネットカフェ',
  'ホルモン', 'ビストロ', 'うなぎ', '天丼', 'とんかつ', 'しゃぶしゃぶ', 'LIVE HOUSE', '珈琲', 'RAMEN', 'SUSHI',
  'IZAKAYA', '書店', '電器', '靴', 'NOODLE'];
const NEON = ['#ff2d6f', '#ff3df0', '#33e6ff', '#36ff8a', '#ffe23a', '#ff7a1a', '#ffffff', '#7d6bff', '#ff4040', '#4dc3ff'];
const FONT = '"Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "WenQuanYi Zen Hei", sans-serif';

function rnd(i) { return Math.abs(Math.sin(i * 12.9898 + 4.1414) * 43758.5453) % 1; }

function signAtlas() {
  const W = 2048, H = 2048;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  // 32 vertical blades (128 x 512) in the top half
  for (let i = 0; i < 32; i++) {
    const x = (i % 16) * 128, y = Math.floor(i / 16) * 512;
    const neon = rnd(i) < 0.5;
    const col = NEON[Math.floor(rnd(i + 50) * NEON.length)];
    const text = BLADE_TEXT[i % BLADE_TEXT.length];
    if (neon) {
      g.fillStyle = '#0b0b10';
      g.fillRect(x + 4, y + 4, 120, 504);
      g.strokeStyle = col; g.lineWidth = 5; g.shadowColor = col; g.shadowBlur = 14;
      g.strokeRect(x + 10, y + 10, 108, 492);
    } else {
      const bg = ['#fff8e8', '#ffe94a', '#ffffff', '#ffdf9e', '#e8f6ff'][Math.floor(rnd(i + 9) * 5)];
      g.shadowBlur = 0;
      g.fillStyle = bg;
      g.fillRect(x + 4, y + 4, 120, 504);
      g.fillStyle = col === '#ffffff' ? '#d42020' : col;
      g.fillRect(x + 4, y + 4, 120, 22);
      g.fillRect(x + 4, y + 486, 120, 22);
    }
    const chars = [...text];
    const size = Math.min(96, 440 / chars.length);
    g.font = `900 ${size}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = neon ? '#fff' : (['#c81e1e', '#1a1a1a', '#1440a8', '#0d6b3a'][Math.floor(rnd(i + 3) * 4)]);
    g.shadowColor = neon ? col : 'transparent';
    g.shadowBlur = neon ? 18 : 0;
    const total = chars.length * size * 1.02;
    chars.forEach((ch, k) => {
      const latin = /[A-Za-z&]/.test(ch);
      g.save();
      g.translate(x + 64, y + 256 - total / 2 + size * (k + 0.5) * 1.02);
      if (latin) g.rotate(Math.PI / 2);
      g.fillText(ch, 0, 0);
      if (neon) { g.shadowBlur = 4; g.fillText(ch, 0, 0); }
      g.restore();
    });
    g.shadowBlur = 0;
  }
  // 32 horizontal boxes (512 x 128) in the bottom half
  for (let i = 0; i < 32; i++) {
    const x = (i % 4) * 512, y = 1024 + Math.floor(i / 4) * 128;
    const neon = rnd(i + 100) < 0.45;
    const col = NEON[Math.floor(rnd(i + 150) * NEON.length)];
    const text = FLAT_TEXT[i % FLAT_TEXT.length];
    if (neon) {
      g.fillStyle = '#0a0a0f';
      g.fillRect(x + 4, y + 4, 504, 120);
    } else {
      const bg = ['#ffffff', '#fff3c4', '#d8202a', '#1b4fb5', '#ffd400', '#0f8a4a', '#222'][Math.floor(rnd(i + 19) * 7)];
      g.fillStyle = bg;
      g.fillRect(x + 4, y + 4, 504, 120);
    }
    g.font = `900 ${Math.min(84, 900 / [...text].length)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (neon) {
      g.shadowColor = col; g.shadowBlur = 20; g.fillStyle = '#fff';
      g.fillText(text, x + 256, y + 66);
      g.shadowBlur = 6; g.fillStyle = col;
      g.fillText(text, x + 256, y + 66);
      g.strokeStyle = col; g.lineWidth = 4; g.shadowBlur = 12;
      g.strokeRect(x + 12, y + 12, 488, 104);
    } else {
      const bgDark = ['#d8202a', '#1b4fb5', '#0f8a4a', '#222'].includes(g.fillStyle);
      g.shadowBlur = 0;
      g.fillStyle = bgDark ? '#fff' : ['#c81e1e', '#111', '#1440a8'][Math.floor(rnd(i + 7) * 3)];
      g.fillText(text, x + 256, y + 66);
    }
    g.shadowBlur = 0;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  return tex;
}

const SCREEN_ADS = [
  ['TOKYO', '#ff2d95', '#3a0ca3'], ['東京', '#00f5d4', '#00177a'], ['夜景', '#fee440', '#f15bb5'],
  ['NEW MUSIC', '#ffffff', '#ff006e'], ['SALE', '#ffbe0b', '#fb5607'], ['渋谷', '#80ffdb', '#5390d9'],
  ['ネオン', '#f72585', '#4cc9f0'], ['LIVE', '#caffbf', '#2b2d42'],
];

function screenAtlas() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 1024;
  const g = cv.getContext('2d');
  SCREEN_ADS.forEach(([text, c1, c2], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    const gr = g.createLinearGradient(x, y, x + 512, y + 256);
    gr.addColorStop(0, c2); gr.addColorStop(1, c1);
    g.fillStyle = gr;
    g.fillRect(x, y, 512, 256);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `rgba(255,255,255,${0.05 + rnd(i * 20 + k) * 0.12})`;
      g.beginPath();
      g.arc(x + rnd(i * 31 + k) * 512, y + rnd(i * 17 + k) * 256, 10 + rnd(k + i) * 60, 0, Math.PI * 2);
      g.fill();
    }
    g.font = `900 ${Math.min(150, 1000 / [...text].length)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 16;
    g.fillText(text, x + 256, y + 132);
    g.shadowBlur = 0;
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSigns(sec) {
  const n = sec.n;
  const quad = new THREE.PlaneGeometry(1, 1);
  const pos = new Float32Array(n * 4);   // x y z yaw
  const size = new Float32Array(n * 4);  // w h kind tile
  let nScreens = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 18, dv = sec.dv;
    pos[i * 4] = dv.getFloat32(o, true);
    pos[i * 4 + 2] = dv.getFloat32(o + 4, true);
    pos[i * 4 + 1] = dv.getUint16(o + 8, true) / 10;
    pos[i * 4 + 3] = dv.getUint16(o + 10, true) / 65535 * Math.PI * 2;
    size[i * 4] = dv.getUint8(o + 12) / 10;
    size[i * 4 + 1] = dv.getUint8(o + 13) / 10;
    size[i * 4 + 2] = dv.getUint8(o + 14);
    size[i * 4 + 3] = dv.getUint8(o + 15) + dv.getUint8(o + 16) / 256;
    if (size[i * 4 + 2] === 2) nScreens++;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 4));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 4));
  geo.instanceCount = n;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: signAtlas() }, uScreens: { value: screenAtlas() },
      uNight: U.uNight, uTime: U.uTime, uSunColor: U.uSunColor, uWet: U.uWet,
    },
    vertexShader: /* glsl */`
      attribute vec4 aPos;
      attribute vec4 aSize;
      varying vec2 vUv;
      varying vec4 vSize;
      varying float vFade;
      void main() {
        float s = sin(aPos.w), c = cos(aPos.w);
        vec3 local = vec3(position.x * aSize.x, position.y * aSize.y, 0.0);
        vec3 wp = aPos.xyz + vec3(local.x * s, local.y, -local.x * c);
        vUv = uv;
        vSize = aSize;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vFade = 1.0 - smoothstep(2500.0, 6000.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uAtlas;
      uniform sampler2D uScreens;
      uniform float uNight;
      uniform float uTime;
      uniform vec3 uSunColor;
      varying vec2 vUv;
      varying vec4 vSize;
      varying float vFade;
      void main() {
        int kind = int(vSize.z + 0.5);
        float tile = floor(vSize.w);
        float hue = fract(vSize.w);
        vec2 uv = vUv;
        if (!gl_FrontFacing) uv.x = 1.0 - uv.x;
        vec3 col;
        float glow;
        if (kind == 0) {
          float t = mod(tile, 32.0);
          vec2 o = vec2(mod(t, 16.0) * 128.0, floor(t / 16.0) * 512.0) / 2048.0;
          col = texture2D(uAtlas, o + uv * vec2(128.0, 512.0) / 2048.0).rgb;
          glow = 2.2;
          // some signs chase / flicker
          if (hue > 0.85) glow *= 0.75 + 0.25 * step(0.5, fract(uTime * 1.5 + hue * 10.0));
        } else if (kind == 1) {
          float t = mod(tile, 32.0);
          vec2 o = vec2(mod(t, 4.0) * 512.0, 1024.0 + floor(t / 4.0) * 128.0) / 2048.0;
          col = texture2D(uAtlas, o + uv * vec2(512.0, 128.0) / 2048.0).rgb;
          glow = 1.8;
        } else {
          // LED screens: cycle through ads with a wipe, scanlines and moving light
          float slot = floor(uTime / 7.0 + tile * 1.7 + hue * 5.0);
          float ph = fract(uTime / 7.0 + tile * 1.7 + hue * 5.0);
          float a = mod(slot, 8.0), b = mod(slot + 1.0, 8.0);
          vec2 cellA = vec2(mod(a, 2.0) * 0.5, floor(a / 2.0) * 0.25);
          vec2 cellB = vec2(mod(b, 2.0) * 0.5, floor(b / 2.0) * 0.25);
          vec2 tuv = vec2(uv.x * 0.5, uv.y * 0.25);
          float wipe = smoothstep(0.88, 1.0, ph);
          vec3 ca = texture2D(uScreens, cellA + tuv).rgb;
          vec3 cb = texture2D(uScreens, cellB + tuv).rgb;
          col = mix(ca, cb, step(uv.x, wipe));
          col *= 0.85 + 0.15 * sin(uv.y * 400.0);
          col += 0.25 * exp(-pow((uv.x - fract(uTime * 0.2 + hue)) * 6.0, 2.0));
          glow = 2.4;
          // dark bezel
          vec2 e = min(uv, 1.0 - uv);
          col *= smoothstep(0.0, 0.015, min(e.x, e.y));
        }
        float day = 1.0 - uNight;
        vec3 lit = col * (glow * (0.35 + 0.65 * uNight));
        // daylight: shows as a painted/backlit panel, dimmer
        vec3 outc = mix(lit, col * (0.6 + 0.4 * uSunColor), day * 0.55);
        gl_FragColor = vec4(outc * vFade, 1.0);
        if (vFade < 0.01) discard;
      }`,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.screens = nScreens;
  return mesh;
}

// ------------------------------------------------------------------ distant sprawl
export function createSprawl(far) {
  const n = far.nBoxes;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = U.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSW;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSW; uniform float uNight;
        float sh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 cell = floor(vSW / vec3(4.0, 3.2, 4.0));
        float on = step(0.72, sh(cell));
        float warm = sh(cell + 7.0);
        totalEmissiveRadiance += mix(vec3(1.0, 0.7, 0.4), vec3(0.85, 0.92, 1.0), step(0.6, warm)) * on * uNight * 0.55;`);
  };
  mat.customProgramCacheKey = () => 'tokyo-sprawl';
  const inst = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const x = far.boxes.getInt16(o, true) * 4;
    const z = far.boxes.getInt16(o + 2, true) * 4;
    const h = far.boxes.getUint8(o + 4);
    const sz = far.boxes.getUint8(o + 5);
    p.set(x, 0, z);
    q.setFromAxisAngle(up, rnd(i) * Math.PI);
    s.set(sz, h, sz * (0.6 + rnd(i + 3) * 0.8));
    m4.compose(p, q, s);
    inst.setMatrixAt(i, m4);
    const v = 0.62 + rnd(i + 11) * 0.3;
    col.setRGB(v, v * 0.98, v * 0.95);
    inst.setColorAt(i, col);
  }
  inst.computeBoundingSphere();
  inst.receiveShadow = false;
  return inst;
}
