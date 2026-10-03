// Refined districts: hand-styled hero buildings and street dressing, one module per district
// (src/world/districts/<key>.js), fed by manifest.districts (tools/districts/<key>.json via
// tools/build_world.py). Each district becomes one mesh with the shared hero material.
import * as THREE from 'three';
import { Kit, heroMaterial } from './kit.js';
import { createPointLights } from '../extras.js';
import shibuya from './shibuya.js';
import akihabara from './akihabara.js';
import tokyostation from './tokyostation.js';

const MODULES = { shibuya, akihabara, tokyostation };

export function createDistricts(manifest) {
  const group = new THREE.Group();
  const stats = {};
  for (const d of manifest.districts || []) {
    const mod = MODULES[d.key];
    if (!mod) continue;
    const kit = new Kit();
    try {
      mod.build(kit, d);
    } catch (e) {
      console.warn('district', d.key, e);
      continue;
    }
    if (!kit.idx.length) continue;
    const mesh = new THREE.Mesh(kit.build(), heroMaterial());
    mesh.name = `district-${d.key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (kit.lights.length) group.add(createPointLights(new Float32Array(kit.lights), 'aviation'));
    stats[d.key] = kit.triangles;
  }
  return { group, stats };
}
