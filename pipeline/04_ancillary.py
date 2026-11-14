"""Step 4 - ancillary layers on the shared AOI grid.

Stages (run all, or pick with --only dem,osm,landcover,water,pop,cband,optical,rain):
  dem        NASADEM (NASA, needs Earthdata login) or Copernicus GLO-30 as fallback
  osm        OpenStreetMap buildings, roads, places, facilities, water, forest (Overpass API)
  landcover  ESA WorldCover 2021 -> contract classes (tree cover split with OSM forest polygons)
  water      JRC Global Surface Water occurrence (permanent water)
  pop        WorldPop 100 m population
  cband      OPERA RTC-S1 (Sentinel-1 C-band backscatter, NASA/JPL) nearest each NISAR pass
  optical    NASA HLS true colour + Fmask cloud nearest each NISAR pass
  rain       NASA GPM IMERG rainfall in the 7 days before each pass

Everything is cached under <work_dir>; only the AOI window of each remote file is read where
the server allows it. Each stage records its source in <work_dir>/ancillary.json.

Run from the repo root:   python pipeline/04_ancillary.py [--config ...] [--only dem,osm]
"""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from common import (earthdata_login, grid_from_config, load_config, lonlat_to_utm, rasterize_lonlat,
                    read_to_grid, warp_to_grid, work_dir, write_json)

UA = {"User-Agent": "floodlens-pipeline/0.1"}
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF",
                GDAL_HTTP_TIMEOUT="120", GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2")
CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"


# --------------------------------------------------------------------------- small utilities
def note(work: Path, key: str, value) -> None:
    """Record what a stage actually used; 06_export_web.py turns this into manifest sources."""
    p = work / "ancillary.json"
    d = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    d[key] = value
    write_json(p, d)


