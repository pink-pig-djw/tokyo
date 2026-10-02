"""Stage 2: write the compact binary world consumed by the web app.

public/data/
  manifest.json          chunk list, palettes, landmarks, wards, stations
  b_<i>_<j>.bin.gz       building footprints per 2 km chunk
  ground.bin.gz          triangulated land-cover layers (water, parks, forest...)
  roads.bin.gz           road + rail centrelines with per-vertex elevation
  routes.bin.gz          merged polylines for animated cars and trains
  extras.bin.gz          trees, lamps, neon signs, rooftop units, aviation lights
  far.bin.gz             coarse land/sea and sprawl boxes beyond the core area

All coordinates are three.js world metres: x = east, z = south, origin LON0/LAT0.
"""
import collections
import gzip
import json
import math
import os
import pickle
import struct
import time

import mapbox_earcut as earcut
import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely import STRtree
from shapely.geometry import box

from common import (CHUNK, GRID_MIN, GRID_N, KX, KY, LAT0, LON0, OUT, RAW, hash01, lonlat_to_xn, project)

T0 = time.time()
rng = np.random.default_rng(20261002)


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def col(t, name):
    return t.column(name).to_numpy(zero_copy_only=False)


def write_gz(name, data):
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.write(gzip.compress(bytes(data), 9, mtime=0))
    return os.path.getsize(path)


os.makedirs(OUT, exist_ok=True)

# core area in local metres (x east, n north) = the Overture extract bbox
CORE_X0, CORE_N0 = lonlat_to_xn(139.665, 35.600)
CORE_X1, CORE_N1 = lonlat_to_xn(139.845, 35.750)
CORE = box(CORE_X0, CORE_N0, CORE_X1, CORE_N1)
log("core", round(CORE_X0), round(CORE_N0), round(CORE_X1), round(CORE_N1))


def xn(lon, lat):
    x, n = lonlat_to_xn(lon, lat)
    return float(x), float(n)


# =====================================================================================
# 1. transport network (needed by buildings for street-facing tests)
# =====================================================================================
seg = pq.read_table(os.path.join(RAW, "segment.parquet"))
s_geom = project(shapely.from_wkb(col(seg, "geometry")))
s_sub = seg.column("subtype").to_pylist()
s_cls = seg.column("class").to_pylist()
s_subcls = seg.column("subclass").to_pylist()
s_name = seg.column("names").combine_chunks().field("primary").to_pylist()
s_rflags = seg.column("road_flags").to_pylist()
s_railflags = seg.column("rail_flags").to_pylist()
s_levels = seg.column("level_rules").to_pylist()

ROAD_CODE = {"motorway": 1, "trunk": 2, "primary": 3, "secondary": 4, "tertiary": 5,
             "residential": 6, "unclassified": 6, "living_street": 6, "service": 7, "pedestrian": 8,
             "unknown": 7}
RAIL_CODE = {"standard_gauge": 20, "subway": 21, "light_rail": 22, "monorail": 22, "tram": 23, "funicular": 23}


def flag_fraction(flags, name):
    """Fraction of a segment covered by a flag (Overture 'between' ranges)."""
    if not flags:
        return 0.0
    tot = 0.0
    for e in flags:
        if name in (e["values"] or []):
            b = e["between"]
            tot += (b[1] - b[0]) if b else 1.0
    return min(tot, 1.0)


def level_at(levels, t):
    if not levels:
        return 0
    lv = 0
    for e in levels:
        b = e["between"]
        if b is None or (b[0] <= t <= b[1]):
            lv = e["value"]
    return lv


# Rainbow Bridge structure polygon (from Overture infrastructure 'viaduct')
inf = pq.read_table(os.path.join(RAW, "infrastructure.parquet"))
i_geom = project(shapely.from_wkb(col(inf, "geometry")))
i_cls = inf.column("class").to_pylist()
i_sub = inf.column("subtype").to_pylist()
i_name = inf.column("names").combine_chunks().field("primary").to_pylist()
rb_idx = [k for k, n in enumerate(i_name) if n == "レインボーブリッジ"][0]


def _aspect(p):
    r = np.array(shapely.minimum_rotated_rectangle(p).exterior.coords)
    a, b = np.linalg.norm(r[1] - r[0]), np.linalg.norm(r[2] - r[1])
    return max(a, b) / max(min(a, b), 1e-3) if max(a, b) > 600 else 0


# the suspension span is the long, narrow part of the viaduct multipolygon
rainbow_poly = max(shapely.get_parts(i_geom[rb_idx]), key=_aspect)
rr = shapely.minimum_rotated_rectangle(rainbow_poly)
rc = np.array(rr.exterior.coords)[:4]
e0 = rc[1] - rc[0]
e1 = rc[2] - rc[1]
if np.linalg.norm(e0) > np.linalg.norm(e1):
    axis = e0 / np.linalg.norm(e0)
    rb_len = np.linalg.norm(e0)
    rb_wid = np.linalg.norm(e1)
else:
    axis = e1 / np.linalg.norm(e1)
    rb_len = np.linalg.norm(e1)
    rb_wid = np.linalg.norm(e0)
rb_c = np.array(rainbow_poly.centroid.coords[0])
log(f"rainbow bridge: centre {rb_c.round(1)}, axis {axis.round(3)}, length {rb_len:.0f}, width {rb_wid:.0f}")
RB_DECK = 50.0
rainbow_zone = rainbow_poly.buffer(8)


def rainbow_elev(x, n):
    d = np.array([x, n]) - rb_c
    t = abs(float(d @ axis)) / (rb_len / 2)
    return RB_DECK + 4.0 * max(0.0, 1 - t * t)


lines = []  # dicts: code, coords (N,2), elev (N,), hidden, name
for k in range(len(s_geom)):
    g = s_geom[k]
    if g is None or shapely.get_type_id(g) != 1:
        continue
    st, c = s_sub[k], s_cls[k]
    if st == "road":
        code = ROAD_CODE.get(c)
        if c == "footway" and s_subcls[k] == "crosswalk":
            code = 9
        if code is None:
            continue
        if s_subcls[k] in ("parking_aisle", "driveway"):
            continue
        fl = s_rflags[k]
    elif st == "rail":
        code = RAIL_CODE.get(c)
        if code is None:
            continue
        fl = s_railflags[k]
    else:
        continue
    if flag_fraction(fl, "is_tunnel") > 0.5 or flag_fraction(fl, "is_indoor") > 0.5 \
            or flag_fraction(fl, "is_under_construction") > 0.5 or flag_fraction(fl, "is_abandoned") > 0.5 \
            or flag_fraction(fl, "is_disused") > 0.5:
        continue
    coords = np.array(g.coords)[:, :2]
    if len(coords) < 2:
        continue
    seglen = np.r_[0, np.cumsum(np.linalg.norm(np.diff(coords, axis=0), axis=1))]
    L = seglen[-1]
    if L < 1:
        continue
    t = seglen / L
    lv = np.array([level_at(s_levels[k], tt) for tt in t])
    if (lv < 0).mean() > 0.5:
        continue
    lv = np.maximum(lv, 0)
    per_level = 10.0 if code in (1, 2) else 7.5
    elev = lv * per_level
    # bridges at level 0 still clear the water a little
    if flag_fraction(fl, "is_bridge") > 0.5:
        elev = np.maximum(elev, 3.0 if code < 20 else 5.0)
    lines.append(dict(code=code, coords=coords, elev=elev.astype(float), s=seglen,
                      name=s_name[k], bridge=flag_fraction(fl, "is_bridge") > 0.5, hidden=False,
                      link=flag_fraction(fl, "is_link") > 0.5))
log("transport lines", len(lines))

# node reconciliation + ramp smoothing so elevated expressways blend into the ground network
node_vals = collections.defaultdict(list)


def nkey(p):
    return (round(p[0] * 2), round(p[1] * 2))


