"""Step 5 - Flood Exposure Ranking on a 1 km hexagon grid.

Per hexagon and per pass:
  flood_frac   flooded share of the hexagon (open water + flooded vegetation, valid pixels only)
  people       WorldPop population on flooded pixels
  roads_km     length of OpenStreetMap roads on flooded pixels
  facilities   schools, clinics, hospitals, places of worship, police / fire stations and
               community halls standing on (or within one 20 m pixel of) a flooded pixel
  score        100 * sum(weight_i * metric_i / max(metric_i))   (weights in config.yaml)
  rank         1 = highest score on that pass; hexagons with score 0 are unranked

It is a screening aid built from satellite detections and open data - not a rescue order.

Run from the repo root:   python pipeline/05_exposure.py [--config ...]
"""
from __future__ import annotations

import argparse
import importlib
import json
import math

import numpy as np
from scipy import ndimage as ndi

from common import grid_from_config, load_config, lonlat_to_utm, utm_to_lonlat, work_dir, write_json

OPEN, VEG, NODATA = 2, 3, 255
ROAD_STEP_M = 10.0


def road_points(work, grid):
    """Sample every OSM road each ~10 m. Returns arrays (row, col, km)."""
    f = work / "osm" / "roads.json"
    rows, cols, kms = [], [], []
    if not f.exists():
        return np.zeros(0, int), np.zeros(0, int), np.zeros(0)
    for e in json.loads(f.read_text(encoding="utf-8"))["elements"]:
        g = e.get("geometry")
        if e["type"] != "way" or not g or len(g) < 2:
            continue
        x, y = lonlat_to_utm([p["lon"] for p in g], [p["lat"] for p in g], grid.epsg)
        for i in range(len(x) - 1):
            length = math.hypot(x[i + 1] - x[i], y[i + 1] - y[i])
            if length <= 0:
                continue
            n = max(1, int(length / ROAD_STEP_M))
            t = (np.arange(n) + 0.5) / n
            px = x[i] + (x[i + 1] - x[i]) * t
            py = y[i] + (y[i + 1] - y[i]) * t
            cols.append((px - grid.xmin) / grid.pixel_m)
            rows.append((grid.ymax - py) / grid.pixel_m)
            kms.append(np.full(n, length / n / 1000))
    r, c, k = np.concatenate(rows).astype(int), np.concatenate(cols).astype(int), np.concatenate(kms)
    ok = (r >= 0) & (r < grid.height) & (c >= 0) & (c < grid.width)
    return r[ok], c[ok], k[ok]