def download(url: str, dest: Path, session=None) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"    downloading {url.split('/')[-1]}")
    if session is not None:
        with session.get(url, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(tmp, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
    else:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(tmp, "wb") as fh:
            while chunk := r.read(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)
    return dest


def cmr(concept_id: str, **params) -> list[dict]:
    q = urllib.parse.urlencode({"collection_concept_id": concept_id, "page_size": 500, "sort_key": "start_date", **params})
    with urllib.request.urlopen(f"{CMR}?{q}", timeout=120) as r:
        return json.load(r)["items"]


def tiles_1deg(grid):
    lon0, lat0, lon1, lat1 = grid.bbox_wgs84
    return [(la, lo) for la in range(math.floor(lat0), math.floor(lat1) + 1)
            for lo in range(math.floor(lon0), math.floor(lon1) + 1)]


def pass_times(cfg, work) -> dict[str, datetime]:
    """UTC acquisition time of each configured date (from the NISAR search, else noon)."""
    out = {d["date"]: datetime.fromisoformat(d["date"] + "T12:00:00+00:00") for d in cfg["dates"]}
    p = work / "nisar_granules.json"
    if p.exists():
        for g in json.loads(p.read_text(encoding="utf-8"))["passes"]:
            if g["date"] in out:
                out[g["date"]] = datetime.fromisoformat(g["start"].replace("Z", "+00:00"))
    return out


# --------------------------------------------------------------------------- dem
def stage_dem(cfg, grid, work):
    import rasterio
    from rasterio.transform import from_origin
    dem = np.full((grid.height, grid.width), np.nan, dtype="float32")
    ea = earthdata_login()
    used = None
    if ea:
        try:
            for la, lo in tiles_1deg(grid):
                tile = f"{'n' if la >= 0 else 's'}{abs(la):02d}{'e' if lo >= 0 else 'w'}{abs(lo):03d}"
                url = f"https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/NASADEM_HGT.001/NASADEM_HGT_{tile}/NASADEM_HGT_{tile}.zip"
                z = download(url, work / "dem" / f"NASADEM_HGT_{tile}.zip", ea.get_requests_https_session())
                with zipfile.ZipFile(z) as zf:
                    raw = zf.read(f"{tile}.hgt")
                h = np.frombuffer(raw, dtype=">i2").reshape(3601, 3601).astype("float32")
                tf = from_origin(lo - 0.5 / 3600, la + 1 + 0.5 / 3600, 1 / 3600, 1 / 3600)
                part = warp_to_grid(h, tf, "EPSG:4326", grid, "bilinear", src_nodata=-32768)
                dem = np.where(np.isnan(dem), part, dem)
            used = {"name": "NASADEM Merged DEM Global 1 arc second (NASADEM_HGT v001)", "provider": "NASA LP DAAC",
                    "url": "https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001", "nasa": True}
        except Exception as err:                      # noqa: BLE001 - fall back, but say so
            print(f"    NASADEM failed ({err!r}); falling back to Copernicus GLO-30")
            dem[:] = np.nan
    if used is None:
        with rasterio.Env(**GDAL_ENV):
            for la, lo in tiles_1deg(grid):
                t = f"Copernicus_DSM_COG_10_{'N' if la >= 0 else 'S'}{abs(la):02d}_00_{'E' if lo >= 0 else 'W'}{abs(lo):03d}_00_DEM"
                part = read_to_grid(f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{t}/{t}.tif", grid, "bilinear")
                if part is not None:
                    dem = np.where(np.isnan(dem), part, dem)
        used = {"name": "Copernicus DEM GLO-30", "provider": "ESA / Airbus via AWS Open Data",
                "url": "https://doi.org/10.5270/ESA-c5d3d65", "nasa": False}
    dem = np.nan_to_num(dem, nan=0.0)
    np.save(work / "dem.npy", dem)
    note(work, "dem", used)
    print(f"  dem: {used['name']}  min {dem.min():.1f} m  max {dem.max():.1f} m  mean {dem.mean():.1f} m")


# --------------------------------------------------------------------------- osm
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]


def overpass(query: str) -> dict:
    last = None
    for attempt in range(6):
        host = OVERPASS[attempt % len(OVERPASS)]
        try:
            req = urllib.request.Request(host, data=urllib.parse.urlencode({"data": query}).encode(), headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read())
        except Exception as err:                      # noqa: BLE001 - public servers are often busy
            last = err
            print(f"    overpass {host.split('/')[2]} failed ({str(err)[:60]}); retrying")
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Overpass unavailable: {last!r}")


def stage_osm(cfg, grid, work):
    lon0, lat0, lon1, lat1 = grid.bbox_wgs84
    bb = f"({lat0},{lon0},{lat1},{lon1})"
    groups = {
        "buildings": f'way["building"]{bb};',
        "roads": f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service|track)$"]{bb};',
        "places": f'node["place"~"^(city|town|village|suburb|hamlet|neighbourhood)$"]["name"]{bb};',
        "facilities": f'nwr["amenity"~"^(school|kindergarten|college|university|clinic|hospital|doctors|place_of_worship|police|fire_station|community_centre|townhall)$"]{bb};',
        "water": f'(way["natural"="water"]{bb};relation["natural"="water"]{bb};way["waterway"~"^(river|canal|stream|drain)$"]{bb};way["waterway"="riverbank"]{bb};);',
        "forest": f'(way["landuse"="forest"]{bb};relation["landuse"="forest"]{bb};way["natural"~"^(wood|wetland)$"]{bb};relation["natural"~"^(wood|wetland)$"]{bb};'
                  f'way["leisure"="nature_reserve"]{bb};relation["leisure"="nature_reserve"]{bb};way["boundary"="protected_area"]{bb};relation["boundary"="protected_area"]{bb};);',
        "plantation": f'(way["landuse"~"^(plantation|orchard)$"]{bb};relation["landuse"~"^(plantation|orchard)$"]{bb};way["crop"~"palm"]{bb};);',
    }
    out = work / "osm"
    out.mkdir(exist_ok=True)
    for name, body in groups.items():
        f = out / f"{name}.json"
        if f.exists():
            n = len(json.loads(f.read_text(encoding="utf-8"))["elements"])
        else:
            d = overpass(f"[out:json][timeout:240];{body}out {'body' if name == 'places' else 'geom'};")
            f.write_text(json.dumps(d), encoding="utf-8")
            n = len(d["elements"])
        print(f"  osm {name}: {n} elements")
    note(work, "osm", {"name": "OpenStreetMap", "provider": "OpenStreetMap contributors (ODbL), via Overpass API",
                       "url": "https://www.openstreetmap.org/copyright", "nasa": False,
                       "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d")})


