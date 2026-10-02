// Quality profiles, GPU-based default and the distance-culling (LOD) manager.
import * as THREE from 'three';

export const PROFILES = {
  high: {
    msaa: true, ao: true, shadowSize: 4096, reflection: 0.4,
    treeDensity: 1.0, sprawlDensity: 1.0, maxPixels: 4.2e6, maxDpr: 1.5,
    // distance (m) beyond which a kind of object is not drawn ...
    lod: { small: 7500, tree: 4200, roof: 3000, car: 3800, ped: 1400 },
    // ... plus this many metres per metre of camera altitude: from above, far small
    // buildings are seen roof-on and make up the city's texture; near the ground they hide
    lodAlt: { small: 4 },
  },
  medium: {
    msaa: false, ao: false, shadowSize: 2048, reflection: 0.25,
    treeDensity: 0.6, sprawlDensity: 0.7, maxPixels: 2.4e6, maxDpr: 1.25,
    lod: { small: 5200, tree: 2800, roof: 2000, car: 2600, ped: 1000 },
    lodAlt: { small: 4 },
  },
  low: {
    msaa: false, ao: false, shadowSize: 1024, reflection: 0,
    treeDensity: 0.35, sprawlDensity: 0.45, maxPixels: 1.4e6, maxDpr: 1.0,
    lod: { small: 3600, tree: 1800, roof: 1300, car: 1700, ped: 700 },
    lodAlt: { small: 2.5 },
  },
};

/** Best guess from the GPU name: integrated / mobile GPUs start lower. */
export function detectGpuLevel(gl) {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
  if (mobile) return { level: 'low', gpu: 'mobile' };
  let name = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch (e) { /* hidden */ }
  const n = name.toLowerCase();
  let level = 'medium';
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(n)) level = 'low';
  else if (/nvidia|geforce|quadro|rtx|gtx/.test(n)) level = 'high';
  else if (/radeon/.test(n)) level = /radeon\s*(\(tm\)\s*)?(graphics|vega|r[2-7] )|radeon(tm)? graphics/.test(n) ? 'medium' : 'high';
  else if (/apple m\d (pro|max|ultra)/.test(n)) level = 'high';
  else if (/apple|intel|iris|uhd|mali|adreno|powervr/.test(n)) level = /hd graphics|uhd graphics 6|mali|adreno|powervr/.test(n) ? 'low' : 'medium';
  return { level, gpu: name };
}

export function resolveQuality(level, flags = {}) {
  const p = PROFILES[level] || PROFILES.medium;
  const dpr = Math.min(window.devicePixelRatio || 1, p.maxDpr,
    Math.sqrt(p.maxPixels / Math.max(1, window.innerWidth * window.innerHeight)));
  return {
    ...p,
    level,
    ao: p.ao && !flags.noao,
    reflection: flags.norefl ? 0 : p.reflection,
    dpr: Math.max(0.6, dpr),
  };
}

/** Shows/hides registered objects by camera distance; tells the caller when casters changed. */
export class LodManager {
  constructor() {
    this.items = [];
    this.limits = {};
    this.altGain = {};
    this.last = new THREE.Vector3(Infinity, 0, 0);
    this.dirty = true;
  }

  add(obj, kind, center, radius) {
    this.items.push({ obj, kind, center, radius });
    this.dirty = true;
  }

  setLimits(limits, altGain = {}) {
    this.limits = limits;
    this.altGain = altGain;
    this.dirty = true;
  }

  /** @returns {boolean} true when the visibility of a shadow caster changed */
  update(camera) {
    if (!this.dirty && camera.position.distanceToSquared(this.last) < 60 * 60) return false;
    this.last.copy(camera.position);
    this.dirty = false;
    let casterChanged = false;
    const alt = Math.max(0, camera.position.y);
    for (const it of this.items) {
      const lim = this.limits[it.kind];
      if (lim === undefined) continue;
      const vis = camera.position.distanceTo(it.center) - it.radius < lim + alt * (this.altGain[it.kind] || 0);
      if (it.obj.visible !== vis) {
        it.obj.visible = vis;
        if (it.obj.castShadow) casterChanged = true;
      }
    }
    return casterChanged;
  }
}