for L in lines:
    node_vals[nkey(L["coords"][0])].append(L["elev"][0])
    node_vals[nkey(L["coords"][-1])].append(L["elev"][-1])
node_elev = {k: float(np.median(v)) for k, v in node_vals.items()}
for L in lines:
    e = L["elev"]
    s = L["s"]
    tot = s[-1]
    a = node_elev[nkey(L["coords"][0])] - e[0]
    b = node_elev[nkey(L["coords"][-1])] - e[-1]
    if a == 0 and b == 0:
        continue
    R = min(max(tot * 0.85, 20.0), 260.0)
    w0 = np.clip(1 - s / R, 0, 1)
    w1 = np.clip(1 - (tot - s) / R, 0, 1)
    tw = w0 + w1
    scale = np.where(tw > 1, 1 / np.maximum(tw, 1e-6), 1)
    L["elev"] = np.maximum(e + (a * w0 + b * w1) * scale, 0)

# Rainbow Bridge decks: lift everything on the structure, hide ribbons (the model has the deck)
for L in lines:
    inside = shapely.contains_xy(rainbow_zone, L["coords"][:, 0], L["coords"][:, 1])
    if inside.any():
        lower = L["code"] >= 20 or L["code"] >= 3  # rail + local road use the lower deck
        for idx in np.where(inside)[0]:
            x, n = L["coords"][idx]
            L["elev"][idx] = rainbow_elev(x, n) + (0.0 if lower else 9.0)
        if inside.mean() > 0.6:
            L["hidden"] = True
# smooth the approach viaducts towards the bridge decks
deck_nodes = {}
for L in lines:
    for end in (0, -1):
        x, n = L["coords"][end]
        if shapely.contains_xy(rainbow_zone, x, n):
            deck_nodes[nkey(L["coords"][end])] = L["elev"][end]
for _ in range(3):
    changed = 0
    for L in lines:
        for end in (0, -1):
            kk = nkey(L["coords"][end])
            if kk in deck_nodes and L["elev"][end] < deck_nodes[kk] - 1:
                s = L["s"]
                tot = s[-1]
                R = min(tot, 600.0)
                w = np.clip(1 - (s if end == 0 else (tot - s)) / R, 0, 1)
                target = deck_nodes[kk]
                L["elev"] = np.maximum(L["elev"], L["elev"] + (target - L["elev"][end]) * w)
                other = nkey(L["coords"][-1 if end == 0 else 0])
                if R >= tot and other not in deck_nodes:
                    deck_nodes[other] = L["elev"][-1 if end == 0 else 0]
                    changed += 1
    if not changed:
        break

road_geoms_for_tests = [shapely.LineString(L["coords"]) for L in lines if L["code"] < 20]
road_tree = STRtree(road_geoms_for_tests)
major_geoms = [shapely.LineString(L["coords"]) for L in lines if L["code"] <= 4]
major_tree = STRtree(major_geoms)

# =====================================================================================
# 2. buildings
# =====================================================================================
with open(os.path.join(RAW, "buildings_proc.pkl"), "rb") as f:
    B = pickle.load(f)
geoms = B["geoms"]
H = B["h"]
MINH = B["minh"]
AREA = B["area"]
CX = B["cx"]
CY = B["cy"]
NB = len(geoms)
log("buildings", NB)

WALL_PALETTE = [
    "#e9e6df", "#f1ede4", "#dcd8cf", "#d6cfc2", "#cfc6b4", "#c9c3b8", "#bdb8b0", "#a9a59e", "#8f8b85",
    "#c8b49a", "#b59c80", "#9a7a62", "#7c5e4a", "#a65a42", "#8c4a3a", "#e3dccb", "#c7cdd2", "#9ea6ad",
    "#6f767c", "#4d5257",
    "#4a6274", "#3d5566", "#5b7380", "#6f8790", "#39505a", "#2f3a44", "#7d8a8e", "#556b6e", "#4e5560",
    "#8a8070",
    "#d8c79e", "#c9a27a", "#a8b5a0", "#b9c4cc", "#e0d0c0", "#9e8f7c",
]
ROOF_PALETTE = [
    "#8c8b86", "#a2a19a", "#75746f", "#b5b2a8", "#5a6068", "#3f454d", "#4f5965", "#6a5446", "#7e4b3a",
    "#4b6e5a", "#6d7f63", "#c4c3bc", "#9a8e7e", "#2f3338", "#7a8794", "#5e6e58",
]


def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=float)


WALL_RGB = np.array([hex2rgb(c) for c in WALL_PALETTE])
ROOF_RGB = np.array([hex2rgb(c) for c in ROOF_PALETTE])


def nearest_wall(hexc):
    try:
        c = hex2rgb(hexc)
    except Exception:
        return None
    # tame saturated tags (#FF0000 etc.)
    g = c.mean()
    c = g + (c - g) * 0.55
    return int(np.argmin(((WALL_RGB - c) ** 2).sum(1)))


def nearest_roof(hexc):
    try:
        c = hex2rgb(hexc)
    except Exception:
        return None
    g = c.mean()
    c = g + (c - g) * 0.6
    return int(np.argmin(((ROOF_RGB - c) ** 2).sum(1)))


def pick(options, weights, r):
    w = np.array(weights, dtype=float)
    w /= w.sum()
    return options[int(np.searchsorted(np.cumsum(w), r, side="right").clip(0, len(options) - 1))]


HOUSE_WALL = ([0, 1, 2, 3, 4, 5, 9, 10, 15, 16, 34, 30, 31, 33, 11, 18, 19],
              [9, 8, 7, 6, 5, 5, 4, 3, 6, 5, 3, 2, 2, 2, 2, 2, 1])
HOUSE_ROOF = ([5, 6, 7, 4, 13, 14, 8, 12, 2], [10, 8, 5, 6, 4, 3, 1, 2, 2])
APT_WALL = ([0, 1, 2, 3, 4, 6, 9, 10, 15, 16, 34, 35, 13, 31, 30, 33], [8, 7, 7, 6, 4, 5, 5, 4, 6, 5, 3, 3, 2, 2, 2, 2])
FLAT_ROOF = ([0, 1, 2, 3, 11, 10], [8, 6, 5, 4, 3, 1])
OFFICE_WALL = ([6, 7, 8, 16, 17, 18, 2, 5, 19, 22, 23, 26, 15, 9], [6, 5, 3, 6, 5, 3, 4, 3, 2, 3, 3, 3, 2, 2])
GLASS_WALL = ([20, 21, 22, 23, 24, 25, 26, 27, 28, 29], [7, 6, 6, 5, 4, 4, 3, 3, 4, 2])
TOWER_ROOF = ([0, 2, 4, 13, 1], [5, 4, 3, 2, 3])
IND_WALL = ([6, 7, 16, 17, 33, 32, 2], [5, 4, 5, 4, 3, 2, 3])
IND_ROOF = ([4, 14, 1, 11, 0], [5, 3, 4, 3, 3])
REL_WALL = ([12, 14, 11, 0, 3], [4, 3, 3, 2, 2])
REL_ROOF = ([5, 9, 13], [6, 3, 3])

