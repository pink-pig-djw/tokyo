// Precipitation around the camera: rain streaks, snow flakes and drifting cherry
// petals (spring). Particles live in a box that wraps around the camera, so the
// effect is unbounded but costs a constant number of vertices.
import * as THREE from 'three';
import { U } from '../core/env.js';

function wrapGLSL(box) {
  return /* glsl */`
    vec3 wrapPos(vec3 seed, vec3 vel, float t) {
      vec3 box = vec3(${box.toFixed(1)});
      vec3 p = seed * box + vel * t;
      p = mod(p - cameraPosition + box * 0.5, box) - box * 0.5;
      return cameraPosition + p;
    }`;
}

export class Weather {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.uRain = { value: 0 };
    this.uSnowFall = { value: 0 };
    this.uPetals = { value: 0 };
    this._rain();
    this._snow();
    this._petals();
    this.instant = false;
  }

  _rain() {
    const n = 14000;
    const seeds = new Float32Array(n * 2 * 3);
    const ends = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      seeds.set(s, i * 6); seeds.set(s, i * 6 + 3);
      ends[i * 2] = 0; ends[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uAmt: this.uRain, uNight: U.uNight },
      vertexShader: /* glsl */`
        attribute float aEnd;
        uniform float uTime; uniform float uAmt;
        varying float vA;
        ${wrapGLSL(160)}
        void main() {
          vec3 vel = vec3(1.5, -24.0, 0.8);
          vec3 p = wrapPos(position, vel, uTime);
          p -= vel * 0.045 * aEnd;          // streak length from velocity
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vA = uAmt * smoothstep(160.0, 20.0, -mv.z) * step(fract(position.x * 91.7), uAmt);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA; uniform float uNight;
        void main() { gl_FragColor = vec4(vec3(0.6, 0.68, 0.8) * (0.16 + 0.22 * uNight) * vA, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(g, mat);
    lines.frustumCulled = false;
    this.group.add(lines);
  }

  _points(n, color, size, vel, sway, amtUniform, box) {
    const seeds = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) seeds[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uAmt: amtUniform, uNight: U.uNight, uSun: U.uSunColor },
      vertexShader: /* glsl */`
        uniform float uTime; uniform float uAmt;
        varying float vA; varying float vS;
        ${wrapGLSL(box)}
        void main() {
          vec3 vel = vec3(${vel.map((v) => v.toFixed(2)).join(', ')});
          vec3 p = wrapPos(position, vel, uTime);
          float ph = position.x * 40.0 + position.z * 17.0;
          p.x += sin(uTime * 0.9 + ph) * ${sway.toFixed(2)};
          p.z += cos(uTime * 0.7 + ph * 1.3) * ${sway.toFixed(2)};
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = uAmt * smoothstep(${box.toFixed(1)} * 0.5, 4.0, d) * step(fract(position.y * 57.3), uAmt);
          vS = fract(position.z * 31.0);
          gl_PointSize = clamp(${size.toFixed(1)} * 300.0 / d, 1.0, 26.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying float vS; uniform float uNight; uniform vec3 uSun;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          ${color === 'petal'
    ? 'c.x *= 1.8; float a = smoothstep(0.5, 0.3, length(c)) * vA; vec3 col = mix(vec3(1.0, 0.78, 0.86), vec3(1.0, 0.9, 0.94), vS) * (0.35 + 0.65 * (1.0 - uNight));'
    : 'float a = smoothstep(0.5, 0.1, length(c)) * vA; vec3 col = vec3(0.92, 0.95, 1.0) * (0.45 + 0.55 * (1.0 - uNight * 0.7));'}
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  _snow() { this._points(9000, 'snow', 0.12, [0.6, -1.4, 0.3], 0.8, this.uSnowFall, 140); }
  _petals() { this._points(2500, 'petal', 0.09, [0.9, -0.7, 0.4], 1.6, this.uPetals, 90); }

  update(dt, env, cameraY) {
    const k = this.instant ? 1 : 1 - Math.exp(-dt * 1.2);
    const low = THREE.MathUtils.smoothstep(-cameraY, -700, -150); // fade out from altitude
    const rain = env.weather === 'rain' ? low : 0;
    const snow = env.weather === 'snow' ? low : 0;
    const petals = env.season === 'spring' && env.weather === 'clear' ? THREE.MathUtils.smoothstep(-cameraY, -260, -60) * 0.8 : 0;
    this.uRain.value += (rain - this.uRain.value) * k;
    this.uSnowFall.value += (snow - this.uSnowFall.value) * k;
    this.uPetals.value += (petals - this.uPetals.value) * k;
    this.group.visible = this.uRain.value + this.uSnowFall.value + this.uPetals.value > 0.01;
  }
}
