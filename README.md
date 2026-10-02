# 東京 · Tokyo 3D

A real-data 3D panoramic tour of central Tokyo that runs in the browser (Three.js / WebGL2).

- **662,276 buildings**, roads, rails, rivers, the bay, parks and street trees from
  [Overture Maps](https://overturemaps.org) (release `2026-09-23.1`, which includes OpenStreetMap data)
- building heights from OSM tags where present (~21%); the rest are inferred by a gradient-boosted
  model trained on the tagged buildings (hold-out median error ≈ 1.2 m)
- 24 procedural facade archetypes with per-building randomisation, and a "messy" night:
  per-building occupancy, mixed colour temperatures, tenant-by-floor lighting, LED accents
- Tokyo Tower, Tokyo Skytree and the Rainbow Bridge modelled procedurally at their real positions
- real sun and moon positions for Tokyo (JST), sky with Mt. Fuji on the true bearing, aerial fog,
  bloom, planar water reflections, rain / snow / cherry petals, four seasons
- GPU-animated cars (keeping left) and line-coloured trains on the real network, pedestrians
  on the busiest crossings, ~17k neon blade signs / light boxes and LED screens
- landmark rail with station-number badges, fly-to presets, a guided golden-hour-to-night tour,
  orbit and free-flight modes

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (?q=low|medium|high, ?t=19.5 for 19:30 JST)
npm run build      # dist/index.html (single file) + dist/data/
node tools/make_artifact.mjs   # artifact/ page body + base64 data files
```

## Performance

The default quality comes from the GPU name (discrete → high, integrated → medium, older
integrated / mobile / software → low) and steps down by itself if the first seconds run below
~28 fps; a level picked in the time bar is remembered. What the levels change:

| | high | medium | low |
| --- | --- | --- | --- |
| anti-aliasing | MSAA ×4 | FXAA | FXAA |
| ambient occlusion (N8AO) | ✓ | – | – |
| water reflections | 40 % res. | 25 % res. | – |
| sun shadows | 4096² | 2048² | – |
| street trees drawn | 100 % | 60 % | 35 % |
| draw distance: small buildings / trees | 7.5 / 4.2 km | 5.2 / 2.8 km | 3.6 / 1.8 km |

The shadow map is only re-rendered when the view or the sun has moved enough to show; trees
and roof units are instanced per 1.5 km tile (the outer sprawl per 9 km) so they are frustum- and
distance-culled. Headless helpers (SwiftShader): `tools/profile.mjs` (render calls, draws,
triangles per frame), `tools/frametime.mjs` (frame time, optionally with parts switched off) and
`tools/nanscan.mjs` (non-finite pixels after each post pass).

## Rebuild the data

```bash
pip install pyarrow shapely numpy requests mapbox_earcut scikit-learn
npm run data       # fetch_overture.py -> build_buildings.py -> build_world.py
```

`tools/overture_range.py` reads only the Parquet footers and the row groups that intersect the
Tokyo bounding box over HTTP range requests, so the extract (~110 MB) comes out of the ~280 GB
global release in under a minute. `tokyo_wards.geojson` (ward boundaries for the HUD) comes from
[dataofjapan/land](https://github.com/dataofjapan/land).

## Layout

| Path | What |
| --- | --- |
| `tools/` | data pipeline (Python) and headless screenshot / packaging scripts |
| `public/data/` | compact gzipped binary chunks consumed by the app |
| `src/data/` | loaders and the geometry worker (footprints → walls, roofs, hipped roofs; road ribbons) |
| `src/world/` | buildings, ground and water, roads, trees and details, traffic, landmarks, sky, weather |
| `src/core/` | environment (time, sun, palette), post-processing, reflections, camera director, tour |
| `src/ui/` | landmark list, HUD, time bar, labels |

## Attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the
Open Database License, distributed via the Overture Maps Foundation. Inferred heights, facades,
lighting, signs and landmark models are procedural approximations, not survey data.