# neon / nightlife zones: lon, lat, radius, intensity
ZONES = [
    (139.7025, 35.6940, 430, 1.0),  # Kabukicho
    (139.7045, 35.6905, 300, 0.85),  # Shinjuku east exit
    (139.6995, 35.6930, 130, 1.0),  # Omoide Yokocho
    (139.6985, 35.6600, 380, 1.0),  # Shibuya Center-gai / Dogenzaka
    (139.7135, 35.7305, 380, 0.9),  # Ikebukuro east
    (139.7070, 35.7310, 260, 0.75),  # Ikebukuro west
    (139.7715, 35.6995, 330, 1.0),  # Akihabara
    (139.7745, 35.7085, 300, 0.9),  # Ueno / Ameyoko
    (139.7650, 35.6710, 420, 0.55),  # Ginza
    (139.7590, 35.6680, 300, 0.85),  # Yurakucho / Shimbashi
    (139.7315, 35.6625, 300, 0.85),  # Roppongi
    (139.7960, 35.7125, 280, 0.6),  # Asakusa
    (139.7710, 35.6920, 230, 0.6),  # Kanda
    (139.7240, 35.6265, 220, 0.65),  # Gotanda
    (139.7045, 35.7125, 230, 0.65),  # Takadanobaba
    (139.7100, 35.6465, 200, 0.5),  # Ebisu
    (139.8140, 35.6965, 260, 0.7),  # Kinshicho
    (139.7030, 35.6710, 150, 0.6),  # Harajuku Takeshita-dori
    (139.7005, 35.7010, 260, 0.8),  # Shin-Okubo
    (139.7365, 35.6745, 220, 0.7),  # Akasaka
    (139.7395, 35.6285, 200, 0.5),  # Shinagawa
    (139.7180, 35.6200, 160, 0.5),  # Meguro
    (139.6680, 35.7060, 200, 0.6),  # Nakano
    (139.8270, 35.7000, 180, 0.4),  # Hirai-ish / Kameido
]
ZONES_XY = [(*xn(lo, la), r, s) for lo, la, r, s in ZONES]


def zone_strength(x, n):
    best = 0.0
    for zx, zn, r, s in ZONES_XY:
        d = math.hypot(x - zx, n - zn)
        if d < r:
            best = max(best, s * (1 - d / r) ** 0.5)
    return best


# street proximity: is the building's centroid within 25 m of a major road?
near_major = np.zeros(NB, bool)
cent_pts = shapely.points(CX, CY)
idx_pairs = major_tree.query(cent_pts, predicate="dwithin", distance=28)
near_major[np.unique(idx_pairs[0])] = True
log("near major roads", near_major.sum())

wall = np.zeros(NB, np.uint8)
roof = np.zeros(NB, np.uint8)
style = np.zeros(NB, np.uint8)
flags = np.zeros(NB, np.uint8)
seed = np.zeros(NB, np.uint8)
zone_s = np.zeros(NB)
nverts = shapely.get_num_coordinates(geoms)
nholes = shapely.get_num_interior_rings(geoms)

NAMED = {
    "東京駅丸の内駅舎": (13, 5, 2),
    "国会議事堂": (3, 9, 2),
    "東京都庁舎 第一本庁舎": (7, 0, 2),
    "東京都庁舎 第二本庁舎": (7, 0, 2),
    "雷門": (13, 5, 5),
    "五重塔": (13, 5, 5),
    "日本武道館": (3, 9, 5),
}

for i in range(NB):
    h = H[i]
    a = AREA[i]
    cls = B["cls"][i] or ""
    sub = B["sub"][i] or ""
    r1, r2, r3, r4 = hash01(i, 1), hash01(i, 2), hash01(i, 3), hash01(i, 4)
    seed[i] = int(hash01(i, 5) * 255)
    zs = zone_strength(CX[i], CY[i])
    zone_s[i] = zs
    residential = cls in ("house", "apartments", "residential", "detached", "semidetached_house",
                          "terrace", "dormitory") or sub == "residential"
    if sub == "religious" or cls in ("temple", "shrine", "church"):
        st = 5
        w, rf = pick(*REL_WALL, r1), pick(*REL_ROOF, r2)
    elif cls in ("warehouse", "industrial", "factory", "manufacture", "garage", "garages") or \
            sub == "industrial" or (a > 3500 and h < 22 and not residential):
        st = 4
        w, rf = pick(*IND_WALL, r1), pick(*IND_ROOF, r2)
    elif cls == "train_station" or sub == "transportation":
        st = 6
        w, rf = pick(*IND_WALL, r1), pick(*IND_ROOF, r2)
    elif h >= 80 and r3 < (0.75 if not residential else 0.35) or (45 <= h < 80 and r3 < 0.28 and not residential):
        st = 3
        w, rf = pick(*GLASS_WALL, r1), pick(*TOWER_ROOF, r2)
    elif h < 12.5 and a < 260 and not (cls in ("commercial", "retail", "office") or zs > 0.3):
        st = 0
        w, rf = pick(*HOUSE_WALL, r1), pick(*HOUSE_ROOF, r2)
    elif residential or (h < 45 and r3 < 0.45 and zs < 0.2):
        st = 1
        w, rf = pick(*APT_WALL, r1), pick(*FLAT_ROOF, r2)
    else:
        st = 2
        w, rf = pick(*OFFICE_WALL, r1), pick(*FLAT_ROOF if h < 80 else TOWER_ROOF, r2)
    if B["fc"][i]:
        nw = nearest_wall(B["fc"][i])
        if nw is not None:
            w = nw
    if B["rc"][i]:
        nr = nearest_roof(B["rc"][i])
        if nr is not None:
            rf = nr
    nm = B["name"][i]
    if nm in NAMED:
        w, rf, st = NAMED[nm]
    fl = 0
    if st == 0 and nverts[i] <= 7 and nholes[i] == 0 and a < 240:
        fl |= 1                       # pitched roof
    if zs > 0.05:
        fl |= 2                       # nightlife zone (more lit, warmer)
    if h >= 60:
        fl |= 4                       # aviation obstruction lights
    if h >= 150:
        fl |= 8                       # crown lighting
    if st in (1, 2) and h < 60 and (near_major[i] or zs > 0.1) and r4 < (0.85 if zs > 0.1 else 0.55):
        fl |= 16                      # lit storefront at street level
    wall[i], roof[i], style[i], flags[i] = w, rf, st, fl
log("styles", np.bincount(style))

# ---------------------------------------------------------------- write building chunks
ci = np.floor((CX - GRID_MIN) / CHUNK).astype(int).clip(0, GRID_N - 1)
cj = np.floor((-CY - GRID_MIN) / CHUNK).astype(int).clip(0, GRID_N - 1)  # z = -north
chunks = []
total_bytes = 0
for i in range(GRID_N):
    for j in range(GRID_N):
        sel = np.where((ci == i) & (cj == j))[0]
        if len(sel) == 0:
            continue
        ccx = GRID_MIN + (i + 0.5) * CHUNK
        ccz = GRID_MIN + (j + 0.5) * CHUNK
        ring_lens = []
        verts = []
        nr = np.zeros(len(sel), np.uint8)
        hmax = 0.0
        for k, b in enumerate(sel):
            g = geoms[b]
            rings = [g.exterior] + list(g.interiors)
            rings = [r for r in rings if len(r.coords) >= 4]
            rings = rings[:255]
            nr[k] = len(rings)
            for r in rings:
                c = np.array(r.coords)[:-1, :2]
                # world: x, z=-n ; quantise to 5 cm relative to chunk centre
                q = np.empty((len(c), 2), np.int32)
                q[:, 0] = np.round((c[:, 0] - ccx) * 20)
                q[:, 1] = np.round((-c[:, 1] - ccz) * 20)
                d = np.diff(q, axis=0, prepend=np.zeros((1, 2), np.int32))
                if np.abs(d).max() > 32767:
                    raise ValueError("delta overflow")
                ring_lens.append(len(c))
                verts.append(d.astype(np.int16))
            hmax = max(hmax, H[b])
        verts = np.concatenate(verts) if verts else np.zeros((0, 2), np.int16)
        nB, nR, nV = len(sel), len(ring_lens), len(verts)
        buf = bytearray()
        buf += b"TKB2"
        buf += struct.pack("<ffIII", ccx, ccz, nB, nR, nV)
        buf += np.round(H[sel] * 10).clip(0, 65535).astype("<u2").tobytes()
        buf += np.round(MINH[sel] * 10).clip(0, 65535).astype("<u2").tobytes()
        buf += wall[sel].tobytes() + roof[sel].tobytes() + style[sel].tobytes() + flags[sel].tobytes()
        buf += seed[sel].tobytes() + nr.tobytes()
        while len(buf) % 4:
            buf += b"\0"
        buf += np.array(ring_lens, "<u2").tobytes()
        while len(buf) % 4:
            buf += b"\0"
        buf += verts.astype("<i2").tobytes()
        name = f"b_{i}_{j}.bin.gz"
        size = write_gz(name, buf)
        total_bytes += size
        chunks.append(dict(file=name, i=i, j=j, cx=ccx, cz=ccz, n=int(nB), v=int(nV), hmax=round(float(hmax), 1),
                           bytes=size))
