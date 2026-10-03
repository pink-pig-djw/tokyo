// Streams the 2 km building chunks in priority order: what the camera looks at (or is about
// to fly to) first, the rest of the city in the background with a few requests in flight.
import * as THREE from 'three';

const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

export class ChunkStreamer {
  /**
   * @param {object[]} chunks manifest.chunks ({ file, cx, cz, hmax, bytes })
   * @param {(chunk) => Promise<void>} loadOne fetches, builds and adds one chunk
   */
  constructor(chunks, loadOne) {
    this.items = chunks.map((c) => ({ c, state: 'pending' }));
    this.loadOne = loadOne;
    this.active = 0;
    this.concurrency = 3;
    this.focus = null;          // { x, z } of a flight target, served first
    this.camera = null;
    this.done = 0;
    this.failed = 0;
    this.listeners = [];
    this.finished = new Promise((r) => { this._finish = r; });
  }

  get total() { return this.items.length; }

  /** Lower is sooner: the focus area, then what is in view by distance, then the rest. */
  score(it) {
    const c = it.c;
    if (this.focus) {
      const df = Math.hypot(c.cx - this.focus.x, c.cz - this.focus.z);
      if (df < 3200) return -1e6 + df;
    }
    if (!this.camera) return 0;
    const p = this.camera.position;
    const d = Math.hypot(c.cx - p.x, c.cz - p.z);
    _sphere.center.set(c.cx, (c.hmax || 30) / 2, c.cz);
    _sphere.radius = 1420 + (c.hmax || 30) / 2;
    return (_frustum.intersectsSphere(_sphere) ? 0 : 3e4) + d;
  }

  _updateFrustum() {
    if (!this.camera) return;
    this.camera.updateMatrixWorld();
    _m.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m);
  }

  /**
   * Chunks needed before the city can be shown from `camera`: in view and no further than a
   * bit past the look-at target, nearest first, at most `max`.
   */
  startSet(camera, target, max = 24) {
    this.camera = camera;
    this._updateFrustum();
    const reach = camera.position.distanceTo(target) + 2500;
    const p = camera.position;
    return this.items
      .filter((it) => {
        const c = it.c;
        const d = Math.hypot(c.cx - p.x, c.cz - p.z);
        const dt = Math.hypot(c.cx - target.x, c.cz - target.z);
        return dt < 2200 || (this.score(it) < 3e4 && d < reach);
      })
      .sort((a, b) => this.score(a) - this.score(b))
      .slice(0, max);
  }

  /** Load the given items with more requests in flight; resolves when all of them are in. */
  async loadSet(set, onEach) {
    await Promise.all(set.map((it) => this._load(it).then(() => onEach?.())));
  }

  /** Stream everything that is left; resolves when the whole city is in. */
  streamRest() {
    this.streaming = true;
    this._pump();
    return this.finished;
  }

  setFocus(x, z) {
    this.focus = { x, z };
    this._pump();
  }

  onProgress(fn) { this.listeners.push(fn); }

  _pump() {
    if (!this.streaming) return;
    this._updateFrustum();
    while (this.active < this.concurrency) {
      let best = null, bs = Infinity;
      for (const it of this.items) {
        if (it.state !== 'pending') continue;
        const s = this.score(it);
        if (s < bs) { bs = s; best = it; }
      }
      if (!best) break;
      this._load(best).then(() => this._pump());
    }
    if (this.done + this.failed === this.items.length) this._finish();
  }

  _load(it) {
    if (it.promise) return it.promise;
    it.state = 'loading';
    this.active++;
    it.promise = this.loadOne(it.c)
      .then(() => { it.state = 'done'; this.done++; })
      .catch((e) => { it.state = 'failed'; this.failed++; console.warn('chunk failed', it.c.file, e); })
      .finally(() => {
        this.active--;
        for (const fn of this.listeners) fn(this.done, this.items.length);
        if (this.done + this.failed === this.items.length) this._finish();
      });
    return it.promise;
  }
}
