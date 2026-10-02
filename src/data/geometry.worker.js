import { buildChunk } from './buildingBuilder.js';
import { buildRoads } from './roadBuilder.js';

self.onmessage = (e) => {
  const { id, type, buf, opts } = e.data;
  try {
    if (type === 'chunk') {
      const res = buildChunk(buf);
      const transfer = [];
      for (const b of res.batches) transfer.push(b.pos.buffer, b.info.buffer, b.info2.buffer, b.idx.buffer);
      self.postMessage({ id, res }, transfer);
    } else if (type === 'roads') {
      const res = buildRoads(buf, opts);
      const transfer = [res.pillars.buffer];
      for (const t of res.tiles) transfer.push(t.pos.buffer, t.attr.buffer, t.idx.buffer);
      self.postMessage({ id, res }, transfer);
    }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
