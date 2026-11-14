"""Step 1 - list the NISAR L2 GCOV granules NASA has published over the area of interest.

Queries NASA's Common Metadata Repository (CMR), which needs no login. Keeps granules whose
footprint contains the whole AOI, groups them by track / direction, and writes the passes on
the configured track to <work_dir>/nisar_granules.json for 02_fetch_subset.py.

Run from the repo root:   python pipeline/01_search_nisar.py [--config pipeline/config.yaml]
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from collections import defaultdict

from shapely.geometry import Polygon, box

from common import ROOT, grid_from_config, load_config, write_json

CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"


def cmr_granules(concept_id: str, **params) -> list[dict]:
    """All granules of one collection matching the CMR parameters (handles paging)."""
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({"collection_concept_id": concept_id, "page_size": 500,
                                    "page_num": page, "sort_key": "start_date", **params})
        with urllib.request.urlopen(f"{CMR}?{q}", timeout=120) as r:
            d = json.load(r)
        out += d["items"]
        if len(out) >= d["hits"] or not d["items"]:
            return out
        page += 1


def parse(item: dict, level: str) -> dict:
    u = item["umm"]
    attrs = {a["Name"]: a["Values"] for a in u.get("AdditionalAttributes", [])}
    pts = u["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"]["GPolygons"][0]["Boundary"]["Points"]
    urls = [r["URL"] for r in u.get("RelatedUrls", []) if r["URL"].endswith(".h5") and "QA_STATS" not in r["URL"]]
    name = u["GranuleUR"]
    return {
        "granule": name,
        "collection": level,
        "start": u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"],
        "date": u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10],
        "track": int(attrs.get("TRACK_NUMBER", [name.split("_")[5]])[0]),
        "frame": int(attrs.get("FRAME_NUMBER", [name.split("_")[7]])[0]),
        "direction": attrs.get("ASCENDING_DESCENDING", ["?"])[0],
        "mode": name.split("_")[8],
        "polarizations": attrs.get("FREQUENCY_A_POLARIZATION", []),
        "bandwidth_mhz": attrs.get("FREQUENCY_A_RANGE_BANDWIDTH", [None])[0],
        "product_version": attrs.get("PRODUCT_VERSION", [None])[0],
        "published": item["meta"].get("revision-date", "")[:16],
        "https": next((x for x in urls if x.startswith("https")), None),
        "s3": next((x for x in urls if x.startswith("s3")), None),
        "footprint": [[p["Longitude"], p["Latitude"]] for p in pts],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default=None)
    args = ap.parse_args()
    cfg = load_config(args.config)
    grid = grid_from_config(cfg)
    ns = cfg["nisar"]
    lon0, lat0, lon1, lat1 = grid.bbox_wgs84
    aoi = box(lon0, lat0, lon1, lat1)
    print(f"AOI {grid.bbox_wgs84}  {ns['search_start']} .. {ns['search_end']}")

    found = {}
    for col in ns["collections"]:           # newest processing level first: it wins on duplicates
        items = cmr_granules(col["concept_id"], bounding_box=f"{lon0},{lat0},{lon1},{lat1}",
                             temporal=f"{ns['search_start']}T00:00:00Z,{ns['search_end']}T23:59:59Z")
        print(f"  {col['short_name']}: {len(items)} granules intersect the AOI")
        for it in items:
            g = parse(it, col["short_name"])
            g["covers_aoi"] = bool(Polygon(g["footprint"]).contains(aoi))
            found.setdefault((g["track"], g["direction"], g["frame"], g["start"][:13], g["mode"]), g)

    tracks = defaultdict(list)
    for g in found.values():
        tracks[(g["track"], g["direction"])].append(g)
    print("\nPasses by track (only granules that contain the whole AOI are usable):")
    for (trk, dirn), gs in sorted(tracks.items()):
        ok = sorted({g["date"] for g in gs if g["covers_aoi"]})
        part = sorted({g["date"] for g in gs if not g["covers_aoi"]} - set(ok))
        print(f"  track {trk:>3} {dirn:<10} full: {', '.join(ok) or '-'}" + (f"   partial: {', '.join(part)}" if part else ""))

    want = (int(ns["track"]), ns["direction"]) if ns.get("track") else max(
        tracks, key=lambda k: len({g["date"] for g in tracks[k] if g["covers_aoi"]}))
    chosen = sorted((g for g in tracks.get(want, []) if g["covers_aoi"]), key=lambda g: g["start"])
    by_date = {}
    for g in chosen:                         # one granule per date; prefer the widest bandwidth
        if g["date"] not in by_date or (g["bandwidth_mhz"] or "0") > (by_date[g["date"]]["bandwidth_mhz"] or "0"):
            by_date[g["date"]] = g
    print(f"\nUsing track {want[0]} {want[1]}:")
    for d, g in by_date.items():
        print(f"  {g['start'][:16]}Z  frame {g['frame']}  {g['bandwidth_mhz']} MHz {'+'.join(g['polarizations'])}  "
              f"{g['collection']}  v{g['product_version']}  published {g['published']}")
    missing = [d["date"] for d in cfg["dates"] if d["date"] not in by_date and d.get("nisar") is not False]
    if missing:
        print(f"\nWARNING: no published granule yet for configured date(s): {', '.join(missing)}")

    out = ROOT / cfg["paths"]["work_dir"]
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "nisar_granules.json", {"track": want[0], "direction": want[1], "aoi_wgs84": grid.bbox_wgs84,
                                             "passes": list(by_date.values())})
    print(f"\nwrote {out / 'nisar_granules.json'}")


if __name__ == "__main__":
    main()
