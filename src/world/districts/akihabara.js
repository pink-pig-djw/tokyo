// akihabara: hero buildings and street dressing (see ./kit.js and tools/districts/akihabara.json).
import { PAT } from './kit.js';

export default {
  build(kit, d) {
    // placeholder until the district is styled: extrude every hero footprint as glass
    d.heroes.forEach((h, i) => {
      kit.seed(i);
      for (const ring of h.rings) kit.prism(ring, h.dataMinH || 0, h.h, { color: '#7d8c99', style: [PAT.GLASS, 1.6, 4, 0.5] }, { color: '#9aa0a6', style: [PAT.PLAIN, 0.8, 0, 0] });
    });
  },
};