def osm_polygons(work: Path, name: str):
    """Closed ways and multipolygon outer rings of one cached OSM group, as shapely polygons (lon/lat)."""
    from shapely.geometry import Polygon
    f = work / "osm" / f"{name}.json"
    polys = []
    if not f.exists():
        return polys
    for e in json.loads(f.read_text(encoding="utf-8"))["elements"]:
        rings = []
        if e["type"] == "way" and "geometry" in e:
            rings.append(e["geometry"])
        elif e["type"] == "relation":
            rings += [m["geometry"] for m in e.get("members", []) if m.get("role") in ("outer", "") and "geometry" in m]
        for ring in rings:
            pts = [(p["lon"], p["lat"]) for p in ring]
            if len(pts) >= 4 and pts[0] == pts[-1]:
                poly = Polygon(pts)
                if poly.is_valid and poly.area > 0:
                    polys.append(poly)
    return polys


def osm_lines(work: Path, name: str, key: str | None = None, values=None):
    from shapely.geometry import LineString
    f = work / "osm" / f"{name}.json"
    out = []
    if not f.exists():
        return out
    for e in json.loads(f.read_text(encoding="utf-8"))["elements"]:
        if e["type"] != "way" or "geometry" not in e:
            continue
        if key and e.get("tags", {}).get(key) not in values:
            continue
        pts = [(p["lon"], p["lat"]) for p in e["geometry"]]
        if len(pts) >= 2 and pts[0] != pts[-1]:
            out.append((LineString(pts), e.get("tags", {})))
    return out


# --------------------------------------------------------------------------- land cover
def stage_landcover(cfg, grid, work):
    import rasterio
    lon0, lat0, lon1, lat1 = grid.bbox_wgs84
    wc = np.zeros((grid.height, grid.width), dtype="uint8")
    with rasterio.Env(**GDAL_ENV):
        for la in range(math.floor(lat0 / 3) * 3, math.floor(lat1 / 3) * 3 + 1, 3):
            for lo in range(math.floor(lon0 / 3) * 3, math.floor(lon1 / 3) * 3 + 1, 3):
                t = f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}"
                part = read_to_grid(f"/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif",
                                    grid, "mode", dst_nodata=0, dtype="uint8", src_nodata=0)
                if part is not None:
                    wc = np.where(wc == 0, part, wc)
    np.save(work / "worldcover.npy", wc)
    forest = rasterize_lonlat(osm_polygons(work, "forest"), grid)
    plantation = rasterize_lonlat(osm_polygons(work, "plantation"), grid)
    # contract: 0 other, 1 permanent water, 2 urban, 3 oil palm / tree crop, 4 cropland / grass, 5 forest
    lc = np.zeros_like(wc)
    lc[wc == 80] = 1
    lc[wc == 50] = 2
    lc[np.isin(wc, (20, 30, 40, 90))] = 4
    lc[wc == 95] = 5                                   # mangrove
    tree = wc == 10
    lc[tree] = 3                                        # tree cover outside mapped forest = plantation / tree crop
    lc[tree & forest & ~plantation] = 5
    np.save(work / "landcover.npy", lc)
    names = ["other", "water", "urban", "palm/tree crop", "crop/grass", "forest"]
    share = {names[k]: round(float((lc == k).mean() * 100), 1) for k in range(6)}
    note(work, "landcover", {"name": "ESA WorldCover 10 m 2021 v200", "provider": "ESA / VITO",
                             "url": "https://doi.org/10.5281/zenodo.7254221", "nasa": False,
                             "method": "Tree cover is labelled 'oil palm / tree crop' unless it lies inside an OpenStreetMap "
                                       "forest, wood, wetland or protected-area polygon (then 'forest'); mangrove = forest.",
                             "share_pct": share})
    print(f"  landcover: {share}")


