"""Shared constants and helpers for the Tokyo data pipeline."""
import math
import os

import numpy as np
import shapely

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW = os.path.join(ROOT, "data-raw")
OUT = os.path.join(ROOT, "public", "data")

# Local tangent-plane origin (between the Imperial Palace and Tokyo Station).
LON0, LAT0 = 139.7600, 35.6800
_phi = math.radians(LAT0)
# WGS84 metres per degree at LAT0
KY = 111132.92 - 559.82 * math.cos(2 * _phi) + 1.175 * math.cos(4 * _phi)
KX = 111412.84 * math.cos(_phi) - 93.5 * math.cos(3 * _phi)

CHUNK = 2000.0          # building chunk size (m)
GRID_MIN = -10000.0     # chunk grid origin (m)
GRID_N = 10             # chunks per side


def lonlat_to_xn(lon, lat):
    """lon/lat -> (x east, n north) metres."""
    return (np.asarray(lon) - LON0) * KX, (np.asarray(lat) - LAT0) * KY


def project(geoms):
    """Project an array of lon/lat shapely geometries to local metres (x east, y north)."""
    def f(c):
        return np.c_[(c[:, 0] - LON0) * KX, (c[:, 1] - LAT0) * KY]
    return shapely.transform(geoms, f)


def ll(lon, lat):
    """Single lon/lat -> three.js (x, z) where z points south."""
    x, n = lonlat_to_xn(lon, lat)
    return float(x), float(-n)


def hash01(*vals):
    """Deterministic pseudo-random in [0,1) from integers."""
    h = 2166136261
    for v in vals:
        h ^= int(v) & 0xFFFFFFFF
        h = (h * 16777619) & 0xFFFFFFFF
        h ^= h >> 13
        h = (h * 0x5bd1e995) & 0xFFFFFFFF
        h ^= h >> 15
    return h / 4294967296.0
