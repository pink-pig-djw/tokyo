// Road + rail ribbons (built in the worker) with lane markings, sodium-orange
// expressway lighting, wet asphalt, plus elevated-deck pillars.
import * as THREE from 'three';
import { U } from '../core/env.js';

function roadMaterial(rail) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -6;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = U.uNight;
    shader.uniforms.uWet = U.uWet;
    shader.uniforms.uSnow = U.uSnow;
    shader.uniforms.uTime = U.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aRoad;
        varying vec4 vRoad;
        varying vec3 vRW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRoad = aRoad;
        vRW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vRoad;
        varying vec3 vRW;
        uniform float uNight; uniform float uWet; uniform float uSnow; uniform float uTime;
        float rh(float n) { return fract(sin(n * 127.1) * 43758.5453); }
        float line(float x, float c, float w) {
          float fw = fwidth(x);
          return smoothstep(c - w - fw, c - w, x) * (1.0 - smoothstep(c + w, c + w + fw, x));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float u = vRoad.x, v = vRoad.y;
        int code = int(vRoad.z + 0.5);
        int part = int(vRoad.w + 0.5);
        float rough = 0.85;
        vec3 emis = vec3(0.0);
        vec3 c;
        float dist = length(vRW - cameraPosition);
        float detail = 1.0 - smoothstep(250.0, 1400.0, dist);
        if (part == 1) {
          c = vec3(0.62, 0.62, 0.6);              // parapet / girder concrete
          if (code <= 2) {
            // expressway sound barrier with a lit top edge at night
            c = mix(c, vec3(0.5, 0.55, 0.58), 0.3);
          }
        } else if (part == 2) {
          c = vec3(0.32, 0.32, 0.31);             // deck underside
        } else if (code >= 20) {
          // ballast + rails + sleepers
          c = vec3(0.36, 0.33, 0.30);
          float av = abs(v);
          float rails = line(av, 0.36, 0.035);
          float sleep = step(0.5, fract(u / 0.62)) * step(av, 0.6) * detail;
          c = mix(c, vec3(0.26, 0.23, 0.21), sleep * 0.5);
          c = mix(c, vec3(0.55, 0.55, 0.56), rails * detail);
          rough = mix(0.9, 0.3, rails);
          if (code == 22) c = vec3(0.6, 0.6, 0.58); // guideway concrete (Yurikamome / monorail)
        } else if (code == 8) {
          c = vec3(0.58, 0.55, 0.5);              // pedestrian street paving
          c *= 0.92 + 0.08 * step(0.5, fract(u * 0.5) + fract(v * 2.0));
        } else {
          c = code <= 3 ? vec3(0.17, 0.17, 0.18) : vec3(0.22, 0.22, 0.225);
          if (code == 7) c = vec3(0.26, 0.26, 0.26);
          float av = abs(v);
          float m = 0.0;
          // edge lines
          if (code <= 5) m += line(av, 0.9, 0.025);
          // centre line: solid white on major roads, dashed elsewhere
          if (code >= 2 && code <= 5) {
            float dash = code <= 3 ? 1.0 : step(0.45, fract(u / 10.0));
            m += line(v, 0.0, code <= 3 ? 0.018 : 0.025) * dash;
          }
          // lane lines
          if (code <= 3) {
            float dash = step(0.5, fract(u / 12.0));
            m += (line(av, 0.45, 0.012)) * dash;
          }
          if (code == 1) {
            float dash = step(0.5, fract(u / 16.0));
            m += line(v, -0.3, 0.02) * dash + line(v, 0.3, 0.02) * dash;
          }
          c = mix(c, vec3(0.85, 0.85, 0.82), clamp(m, 0.0, 1.0) * detail);
          // street lights pooling on the asphalt
          float sp = code <= 2 ? 32.0 : 36.0;
          float pool = exp(-pow((fract(u / sp) - 0.5) * sp / 6.5, 2.0));
          float side = 1.0 - 0.5 * smoothstep(0.2, 0.9, 1.0 - abs(v));
          vec3 lampCol = code <= 2 ? vec3(1.0, 0.6, 0.26) : (fract(sin(floor(u / 400.0) * 12.9) * 4375.5) > 0.5 ? vec3(1.0, 0.8, 0.55) : vec3(0.85, 0.92, 1.0));
          float strength = code <= 2 ? 0.26 : code <= 4 ? 0.2 : code == 5 ? 0.14 : 0.05;
          emis += lampCol * (0.12 + 0.88 * pool) * side * strength * uNight * (1.0 + uWet * 1.2);
          rough = mix(0.82, 0.12, uWet);
        }
        c = mix(c, vec3(0.92, 0.93, 0.96), uSnow * (part == 0 ? 0.55 : 0.3));
        diffuseColor.rgb = c;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rough;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = emis;');
  };
  mat.customProgramCacheKey = () => `tokyo-road-${rail ? 'r' : 'd'}`;
  return mat;
}

export function createRoads(res) {
  const group = new THREE.Group();
  const roadMat = roadMaterial(false);
  const railMat = roadMaterial(true);
  for (const t of res.tiles) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
    g.setAttribute('aRoad', new THREE.BufferAttribute(t.attr, 4));
    g.setIndex(new THREE.BufferAttribute(t.idx, 1));
    const [cx, cy, cz, r] = t.sphere;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
    const m = new THREE.Mesh(g, t.rail ? railMat : roadMat);
    m.receiveShadow = true;
    m.castShadow = false;
    m.renderOrder = -5;
    m.matrixAutoUpdate = false;
    group.add(m);
  }

  // pillars under elevated decks
  const P = res.pillars;
  const n = P.length / 5;
  if (n) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a9893, roughness: 0.9 });
    const inst = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const x = P[i * 5], z = P[i * 5 + 1], h = P[i * 5 + 2], ang = P[i * 5 + 3], w = P[i * 5 + 4];
      q.setFromAxisAngle(up, -ang);
      p.set(x, 0, z);
      s.set(2.2, h, Math.max(2.4, w * 0.9));
      m4.compose(p, q, s);
      inst.setMatrixAt(i, m4);
    }
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
  return group;
}
