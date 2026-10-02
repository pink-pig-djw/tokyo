// Small worker pool; falls back to running the builders on the main thread when
// workers are unavailable (e.g. a strict sandbox CSP).
import GeometryWorker from './geometry.worker.js?worker&inline';
import { buildChunk } from './buildingBuilder.js';
import { buildRoads } from './roadBuilder.js';

export class WorkerPool {
  constructor(n) {
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    try {
      for (let i = 0; i < n; i++) {
        const w = new GeometryWorker();
        w.onmessage = (e) => this._done(w, e.data);
        w.onerror = (e) => { console.warn('worker failed, falling back to main thread', e); this._broken(); };
        w.busy = false;
        this.workers.push(w);
      }
    } catch (err) {
      console.warn('Web Workers unavailable, building on main thread', err);
      this.workers = [];
    }
  }

  _broken() {
    // e.g. a sandbox CSP that refuses blob:/data: workers: finish everything on the main thread
    const jobs = [...this.pending.values(), ...this.queue];
    this.pending.clear();
    this.queue = [];
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    for (const j of jobs) {
      if (!j.buf || j.buf.byteLength === 0) { j.reject(new Error('worker lost job data')); continue; }
      this.run(j.type, j.buf, j.opts).then(j.resolve, j.reject);
    }
  }

  run(type, buf, opts) {
    if (!this.workers.length) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try { resolve(type === 'chunk' ? buildChunk(buf) : buildRoads(buf, opts)); } catch (e) { reject(e); }
        }, 0);
      });
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, type, buf, opts, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    for (const w of this.workers) {
      if (w.busy || !this.queue.length) continue;
      const job = this.queue.shift();
      w.busy = true;
      this.pending.set(job.id, job);
      const copy = job.buf.slice(0);
      w.postMessage({ id: job.id, type: job.type, buf: copy, opts: job.opts }, [copy]);
    }
  }

  _done(w, data) {
    w.busy = false;
    const job = this.pending.get(data.id);
    this.pending.delete(data.id);
    if (job) {
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.res);
    }
    this._pump();
  }
}