log(f"building chunks: {len(chunks)}, {total_bytes / 1e6:.1f} MB")

# =====================================================================================
# 3. extras: rooftop units, aviation lights, neon signs, storefront, trees, lamps
# =====================================================================================
roof_units = []   # x, z, y, w, d, h, rot
aviation = []     # x, z, y
signs = []        # kind, x, z, y, yaw, w, h, tile, hue

min_rect_angle = {}


def rect_angle(g):
    r = shapely.minimum_rotated_rectangle(g)
    c = np.array(r.exterior.coords)
    e = c[1] - c[0]
    return math.atan2(e[1], e[0]), c[:4]


cand = np.where(((H > 12) & (AREA > 90) & (style != 0) & (style != 5)) | (H >= 60))[0]
log("roof/aviation candidates", len(cand))
for b in cand:
    g = geoms[b]
    ang, corners = rect_angle(g)
    h = H[b]
    if h >= 60:
        cc = np.array(g.centroid.coords[0])
        pts = corners if AREA[b] > 400 else [cc]
        for p in pts:
            p = np.array(p)
            p = p + (cc - p) * 0.08
            aviation.append((p[0], -p[1], h + 1.0))
        if h >= 150:
            aviation.append((cc[0], -cc[1], h + 6.0))
    if h < 12 or AREA[b] < 90:
        continue
    inner = g.buffer(-2.0 if AREA[b] < 400 else -3.0)
    if inner.is_empty or inner.area < 8:
        continue
    xmin, ymin, xmax, ymax = inner.bounds
    ca, sa = math.cos(ang), math.sin(ang)
    cc = np.array(g.centroid.coords[0])

    def try_place(w, d, hh, tag, tries=10, centre=False):
        for t in range(tries):
            if centre and t == 0:
                px, py = cc
            else:
                px = xmin + hash01(b, t, tag, 21) * (xmax - xmin)
                py = ymin + hash01(b, t, tag, 22) * (ymax - ymin)
            # all four corners must sit on the roof
            ok = True
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                qx = px + (sx * w / 2) * ca - (sy * d / 2) * sa
                qy = py + (sx * w / 2) * sa + (sy * d / 2) * ca
                if not shapely.contains_xy(inner, qx, qy):
                    ok = False
                    break
            if ok:
                roof_units.append((px, -py, h, w, d, hh, -ang))
                return True
        return False

    side = math.sqrt(AREA[b])
    big = h >= 90
    # supertall crowns: stepped machine-room "hat" (very visible in the skyline)
    if big and hash01(b, 61) < 0.62:
        k = 0.45 + hash01(b, 62) * 0.3
        rect = shapely.minimum_rotated_rectangle(inner)
        rc_ = np.array(rect.exterior.coords)
        rw = np.linalg.norm(rc_[1] - rc_[0])
        rd = np.linalg.norm(rc_[2] - rc_[1])
        crown_h = 5 + hash01(b, 63) * 12
        if try_place(rw * k, rd * k, crown_h, 1, tries=6, centre=True):
            if hash01(b, 64) < 0.5:
                try_place(rw * k * 0.55, rd * k * 0.55, crown_h + 4 + hash01(b, 65) * 8, 2, tries=4, centre=True)
    # elevator penthouse (almost every Japanese mid-rise has one)
    if 15 <= h < 120 and hash01(b, 66) < 0.8:
        try_place(3.5 + hash01(b, 67) * 3, 4 + hash01(b, 68) * 3, 2.8 + hash01(b, 69) * 1.6, 3)
    # water tank / cooling tower
    if hash01(b, 70) < 0.55:
        sz = 2 + hash01(b, 71) * (4 if h > 40 else 2.5)
        try_place(sz, sz, 1.8 + hash01(b, 72) * 2.5, 4)
    # scattered HVAC units
    n_units = int(min(max(AREA[b] / 300, 0), 6) * (0.4 + hash01(b, 73)))
    for t in range(n_units):
        w = 1.5 + hash01(b, t, 23) * min(7, side * 0.15)
        d = 1.5 + hash01(b, t, 24) * min(6, side * 0.12)
        try_place(w, d, 1.0 + hash01(b, t, 25) * 2.2, 10 + t, tries=3)
    # antenna masts on some towers
    if big and hash01(b, 74) < 0.35:
        try_place(1.2, 1.2, 10 + hash01(b, 75) * 18, 5, tries=4, centre=True)
log("roof units", len(roof_units), "aviation lights", len(aviation))

# neon signs on street-facing walls in nightlife zones
zone_bld = np.where((zone_s > 0.02) & (H >= 7) & (H < 120) & (style != 5) & (style != 4))[0]
log("sign candidate buildings", len(zone_bld))
mids, outs, meta = [], [], []
for b in zone_bld:
    g = geoms[b]
    c = np.array(g.exterior.coords)
    for k in range(len(c) - 1):
        p0, p1 = c[k], c[k + 1]
        e = p1 - p0
        L = float(np.hypot(*e))
        if L < 3.0:
            continue
        nrm = np.array([e[1], -e[0]]) / L  # outward for CCW rings
        mid = (p0 + p1) / 2
        mids.append(mid + nrm * 5.0)
        meta.append((b, p0, e / L, L, nrm))
mids = np.array(mids)
near = np.zeros(len(mids), bool)
pairs = road_tree.query(shapely.points(mids[:, 0], mids[:, 1]), predicate="dwithin", distance=9.0)
near[np.unique(pairs[0])] = True
# also exclude edges whose front is blocked by another building
bld_tree = STRtree(geoms)
blocked = np.zeros(len(mids), bool)
pairs2 = bld_tree.query(shapely.points(mids[:, 0], mids[:, 1]), predicate="intersects")
blocked[np.unique(pairs2[0])] = True
street_edges = collections.defaultdict(list)
for k in np.where(near & ~blocked)[0]:
    street_edges[meta[k][0]].append(meta[k])
log("street-facing edges", sum(len(v) for v in street_edges.values()))

N_TILES = 64
for b, edges in street_edges.items():
    zs = zone_s[b]
    h = H[b]
    edges = sorted(edges, key=lambda m: -m[3])[:3]
    for ei, (_, p0, tdir, L, nrm) in enumerate(edges):
        r = hash01(b, ei, 31)
        # vertical blade signs (tate-kanban)
        if r < 0.75 * zs and h > 9:
            for side in (0.12, 0.88) if (L > 9 and hash01(b, ei, 32) < 0.5) else (0.15,):
                sh = min(h - 3.5, 3.5 + hash01(b, ei, side * 100, 33) * 11)
                if sh < 2.5:
                    continue
                sw = 0.9 + hash01(b, ei, 34) * 0.6
                base_y = 3.0 + hash01(b, ei, 35) * 1.5
                p = p0 + tdir * (L * side) + nrm * (sw / 2 + 0.25)
                yaw = math.atan2(-tdir[1], tdir[0])  # world z = -n
                signs.append((0, p[0], -p[1], base_y + sh / 2, yaw, sw, sh,
                              int(hash01(b, ei, side * 100, 36) * N_TILES), int(hash01(b, ei, side * 100, 37) * 255)))
        # flat wall signs / banners
        if hash01(b, ei, 41) < 0.85 * zs + 0.05:
            nsig = 1 + int(hash01(b, ei, 42) * min(3, h / 8))
            for s in range(nsig):
                fw = min(L * 0.8, 2.5 + hash01(b, ei, s, 43) * 6.5)
                fh = 0.9 + hash01(b, ei, s, 44) * 1.6
                floor = int(hash01(b, ei, s, 45) * max(1, (min(h, 40) - 4) / 3.4))
                y = 3.6 + floor * 3.4 + fh / 2
                if y + fh / 2 > h - 0.5:
                    continue
                t = 0.25 + hash01(b, ei, s, 46) * 0.5
                p = p0 + tdir * (L * t) + nrm * 0.3
                yaw = math.atan2(-nrm[1], nrm[0])
                signs.append((1, p[0], -p[1], y, yaw, fw, fh,
                              int(hash01(b, ei, s, 47) * N_TILES), int(hash01(b, ei, s, 48) * 255)))
