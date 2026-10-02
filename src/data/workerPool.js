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
        w.onerror = (e) => { console.warn('worker error', e); };
        w.busy = false;
        this.workers.push(w);
      }
    } catch (err) {
      console.warn('Web Workers unavailable, building on main thread', err);
      this.workers = [];
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
      w.postMessage({ id: job.id, type: job.type, buf: job.buf, opts: job.opts }, [job.buf]);
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
