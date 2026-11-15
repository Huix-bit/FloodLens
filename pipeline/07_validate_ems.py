"""Validation - compare the flood rasters of one pass with Copernicus EMS Rapid Mapping products.

Inputs: the *observedEventA* (flood polygons), *areaOfInterestA* and *imageFootprintA* GeoJSON
files of one or more Copernicus EMS products, unzipped under <work_dir>/validation/<product>/.
The comparison is made on the shared 20 m grid, only where the EMS area of interest overlaps
our box, and excluding our permanent-water mask (EMS maps flood, not rivers and lakes).

Run from the repo root:
  python pipeline/07_validate_ems.py --config pipeline/config.mozambique.yaml --date 2026-01-17
"""
from __future__ import annotations

import argparse
import json

import numpy as np
from shapely.geometry import shape

from common import grid_from_config, load_config, rasterize_lonlat, work_dir, write_json


def polys(path):
    d = json.loads(path.read_text(encoding="utf-8"))
    return [shape(f["geometry"]) for f in d["features"] if f.get("geometry")], d["features"]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default=None)
    ap.add_argument("--date", required=True)
    args = ap.parse_args()
    cfg = load_config(args.config)
    grid = grid_from_config(cfg)
    work = work_dir(cfg)
    km2 = grid.pixel_km2
    fl = np.load(work / "flood" / f"flood_{args.date}.npy")
    perm = np.load(work / "flood" / "permanent_water.npy")
    ours = {"NISAR L-band (open water + flooded vegetation)": (fl == 2) | (fl == 3)}
    cb = work / "flood" / f"cband_open_{args.date}.npy"
    if cb.exists():
        ours["Sentinel-1 C-band, our rule"] = np.load(cb)

    out = {"date": args.date, "note": "areas in km2 on the 20 m grid, inside the overlap of our box and the EMS area of interest, "
                                      "excluding our permanent-water mask", "products": []}
    root = work.parent / "validation" if (work.parent / "validation").exists() else work / "validation"
    for prod in sorted(p for p in root.iterdir() if p.is_dir()):
        ev = next(prod.glob("*observedEventA*.json"), None)
        aoi = next(prod.glob("*areaOfInterestA*.json"), None)
        if not ev or not aoi:
            continue
        ev_p, ev_f = polys(ev)
        aoi_p, _ = polys(aoi)
        foot = next(prod.glob("*imageFootprintA*.json"), None)
        src = []
        if foot:
            for f in polys(foot)[1]:
                pr = f["properties"]
                src.append({k: pr.get(k) for k in ("sensor_name", "source_nam", "src_date", "source_tm", "resolution", "or_src_id") if pr.get(k) is not None})
        domain = rasterize_lonlat(aoi_p, grid) & ~perm
        theirs = rasterize_lonlat(ev_p, grid) & domain
        kinds = sorted({str(f["properties"].get("event_type") or f["properties"].get("obj_desc") or "") for f in ev_f})
        rec = {"product": prod.name, "event_types": kinds, "imagery": src[:4],
               "overlap_km2": round(float(domain.sum() * km2), 1), "ems_flood_km2": round(float(theirs.sum() * km2), 1), "compare": {}}
        print(f"{prod.name}: overlap {rec['overlap_km2']} km2, EMS flood {rec['ems_flood_km2']} km2, imagery {src[:2]}")
        if domain.sum() * km2 < 5:
            continue
        for name, m in ours.items():
            m = m & domain
            both, a, b = (m & theirs).sum() * km2, m.sum() * km2, theirs.sum() * km2
            rec["compare"][name] = {
                "ours_km2": round(float(a), 1), "both_km2": round(float(both), 1),
                "ours_only_km2": round(float(a - both), 1), "ems_only_km2": round(float(b - both), 1),
                "pct_of_ours_inside_ems": round(float(both / max(a, 1e-9) * 100), 1),
                "pct_of_ems_we_flag": round(float(both / max(b, 1e-9) * 100), 1),
                "iou_pct": round(float(both / max(a + b - both, 1e-9) * 100), 1)}
            c = rec["compare"][name]
            print(f"   {name}: ours {c['ours_km2']}, both {c['both_km2']}, ours only {c['ours_only_km2']}, EMS only {c['ems_only_km2']}, "
                  f"{c['pct_of_ours_inside_ems']}% of ours inside EMS, we flag {c['pct_of_ems_we_flag']}% of EMS, IoU {c['iou_pct']}%")
        out["products"].append(rec)
    write_json(work / "flood" / f"validation_ems_{args.date}.json", out)


if __name__ == "__main__":
    main()