log("signs", len(signs))

# big LED screens at the famous plazas: choose the wall facing the plaza centre
SCREENS = [
    # lon, lat, how many, size scale
    (139.70056, 35.65950, 5, 1.0),   # Shibuya Scramble Crossing
    (139.70110, 35.69210, 3, 1.0),   # Shinjuku east exit (Cross Shinjuku Vision area)
    (139.70240, 35.69420, 3, 0.8),   # Kabukicho Ichibangai
    (139.71210, 35.72990, 2, 0.8),   # Ikebukuro east
    (139.77130, 35.69960, 3, 0.8),   # Akihabara Chuo-dori
    (139.76470, 35.67160, 2, 0.8),   # Ginza 4-chome crossing
    (139.73140, 35.66280, 2, 0.7),   # Roppongi crossing
]
for lo, la, count, sc in SCREENS:
    px, pn = xn(lo, la)
    cands = []
    for b in bld_tree.query(shapely.Point(px, pn).buffer(110)):
        if H[b] < 15:
            continue
        g = geoms[b]
        c = np.array(g.exterior.coords)
        for k in range(len(c) - 1):
            p0, p1 = c[k], c[k + 1]
            e = p1 - p0
            L = float(np.hypot(*e))
            if L < 10:
                continue
            nrm = np.array([e[1], -e[0]]) / L
            mid = (p0 + p1) / 2
            to = np.array([px, pn]) - mid
            dist = float(np.hypot(*to))
            facing = float(nrm @ to) / max(dist, 1e-6)
            if facing < 0.6 or dist > 110:
                continue
            cands.append((dist - facing * 20, b, p0, e / L, L, nrm, mid))
    cands.sort(key=lambda c: c[0])
    used = set()
    for _, b, p0, tdir, L, nrm, mid in cands:
        if b in used:
            continue
        used.add(b)
        sw = min(L * 0.85, 22 * sc)
        sh = min(sw * 0.62, H[b] * 0.45)
        y = min(H[b] - sh / 2 - 2, 8 + sh / 2 + hash01(b, 51) * 10)
        p = mid + nrm * 0.35
        yaw = math.atan2(-nrm[1], nrm[0])
        signs.append((2, p[0], -p[1], y, yaw, sw, sh, len(used) % 8, int(hash01(b, 52) * 255)))
        if len(used) >= count:
            break
log("signs incl. screens", len(signs))

# ---------------------------------------------------------------- land cover polygons
lu = pq.read_table(os.path.join(RAW, "land_use.parquet"))
lu_geom = project(shapely.from_wkb(col(lu, "geometry")))
lu_cls = lu.column("class").to_pylist()
lu_sub = lu.column("subtype").to_pylist()
lu_name = lu.column("names").combine_chunks().field("primary").to_pylist()
ld = pq.read_table(os.path.join(RAW, "land.parquet"))
ld_geom = project(shapely.from_wkb(col(ld, "geometry")))
ld_cls = ld.column("class").to_pylist()
lc = pq.read_table(os.path.join(RAW, "land_cover.parquet"))
lc_geom = project(shapely.from_wkb(col(lc, "geometry")))
lc_sub = lc.column("subtype").to_pylist()
wt = pq.read_table(os.path.join(RAW, "water.parquet"))
wt_geom = project(shapely.from_wkb(col(wt, "geometry")))
wt_cls = wt.column("class").to_pylist()
wt_sub = wt.column("subtype").to_pylist()

BIG = box(CORE_X0 - 60000, CORE_N0 - 60000, CORE_X1 + 60000, CORE_N1 + 60000)


def polys(gs):
    out = []
    for g in gs:
        if g is None or g.is_empty:
            continue
        if shapely.get_type_id(g) in (3, 6):
            out.append(g)
    return out


def U(gs):
    gs = polys(gs)
    if not gs:
        return shapely.Polygon()
    return shapely.unary_union(shapely.make_valid(np.array(gs, dtype=object)))


land_polys = [ld_geom[k] for k in range(len(ld_geom)) if ld_cls[k] in ("land", "island", "islet")]
land_core = shapely.intersection(U([shapely.clip_by_rect(g, CORE_X0, CORE_N0, CORE_X1, CORE_N1) for g in land_polys]),
                                 CORE)
INLAND = {"river", "canal", "pond", "moat", "reservoir", "basin", "water", "lake", "stream", "reflecting_pool",
          "fishpond", "bay", "ditch", "drain"}
inland = U([wt_geom[k] for k in range(len(wt_geom))
            if wt_cls[k] in INLAND and shapely.get_type_id(wt_geom[k]) in (3, 6)])
inland = shapely.intersection(inland, CORE)
water_core = shapely.union(shapely.difference(CORE, land_core), inland)
water_core = shapely.make_valid(water_core)
log("water area km2", round(water_core.area / 1e6, 2))

FOREST_LAND = ("forest", "wood", "scrub", "shrubbery", "heath", "wetland")
GRASS_LU = ("park", "garden", "grass", "recreation_ground", "village_green", "meadow", "greenfield", "dog_park",
            "fairway", "rough", "tee", "green", "allotments", "flowerbed", "golf_course", "farmland")
forest = U([ld_geom[k] for k in range(len(ld_geom)) if ld_cls[k] in FOREST_LAND] +
           [lc_geom[k] for k in range(len(lc_geom)) if lc_sub[k] in ("forest", "shrub")])
grass = U([lu_geom[k] for k in range(len(lu_geom)) if lu_cls[k] in GRASS_LU] +
          [ld_geom[k] for k in range(len(ld_geom)) if ld_cls[k] in ("grassland", "grass")])
pitch = U([lu_geom[k] for k in range(len(lu_geom)) if lu_cls[k] in ("pitch", "track", "playground", "bunker")])
plaza = U([lu_geom[k] for k in range(len(lu_geom)) if lu_cls[k] in ("pedestrian", "plaza")])
cemetery = U([lu_geom[k] for k in range(len(lu_geom)) if lu_cls[k] in ("cemetery", "grave_yard")])
railway = U([lu_geom[k] for k in range(len(lu_geom)) if lu_cls[k] in ("railway",)])
sand = U([ld_geom[k] for k in range(len(ld_geom)) if ld_cls[k] in ("sand", "beach")])

layers_raw = [("water", water_core), ("forest", forest), ("grass", grass), ("cemetery", cemetery),
              ("pitch", pitch), ("sand", sand), ("plaza", plaza), ("railway", railway)]
taken = shapely.Polygon()
layers = []
for name, g in layers_raw:
    g = shapely.intersection(shapely.make_valid(g), CORE)
    if name != "water":
        g = shapely.intersection(g, land_core)
    g = shapely.difference(g, taken)
    g = shapely.simplify(g, 0.6)
    g = shapely.make_valid(g)
    taken = shapely.union(taken, g)
    layers.append((name, g))
    log(f"layer {name}: {g.area / 1e6:.2f} km2")
