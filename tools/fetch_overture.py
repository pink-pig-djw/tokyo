"""Download the Tokyo extract from Overture Maps (buildings, base, transportation).

Output: data-raw/*.parquet (gitignored). Run once; build_data.py consumes these.
"""
import os
import sys
import time

import pyarrow.parquet as pq

from overture_range import extract

RELEASE = "release/2026-09-23.1"
# central Tokyo: Shinjuku/Ikebukuro in the west, Skytree/Kiyosumi in the east, Odaiba in the south
BBOX = (139.665, 35.600, 139.845, 35.750)
OUT = os.path.join(os.path.dirname(__file__), "..", "data-raw")

JOBS = {
    "building": ("theme=buildings/type=building/",
                 ["id", "names", "height", "min_height", "num_floors", "min_floor", "subtype", "class",
                  "roof_shape", "roof_height", "facade_color", "roof_color", "has_parts", "is_underground",
                  "geometry", "bbox"]),
    "building_part": ("theme=buildings/type=building_part/",
                      ["id", "building_id", "height", "min_height", "num_floors", "min_floor", "roof_shape",
                       "facade_color", "roof_color", "is_underground", "geometry", "bbox"]),
    "water": ("theme=base/type=water/", ["id", "names", "subtype", "class", "is_salt", "is_intermittent", "geometry", "bbox"]),
    "land_use": ("theme=base/type=land_use/", ["id", "names", "subtype", "class", "geometry", "bbox"]),
    "land": ("theme=base/type=land/", ["id", "subtype", "class", "geometry", "bbox"]),
    "land_cover": ("theme=base/type=land_cover/", ["id", "subtype", "geometry", "bbox"]),
    "infrastructure": ("theme=base/type=infrastructure/", ["id", "names", "subtype", "class", "height", "geometry", "bbox"]),
    "segment": ("theme=transportation/type=segment/",
                ["id", "names", "subtype", "class", "subclass", "road_flags", "level_rules", "rail_flags", "geometry", "bbox"]),
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    which = sys.argv[1:] or list(JOBS)
    for name in which:
        prefix, cols = JOBS[name]
        dest = os.path.join(OUT, f"{name}.parquet")
        if os.path.exists(dest):
            print("skip", name)
            continue
        t = time.time()
        try:
            tbl = extract(f"{RELEASE}/{prefix}", BBOX, columns=cols)
        except KeyError as e:
            print("column problem", name, e)
            raise
        if tbl is None:
            print(name, "empty")
            continue
        pq.write_table(tbl, dest, compression="zstd")
        print(f"{name}: {tbl.num_rows} rows, {os.path.getsize(dest)/1e6:.1f} MB, {time.time()-t:.0f}s", flush=True)
