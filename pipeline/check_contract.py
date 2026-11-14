"""Validate web/data/ against the data contract in CLAUDE.md section 3.

Run after 00_mock_data.py or 06_export_web.py:   python pipeline/check_contract.py
Exits non-zero and lists every problem if the frontend would break.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from common import ROOT, load_config

MANIFEST_KEYS = ["title", "simulated", "crs", "bbox_utm", "bbox_wgs84", "grid", "dem", "landcover",
                 "dates", "stats", "hexes", "buildings", "places", "sources"]
DATE_KEYS = ["date", "label", "nisar_track", "optical", "optical_cloud_pct", "cband", "lband",
             "flood", "rain_mm_prev7d"]
STAT_KEYS = ["open_flood_km2", "veg_flood_km2", "detected_km2", "people_exposed",
             "roads_flooded_km", "facilities_affected"]
HEX_KEYS = ["id", "name", "flood_frac", "people", "roads_km", "facilities", "score", "rank"]


def main() -> int:
    data = ROOT / load_config(sys.argv[1] if len(sys.argv) > 1 else None)["paths"]["web_data"]
    errors: list[str] = []
    err = errors.append

    def load_json(name):
        try:
            return json.loads((data / name).read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            err(f"{name}: {exc}")
            return None

    man = load_json("manifest.json")
    if man is None:
        print("\n".join(errors))
        return 1
    for k in MANIFEST_KEYS:
        if k not in man:
            err(f"manifest: missing '{k}'")
    w, h = man["grid"]["width"], man["grid"]["height"]
    if max(w, h) > 2048:
        err("grid larger than 2048")
    xmin, ymin, xmax, ymax = man["bbox_utm"]
    if abs((xmax - xmin) - w * man["grid"]["pixel_m"]) > 1e-6 or abs((ymax - ymin) - h * man["grid"]["pixel_m"]) > 1e-6:
        err("bbox_utm does not equal width/height * pixel_m")

    def raster(name, bands):
        p = data / name
        if not p.exists():
            err(f"{name}: missing")
            return None
        im = Image.open(p)
        if im.size != (w, h):
            err(f"{name}: size {im.size} != grid {(w, h)}")
        if bands == 3 and im.mode != "RGB":
            err(f"{name}: expected RGB, got {im.mode}")
        return np.asarray(im.convert("RGB"))

    dem = raster(man["dem"], 3)
    if dem is not None:
        d64 = dem.astype(np.int64)
        hm = -10000 + (d64[..., 0] * 65536 + d64[..., 1] * 256 + d64[..., 2]) * 0.1
        if hm.min() < -500 or hm.max() > 9000:
            err(f"dem: implausible heights {hm.min():.0f}..{hm.max():.0f} m")
    lc = raster(man["landcover"], 1)
    if lc is not None and not set(np.unique(lc[..., 0])) <= {0, 1, 2, 3, 4, 5}:
        err(f"landcover: unexpected codes {sorted(set(np.unique(lc[..., 0])))}")

    stats = load_json(man["stats"]) or {"per_date": {}}
    dates = []
    if not man["dates"]:
        err("manifest: no dates")
    for d in man["dates"]:
        for k in DATE_KEYS:
            if k not in d:
                err(f"date {d.get('date')}: missing '{k}'")
        dates.append(d["date"])
        raster(d["optical"], 3)
        raster(d["cband"], 1)
        raster(d["lband"], 1)
        fl = raster(d["flood"], 1)
        if fl is not None and not set(np.unique(fl[..., 0])) <= {0, 1, 2, 3, 255}:
            err(f"{d['flood']}: unexpected codes")
        st = stats["per_date"].get(d["date"])
        if st is None:
            err(f"stats: no entry for {d['date']}")
            continue
        for k in STAT_KEYS:
            if k not in st:
                err(f"stats[{d['date']}]: missing '{k}'")
        for k in ("optical", "cband", "lband"):
            if k not in st.get("detected_km2", {}):
                err(f"stats[{d['date']}].detected_km2: missing '{k}'")
        if fl is not None:
            km2 = (man["grid"]["pixel_m"] / 1000) ** 2
            for code, key in ((2, "open_flood_km2"), (3, "veg_flood_km2")):
                got = float((fl[..., 0] == code).sum() * km2)
                if key in st and abs(got - st[key]) > 0.05 + 0.02 * got:
                    err(f"stats[{d['date']}].{key}={st[key]} but raster gives {got:.2f}")
    if dates != sorted(dates):
        err("dates are not in chronological order")

    lon0, lat0, lon1, lat1 = man["bbox_wgs84"]
    pad = 0.02

    def in_bbox(lon, lat):
        return lon0 - pad <= lon <= lon1 + pad and lat0 - pad <= lat <= lat1 + pad

    hexes = load_json(man["hexes"])
    if hexes:
        for f in hexes["features"]:
            p = f["properties"]
            for k in HEX_KEYS:
                if k not in p:
                    err(f"hex {p.get('id')}: missing '{k}'")
                    break
            else:
                for k in HEX_KEYS[2:]:
                    if set(p[k]) != set(dates):
                        err(f"hex {p['id']}.{k}: dates {sorted(p[k])} != manifest dates")
                        break
            if not in_bbox(*f["geometry"]["coordinates"][0][0]):
                err(f"hex {p.get('id')}: outside bbox_wgs84")
                break
    bld = load_json(man["buildings"])
    if bld:
        for f in bld["features"][:200]:
            if "height_m" not in f["properties"]:
                err("building without height_m")
                break
            if not in_bbox(*f["geometry"]["coordinates"][0][0]):
                err("building outside bbox_wgs84")
                break
    places = load_json(man["places"])
    if places:
        for f in places["features"]:
            if not f["properties"].get("name"):
                err("place without name")
            if not in_bbox(*f["geometry"]["coordinates"]):
                err(f"place {f['properties'].get('name')}: outside bbox_wgs84")
    for s in man["sources"]:
        for k in ("name", "provider", "url", "used_for"):
            if k not in s:
                err(f"source {s.get('name')}: missing '{k}'")

    if errors:
        print(f"CONTRACT CHECK FAILED ({len(errors)} problems)")
        print("\n".join("  - " + e for e in errors))
        return 1
    print(f"contract OK: {len(dates)} dates, {w}x{h} grid, "
          f"{len(hexes['features'])} hexes, {len(bld['features'])} buildings, {len(places['features'])} places, "
          f"simulated={man['simulated']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