# --------------------------------------------------------------------------- permanent water
def stage_water(cfg, grid, work):
    import rasterio
    lon0, lat0, lon1, lat1 = grid.bbox_wgs84
    occ = np.zeros((grid.height, grid.width), dtype="float32")
    with rasterio.Env(**GDAL_ENV):
        for la in range(math.floor(lat0 / 10) * 10 + 10, math.floor(lat1 / 10) * 10 + 11, 10):
            for lo in range(math.floor(lon0 / 10) * 10, math.floor(lon1 / 10) * 10 + 1, 10):
                t = f"{abs(lo)}{'E' if lo >= 0 else 'W'}_{abs(la)}{'N' if la >= 0 else 'S'}"
                part = read_to_grid(f"/vsicurl/https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_{t}v1_4_2021.tif",
                                    grid, "bilinear", dst_nodata=0, src_nodata=255)
                if part is not None:
                    occ = np.maximum(occ, part)
    np.save(work / "jrc_occurrence.npy", occ)
    thr = cfg["thresholds"]["permanent_water_occurrence"]
    note(work, "water", {"name": "JRC Global Surface Water occurrence 1984-2021 (v1.4)", "provider": "EC JRC / Google",
                         "url": "https://global-surface-water.appspot.com/", "nasa": False,
                         "note": "Derived from the NASA/USGS Landsat archive."})
    print(f"  water: occurrence >= {thr}% on {float((occ >= thr).mean() * 100):.2f}% of the AOI")


# --------------------------------------------------------------------------- population
def stage_pop(cfg, grid, work):
    import rasterio
    url = "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2026/MYS/v1/100m/constrained/mys_pop_2026_CN_100m_R2025A_v1.tif"
    src = download(url, work / "pop" / url.split("/")[-1])
    with rasterio.open(src) as ds:
        res_deg = ds.res[0]
        nod = ds.nodata
    lat = math.radians(sum(grid.bbox_wgs84[1::2]) / 2)
    cell_m2 = (res_deg * 111320 * math.cos(lat)) * (res_deg * 110574)
    per_cell = read_to_grid(str(src), grid, "nearest", dst_nodata=0, src_nodata=nod)
    pop = np.clip(per_cell, 0, None) * (grid.pixel_m ** 2 / cell_m2)       # people per 20 m pixel
    np.save(work / "pop.npy", pop.astype("float32"))
    note(work, "pop", {"name": "WorldPop Global 2015-2030 (R2025A) constrained 100 m population, 2026, Malaysia",
                       "provider": "WorldPop, University of Southampton (CC BY 4.0)", "url": "https://www.worldpop.org/", "nasa": False})
    print(f"  pop: {pop.sum():,.0f} people in the AOI")


