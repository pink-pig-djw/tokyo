"""Minimal HTTP range reader for Overture Maps GeoParquet files on public S3.

Reads only parquet footers + row groups that intersect a bbox, so we can pull
a city-sized extract out of a ~280 GB global dataset without downloading it.
"""
import io
import re
import struct
import concurrent.futures as cf

import pyarrow as pa
import pyarrow.parquet as pq
import requests

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
_session = requests.Session()


def list_keys(prefix):
    keys, token = [], None
    while True:
        params = {"list-type": "2", "prefix": prefix}
        if token:
            params["continuation-token"] = token
        r = _session.get(BUCKET + "/", params=params, timeout=60)
        r.raise_for_status()
        d = r.text
        ks = re.findall(r"<Key>([^<]+)</Key>", d)
        ss = re.findall(r"<Size>([^<]+)</Size>", d)
        keys += [(k, int(s)) for k, s in zip(ks, ss) if k.endswith(".parquet")]
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", d)
        if not m:
            return keys
        token = m.group(1)


class RangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests with a block cache."""

    BLOCK = 1 << 20

    def __init__(self, key, size):
        self.url = f"{BUCKET}/{key}"
        self.size = size
        self.pos = 0
        self.cache = {}

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        if whence == 0:
            self.pos = off
        elif whence == 1:
            self.pos += off
        else:
            self.pos = self.size + off
        return self.pos

    def _fetch(self, start, end):
        for attempt in range(5):
            try:
                r = _session.get(self.url, headers={"Range": f"bytes={start}-{end - 1}"}, timeout=120)
                r.raise_for_status()
                return r.content
            except Exception:
                if attempt == 4:
                    raise

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        # big reads go straight through; small ones use the block cache
        if n > 4 * self.BLOCK:
            data = self._fetch(self.pos, self.pos + n)
        else:
            out = bytearray()
            p = self.pos
            while len(out) < n:
                b = p // self.BLOCK
                if b not in self.cache:
                    s = b * self.BLOCK
                    self.cache[b] = self._fetch(s, min(s + self.BLOCK, self.size))
                blk = self.cache[b]
                off = p - b * self.BLOCK
                take = min(n - len(out), len(blk) - off)
                out += blk[off:off + take]
                p += take
            data = bytes(out)
        self.pos += len(data)
        return data

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def _bbox_col_indices(md):
    names = {}
    rg = md.row_group(0)
    for i in range(rg.num_columns):
        names[rg.column(i).path_in_schema] = i
    return names


def intersecting_row_groups(key, size, bbox):
    """Return (key, size, [row group ids]) whose bbox stats intersect bbox."""
    f = RangeFile(key, size)
    pf = pq.ParquetFile(f)
    md = pf.metadata
    idx = _bbox_col_indices(md)
    xmin_i, xmax_i = idx["bbox.xmin"], idx["bbox.xmax"]
    ymin_i, ymax_i = idx["bbox.ymin"], idx["bbox.ymax"]
    hits = []
    for g in range(md.num_row_groups):
        rg = md.row_group(g)
        sx0 = rg.column(xmin_i).statistics
        sx1 = rg.column(xmax_i).statistics
        sy0 = rg.column(ymin_i).statistics
        sy1 = rg.column(ymax_i).statistics
        if sx0 is None or sx1 is None or sy0 is None or sy1 is None:
            continue
        if sx0.min > bbox[2] or sx1.max < bbox[0] or sy0.min > bbox[3] or sy1.max < bbox[1]:
            continue
        hits.append(g)
    return key, size, hits


def extract(prefix, bbox, columns=None, workers=24, log=print):
    keys = list_keys(prefix)
    log(f"{prefix}: {len(keys)} files")
    plan = []
    with cf.ThreadPoolExecutor(workers) as ex:
        for key, size, hits in ex.map(lambda ks: intersecting_row_groups(ks[0], ks[1], bbox), keys):
            if hits:
                plan.append((key, size, hits))
    log(f"  {sum(len(h) for _, _, h in plan)} row groups in {len(plan)} files intersect")

    def read_one(item):
        key, size, groups = item
        pf = pq.ParquetFile(RangeFile(key, size))
        tables = []
        for g in groups:
            t = pf.read_row_group(g, columns=columns)
            b = t.column("bbox").combine_chunks()
            xmin = b.field("xmin").to_numpy(zero_copy_only=False)
            xmax = b.field("xmax").to_numpy(zero_copy_only=False)
            ymin = b.field("ymin").to_numpy(zero_copy_only=False)
            ymax = b.field("ymax").to_numpy(zero_copy_only=False)
            mask = (xmax >= bbox[0]) & (xmin <= bbox[2]) & (ymax >= bbox[1]) & (ymin <= bbox[3])
            tables.append(t.filter(pa.array(mask)))
        return tables

    out = []
    with cf.ThreadPoolExecutor(min(workers, 16)) as ex:
        for ts in ex.map(read_one, plan):
            out += ts
    if not out:
        return None
    return pa.concat_tables(out, promote_options="permissive")
