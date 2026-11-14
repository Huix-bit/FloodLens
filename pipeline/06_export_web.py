"""Step 6 - write web/data/ in the exact contract format from the real intermediate products.

Reads <work_dir> (steps 01-05) and writes manifest.json, dem.png, landcover.png, per-pass
optical / cband / lband / flood PNGs, stats.json, hexes.geojson, buildings.geojson and
places.geojson. Nothing is invented:
  * a date is exported only if step 03 produced a flood raster for it;
  * a date without a NISAR pass (config `nisar: false`) reuses the latest earlier NISAR image
    and is flagged `lband_pending` - the app says so on screen;
  * a layer that could not be obtained is written as an empty image and flagged `*_missing`;
  * configured NISAR dates that NASA has not published yet are listed under `pending_passes`.

Run from the repo root:   python pipeline/06_export_web.py [--config ...]
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

import numpy as np
from PIL import Image

from common import ROOT, grid_from_config, load_config, lonlat_to_utm, utm_to_lonlat, work_dir, write_json


def save(arr, path):
    Image.fromarray(arr).save(path, optimize=True)


def encode_dem(dem):
    v = np.round((dem.astype(np.float64) + 10000) * 10).astype(np.uint32)
    return np.dstack([(v >> 16) & 255, (v >> 8) & 255, v & 255]).astype(np.uint8)


def stretch(db, lo, hi):
    out = np.clip((db - lo) / (hi - lo) * 255 + 0.5, 1, 255)
    return np.where(np.isfinite(db), out, 0).astype(np.uint8)


def to_db(x):
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(x)


def true_colour(rgb):
    """HLS surface reflectance -> 8-bit true colour. Clouds are left in: they are the point."""
    v = np.clip(np.nan_to_num(rgb[:3], nan=0.0) / 0.28, 0, 1) ** (1 / 1.7)
    return (np.moveaxis(v, 0, -1) * 255 + 0.5).astype(np.uint8)


def building_height(tags):
    for key, k in (("height", 1.0), ("building:levels", 3.2)):
        try:
            v = float(str(tags.get(key, "")).replace("m", "").strip()) * k
            if 2 <= v <= 300:
                return round(v, 1), False
        except ValueError:
            pass
    kind = tags.get("building", "yes")
    guess = {"apartments": 15, "commercial": 8, "retail": 7, "industrial": 9, "warehouse": 9, "school": 8,
             "hospital": 12, "mosque": 10, "temple": 9, "church": 9, "office": 12, "terrace": 7}.get(kind, 4.5)
    return guess, True


def export_buildings(work, grid, min_area_m2=40.0):
    from shapely.geometry import Polygon
    f = work / "osm" / "buildings.json"
    feats = []
    if not f.exists():
        return {"type": "FeatureCollection", "features": feats}
    x0, y0, x1, y1 = grid.bbox_utm
    for e in json.loads(f.read_text(encoding="utf-8"))["elements"]:
        g = e.get("geometry")
        if e["type"] != "way" or not g or len(g) < 4:
            continue
        x, y = lonlat_to_utm([p["lon"] for p in g], [p["lat"] for p in g], grid.epsg)
        poly = Polygon(np.column_stack([x, y]))
        if not poly.is_valid or poly.area < min_area_m2:
            continue
        c = poly.centroid
        if not (x0 + 30 < c.x < x1 - 30 and y0 + 30 < c.y < y1 - 30):
            continue
        poly = poly.simplify(1.0)
        if poly.is_empty or poly.geom_type != "Polygon":
            continue
        px, py = poly.exterior.coords.xy
        lon, lat = utm_to_lonlat(np.array(px), np.array(py), grid.epsg)
        h, est = building_height(e.get("tags", {}))
        feats.append({"type": "Feature", "properties": {"height_m": h, "height_estimated": est},
                      "geometry": {"type": "Polygon", "coordinates": [[[round(float(a), 5), round(float(b), 5)] for a, b in zip(lon, lat)]]}})
    return {"type": "FeatureCollection", "features": feats}


def export_places(work, grid):
    f = work / "osm" / "places.json"
    feats = []
    if f.exists():
        lon0, lat0, lon1, lat1 = grid.bbox_wgs84
        for e in json.loads(f.read_text(encoding="utf-8"))["elements"]:
            t = e.get("tags", {})
            if "lat" in e and t.get("name") and lon0 < e["lon"] < lon1 and lat0 < e["lat"] < lat1:
                feats.append({"type": "Feature", "properties": {"name": t.get("name:en") or t["name"], "place": t.get("place")},
                              "geometry": {"type": "Point", "coordinates": [round(e["lon"], 6), round(e["lat"], 6)]}})
    return {"type": "FeatureCollection", "features": feats}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default=None)
    args = ap.parse_args()
    cfg = load_config(args.config)
    grid = grid_from_config(cfg)
    work = work_dir(cfg)
    out = ROOT / cfg["paths"]["web_data"]
    out.mkdir(parents=True, exist_ok=True)
    detect = json.loads((work / "flood" / "detect.json").read_text(encoding="utf-8"))
    anc = json.loads((work / "ancillary.json").read_text(encoding="utf-8")) if (work / "ancillary.json").exists() else {}
    totals = json.loads((work / "exposure" / "totals.json").read_text(encoding="utf-8")) if (work / "exposure" / "totals.json").exists() else {"per_date": {}}
    listing = json.loads((work / "nisar_granules.json").read_text(encoding="utf-8"))
    dates = [d for d in cfg["dates"] if d["date"] in detect["per_date"]]
    if not dates:
        raise SystemExit("nothing to export - run steps 02 and 03 first")

    for old in out.glob("*"):
        if old.suffix in (".png", ".json", ".geojson"):
            old.unlink()
    save(encode_dem(np.load(work / "dem.npy")), out / "dem.png")
    save(np.load(work / "landcover.npy").astype(np.uint8), out / "landcover.png")
    lo_c, hi_c = cfg["stretch_db"]["cband"]
    lo_l, hi_l = cfg["stretch_db"]["lband"]
    shape = (grid.height, grid.width)

    entries, stats, levels, last_nisar = [], {}, set(), None
    for d in dates:
        date = d["date"]
        p = detect["per_date"][date]
        entry = {"date": date, "label": d["label"], "nisar_track": None,
                 "optical": f"optical_{date}.png", "optical_cloud_pct": None,
                 "cband": f"cband_{date}.png", "lband": f"lband_{date}.png", "flood": f"flood_{date}.png",
                 "rain_mm_prev7d": None, "flood_source": p["source"]}
        if p["source"] == "nisar":
            meta = json.loads((work / "nisar" / f"{date}.json").read_text(encoding="utf-8"))
            levels.add(meta["collection"])
            last_nisar = date
            save(stretch(to_db(np.load(work / "nisar" / f"{date}.npz")["hh"]), lo_l, hi_l), out / f"lband_{date}.png")
            entry.update(nisar_track=f"{meta.get('trackNumber', listing['track'])} {str(meta.get('orbitPassDirection', listing['direction'])).lower()}",
                         nisar_granule=meta["granule"], nisar_time_utc=meta["start"][:16] + "Z", nisar_collection=meta["collection"])
        elif last_nisar:
            # No NISAR pass on this date: show the latest earlier pass and say so.
            save(stretch(to_db(np.load(work / "nisar" / f"{last_nisar}.npz")["hh"]), lo_l, hi_l), out / f"lband_{date}.png")
            entry.update(lband_pending=True, lband_from=last_nisar)
        else:
            save(np.zeros(shape, np.uint8), out / f"lband_{date}.png")
            entry["lband_missing"] = True
        save(np.load(work / "flood" / f"flood_{date}.npy").astype(np.uint8), out / f"flood_{date}.png")

        cb = work / "cband" / f"{date}.npy"
        if cb.exists():
            save(stretch(to_db(np.load(cb)), lo_c, hi_c), out / f"cband_{date}.png")
            info = anc.get("cband", {}).get("dates", {}).get(date, {})
            entry.update(cband_acquired=info.get("acquired"), cband_offset_days=info.get("offset_days"), cband_track=info.get("track"))
        else:
            save(np.zeros(shape, np.uint8), out / f"cband_{date}.png")
            entry["cband_missing"] = True
        op = work / "optical" / f"{date}.npz"
        if op.exists():
            save(true_colour(np.load(op)["rgb"]), out / f"optical_{date}.png")
            info = anc.get("optical", {}).get("dates", {}).get(date, {})
            entry.update(optical_scene=info.get("scene"), optical_acquired=info.get("acquired"),
                         optical_offset_days=info.get("offset_days"),
                         optical_cloud_pct=p.get("optical_cloud_pct", info.get("cloud_pct")))
        else:
            save(np.zeros(shape + (3,), np.uint8), out / f"optical_{date}.png")
            entry["optical_missing"] = True
        rain = anc.get("rain", {}).get("dates", {}).get(date)
        if rain:
            entry["rain_mm_prev7d"] = rain["mm_prev7d"]
        entries.append(entry)
        det = p["detected_km2"]
        stats[date] = {"open_flood_km2": p["open_flood_km2"], "veg_flood_km2": p["veg_flood_km2"],
                       "detected_km2": {"optical": det.get("optical"), "cband": det.get("cband"), "lband": det.get("lband")},
                       "is_reference": p.get("is_reference", False), "flood_source": p["source"],
                       **totals["per_date"].get(date, {"people_exposed": 0, "roads_flooded_km": 0, "facilities_affected": 0})}

    write_json(out / "stats.json", {"per_date": stats})
    hexes = work / "exposure" / "hexes.geojson"
    (out / "hexes.geojson").write_text(hexes.read_text(encoding="utf-8") if hexes.exists() else '{"type":"FeatureCollection","features":[]}', encoding="utf-8")
    buildings = export_buildings(work, grid)
    write_json(out / "buildings.geojson", buildings, compact=True)
    places = export_places(work, grid)
    for rc in cfg.get("relief_centres", []):
        places["features"].append({"type": "Feature", "properties": {"name": rc["name"], "place": "relief_centre"},
                                   "geometry": {"type": "Point", "coordinates": [rc["lon"], rc["lat"]]}})
    write_json(out / "places.geojson", places, compact=True)

    n_nisar = sum(1 for e in entries if e["flood_source"] == "nisar")
    sources = [{"name": "NISAR L2 Geocoded Polarimetric Covariance (GCOV), L-band HH / HV", "provider": "NASA / ISRO via ASF DAAC",
                "url": "https://search.asf.alaska.edu/", "nasa": True, "simulated": False,
                "used_for": "L-band mode; open-water and under-canopy flood detection",
                "detail": f"Track {listing['track']} {listing['direction'].lower()}, {n_nisar} passes; collections: {', '.join(sorted(levels))}"}]
    used_for = {"cband": "C-band mode; open-water flood seen by Sentinel-1", "optical": "Optical mode; cloud cover; optical water test",
                "dem": "3D terrain; height-above-drainage mask", "rain": "Rainfall in the 7 days before each pass",
                "landcover": "Land-cover classes (palm / tree crop, forest, urban, crop)", "water": "Permanent-water mask",
                "pop": "People exposed per hexagon", "osm": "Buildings, roads, places, facilities, water and forest outlines"}
    for key in ("cband", "optical", "dem", "rain", "landcover", "water", "pop", "osm"):
        a = anc.get(key)
        if a and (key not in ("cband", "optical", "rain") or a.get("dates")):
            sources.append({"name": a["name"], "provider": a["provider"], "url": a["url"], "nasa": bool(a.get("nasa")),
                            "simulated": False, "used_for": used_for[key]})

    exported = {e["date"] for e in entries}
    pending = [{"date": d["date"], "label": d["label"], "note": d.get("pending_note", "NISAR pass not yet published by NASA")}
               for d in cfg["dates"] if d["date"] not in exported and d.get("nisar") is not False]
    write_json(out / "manifest.json", {
        "title": cfg["title"],
        "simulated": False,
        "crs": f"EPSG:{grid.epsg}",
        "bbox_utm": grid.bbox_utm,
        "bbox_wgs84": grid.bbox_wgs84,
        "grid": {"width": grid.width, "height": grid.height, "pixel_m": grid.pixel_m},
        "dem": "dem.png",
        "landcover": "landcover.png",
        "dates": entries,
        "stats": "stats.json",
        "hexes": "hexes.geojson",
        "buildings": "buildings.geojson",
        "places": "places.geojson",
        "sources": sources,
        # Optional extensions (the frontend works without them):
        "stretch_db": cfg["stretch_db"],
        "exposure_weights": cfg["exposure"]["weights"],
        "pending_passes": pending,
        "home_lonlat": [cfg["home"]["lon"], cfg["home"]["lat"]] if cfg.get("home") else None,
        "default_date": cfg.get("default_date"),
        "event": cfg.get("event"),
        "method": {"reference_dates": detect["reference_dates"], "lband": detect["lband"], "cband": detect["cband"],
                   "optical": detect["optical"], "permanent_water_km2": detect["permanent_water_km2"],
                   "landcover": anc.get("landcover", {}).get("method")},
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
    })
    size = sum(f.stat().st_size for f in out.iterdir()) / 1e6
    print(f"wrote {len(list(out.iterdir()))} files, {size:.1f} MB -> {out}")
    print(f"  passes {[e['date'] for e in entries]}  pending {[p['date'] for p in pending]}  buildings {len(buildings['features'])}")


if __name__ == "__main__":
    main()