taken_all = taken


def triangulate(g, quant):
    """earcut a (multi)polygon; returns int16 xz verts (world, z=-n) and uint32 indices."""
    V, I = [], []
    base = 0
    for p in shapely.get_parts(g):
        if shapely.get_type_id(p) != 3 or p.area < 1:
            continue
        p = shapely.geometry.polygon.orient(p, 1.0)
        rings = [np.array(p.exterior.coords)[:-1, :2]] + \
                [np.array(r.coords)[:-1, :2] for r in p.interiors if len(r.coords) >= 4]
        rings = [r for r in rings if len(r) >= 3]
        if not rings:
            continue
        allv = np.concatenate(rings)
        ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
        tri = earcut.triangulate_float64(allv, ends)
        V.append(allv)
        I.append(tri.astype(np.uint32) + base)
        base += len(allv)
    if not V:
        return np.zeros((0, 2), np.int16), np.zeros(0, np.uint32)
    V = np.concatenate(V)
    q = np.empty_like(V)
    q[:, 0] = V[:, 0] / quant
    q[:, 1] = -V[:, 1] / quant
    return np.round(q).astype(np.int16), np.concatenate(I)


GROUND_IDS = {"water": 0, "forest": 1, "grass": 2, "cemetery": 3, "pitch": 4, "sand": 5, "plaza": 6, "railway": 7}
gbuf = bytearray(b"TKG1")
gbuf += struct.pack("<I", len(layers))
for name, g in layers:
    v, idx = triangulate(g, 0.5)
    gbuf += struct.pack("<BxxxII", GROUND_IDS[name], len(v), len(idx))
    gbuf += v.astype("<i2").tobytes()
    while len(gbuf) % 4:
        gbuf += b"\0"
    gbuf += idx.astype("<u4").tobytes()
    log(f"  tri {name}: {len(v)} verts, {len(idx) // 3} tris")
log("ground.bin.gz", write_gz("ground.bin.gz", gbuf) / 1e6, "MB")

# ---------------------------------------------------------------- trees
trees = []  # x, z, type, scale  (types: 0 broadleaf, 1 conifer, 2 ginkgo, 3 sakura, 4 zelkova/keyaki)
SAKURA_SPOTS = [(139.7714, 35.7148, 380), (139.7445, 35.6905, 320), (139.6985, 35.6440, 220),
                (139.7100, 35.6852, 520), (139.8030, 35.7130, 280), (139.7225, 35.6655, 420),
                (139.7442, 35.6942, 220), (139.7466, 35.7330, 260), (139.7570, 35.6770, 260),
                (139.7520, 35.6830, 200), (139.7380, 35.6970, 220), (139.7590, 35.6600, 200),
                (139.7880, 35.7100, 260)]
SAK_XY = [(*xn(lo, la), r) for lo, la, r in SAKURA_SPOTS]


def sakura_bias(x, n):
    for sx, sn, r in SAK_XY:
        if (x - sx) ** 2 + (n - sn) ** 2 < r * r:
            return 0.65
    return 0.12


water_poly = layers[0][1]
shapely.prepare(water_poly)


def blocked_pts(px, py):
    """True where a point falls on a building footprint or water."""
    pts = shapely.points(px, py)
    hit = np.zeros(len(px), bool)
    pr = bld_tree.query(pts, predicate="intersects")
    hit[np.unique(pr[0])] = True
    hit |= shapely.contains_xy(water_poly, px, py)
    return hit


def scatter(poly, density, kind_fn, scale_fn, cap):
    out = []
    if poly.is_empty:
        return out
    for p in shapely.get_parts(poly):
        if p.area < 40:
            continue
        n = int(min(p.area * density, cap))
        if n <= 0:
            continue
        xmin, ymin, xmax, ymax = p.bounds
        px = rng.uniform(xmin, xmax, n * 3)
        py = rng.uniform(ymin, ymax, n * 3)
        m = shapely.contains_xy(p, px, py)
        px, py = px[m][:n], py[m][:n]
        m2 = ~blocked_pts(px, py)
        for x, y in zip(px[m2], py[m2]):
            out.append((x, -y, kind_fn(x, y), scale_fn()))
    return out


def forest_kind(x, y):
    r = rng.random()
    return 1 if r < 0.22 else (4 if r < 0.42 else 0)


def park_kind(x, y):
    r = rng.random()
    sb = sakura_bias(x, y)
    if r < sb:
        return 3
    r = rng.random()
    return 2 if r < 0.18 else (1 if r < 0.38 else (4 if r < 0.6 else 0))


trees += scatter(layers[1][1], 1 / 85.0, forest_kind, lambda: rng.uniform(0.65, 1.0), 25000)
trees += scatter(layers[2][1], 1 / 230.0, park_kind, lambda: rng.uniform(0.45, 0.9), 5000)
trees += scatter(layers[3][1], 1 / 320.0, park_kind, lambda: rng.uniform(0.4, 0.75), 2000)
log("trees (areas)", len(trees))
# real mapped trees and tree rows
for k in range(len(ld_geom)):
    g = ld_geom[k]
    if ld_cls[k] == "tree" and shapely.get_type_id(g) == 0:
        x, y = g.x, g.y
        if CORE_X0 < x < CORE_X1 and CORE_N0 < y < CORE_N1:
            trees.append((x, -y, park_kind(x, y), rng.uniform(0.45, 0.85)))
    elif ld_cls[k] == "tree_row" and shapely.get_type_id(g) == 1:
        L = g.length
        for d in np.arange(4, L, 9.0):
            p = g.interpolate(d)
            trees.append((p.x, -p.y, 2 if rng.random() < 0.6 else 4, rng.uniform(0.45, 0.75)))
log("trees (+mapped)", len(trees))
# street trees along major roads (ginkgo is Tokyo's most common street tree)
st_pts = []
for L in lines:
    if L["code"] not in (2, 3, 4) or L["elev"].max() > 1 or L["bridge"]:
        continue
    g = shapely.LineString(L["coords"])
    half = {2: 11.5, 3: 10.0, 4: 8.0}[L["code"]]
    for d in np.arange(6, g.length, 11.0):
        p = g.interpolate(d)
        q = g.interpolate(min(d + 1, g.length))
        tx, ty = q.x - p.x, q.y - p.y
        tl = math.hypot(tx, ty) or 1
        nx, ny = -ty / tl, tx / tl
        for sgn in (-1, 1):
            st_pts.append((p.x + nx * half * sgn, p.y + ny * half * sgn))
st_pts = np.array(st_pts)
m = ~blocked_pts(st_pts[:, 0], st_pts[:, 1]) & ~shapely.contains_xy(taken_all, st_pts[:, 0], st_pts[:, 1])
# keep off the carriageways themselves
road_union_pairs = road_tree.query(shapely.points(st_pts[:, 0], st_pts[:, 1]), predicate="dwithin", distance=3.0)
on_road = np.zeros(len(st_pts), bool)
on_road[np.unique(road_union_pairs[0])] = True
m &= ~on_road
for x, y in st_pts[m]:
    trees.append((x, -y, 2 if rng.random() < 0.55 else 4, rng.uniform(0.4, 0.65)))
log("trees total", len(trees))

# street lamps: mapped lamps + generated along main roads
lamps = []
for k in range(len(i_geom)):
    if i_cls[k] == "street_lamp" and shapely.get_type_id(i_geom[k]) == 0:
        g = i_geom[k]
        lamps.append((g.x, -g.y, 6.0))
