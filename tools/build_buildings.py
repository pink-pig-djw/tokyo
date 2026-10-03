"""Stage 1: buildings.

- merges Overture buildings + building parts (parts replace their outline)
- removes the volumes we replace with hand-built landmark models
- infers missing heights with a gradient-boosted model trained on the
  ~19% of buildings that carry an OSM height / level count
- assigns facade style, palette colours and flags
- writes data-raw/buildings_proc.pkl for the chunk writer
"""
import collections
import os
import pickle
import time

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely import STRtree

from common import RAW, project, lonlat_to_xn, hash01

T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


# ---------------------------------------------------------------- load
bt = pq.read_table(os.path.join(RAW, "building.parquet"))
pt = pq.read_table(os.path.join(RAW, "building_part.parquet"))
log("loaded", bt.num_rows, "buildings", pt.num_rows, "parts")


def col(t, name):
    return t.column(name).to_numpy(zero_copy_only=False)


b_geom = project(shapely.from_wkb(col(bt, "geometry")))
b_id = col(bt, "id")
b_h = col(bt, "height").astype(float)
b_minh = col(bt, "min_height").astype(float)
b_fl = col(bt, "num_floors").astype(float)
b_minfl = col(bt, "min_floor").astype(float)
b_cls = bt.column("class").to_pylist()
b_sub = bt.column("subtype").to_pylist()
b_name = bt.column("names").combine_chunks().field("primary").to_pylist()
b_fc = bt.column("facade_color").to_pylist()
b_rc = bt.column("roof_color").to_pylist()
b_under = bt.column("is_underground").to_pylist()
b_parts = bt.column("has_parts").to_pylist()

p_geom = project(shapely.from_wkb(col(pt, "geometry")))
p_bid = pt.column("building_id").to_pylist()
p_h = col(pt, "height").astype(float)
p_minh = col(pt, "min_height").astype(float)
p_fl = col(pt, "num_floors").astype(float)
p_minfl = col(pt, "min_floor").astype(float)
p_fc = pt.column("facade_color").to_pylist()
p_rc = pt.column("roof_color").to_pylist()
p_under = pt.column("is_underground").to_pylist()

parts_by_building = collections.defaultdict(list)
for i, bid in enumerate(p_bid):
    if bid and not p_under[i]:
        parts_by_building[bid].append(i)

# ---------------------------------------------------------------- assemble records
recs = []  # dict per polygon volume
idx_of = {bid: i for i, bid in enumerate(b_id)}
for i in range(len(b_id)):
    if b_under[i]:
        continue
    base = dict(cls=b_cls[i], sub=b_sub[i], name=b_name[i], parent=i)
    plist = parts_by_building.get(b_id[i]) if b_parts[i] else None
    if plist:
        prs = []
        for j in plist:
            h, hfl = p_h[j], False
            if np.isnan(h) and not np.isnan(p_fl[j]):
                h, hfl = p_fl[j] * 3.4, True
            if np.isnan(h):
                h = b_h[i] if not np.isnan(b_h[i]) else np.nan
            mh = p_minh[j]
            if np.isnan(mh):
                mh = p_minfl[j] * 3.4 if not np.isnan(p_minfl[j]) else 0.0
            prs.append(dict(base, geom=p_geom[j], h=h, minh=mh, floors=p_fl[j], hfl=hfl,
                            fc=p_fc[j] or b_fc[i], rc=p_rc[j] or b_rc[i], part=True))
        bh = b_h[i]
        hs = [r["h"] for r in prs if not np.isnan(r["h"])]
        tall = max(hs) if hs else np.nan
        # floor counts x 3.4 m undershoot towers with tall storeys (Hikarie: 34F, 182.5 m):
        # scale floor-derived parts up to the building's known height
        if not np.isnan(bh) and hs and tall < 0.8 * bh and any(r["hfl"] for r in prs if r["h"] == tall):
            k = bh / tall
            for r in prs:
                if r["hfl"]:
                    r["h"] *= k
                    r["minh"] *= k
            tall = bh
        # Parts replace the outline, but often only the towers are mapped: keep the rest of the
        # outline as a podium (Marunouchi Building), fill under floating parts (Mark City), or
        # restore the main body when the mapped parts are only low annexes.
        try:
            outline = shapely.make_valid(b_geom[i])
            ground = [r["geom"] for r in prs if r["minh"] < 0.5]
            floating = [r for r in prs if r["minh"] >= 0.5]
            pu = shapely.make_valid(shapely.union_all([r["geom"] for r in prs]))
            gu = shapely.make_valid(shapely.union_all(ground)) if ground else None
            cov = pu.area / max(outline.area, 1.0)
            unsupported = 0.0
            if floating:
                fu = shapely.make_valid(shapely.union_all([r["geom"] for r in floating]))
                unsupported = (fu.difference(gu).area if gu is not None else fu.area) / max(fu.area, 1.0)
            if cov < 0.6 or unsupported > 0.3:
                pod = outline.difference(gu.buffer(0.05)) if gu is not None else outline
                if pod.area >= 20:
                    if floating and unsupported > 0.3:
                        ph = min(r["minh"] for r in floating)
                    elif not np.isnan(bh) and (np.isnan(tall) or tall < 0.7 * bh):
                        ph = bh
                    else:
                        ph = np.nan
                    recs.append(dict(base, geom=pod, h=ph, minh=0.0, floors=np.nan, fc=b_fc[i], rc=b_rc[i],
                                     part=False, hcap=0.5 * tall if not np.isnan(tall) else 45.0))
        except Exception:
            pass
        recs.extend(prs)
    else:
        mh = b_minh[i]
        if np.isnan(mh):
            mh = b_minfl[i] * 3.4 if not np.isnan(b_minfl[i]) else 0.0
        recs.append(dict(base, geom=b_geom[i], h=b_h[i], minh=mh, floors=b_fl[i],
                         fc=b_fc[i], rc=b_rc[i], part=False))
