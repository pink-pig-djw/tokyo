// Procedural sky: gradient atmosphere, sun + moon (with real phase), sparse stars
// (it's Tokyo — light pollution), animated clouds lit by sun or city glow, and the
// distant mountain horizon with Mt. Fuji placed at its true bearing.
import * as THREE from 'three';
import { U } from '../core/env.js';

export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uNight;
uniform float uDusk;
uniform float uCloud;
uniform float uTime;
uniform vec4 uFuji;
uniform float uSnow;

float skyHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n2hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(n2hash(i), n2hash(i + vec2(1, 0)), u.x), mix(n2hash(i + vec2(0, 1)), n2hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
float n1(float x) { float i = floor(x), f = fract(x); return mix(fract(sin(i * 91.7) * 4375.5), fract(sin((i + 1.0) * 91.7) * 4375.5), f * f * (3.0 - 2.0 * f)); }

// elevation (radians) of the mountain horizon for a compass bearing (radians, 0 = north, cw)
float mountainProfile(float az, out float fujiMask) {
  float h = 0.0;
  fujiMask = 0.0;
  float d = az - uFuji.x;
  d = mod(d + 3.14159265, 6.2831853) - 3.14159265;
  float x = abs(d) / uFuji.z;
  if (x < 1.0) {
    float f = uFuji.y * min(1.0, pow(1.0 - x, 1.85) * 1.06);
    if (f > h) { h = f; fujiMask = 1.0; }
  }
  // Tanzawa / Okutama / Chichibu ranges, west to north-west
  float deg = degrees(az);
  float w = smoothstep(195.0, 215.0, deg) * (1.0 - smoothstep(310.0, 335.0, deg));
  float r = (0.0035 + 0.0085 * (n1(deg * 0.35) * 0.65 + n1(deg * 1.3) * 0.25 + n1(deg * 4.1) * 0.1)) * w;
  // Hakone / Ashitaka shoulders near Fuji are lower and hazier
  if (r > h) { h = r; fujiMask = 0.0; }
  // Mt. Tsukuba, two summits to the north-east
  float t = abs(deg - 33.0);
  float tk = 0.011 * max(0.0, 1.0 - t / 2.2) + 0.002 * max(0.0, 1.0 - t / 8.0);
  if (tk > h) { h = tk; fujiMask = 0.0; }
  // low Boso hills across the bay
  float bw = smoothstep(115.0, 130.0, deg) * (1.0 - smoothstep(175.0, 190.0, deg));
  float b = (0.0012 + 0.0016 * n1(deg * 0.8)) * bw;
  if (b > h) { h = b; fujiMask = 0.0; }
  return h;
}

vec3 skyColor(vec3 dir, bool envMode) {
  float e = dir.y;
  float mu = dot(dir, uSunDir);
  float eu = max(e, 0.0);
  float hz = pow(1.0 - eu, 5.0);
  vec3 col = mix(uZenith, uHorizon, hz);
  // sun-side glow, strongest near the horizon (dusk)
  float g = pow(max(mu, 0.0), 5.0) * (0.35 + 0.65 * hz);
  col += uGlow * g * (0.25 + 1.1 * uDusk) * (1.0 - uNight * 0.8);
  col += uGlow * pow(max(mu, 0.0), 48.0) * 0.6 * (1.0 - uNight);
  // anti-solar side slightly bluer/pinker at dusk (Belt of Venus)
  col += vec3(0.18, 0.09, 0.12) * uDusk * pow(max(-mu, 0.0), 2.0) * smoothstep(0.25, 0.0, e) * smoothstep(-0.02, 0.05, e);

  // stars (few: light pollution)
  if (e > 0.02 && uNight > 0.01) {
    vec3 p = dir * 420.0;
    vec3 c = floor(p);
    float h = skyHash(c);
    if (h > 0.9965) {
      vec3 f = fract(p) - 0.5;
      float s = smoothstep(0.18, 0.0, length(f)) * (0.6 + 0.4 * sin(uTime * (2.0 + h * 5.0) + h * 40.0));
      col += vec3(0.9, 0.95, 1.0) * s * uNight * 1.2 * smoothstep(0.02, 0.3, e) * (1.0 - uCloud * 0.9);
    }
  }

  // moon with phase from the real sun direction
  float mm = dot(dir, uMoonDir);
  float moonR = 0.0085;
  float cosR = cos(moonR);
  if (mm > cosR && uMoonDir.y > -0.05) {
    vec3 off = dir - uMoonDir * mm;
    vec2 q;
    vec3 ax = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 ay = cross(ax, uMoonDir);
    q = vec2(dot(off, ax), dot(off, ay)) / sin(moonR);
    float rr = dot(q, q);
    vec3 nrm = normalize(ax * q.x + ay * q.y + uMoonDir * sqrt(max(0.0, 1.0 - rr)));
    float lit = clamp(dot(nrm, uSunDir) * 3.0 + 0.1, 0.0, 1.0);
    float maria = 0.82 + 0.18 * vnoise(q * 3.5 + 7.0);
    float edge = smoothstep(1.0, 0.92, rr);
    col = mix(col, vec3(1.0, 0.96, 0.88) * (lit * maria * (envMode ? 1.5 : 4.0) + 0.02), edge);
  }
  col += vec3(0.6, 0.65, 0.8) * pow(max(mm, 0.0), 900.0) * 0.6 * smoothstep(-0.05, 0.1, uMoonDir.y) * uNight;

  // sun disk
  float sunDisk = smoothstep(0.99975, 0.99988, mu);
  float sunVis = smoothstep(-0.01, 0.01, e);
  col += uSunColor * sunDisk * sunVis * (envMode ? 4.0 : 40.0) * (1.0 - uCloud * 0.85);

  // clouds
  if (e > 0.0) {
    vec2 uv = dir.xz / (e + 0.08) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(uv * 1.3) * 0.7 + fbm(uv * 4.1 + 3.0) * 0.3;
    float cov = uCloud;
    float dns = smoothstep(1.0 - cov - 0.08, 1.0 - cov + 0.35, c) * smoothstep(0.0, 0.12, e);
    vec3 sunlit = uSunColor * (0.55 + 0.9 * pow(max(mu, 0.0), 3.0)) * (1.0 - uNight);
    vec3 base = mix(uHorizon, uZenith, 0.35) * 0.85;
    vec3 duskUnder = uGlow * uDusk * 0.9 * (0.4 + 0.6 * pow(max(mu, 0.0), 2.0));
    vec3 cityUnder = vec3(0.16, 0.095, 0.06) * uNight * (0.6 + cov);
    vec3 cc = base * (0.6 + 0.4 * (1.0 - c)) + sunlit * 0.55 * (1.0 - c * 0.5) + duskUnder + cityUnder;
    cc = mix(cc, vec3(dot(cc, vec3(0.33))), cov * 0.4);
    col = mix(col, cc, dns * 0.92);
  }

  // mountains along the horizon
  float az = atan(dir.x, -dir.z);
  if (az < 0.0) az += 6.2831853;
  float elev = asin(clamp(e, -1.0, 1.0));
  float fm;
  float mh = mountainProfile(az, fm);
  if (elev < mh && elev > -0.004) {
    float vis = uFuji.w;
    vec3 mcol = mix(uHorizon, vec3(0.16, 0.19, 0.27) * (0.25 + 0.75 * (1.0 - uNight)), 0.42 * vis);
    // snow cap on Fuji (seasonal + weather)
    float cap = fm * smoothstep(uFuji.y * 0.62, uFuji.y * 0.7, elev);
    float snowAmt = 0.55 + 0.45 * uSnow;
    mcol = mix(mcol, mix(uHorizon, vec3(0.9, 0.92, 0.98) * (0.35 + 0.65 * (1.0 - uNight)), 0.5 * vis), cap * snowAmt);
    // backlit at dusk: darker silhouettes on the sun side
    float back = pow(max(dot(normalize(vec2(dir.x, dir.z)), normalize(vec2(uSunDir.x, uSunDir.z))), 0.0), 3.0);
    mcol *= 1.0 - 0.45 * back * uDusk;
    col = mix(col, mcol, smoothstep(-0.004, 0.0, elev) * (1.0 - smoothstep(mh - 0.0006, mh, elev)) * vis * (1.0 - uCloud * 0.5));
  }

  // below the horizon: haze into the ground colour
  if (e < 0.0) {
    vec3 ground = mix(uHorizon, vec3(0.05, 0.05, 0.055) + uHorizon * 0.2, smoothstep(0.0, -0.25, e));
    col = mix(col, ground, smoothstep(0.0, -0.02, e));
  }
  return col;
}
`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: U.uSunDir, uMoonDir: U.uMoonDir, uSunColor: U.uSunColor, uZenith: U.uZenith,
      uHorizon: U.uHorizon, uGlow: U.uGlow, uNight: U.uNight, uDusk: U.uDusk, uCloud: U.uCloud,
      uTime: U.uTime, uFuji: U.uFuji, uSnow: U.uSnow, uEnvMode: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w; // at the far plane
      }`,
    fragmentShader: /* glsl */`
      ${SKY_GLSL}
      uniform float uEnvMode;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        gl_FragColor = vec4(skyColor(dir, uEnvMode > 0.5), 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.scale.setScalar(150000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  // separate copy for environment-map generation (small radius, env mode)
  const envMat = mat.clone();
  envMat.uniforms = { ...mat.uniforms, uEnvMode: { value: 1 } };
  const envMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), envMat);
  envMesh.scale.setScalar(500);
  const envScene = new THREE.Scene();
  envScene.add(envMesh);
  return { mesh, envScene };
}