for L in lines:
    if L["code"] > 5 or L["hidden"]:
        continue
    g = shapely.LineString(L["coords"])
    half = {1: 7.5, 2: 10.5, 3: 9.0, 4: 7.0, 5: 5.0}[L["code"]]
    spacing = 32.0 if L["code"] <= 3 else 40.0
    s = L["s"]
    for d in np.arange(spacing / 2, g.length, spacing):
        p = g.interpolate(d)
        q = g.interpolate(min(d + 1, g.length))
        tx, ty = q.x - p.x, q.y - p.y
        tl = math.hypot(tx, ty) or 1
        nx, ny = -ty / tl, tx / tl
        e = float(np.interp(d, s, L["elev"]))
        for sgn in ((-1, 1) if L["code"] <= 3 else ((-1,) if int(d / spacing) % 2 else (1,))):
            lamps.append((p.x + nx * half * sgn, -(p.y + ny * half * sgn), e + (9.0 if L["code"] <= 2 else 7.0)))
log("lamps", len(lamps))

# ---------------------------------------------------------------- write extras
ebuf = bytearray(b"TKE1")


def sect(arr_bytes, n):
    global ebuf
    ebuf += struct.pack("<I", n)
    ebuf += arr_bytes
    while len(ebuf) % 4:
        ebuf += b"\0"


T = np.array(trees)
tree_dt = np.dtype([("x", "<i2"), ("z", "<i2"), ("t", "u1"), ("s", "u1")])
ta = np.zeros(len(T), tree_dt)
ta["x"] = np.round(T[:, 0] * 2)
ta["z"] = np.round(T[:, 1] * 2)
ta["t"] = T[:, 2]
ta["s"] = np.round(T[:, 3] * 255)
sect(ta.tobytes(), len(ta))

Lm = np.array(lamps)
lamp_dt = np.dtype([("x", "<i2"), ("z", "<i2"), ("y", "<u2")])
la_ = np.zeros(len(Lm), lamp_dt)
la_["x"] = np.round(Lm[:, 0] * 2)
la_["z"] = np.round(Lm[:, 1] * 2)
la_["y"] = np.round(Lm[:, 2] * 10)
sect(la_.tobytes(), len(la_))

R = np.array(roof_units)
ru_dt = np.dtype([("x", "<i2"), ("z", "<i2"), ("y", "<u2"), ("w", "u1"), ("d", "u1"), ("h", "u1"), ("r", "u1")])
ru = np.zeros(len(R), ru_dt)
ru["x"] = np.round(R[:, 0] * 2)
ru["z"] = np.round(R[:, 1] * 2)
ru["y"] = np.round(R[:, 2] * 10)
ru["w"] = np.round(R[:, 3] * 4).clip(0, 255)
ru["d"] = np.round(R[:, 4] * 4).clip(0, 255)
ru["h"] = np.round(R[:, 5] * 8).clip(0, 255)
ru["r"] = np.round(((R[:, 6] % math.pi) / math.pi) * 255).clip(0, 255)
sect(ru.tobytes(), len(ru))

A = np.array(aviation)
av_dt = np.dtype([("x", "<i2"), ("z", "<i2"), ("y", "<u2")])
av = np.zeros(len(A), av_dt)
av["x"] = np.round(A[:, 0] * 2)
av["z"] = np.round(A[:, 1] * 2)
av["y"] = np.round(A[:, 2] * 10)
sect(av.tobytes(), len(av))

S = np.array(signs, dtype=float)
sg_dt = np.dtype([("x", "<f4"), ("z", "<f4"), ("y", "<u2"), ("yaw", "<u2"), ("w", "u1"), ("h", "u1"),
                  ("kind", "u1"), ("tile", "u1"), ("hue", "u1"), ("pad", "u1")])
sg = np.zeros(len(S), sg_dt)
sg["x"] = S[:, 1]
sg["z"] = S[:, 2]
sg["y"] = np.round(S[:, 3] * 10)
sg["yaw"] = np.round(((S[:, 4] % (2 * math.pi)) / (2 * math.pi)) * 65535)
sg["w"] = np.round(S[:, 5] * 10).clip(0, 255)
sg["h"] = np.round(S[:, 6] * 10).clip(0, 255)
sg["kind"] = S[:, 0]
sg["tile"] = S[:, 7]
sg["hue"] = S[:, 8]
sect(sg.tobytes(), len(sg))
log("extras.bin.gz", write_gz("extras.bin.gz", ebuf) / 1e6, "MB")

# ---------------------------------------------------------------- roads + rails
rbuf = bytearray(b"TKR1")
vis = [L for L in lines if not L["hidden"]]
rbuf += struct.pack("<II", len(vis), sum(len(L["coords"]) for L in vis))
hdr = np.zeros(len(vis), np.dtype([("code", "u1"), ("flags", "u1"), ("n", "<u2")]))
for k, L in enumerate(vis):
    hdr[k] = (L["code"], (1 if L["bridge"] else 0) | (2 if L["link"] else 0), len(L["coords"]))
rbuf += hdr.tobytes()
V = np.concatenate([L["coords"] for L in vis])
E = np.concatenate([L["elev"] for L in vis])
vd = np.zeros(len(V), np.dtype([("x", "<i2"), ("z", "<i2"), ("y", "<u2")]))
vd["x"] = np.round(V[:, 0] * 2)
vd["z"] = np.round(-V[:, 1] * 2)
vd["y"] = np.round(E * 20).clip(0, 65535)
rbuf += vd.tobytes()
log("roads.bin.gz", write_gz("roads.bin.gz", rbuf) / 1e6, "MB", len(vis), "lines")

# ---------------------------------------------------------------- animated routes
TRAIN_COLORS = [  # (substring, colour id)
    ("山手", 1), ("Yamanote", 1), ("中央本線", 2), ("中央緩行", 3), ("中央線", 2), ("総武", 3), ("京浜東北", 4),
    ("東北本線", 4), ("新幹線", 5), ("埼京", 6), ("りんかい", 6), ("京葉", 7), ("常磐", 8), ("東海道", 9),
    ("横須賀", 10), ("ゆりかもめ", 11), ("Yurikamome", 11), ("モノレール", 12), ("小田急", 13), ("京王", 14),
    ("東急", 15), ("西武", 16), ("東武", 17), ("京成", 18), ("京急", 19), ("京浜急行", 19), ("丸ノ内", 20),
    ("銀座", 21), ("日比谷", 22), ("東西", 23), ("千代田", 24), ("有楽町", 25), ("半蔵門", 26), ("南北", 27),
    ("副都心", 28), ("浅草線", 29), ("三田", 30), ("新宿線", 31), ("大江戸", 32), ("都電", 33), ("舎人", 11),
]


def train_color(name):
    if not name:
        return 0
    for s, c in TRAIN_COLORS:
        if s in name:
            return c
    return 0


def resample(ls, step):
    L = ls.length
    n = max(2, int(L / step) + 1)
    d = np.linspace(0, L, n)
    pts = shapely.line_interpolate_point(ls, d)
    c = shapely.get_coordinates(pts, include_z=True)
    return c


groups = collections.defaultdict(list)
for L in lines:
    c3 = np.c_[L["coords"], L["elev"]]
    g = shapely.LineString(c3)
    if L["code"] >= 20:
        if L["code"] == 21 and L["elev"].max() < 1:
            continue
        groups[("rail", L["name"] or f"r{L['code']}")].append(g)
    elif L["code"] <= 4:
        groups[("road", L["code"], L["name"] or "")].append(g)
routes = []
for key, gs in groups.items():
    merged = shapely.line_merge(shapely.MultiLineString(gs))
    parts = shapely.get_parts(merged)
    for p in parts:
        Lp = p.length
        if key[0] == "rail":
            if Lp < 900:
                continue
            routes.append(dict(kind=2, color=train_color(key[1]), pts=resample(p, 6.0)))
        else:
            if Lp < 250:
                continue
            code = key[1]
            routes.append(dict(kind=0 if code == 1 else 1, color=code, pts=resample(p, 6.0)))