def facility_points(work, grid):
    f = work / "osm" / "facilities.json"
    out = []
    if not f.exists():
        return out
    for e in json.loads(f.read_text(encoding="utf-8"))["elements"]:
        if "lat" in e:
            lon, lat = e["lon"], e["lat"]
        elif "bounds" in e:
            b = e["bounds"]
            lon, lat = (b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2
        else:
            continue
        x, y = lonlat_to_utm(lon, lat, grid.epsg)
        r, c = int((grid.ymax - float(y)) / grid.pixel_m), int((float(x) - grid.xmin) / grid.pixel_m)
        if 0 <= r < grid.height and 0 <= c < grid.width:
            t = e.get("tags", {})
            out.append({"row": r, "col": c, "lon": round(lon, 6), "lat": round(lat, 6),
                        "kind": t.get("amenity"), "name": t.get("name")})
    return out


def place_points(work, grid):
    f = work / "osm" / "places.json"
    out = []
    if not f.exists():
        return out
    for e in json.loads(f.read_text(encoding="utf-8"))["elements"]:
        t = e.get("tags", {})
        if "lat" in e and t.get("name"):
            x, y = lonlat_to_utm(e["lon"], e["lat"], grid.epsg)
            out.append({"x": float(x) - grid.xmin, "y": grid.ymax - float(y), "lon": e["lon"], "lat": e["lat"],
                        "name": t.get("name:en") or t["name"], "place": t.get("place")})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default=None)
    args = ap.parse_args()
    cfg = load_config(args.config)
    grid = grid_from_config(cfg)
    work = work_dir(cfg)
    hex_index = importlib.import_module("00_mock_data").hex_index
    idx, centres, size = hex_index(grid, cfg["exposure"]["hex_flat_to_flat_m"])
    n = len(centres)
    flat = idx.ravel()
    ok = flat >= 0

    dates = [d["date"] for d in cfg["dates"] if (work / "flood" / f"flood_{d['date']}.npy").exists()]
    pop = np.load(work / "pop.npy") if (work / "pop.npy").exists() else np.zeros((grid.height, grid.width), "float32")
    rr, rc, rkm = road_points(work, grid)
    r_hex = idx[rr, rc]
    fac = facility_points(work, grid)
    places = place_points(work, grid)
    hex_pop = np.bincount(flat[ok], pop.ravel()[ok], n)

    m = {k: {} for k in ("flood_frac", "people", "roads_km", "facilities")}
    fac_hits = {}
    for d in dates:
        flood = np.load(work / "flood" / f"flood_{d}.npy")
        wet = (flood == OPEN) | (flood == VEG)
        valid = np.bincount(flat[ok], (flood != NODATA).ravel()[ok], n)
        m["flood_frac"][d] = np.bincount(flat[ok], wet.ravel()[ok], n) / np.maximum(valid, 1)
        m["people"][d] = np.bincount(flat[ok], (pop * wet).ravel()[ok], n)
        hit = wet[rr, rc] & (r_hex >= 0)
        m["roads_km"][d] = np.bincount(r_hex[hit], rkm[hit], n)
        near = ndi.maximum_filter(wet, size=3)                       # on or within one pixel of flood
        cnt = np.zeros(n)
        fac_hits[d] = []
        for f in fac:
            if near[f["row"], f["col"]] and idx[f["row"], f["col"]] >= 0:
                cnt[idx[f["row"], f["col"]]] += 1
                fac_hits[d].append({k: f[k] for k in ("name", "kind", "lon", "lat")})
        m["facilities"][d] = cnt

    wts = cfg["exposure"]["weights"]
    peak = {k: max(float(max(v.max() for v in m[k].values())), 1e-9) for k in m}
    peak["flood_frac"] = 1.0
    score, rank = {}, {}
    for d in dates:
        s = 100 * sum(wts[k] * m[k][d] / peak[k] for k in m)
        score[d] = s
        order = np.argsort(-s, kind="stable")
        rk = np.zeros(n, int)
        rk[order] = np.arange(1, n + 1)
        rank[d] = np.where(s > 0, rk, 0)

    pxy = np.array([[p["x"], p["y"]] for p in places]) if places else None
    feats = []
    for i, (cx, cy) in enumerate(centres):
        ring = []
        for k in range(7):
            ang = math.radians(60 * k + 30)
            lon, lat = utm_to_lonlat(grid.xmin + cx + size * math.cos(ang), grid.ymax - (cy + size * math.sin(ang)), grid.epsg)
            ring.append([round(float(lon), 6), round(float(lat), 6)])
        name = places[int(np.argmin(np.hypot(*(pxy - (cx, cy)).T)))]["name"] if places else f"Hexagon {i + 1}"
        feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {
            "id": f"H{i + 1:04d}", "name": name, "population": int(round(float(hex_pop[i]))),
            "flood_frac": {d: round(float(m["flood_frac"][d][i]), 3) for d in dates},
            "people": {d: int(round(float(m["people"][d][i]))) for d in dates},
            "roads_km": {d: round(float(m["roads_km"][d][i]), 2) for d in dates},
            "facilities": {d: int(m["facilities"][d][i]) for d in dates},
            "score": {d: round(float(score[d][i]), 1) for d in dates},
            "rank": {d: (int(rank[d][i]) or None) for d in dates}}})

    totals = {d: {"people_exposed": int(round(float(m["people"][d].sum()))),
                  "roads_flooded_km": round(float(m["roads_km"][d].sum()), 1),
                  "facilities_affected": int(m["facilities"][d].sum())} for d in dates}
    out = work / "exposure"
    out.mkdir(exist_ok=True)
    write_json(out / "hexes.geojson", {"type": "FeatureCollection", "features": feats}, compact=True)
    write_json(out / "totals.json", {"per_date": totals, "facilities_hit": fac_hits, "weights": wts,
                                     "aoi_population": int(round(float(pop.sum()))),
                                     "aoi_roads_km": round(float(rkm.sum()), 1), "aoi_facilities": len(fac)})
    for d in dates:
        top = max(range(n), key=lambda i: score[d][i])
        print(f"  {d}: {totals[d]['people_exposed']:,} people, {totals[d]['roads_flooded_km']} km roads, "
              f"{totals[d]['facilities_affected']} facilities; top hexagon near {feats[top]['properties']['name']} "
              f"(score {score[d][top]:.0f})")
    print(f"wrote {out / 'hexes.geojson'}  ({n} hexagons)")


if __name__ == "__main__":
    main()
