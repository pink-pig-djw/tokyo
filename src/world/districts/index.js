// Refined districts: hand-styled hero buildings and street dressing, one module per district
// (src/world/districts/<key>.js), fed by manifest.districts (tools/districts/<key>.json via
// tools/build_world.py). Each district becomes one mesh with the shared hero material. The ones
// near the first view are built before the city is shown, the others while it already runs.
import * as THREE from 'three';
import { Kit, heroMaterial } from './kit.js';
import { createPointLights } from '../extras.js';
import shibuya from './shibuya.js';
import akihabara from './akihabara.js';
import tokyostation from './tokyostation.js';

const MODULES = { shibuya, akihabara, tokyostation };

export class Districts {
  constructor(manifest) {
    this.group = new THREE.Group();
    this.stats = {};
    this.todo = (manifest.districts || []).filter((d) => MODULES[d.key]);
  }

  /** Districts not built yet whose centre is within `radius` of (x, z) (all without arguments), taken off the to-do list. */
  take(x, z, radius) {
    const near = radius == null ? this.todo
      : this.todo.filter((d) => !d.center || Math.hypot(d.center.x - x, d.center.z - z) < radius);
    this.todo = this.todo.filter((d) => !near.includes(d));
    return near;
  }

  /** Mesh (+ aviation lights) of one district, not yet attached; null if it failed. */
  build(d) {
    const kit = new Kit();
    try {
      MODULES[d.key].build(kit, d);
    } catch (e) {
      console.warn('district', d.key, e);
      return null;
    }
    if (!kit.idx.length) return null;
    const g = new THREE.Group();
    g.name = `district-${d.key}`;
    const mesh = new THREE.Mesh(kit.build(), heroMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    if (kit.lights.length) g.add(createPointLights(new Float32Array(kit.lights), 'aviation'));
    this.stats[d.key] = kit.triangles;
    return g;
  }
}