log("volumes", len(recs))

# explode multipolygons
out = []
for r in recs:
    g = r["geom"]
    if g is None or g.is_empty:
        continue
    t = shapely.get_type_id(g)
    if t == 3:
        out.append(r)
    elif t == 6:
        for p in shapely.get_parts(g):
            rr = dict(r)
            rr["geom"] = p
            out.append(rr)
recs = out
log("polygons", len(recs))

# ---------------------------------------------------------------- landmark exclusions
# we build Tokyo Tower and Skytree by hand; drop their extruded footprints
EXCL = [
    # lon, lat, radius m, only drop volumes taller than (m)
    (139.74543, 35.65859, 70, 35),   # Tokyo Tower (keep the Foot Town podium)
    (139.81072, 35.71004, 60, 45),   # Tokyo Skytree (keep Solamachi)
]
excl_xy = [(*lonlat_to_xn(lo, la), r, hmin) for lo, la, r, hmin in EXCL]
keep = []
for r in recs:
    c = shapely.centroid(r["geom"])
    drop = False
    for ex, ey, rad, hmin in excl_xy:
        if (c.x - ex) ** 2 + (c.y - ey) ** 2 < rad * rad:
            hv = r["h"] if not np.isnan(r["h"]) else 0
            if hv > hmin or (r["name"] in ("東京タワー", "東京スカイツリー")):
                drop = True
    if not drop:
        keep.append(r)
log("dropped landmark volumes", len(recs) - len(keep))
recs = keep

# ---------------------------------------------------------------- clean geometry
geoms = np.array([r["geom"] for r in recs], dtype=object)
geoms = shapely.make_valid(geoms)
fixed = []
for r, g in zip(recs, geoms):
    if shapely.get_type_id(g) == 3:
        r["geom"] = g
        fixed.append(r)
    else:
        # make_valid may yield collections; keep the polygonal pieces
        for p in shapely.get_parts(g):
            if shapely.get_type_id(p) == 3 and p.area > 4:
                rr = dict(r)
                rr["geom"] = p
                fixed.append(rr)
recs = fixed
geoms = np.array([r["geom"] for r in recs], dtype=object)
geoms = shapely.simplify(geoms, 0.35, preserve_topology=True)
geoms = shapely.orient_polygons(geoms) if hasattr(shapely, "orient_polygons") else np.array(
    [shapely.geometry.polygon.orient(g, 1.0) for g in geoms], dtype=object)
area = shapely.area(geoms)
ok = (area >= 6) & ~shapely.is_empty(geoms)
recs = [r for r, k in zip(recs, ok) if k]
geoms = geoms[ok]
area = area[ok]
for r, g in zip(recs, geoms):
    r["geom"] = g
log("after clean", len(recs))

# ---------------------------------------------------------------- features for height model
N = len(recs)
cent = shapely.centroid(geoms)
cx = shapely.get_x(cent)
cy = shapely.get_y(cent)
perim = shapely.length(geoms)
nverts = shapely.get_num_coordinates(geoms)
compact = perim / np.sqrt(np.maximum(area, 1))

known_h = np.array([r["h"] for r in recs], dtype=float)
floors = np.array([r["floors"] for r in recs], dtype=float)
target = known_h.copy()
use_fl = np.isnan(target) & ~np.isnan(floors) & (floors > 0)
target[use_fl] = floors[use_fl] * 3.3 + 0.8
known = ~np.isnan(target) & (target > 1.5) & (target < 700)
log("known heights", known.sum(), "/", N)

CLASSES = sorted({str(r["cls"]) for r in recs})
SUBS = sorted({str(r["sub"]) for r in recs})
cls_code = np.array([CLASSES.index(str(r["cls"])) for r in recs])
sub_code = np.array([SUBS.index(str(r["sub"])) for r in recs])


def grid_stats(cell, values_list):
    """Aggregate sums on a square grid, then box-blur 3x3; returns per-building lookups."""
    gx = np.floor((cx + 12000) / cell).astype(int)
    gy = np.floor((cy + 12000) / cell).astype(int)
    W = int(24000 / cell) + 2
    res = []
    for vals in values_list:
        g = np.zeros((W, W))
        np.add.at(g, (gx, gy), vals)
        # 3x3 blur
        p = np.pad(g, 1)
        b = sum(p[1 + dx:1 + dx + W, 1 + dy:1 + dy + W] for dx in (-1, 0, 1) for dy in (-1, 0, 1))
        res.append(b[gx, gy])
    return res