# --------------------------------------------------------------------------- C-band (OPERA RTC-S1)
def stage_cband(cfg, grid, work):
    ea = earthdata_login()
    if not ea:
        print("  cband: SKIPPED - needs Earthdata login in ~/.netrc")
        return
    import rasterio
    lon0, lat0, lon1, lat1 = grid.bbox_wgs84
    times = pass_times(cfg, work)
    t0 = min(times.values()) - timedelta(days=8)
    t1 = max(times.values()) + timedelta(days=8)
    items = cmr("C2777436413-ASF", bounding_box=f"{lon0},{lat0},{lon1},{lat1}",
                temporal=f"{t0:%Y-%m-%dT%H:%M:%SZ},{t1:%Y-%m-%dT%H:%M:%SZ}")
    # group bursts by acquisition (same track and same pass = within a few minutes)
    acq: dict[tuple, list] = {}
    for it in items:
        name = it["umm"]["GranuleUR"]                     # OPERA_L2_RTC-S1_T070-148220-IW3_20260920T113344Z_...
        parts = name.split("_")
        track = parts[3].split("-")[0]
        when = datetime.strptime(parts[4], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        urls = [r["URL"] for r in it["umm"].get("RelatedUrls", []) if r["URL"].startswith("https") and r["URL"].endswith("_VV.tif")]
        if urls:
            acq.setdefault((track, when.strftime("%Y-%m-%dT%H")), []).append((when, urls[0], name))
    session = ea.get_requests_https_session()
    out = work / "cband"
    out.mkdir(exist_ok=True)
    chosen = {}
    # one Sentinel-1 track for the whole timeline (same look geometry), the one with most acquisitions near passes
    tracks = sorted({k[0] for k in acq})
    def nearest(track, when):
        cands = [(abs((v[0][0] - when).total_seconds()), k) for k, v in acq.items() if k[0] == track]
        return min(cands) if cands else (float("inf"), None)
    best = min(tracks, key=lambda tr: sum(nearest(tr, w)[0] for w in times.values())) if tracks else None
    for date, when in times.items():
        gap, key = nearest(best, when) if best else (None, None)
        if key is None or gap > 6.5 * 86400:
            print(f"  cband {date}: no Sentinel-1 acquisition within 6 days")
            continue
        mosaic = np.full((grid.height, grid.width), np.nan, dtype="float32")
        for _, url, name in acq[key]:
            tif = download(url, out / url.split("/")[-1], session)
            part = read_to_grid(str(tif), grid, "average", src_nodata=np.nan)
            if part is not None:
                mosaic = np.where(np.isnan(mosaic), part, mosaic)
        np.save(out / f"{date}.npy", mosaic)                 # gamma0 VV, linear power
        chosen[date] = {"acquired": acq[key][0][0].strftime("%Y-%m-%dT%H:%MZ"), "track": best,
                        "offset_days": round((acq[key][0][0] - when).total_seconds() / 86400, 1),
                        "bursts": [n for _, _, n in acq[key]], "valid_pct": round(float(np.isfinite(mosaic).mean() * 100), 1)}
        print(f"  cband {date}: Sentinel-1 {chosen[date]['acquired']} ({chosen[date]['offset_days']:+.1f} d), {chosen[date]['valid_pct']}% valid")
    note(work, "cband", {"name": "OPERA Radiometric Terrain Corrected SAR Backscatter from Sentinel-1 (RTC-S1) v1",
                         "provider": "NASA JPL OPERA via ASF DAAC (contains modified Copernicus Sentinel data)",
                         "url": "https://doi.org/10.5067/SNWG/RTC-S1-V1", "nasa": True, "dates": chosen})


# --------------------------------------------------------------------------- optical (HLS)
# red, green, blue, narrow NIR (NIR is used only for the optical water test)
HLS = {"S30": ("C2021957295-LPCLOUD", ("B04", "B03", "B02", "B8A")), "L30": ("C2021957657-LPCLOUD", ("B04", "B03", "B02", "B05"))}


def stage_optical(cfg, grid, work):
    ea = earthdata_login()
    if not ea:
        print("  optical: SKIPPED - needs Earthdata login in ~/.netrc")
        return
    lon0, lat0, lon1, lat1 = grid.bbox_wgs84
    times = pass_times(cfg, work)
    t0 = min(times.values()) - timedelta(days=8)
    t1 = max(times.values()) + timedelta(days=8)
    scenes = []
    for sensor, (cid, bands) in HLS.items():
        for it in cmr(cid, bounding_box=f"{lon0},{lat0},{lon1},{lat1}", temporal=f"{t0:%Y-%m-%dT%H:%M:%SZ},{t1:%Y-%m-%dT%H:%M:%SZ}"):
            u = it["umm"]
            urls = {r["URL"].rsplit(".", 2)[-2]: r["URL"] for r in u.get("RelatedUrls", [])
                    if r["URL"].startswith("https") and r["URL"].endswith(".tif")}
            if all(b in urls for b in bands + ("Fmask",)):
                scenes.append({"id": u["GranuleUR"], "sensor": sensor, "urls": urls, "bands": bands,
                               "when": datetime.fromisoformat(u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"].replace("Z", "+00:00"))})
    session = ea.get_requests_https_session()
    out = work / "optical"
    out.mkdir(exist_ok=True)
    chosen = {}
    for date, when in times.items():
        cands = sorted(scenes, key=lambda s: abs((s["when"] - when).total_seconds()))
        done = False
        for s in cands[:4]:                                  # nearest scene that actually covers the AOI
            if abs((s["when"] - when).total_seconds()) > 8 * 86400:
                break
            d = out / s["id"]
            fm = read_to_grid(str(download(s["urls"]["Fmask"], d / "Fmask.tif", session)), grid, "nearest", dst_nodata=255, dtype="uint8", src_nodata=255)
            if fm is None or (fm == 255).mean() > 0.2:
                continue
            rgb = [read_to_grid(str(download(s["urls"][b], d / f"{b}.tif", session)), grid, "bilinear", src_nodata=-9999) for b in s["bands"]]
            np.savez_compressed(out / f"{date}.npz", rgb=np.stack(rgb).astype("float32") * 0.0001, fmask=fm)
            cloud = ((fm & 0b00000010) > 0) | ((fm & 0b00000100) > 0) | ((fm & 0b00001000) > 0)   # cloud, adjacent, shadow
            valid = fm != 255
            chosen[date] = {"scene": s["id"], "acquired": s["when"].strftime("%Y-%m-%dT%H:%MZ"),
                            "offset_days": round((s["when"] - when).total_seconds() / 86400, 1),
                            "cloud_pct": round(float(cloud[valid].mean() * 100), 1)}
            print(f"  optical {date}: {s['id']} ({chosen[date]['offset_days']:+.1f} d), cloud/shadow {chosen[date]['cloud_pct']}%")
            done = True
            break
        if not done:
            print(f"  optical {date}: no HLS scene within 8 days")
    note(work, "optical", {"name": "Harmonized Landsat and Sentinel-2 (HLS) surface reflectance v2.0 (HLSS30 / HLSL30)",
                           "provider": "NASA LP DAAC", "url": "https://doi.org/10.5067/HLS/HLSS30.002", "nasa": True, "dates": chosen})


# --------------------------------------------------------------------------- rain (GPM IMERG)
def stage_rain(cfg, grid, work):
    ea = earthdata_login()
    if not ea:
        print("  rain: SKIPPED - needs Earthdata login in ~/.netrc")
        return
    import h5py
    lon0, lat0, lon1, lat1 = grid.bbox_wgs84
    times = pass_times(cfg, work)
    session = ea.get_requests_https_session()
    out = work / "rain"
    out.mkdir(exist_ok=True)
    daily, product = {}, None
    days = sorted({(w - timedelta(days=k)).date() for w in times.values() for k in range(0, 7)})
    for short, cid in (("GPM_3IMERGDL", "C2723754859-GES_DISC"), ("GPM_3IMERGDE", "C2723754850-GES_DISC")):
        items = cmr(cid, temporal=f"{days[0]}T00:00:00Z,{days[-1]}T23:59:59Z")
        for it in items:
            day = it["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10]
            if day in daily or datetime.fromisoformat(day).date() not in days:
                continue
            url = next((r["URL"] for r in it["umm"].get("RelatedUrls", []) if r["URL"].startswith("https") and r["URL"].endswith(".nc4")), None)
            if not url:
                continue
            try:
                f = download(url, out / url.split("/")[-1], session)
                with h5py.File(f, "r") as h:
                    lon, lat = h["lon"][:], h["lat"][:]
                    ix = np.where((lon >= lon0 - 0.05) & (lon <= lon1 + 0.05))[0]
                    iy = np.where((lat >= lat0 - 0.05) & (lat <= lat1 + 0.05))[0]
                    name = "precipitation" if "precipitation" in h else "precipitationCal"
                    v = h[name][0][np.ix_(ix, iy)].astype("float64")       # (time, lon, lat), mm/day
                daily[day] = float(np.mean(v[v >= 0]))
                product = product or short
            except Exception as err:                      # noqa: BLE001
                print(f"    rain {day}: {err!r}")
    res = {}
    for date, when in times.items():
        need = [str((when - timedelta(days=k)).date()) for k in range(0, 7)]
        have = [daily[d] for d in need if d in daily]
        if len(have) >= 5:
            res[date] = {"mm_prev7d": round(sum(have) * 7 / len(have), 1), "days_available": len(have)}
            print(f"  rain {date}: {res[date]['mm_prev7d']} mm in the 7 days to the pass ({len(have)}/7 days)")
        else:
            print(f"  rain {date}: only {len(have)}/7 daily files available - left out")
    write_json(out / "daily_mm.json", daily)
    note(work, "rain", {"name": "GPM IMERG Late/Early Precipitation L3 1 day 0.1 degree V07", "provider": "NASA GES DISC",
                        "url": "https://doi.org/10.5067/GPM/IMERGDL/DAY/07", "nasa": True, "product": product, "dates": res})


STAGES = {"dem": stage_dem, "osm": stage_osm, "landcover": stage_landcover, "water": stage_water, "pop": stage_pop,
          "cband": stage_cband, "optical": stage_optical, "rain": stage_rain}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default=None)
    ap.add_argument("--only", default=",".join(STAGES))
    args = ap.parse_args()
    cfg = load_config(args.config)
    grid = grid_from_config(cfg)
    work = work_dir(cfg)
    for name in args.only.split(","):
        print(f"[{name}]")
        STAGES[name.strip()](cfg, grid, work)


if __name__ == "__main__":
    main()