HOTSPOTS = [(139.70056, 35.65950, 160, 1.0), (139.70110, 35.69210, 220, 0.7), (139.70240, 35.69420, 220, 0.6),
            (139.76470, 35.67160, 220, 0.6), (139.77130, 35.69960, 220, 0.6), (139.71210, 35.72990, 220, 0.6),
            (139.77450, 35.71000, 200, 0.5), (139.79640, 35.71100, 200, 0.5), (139.75830, 35.66650, 200, 0.5),
            (139.76700, 35.68120, 220, 0.5)]
HOT_XY = [(*xn(lo, la), r, w) for lo, la, r, w in HOTSPOTS]
n_ped = 0
for L in lines:
    if L["code"] != 9:
        continue
    c = L["coords"]
    mid = c[len(c) // 2]
    for hx, hn, r, w in HOT_XY:
        if (mid[0] - hx) ** 2 + (mid[1] - hn) ** 2 < r * r:
            g = shapely.LineString(np.c_[c, L["elev"]])
            if 5 < g.length < 80:
                routes.append(dict(kind=3, color=int(w * 10), pts=resample(g, 2.0)))
                n_ped += 1
            break
log("routes", len(routes), "trains", sum(r["kind"] == 2 for r in routes), "pedestrian crossings", n_ped)
obuf = bytearray(b"TKO1")
obuf += struct.pack("<II", len(routes), sum(len(r["pts"]) for r in routes))
rh = np.zeros(len(routes), np.dtype([("kind", "u1"), ("color", "u1"), ("n", "<u2")]))
for k, r in enumerate(routes):
    rh[k] = (r["kind"], r["color"], min(len(r["pts"]), 65535))
    r["pts"] = r["pts"][:65535]
obuf += rh.tobytes()
P = np.concatenate([r["pts"] for r in routes])
pd_ = np.zeros(len(P), np.dtype([("x", "<i2"), ("z", "<i2"), ("y", "<u2")]))
pd_["x"] = np.round(P[:, 0] * 2)
pd_["z"] = np.round(-P[:, 1] * 2)
pd_["y"] = np.round(np.nan_to_num(P[:, 2]) * 20).clip(0, 65535)
obuf += pd_.tobytes()
log("routes.bin.gz", write_gz("routes.bin.gz", obuf) / 1e6, "MB")

# =====================================================================================
# 4. far field: coarse land/sea around the core and sprawl boxes
# =====================================================================================
FAR = 60000.0
far_box = box(-FAR, -FAR, FAR, FAR)
far_land = U([shapely.clip_by_rect(g, -FAR, -FAR, FAR, FAR) for g in land_polys])
far_land = shapely.simplify(far_land, 25.0)
far_land_out = shapely.difference(far_land, CORE)
far_water_out = shapely.difference(shapely.difference(far_box, far_land), CORE)
fbuf = bytearray(b"TKF1")
for name, g, q in (("land", far_land_out, 4.0), ("water", far_water_out, 4.0)):
    v, idx = triangulate(g, q)
    fbuf += struct.pack("<II", len(v), len(idx))
    fbuf += v.astype("<i2").tobytes()
    while len(fbuf) % 4:
        fbuf += b"\0"
    fbuf += idx.astype("<u4").tobytes()
    log(f"far {name}: {len(v)} verts")
# sprawl boxes on far land, density falling with distance from central Tokyo
nb = 90000
d = np.sqrt(rng.uniform(0, 1, nb * 4)) * 36000 + 6000
ang = rng.uniform(0, 2 * math.pi, nb * 4)
px = np.cos(ang) * d
py = np.sin(ang) * d
keep = shapely.contains_xy(far_land_out, px, py)
keep &= rng.uniform(0, 1, len(px)) < np.clip(1.4 - d / 30000, 0.15, 1)
px, py, d = px[keep][:nb], py[keep][:nb], d[keep][:nb]
# denser, taller sub-centres (Yokohama, Kawasaki, Saitama, Chiba, Funabashi, Tachikawa)
CENTERS = [(139.6380, 35.4660, 4500, 2.2), (139.7030, 35.5310, 2500, 1.7), (139.6240, 35.8620, 3000, 1.7),
           (140.1230, 35.6070, 2500, 1.5), (139.9850, 35.7020, 2000, 1.4), (139.4130, 35.6980, 2000, 1.3),
           (139.6970, 35.4540, 1500, 2.4), (139.6390, 35.6080, 1600, 1.4)]
boost = np.ones(len(px))
for lo, la, r, s in CENTERS:
    cx_, cn_ = xn(lo, la)
    dd = np.hypot(px - cx_, py - cn_)
    boost = np.maximum(boost, 1 + (s - 1) * np.clip(1 - dd / r, 0, 1) * 2.5)
hgt = np.clip(rng.lognormal(np.log(9), 0.45, len(px)) * boost, 4, 230)
size = np.clip(rng.uniform(10, 26, len(px)) * np.sqrt(boost), 8, 60)
fd = np.zeros(len(px), np.dtype([("x", "<i2"), ("z", "<i2"), ("h", "u1"), ("s", "u1")]))
fd["x"] = np.round(px / 4)
fd["z"] = np.round(-py / 4)
fd["h"] = np.round(hgt).clip(0, 255)
fd["s"] = np.round(size).clip(0, 255)
fbuf += struct.pack("<I", len(fd))
fbuf += fd.tobytes()
log("sprawl boxes", len(fd))
log("far.bin.gz", write_gz("far.bin.gz", fbuf) / 1e6, "MB")

# =====================================================================================
# 5. manifest: wards, stations, palettes, landmark anchors
# =====================================================================================
wards = []
with open(os.path.join(RAW, "tokyo_wards.geojson"), encoding="utf-8") as f:
    gj = json.load(f)
for ft in gj["features"]:
    g = shapely.geometry.shape(ft["geometry"])
    g = project(np.array([g], dtype=object))[0]
    if not g.intersects(box(-20000, -20000, 20000, 20000)):
        continue
    g = shapely.simplify(g, 40.0)
    rings = []
    for p in shapely.get_parts(g):
        rings.append([[round(x), round(-y)] for x, y in np.array(p.exterior.coords)[:, :2]])
    wards.append(dict(ja=ft["properties"]["ward_ja"], en=ft["properties"]["ward_en"], rings=rings))
log("wards", len(wards))

stations = {}
for k in range(len(i_geom)):
    if i_cls[k] == "railway_station" and i_name[k] and shapely.get_type_id(i_geom[k]) == 0:
        nm = i_name[k].split(";")[0].strip()
        g = i_geom[k]
        if nm not in stations and CORE_X0 < g.x < CORE_X1 and CORE_N0 < g.y < CORE_N1:
            stations[nm] = [round(g.x), round(-g.y)]

manifest = dict(
    version=1,
    origin=dict(lon=LON0, lat=LAT0, kx=KX, ky=KY),
    core=dict(x0=CORE_X0, x1=CORE_X1, z0=-CORE_N1, z1=-CORE_N0),
    chunkSize=CHUNK,
    chunks=chunks,
    wallPalette=WALL_PALETTE,
    roofPalette=ROOF_PALETTE,
    rainbow=dict(x=float(rb_c[0]), z=float(-rb_c[1]), ax=float(axis[0]), az=float(-axis[1]),
                 length=float(rb_len), width=float(rb_wid), deck=RB_DECK),
    wards=wards,
    stations=stations,
    stats=dict(buildings=int(NB), knownHeights=int(B["known"].sum()), trees=len(trees), signs=len(signs),
               lamps=len(lamps), roads=len(vis), routes=len(routes)),
    source="Overture Maps Foundation release 2026-09-23.1 (incl. OpenStreetMap contributors, ODbL)",
)
with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
log("manifest written; total data size",
    round(sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT)) / 1e6, 1), "MB")