feats = [np.log(area), compact, nverts, cx, cy, cls_code, sub_code]
for cell in (60.0, 150.0, 400.0):
    cnt, asum, kcnt, klog = grid_stats(cell, [np.ones(N), area, known.astype(float),
                                              np.where(known, np.log(np.nan_to_num(target, nan=1)), 0)])
    # leave-one-out style: remove own contribution from the known stats
    own_k = known.astype(float)
    own_l = np.where(known, np.log(np.nan_to_num(target, nan=1)), 0)
    kc = kcnt - own_k
    kmean = np.where(kc > 0, (klog - own_l) / np.maximum(kc, 1), np.nan)
    feats += [np.log1p(cnt), asum / (cell * cell * 9), asum / np.maximum(cnt, 1), kc, kmean]

# distance to nearest major road and nearest station
seg = pq.read_table(os.path.join(RAW, "segment.parquet"), columns=["class", "geometry", "subtype"])
s_cls = seg.column("class").to_pylist()
s_geom = project(shapely.from_wkb(col(seg, "geometry")))
major = s_geom[[c in ("motorway", "trunk", "primary", "secondary") for c in s_cls]]
tree = STRtree(major)
_, dist_major = tree.query_nearest(cent, return_distance=True, all_matches=False)
infra = pq.read_table(os.path.join(RAW, "infrastructure.parquet"), columns=["class", "geometry"])
i_cls = infra.column("class").to_pylist()
i_geom = project(shapely.from_wkb(col(infra, "geometry")))
stations = i_geom[[c in ("railway_station", "subway_station") for c in i_cls]]
stree = STRtree(stations)
_, dist_station = stree.query_nearest(cent, return_distance=True, all_matches=False)
# query_nearest returns one row per input when all_matches=False
feats += [np.log1p(dist_major), np.log1p(dist_station)]

X = np.column_stack(feats)
log("features", X.shape)

from sklearn.ensemble import HistGradientBoostingRegressor  # noqa: E402

y = np.log(target[known])
model = HistGradientBoostingRegressor(max_iter=500, learning_rate=0.06, max_leaf_nodes=63,
                                      min_samples_leaf=30, l2_regularization=1.0,
                                      categorical_features=[5, 6], random_state=1)
# quick holdout score for the log
rng = np.random.default_rng(7)
ki = np.where(known)[0]
perm = rng.permutation(len(ki))
hold = ki[perm[:8000]]
train = ki[perm[8000:]]
model.fit(X[train], np.log(target[train]))
pred_hold = np.exp(model.predict(X[hold]))
err = np.abs(pred_hold - target[hold])
log(f"holdout MAE {err.mean():.2f} m, median AE {np.median(err):.2f} m, "
    f"MAPE {np.median(err / target[hold]) * 100:.1f}%")
model.fit(X[known], y)
pred = np.exp(model.predict(X))

final_h = np.where(known, target, np.nan)
unk = np.isnan(final_h)
jit = np.array([hash01(i, 11) for i in range(N)])
final_h[unk] = pred[unk] * np.exp((jit[unk] - 0.5) * 0.38)
# restored podiums stay below the towers they carry
hcap = np.array([r.get("hcap", np.inf) for r in recs])
final_h[unk] = np.minimum(final_h[unk], np.maximum(hcap[unk], 6.0))
final_h = np.clip(final_h, 3.0, 700.0)
minh = np.array([r["minh"] if not np.isnan(r["minh"]) else 0.0 for r in recs])
# roof-only structures (platform canopies, petrol-station roofs): a thin plate on posts,
# not a solid block from the ground
is_roof = np.array([r["cls"] == "roof" for r in recs]) & (minh < 0.5)
final_h[is_roof & unk] = np.clip(final_h[is_roof & unk], 4.5, 9.0)
minh[is_roof] = np.maximum(final_h[is_roof] - 1.2, 0.0)
log("roof-only structures as plates", int(is_roof.sum()))
minh = np.clip(minh, 0, final_h - 1.0)
log("height percentiles (all)", np.percentile(final_h, [10, 50, 90, 99]).round(1))
log("height percentiles (inferred)", np.percentile(final_h[unk], [10, 50, 90, 99]).round(1))

_tmp = os.path.join(RAW, "buildings_proc.pkl.tmp")
with open(_tmp, "wb") as f:
    pickle.dump(dict(
        geoms=geoms, h=final_h, minh=minh, known=known, area=area, cx=cx, cy=cy,
        cls=[r["cls"] for r in recs], sub=[r["sub"] for r in recs], name=[r["name"] for r in recs],
        fc=[r["fc"] for r in recs], rc=[r["rc"] for r in recs], part=[r["part"] for r in recs],
        parent=[r["parent"] for r in recs],
    ), f)
os.replace(_tmp, os.path.join(RAW, "buildings_proc.pkl"))   # atomic: readers never see half a file
log("wrote buildings_proc.pkl")
