"""Milestone 1 - write a complete SIMULATED web/data/ in the exact contract format.

Everything here is synthetic (procedural terrain, river, land cover, flood, backscatter,
clouds, buildings, places). It exists so the frontend never waits for real data, and so the
contract can be tested end to end. manifest.json carries "simulated": true and the app shows
a SIMULATED badge. The real pipeline (01-06) overwrites these files with the same names.

Run from the repo root:   python pipeline/00_mock_data.py [--config pipeline/config.yaml]
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from common import ROOT, Grid, grid_from_config, load_config, write_json

# Land-cover codes (contract)
OTHER, WATER, URBAN, PALM, CROP, FOREST = 0, 1, 2, 3, 4, 5
# Flood codes (contract)
DRY, PERM, OPEN, VEG, NODATA = 0, 1, 2, 3, 255


# --------------------------------------------------------------------------- noise helpers
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def smooth_noise(rng, shape, sigma):
    """Unit-variance Gaussian-smoothed noise. Large sigmas are built at 1/8 scale."""
    f = 8 if sigma >= 16 else 1
    small = (math.ceil(shape[0] / f) + 2, math.ceil(shape[1] / f) + 2)
    n = ndi.gaussian_filter(rng.standard_normal(small).astype(np.float32), sigma / f, mode="reflect")
    if f > 1:
        n = ndi.zoom(n, f, order=3)[f : f + shape[0], f : f + shape[1]]
    else:
        n = n[1 : 1 + shape[0], 1 : 1 + shape[1]]
    return (n - n.mean()) / (n.std() + 1e-9)


def fbm(rng, shape, sigmas, weights):
    out = np.zeros(shape, np.float32)
    for s, w in zip(sigmas, weights):
        out += w * smooth_noise(rng, shape, s)
    return out / math.sqrt(sum(w * w for w in weights))


# --------------------------------------------------------------------------- world
def river_centre(rows, width):
    """Column of the main river centreline for each row (river flows south -> north)."""
    return (
        width * 0.50
        + 105 * np.sin(rows / 150 + 0.6)
        + 42 * np.sin(rows / 52 + 2.1)
        + 14 * np.sin(rows / 23 + 0.4)
    )


SETTLEMENTS = [
    # name, kind, row, offset east of river centre (px), radius (px)
    ("Bandar Contoh", "town", 430, 62, 50),
    ("Kg. Contoh Hulu", "village", 880, 48, 15),
    ("Kg. Contoh Hilir", "village", 110, 44, 16),
    ("Kg. Tanjung Contoh", "village", 640, -52, 14),
    ("Kg. Padang Contoh", "village", 250, -58, 15),
    ("Kg. Kuala Contoh", "village", 585, 70, 13),
    ("Kg. Bukit Contoh", "village", 760, 150, 13),
    ("Ladang Contoh Utara", "village", 330, -170, 11),
    ("Ladang Contoh Selatan", "village", 720, -160, 11),
    ("Kg. Sungai Contoh", "village", 520, 300, 12),
]


def build_world(grid: Grid, rng):
    h, w, px = grid.height, grid.width, grid.pixel_m
    rows, cols = np.mgrid[0:h, 0:w].astype(np.float32)
    xc = river_centre(rows, w)

    main = np.abs(cols - xc) < 5.5 + 1.5 * np.sin(rows / 70)
    trib_row = 610 + 55 * np.sin(cols / 85.0) - (cols - 0.5 * w) * 0.12
    trib = (np.abs(rows - trib_row) < 1.8) & (cols > xc)
    river = main | trib

    bed = 16 + 9 * rows / h + np.where(trib & ~main, 0.012 * np.clip(cols - xc, 0, None), 0)
    dist_px, (ir, ic) = ndi.distance_transform_edt(~river, return_indices=True)
    z_near = bed[ir, ic].astype(np.float32)
    d = (dist_px * px).astype(np.float32)

    dw = d * (1 + 0.35 * fbm(rng, (h, w), [90, 45], [1, 0.5]))
    micro = 0.8 * fbm(rng, (h, w), [14, 6], [1, 0.5]) + 1.2 * smooth_noise(rng, (h, w), 45)
    levee = 1.1 * np.exp(-(((d - 150) / 120) ** 2))
    floodplain = z_near + 0.6 + 2.6 * (1 - np.exp(-d / 900)) + 0.0009 * d + micro + levee
    rough = np.clip(fbm(rng, (h, w), [70, 35, 18, 9], [1, 0.5, 0.25, 0.12]) * 0.9 + 0.5, 0, 1.7)
    hills = (30 + 260 * smoothstep(1800, 9000, dw)) * (0.5 + 0.5 * rough)
    dem = floodplain + smoothstep(1100, 3200, dw) * hills

    places, urban = [], np.zeros((h, w), bool)
    warp = 1 + 0.25 * smooth_noise(rng, (h, w), 10)
    for name, kind, r0, off, rad in SETTLEMENTS:
        c0 = float(river_centre(np.float32(r0), w)) + off
        rr = np.hypot(rows - r0, cols - c0)
        urban |= rr < rad * warp
        dem += (1.6 if kind == "town" else 0.9) * np.exp(-((rr / (rad * 1.2)) ** 2))  # settlement mound
        places.append({"name": name, "kind": kind, "row": r0, "col": c0, "radius": rad})

    dem = np.where(river, z_near, np.maximum(dem, z_near + 0.3)).astype(np.float32)
    hand = dem - z_near
    urban &= ~river & (hand > 0.6)

    gy, gx = np.gradient(dem, px)
    slope = np.hypot(gx, gy)

    palm_field = fbm(rng, (h, w), [60, 25], [1, 0.5])
    palm = (palm_field > -0.25) & (hand > 0.8) & (hand < 70) & (d > 240) & (slope < 0.14) & ~urban & ~river
    palm = ndi.binary_opening(palm, iterations=2)
    clearing = (smooth_noise(rng, (h, w), 7) > 2.0) & (hand > 12)

    lc = np.full((h, w), FOREST, np.uint8)
    lc[(hand < 9) & ~palm] = CROP
    lc[palm] = PALM
    lc[clearing & ~palm] = OTHER
    lc[urban] = URBAN
    lc[river] = WATER

    nodata = (gx > 0.62) | ((rows + (w - 1 - cols)) < 56)  # layover on steep west faces + swath edge
    nodata &= ~river

    return {
        "dem": dem, "hand": hand, "lc": lc, "river": river, "nodata": nodata,
        "gx": gx, "gy": gy, "places": places, "d": d,
    }


def flood_classes(world, stage, rng):
    """Bathtub flood on height-above-nearest-drainage, kept only where connected to the river."""
    hand, lc, river = world["hand"], world["lc"], world["river"]
    wet = (hand < stage + 0.45 * min(1.0, stage) * smooth_noise(rng, hand.shape, 9)) | river
    labels, _ = ndi.label(wet)
    keep = np.zeros(labels.max() + 1, bool)
    keep[np.unique(labels[river])] = True
    flooded = keep[labels] & ~river
    out = np.zeros(hand.shape, np.uint8)
    out[flooded & ~np.isin(lc, (PALM, FOREST))] = OPEN
    out[flooded & np.isin(lc, (PALM, FOREST))] = VEG
    out[river] = PERM
    out[world["nodata"]] = NODATA
    return out


# --------------------------------------------------------------------------- imagery
def hillshade(world):
    lx, ly, lz = -0.5, -0.45, 0.74  # sun from the north-west
    gx, gy = world["gx"] * 2.5, world["gy"] * 2.5
    shade = (-gx * lx - gy * ly + lz) / np.sqrt(gx**2 + gy**2 + 1)
    return np.clip(0.35 + 0.85 * shade, 0.45, 1.25).astype(np.float32)


def speckle_db(rng, shape, looks=6):
    return (10 * np.log10(rng.gamma(looks, 1 / looks, shape))).astype(np.float32)


def stretch(db, lo, hi):
    return np.clip((db - lo) / (hi - lo) * 255 + 0.5, 0, 255).astype(np.uint8)


def backscatter(world, flood, rng, band, date_idx):
    """Synthetic backscatter (dB). The only band-dependent physics that matters for the story:
    C-band is unchanged over flooded canopy; L-band HH brightens by ~5 dB (double bounce)."""
    lc = world["lc"]
    base_c = {OTHER: -11.0, WATER: -21.0, URBAN: -5.0, PALM: -8.5, CROP: -12.5, FOREST: -7.5}
    base_l = {OTHER: -14.0, WATER: -22.0, URBAN: -4.5, PALM: -10.0, CROP: -17.0, FOREST: -8.5}
    base = base_c if band == "c" else base_l
    db = np.zeros(lc.shape, np.float32)
    for code, val in base.items():
        db[lc == code] = val
    wet_soil = (0.0, 1.4, 0.9, 0.3)[min(date_idx, 3)]
    db[np.isin(lc, (CROP, OTHER))] += wet_soil
    db[flood == OPEN] = -20.0 if band == "c" else -21.0
    if band == "l":
        db[(flood == VEG) & (lc == PALM)] += 5.5
        db[(flood == VEG) & (lc == FOREST)] += 3.5
    else:
        db[flood == VEG] += 0.3
    scat = rng.random(lc.shape) < 0.09
    db[(lc == URBAN) & scat] += 4.0  # corner reflectors
    db += -6.0 * np.clip(world["gx"], -0.6, 0.6)  # slopes facing the radar are brighter
    db += 0.6 * smooth_noise(rng, lc.shape, 5)
    db = ndi.uniform_filter(db, 2)  # soften class edges like a multilooked product
    return db + speckle_db(rng, lc.shape)


def optical_image(world, flood, cloud_frac, rng, tex):
    lc = world["lc"]
    rgb = np.zeros(lc.shape + (3,), np.float32)
    colours = {
        OTHER: (172, 142, 106), WATER: (116, 108, 82), URBAN: (166, 160, 150),
        PALM: (50, 92, 44), CROP: (138, 160, 88), FOREST: (34, 74, 40),
    }
    for code, c in colours.items():
        rgb[lc == code] = c
    rgb[lc == PALM] *= (1 + 0.10 * tex["rows"])[lc == PALM, None]
    rgb[lc == CROP] *= (0.86 + 0.28 * tex["fields"])[lc == CROP, None]
    roofs = (lc == URBAN) & (tex["fine"] > 0.9)
    rgb[roofs] = (176, 96, 74)
    rgb *= (1 + 0.07 * tex["fine"])[..., None]
    mud = np.array((150, 126, 92), np.float32) * (1 + 0.04 * tex["fine"])[..., None]
    edge = ndi.uniform_filter((flood == OPEN).astype(np.float32), 3)[..., None]
    rgb = rgb * (1 - edge) + mud * edge  # muddy open water; canopy over flooded palms is unchanged
    rgb *= hillshade(world)[..., None]

    field = fbm(rng, lc.shape, [70, 30, 12, 5], [1, 0.6, 0.35, 0.2])
    thr = np.quantile(field, 1 - cloud_frac)
    alpha = np.clip((field - thr) / 0.22 + 0.5, 0, 1)
    shadow = np.roll(alpha, (14, 9), axis=(0, 1))
    rgb *= (1 - 0.42 * shadow * (1 - alpha))[..., None]
    rgb *= 1 - 0.22 * cloud_frac  # overcast scenes are darker
    white = (236 + 16 * smooth_noise(rng, lc.shape, 6))[..., None]
    rgb = rgb * (1 - alpha[..., None]) + white * alpha[..., None]
    return np.clip(rgb, 0, 255).astype(np.uint8), alpha > 0.5


def encode_dem(dem):
    v = np.round((dem.astype(np.float64) + 10000) * 10).astype(np.uint32)
    return np.dstack([(v >> 16) & 255, (v >> 8) & 255, v & 255]).astype(np.uint8)


# --------------------------------------------------------------------------- vectors
def make_roads(world, grid):
    """Polylines in pixel coords (row, col), sampled every 10 m by the exposure step."""
    h, w = grid.height, grid.width
    r = np.arange(0, h, 2, dtype=np.float32)
    xc = river_centre(r, w)
    east = np.column_stack([r, xc + 46 + 8 * np.sin(r / 40)])
    west = np.column_stack([r, xc - 60 + 10 * np.sin(r / 55 + 1)])
    roads = [east, west]
    for p in world["places"]:
        side = east if p["col"] > float(river_centre(np.float32(p["row"]), w)) else west
        k = int(np.argmin(np.abs(side[:, 0] - p["row"])))
        roads.append(np.array([side[k], [p["row"], p["col"]]], np.float32))
    k = int(np.argmin(np.abs(east[:, 0] - 430)))
    roads.append(np.array([west[k], east[k]], np.float32))  # bridge at the town
    c = np.arange(float(east[305, 1]), w, 2, dtype=np.float32)
    roads.append(np.column_stack([596 + 55 * np.sin(c / 85.0) - (c - 0.5 * w) * 0.12, c]))  # along tributary
    return roads


def sample_roads(roads, grid, step_m=10.0):
    pts = []
    for line in roads:
        seg = np.diff(line, axis=0)
        seg_len = np.hypot(seg[:, 0], seg[:, 1]) * grid.pixel_m
        for a, s, length in zip(line[:-1], seg, seg_len):
            n = max(1, int(length / step_m))
            t = (np.arange(n) + 0.5) / n
            pts.append(np.column_stack([a[0] + s[0] * t, a[1] + s[1] * t, np.full(n, length / n)]))
    pts = np.vstack(pts)
    ok = (pts[:, 0] >= 0) & (pts[:, 0] < grid.height) & (pts[:, 1] >= 0) & (pts[:, 1] < grid.width)
    return pts[ok]


def make_facilities(world, rng):
    out = []
    for p in world["places"]:
        kinds = (["school"] * 3 + ["clinic", "mosque", "mosque", "police"]) if p["kind"] == "town" \
            else ["mosque"] + (["school"] if p["radius"] >= 13 else []) + (["clinic"] if p["radius"] >= 15 else [])
        for kind in kinds:
            ang, rad = rng.uniform(0, 2 * math.pi), p["radius"] * 0.6 * math.sqrt(rng.uniform())
            out.append((kind, p["row"] + rad * math.sin(ang), p["col"] + rad * math.cos(ang)))
    return out


def make_buildings(world, grid, rng):
    urban_r, urban_c = np.nonzero(world["lc"] == URBAN)
    pick = rng.choice(len(urban_r), size=min(2400, len(urban_r) // 5), replace=False)
    town = next(p for p in world["places"] if p["kind"] == "town")
    feats = []
    for r, c in zip(urban_r[pick], urban_c[pick]):
        r, c = r + rng.uniform(), c + rng.uniform()
        wm, dm = rng.uniform(8, 22), rng.uniform(7, 15)
        ang = math.radians(18) + rng.normal(0, 0.12) + (math.pi / 2 if rng.random() < 0.5 else 0)
        central = math.hypot(r - town["row"], c - town["col"]) < town["radius"] * 0.45
        height = rng.uniform(7, 22) if central and rng.random() < 0.5 else rng.uniform(3.5, 8)
        cx, cy = grid.px_to_utm(c, r)
        ca, sa = math.cos(ang), math.sin(ang)
        ring = []
        for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1)):
            x = cx + dx * wm / 2 * ca - dy * dm / 2 * sa
            y = cy + dx * wm / 2 * sa + dy * dm / 2 * ca
            lon, lat = grid_lonlat(grid, x, y)
            ring.append([lon, lat])
        feats.append({
            "type": "Feature",
            "properties": {"height_m": round(height, 1), "height_estimated": bool(rng.random() < 0.85)},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    return {"type": "FeatureCollection", "features": feats}


def grid_lonlat(grid, x, y):
    from common import utm_to_lonlat
    lon, lat = utm_to_lonlat(x, y, grid.epsg)
    return round(float(lon), 6), round(float(lat), 6)


def make_places(world, grid):
    feats = []
    for p in world["places"]:
        lon, lat = grid.px_to_lonlat(p["col"], p["row"])
        feats.append({
            "type": "Feature",
            "properties": {"name": p["name"], "place": p["kind"]},
            "geometry": {"type": "Point", "coordinates": [round(float(lon), 6), round(float(lat), 6)]},
        })
    return {"type": "FeatureCollection", "features": feats}


# --------------------------------------------------------------------------- exposure
def hex_index(grid, flat_to_flat):
    """Assign every pixel to a pointy-top hexagon. Returns (hex id per pixel, list of centres)."""
    size = flat_to_flat / math.sqrt(3)
    rows, cols = np.mgrid[0:grid.height, 0:grid.width]
    x = (cols + 0.5) * grid.pixel_m
    y = (rows + 0.5) * grid.pixel_m
    q = (math.sqrt(3) / 3 * x - y / 3) / size
    r = (2 / 3 * y) / size
    s = -q - r
    rq, rr, rs = np.round(q), np.round(r), np.round(s)
    dq, dr, ds = np.abs(rq - q), np.abs(rr - r), np.abs(rs - s)
    fix_q = (dq > dr) & (dq > ds)
    fix_r = ~fix_q & (dr > ds)
    rq = np.where(fix_q, -rr - rs, rq)
    rr = np.where(fix_r, -rq - rs, rr)
    cx = size * math.sqrt(3) * (rq + rr / 2)
    cy = size * 1.5 * rr
    inside = (cx >= 0) & (cx <= grid.width * grid.pixel_m) & (cy >= 0) & (cy <= grid.height * grid.pixel_m)
    key = (rr.astype(np.int64) + 1000) * 100000 + (rq.astype(np.int64) + 50000)
    key[~inside] = -1
    uniq = np.unique(key[key >= 0])  # sorted north->south, then west->east
    idx = np.searchsorted(uniq, key)
    idx[key < 0] = -1
    rr_u = uniq // 100000 - 1000
    rq_u = uniq % 100000 - 50000
    centres = np.column_stack([size * math.sqrt(3) * (rq_u + rr_u / 2), size * 1.5 * rr_u])
    return idx, centres, size


def exposure(world, grid, floods, dates, cfg, roads_pts, facilities):
    idx, centres, size = hex_index(grid, cfg["exposure"]["hex_flat_to_flat_m"])
    n = len(centres)
    flat = idx.ravel()
    ok = flat >= 0
    density = {OTHER: 20, WATER: 0, URBAN: 3400, PALM: 15, CROP: 70, FOREST: 2}  # people / km2 (mock)
    pop = np.zeros(world["lc"].shape, np.float32)
    for code, dens in density.items():
        pop[world["lc"] == code] = dens * grid.pixel_km2

    rp_r, rp_c = roads_pts[:, 0].astype(int), roads_pts[:, 1].astype(int)
    rp_hex, rp_km = idx[rp_r, rp_c], roads_pts[:, 2] / 1000
    fac_rc = [(int(r), int(c)) for _, r, c in facilities]

    m = {k: {} for k in ("flood_frac", "people", "roads_km", "facilities")}
    for date, flood in zip(dates, floods):
        wet = (flood == OPEN) | (flood == VEG)
        valid = np.bincount(flat[ok], (flood != NODATA).ravel()[ok], n)
        m["flood_frac"][date] = np.bincount(flat[ok], wet.ravel()[ok], n) / np.maximum(valid, 1)
        m["people"][date] = np.bincount(flat[ok], (pop * wet).ravel()[ok], n)
        hit = wet[rp_r, rp_c] & (rp_hex >= 0)
        m["roads_km"][date] = np.bincount(rp_hex[hit], rp_km[hit], n)
        fac = np.zeros(n)
        for r, c in fac_rc:
            if wet[r, c] and idx[r, c] >= 0:
                fac[idx[r, c]] += 1
        m["facilities"][date] = fac

    wts = cfg["exposure"]["weights"]
    peak = {k: max(float(max(v.max() for v in m[k].values())), 1e-9) for k in m}
    peak["flood_frac"] = 1.0
    score, rank = {}, {}
    for date in dates:
        s = 100 * sum(wts[k] * m[k][date] / peak[k] for k in m)
        score[date] = s
        order = np.argsort(-s, kind="stable")
        rk = np.zeros(n, int)
        rk[order] = np.arange(1, n + 1)
        rank[date] = np.where(s > 0, rk, 0)

    place_xy = np.array([[p["col"] * grid.pixel_m, p["row"] * grid.pixel_m] for p in world["places"]])
    feats = []
    for i, (cx, cy) in enumerate(centres):
        ring = []
        for k in range(7):
            ang = math.radians(60 * k + 30)
            lon, lat = grid_lonlat(grid, grid.xmin + cx + size * math.cos(ang), grid.ymax - (cy + size * math.sin(ang)))
            ring.append([lon, lat])
        near = world["places"][int(np.argmin(np.hypot(*(place_xy - (cx, cy)).T)))]["name"]
        props = {"id": f"H{i + 1:04d}", "name": near}
        props["flood_frac"] = {d: round(float(m["flood_frac"][d][i]), 3) for d in dates}
        props["people"] = {d: int(round(float(m["people"][d][i]))) for d in dates}
        props["roads_km"] = {d: round(float(m["roads_km"][d][i]), 2) for d in dates}
        props["facilities"] = {d: int(m["facilities"][d][i]) for d in dates}
        props["score"] = {d: round(float(score[d][i]), 1) for d in dates}
        props["rank"] = {d: (int(rank[d][i]) or None) for d in dates}
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [ring]}})

    totals = {
        d: {
            "people_exposed": int(round(float(m["people"][d].sum()))),
            "roads_flooded_km": round(float(m["roads_km"][d].sum()), 1),
            "facilities_affected": int(m["facilities"][d].sum()),
        }
        for d in dates
    }
    return {"type": "FeatureCollection", "features": feats}, totals


# --------------------------------------------------------------------------- sources
def sources():
    """Datasets the real pipeline uses. In this mock build none of them has been read yet."""
    s = [
        ("NISAR L2 GCOV (L-band HH/HV)", "NASA / ISRO via ASF DAAC", "https://search.asf.alaska.edu/", "L-band mode, flood and flooded-vegetation detection", True),
        ("HLS v2.0 (HLSL30 / HLSS30)", "NASA LP DAAC", "https://doi.org/10.5067/HLS/HLSS30.002", "Optical mode, cloud cover %", True),
        ("OPERA RTC-S1 / DSWx-S1 (from Copernicus Sentinel-1)", "NASA JPL OPERA via ASF DAAC / PO.DAAC; ESA Copernicus", "https://www.jpl.nasa.gov/go/opera", "C-band mode, open-water flood", True),
        ("NASADEM HGT v001", "NASA LP DAAC", "https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001", "3D terrain, high-ground mask", True),
        ("GPM IMERG Final Daily V07", "NASA GES DISC", "https://doi.org/10.5067/GPM/IMERGDF/DAY/07", "7-day rainfall before each pass", True),
        ("GPW v4.11 Population Count", "NASA SEDAC (CIESIN)", "https://doi.org/10.7927/H4JW8BX5", "People exposed per hexagon", True),
        ("ESA WorldCover 10 m v200", "ESA", "https://doi.org/10.5281/zenodo.7254221", "Land cover classes", False),
        ("Global oil palm map 2019 (Descals et al., 2021)", "ESSD / Zenodo", "https://doi.org/10.5194/essd-13-1211-2021", "Oil palm / tree-crop class", False),
        ("JRC Global Surface Water v1.4", "EC JRC / Google", "https://global-surface-water.appspot.com/", "Permanent water mask", False),
        ("OpenStreetMap", "OpenStreetMap contributors (ODbL)", "https://www.openstreetmap.org/copyright", "Buildings, places, roads, facilities", False),
    ]
    return [
        {"name": n, "provider": p, "url": u, "used_for": f, "nasa": nasa, "simulated": True}
        for n, p, u, f, nasa in s
    ]


# --------------------------------------------------------------------------- main
def save(arr, path, mode=None):
    Image.fromarray(arr, mode).save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default=None)
    args = ap.parse_args()
    cfg = load_config(args.config)
    grid = grid_from_config(cfg)
    mock = cfg["mock"]
    dates = [d["date"] for d in cfg["dates"]]
    for key in ("flood_stage_m", "cloud_fraction", "rain_mm_prev7d"):
        if len(mock[key]) < len(dates):
            raise SystemExit(f"config mock.{key} needs one value per date ({len(dates)})")

    out = ROOT / cfg["paths"]["web_data"]
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*"):
        if old.suffix in (".png", ".json", ".geojson"):
            old.unlink()

    rng = np.random.default_rng(mock["seed"])
    shape = (grid.height, grid.width)
    print(f"grid {grid.width}x{grid.height} @ {grid.pixel_m} m  EPSG:{grid.epsg}  bbox {grid.bbox_wgs84}")
    world = build_world(grid, rng)
    save(encode_dem(world["dem"]), out / "dem.png")
    save(world["lc"], out / "landcover.png")

    rows, cols = np.mgrid[0:shape[0], 0:shape[1]]
    tex = {
        "rows": np.sin((cols * 0.94 + rows * 0.34) * 2 * math.pi / 3.2).astype(np.float32),
        "fields": np.kron(rng.random((shape[0] // 16 + 1, shape[1] // 16 + 1)), np.ones((16, 16)))[: shape[0], : shape[1]].astype(np.float32),
        "fine": rng.random(shape).astype(np.float32),
    }
    lo_c, hi_c = cfg["stretch_db"]["cband"]
    lo_l, hi_l = cfg["stretch_db"]["lband"]

    floods, date_entries, stats = [], [], {}
    for i, d in enumerate(cfg["dates"]):
        date = d["date"]
        flood = flood_classes(world, mock["flood_stage_m"][i], rng)
        floods.append(flood)
        c_db = backscatter(world, flood, rng, "c", i)
        l_db = backscatter(world, flood, rng, "l", i)
        opt, cloud = optical_image(world, flood, mock["cloud_fraction"][i], rng, tex)
        save(opt, out / f"optical_{date}.png")
        save(stretch(c_db, lo_c, hi_c), out / f"cband_{date}.png")
        save(stretch(l_db, lo_l, hi_l), out / f"lband_{date}.png")
        save(flood, out / f"flood_{date}.png")

        km2 = grid.pixel_km2
        open_px, veg_px = flood == OPEN, flood == VEG
        c_detect = open_px & (ndi.uniform_filter(c_db, 3) < -15.5)
        stats[date] = {
            "open_flood_km2": round(float(open_px.sum() * km2), 2),
            "veg_flood_km2": round(float(veg_px.sum() * km2), 2),
            "detected_km2": {
                "optical": round(float((open_px & ~cloud).sum() * km2), 2),
                "cband": round(float(c_detect.sum() * km2), 2),
                "lband": round(float((open_px | veg_px).sum() * km2), 2),
            },
        }
        date_entries.append({
            "date": date, "label": d["label"], "nisar_track": "TBD",
            "optical": f"optical_{date}.png",
            "optical_cloud_pct": round(float(cloud.mean() * 100), 1),
            "cband": f"cband_{date}.png", "lband": f"lband_{date}.png", "flood": f"flood_{date}.png",
            "rain_mm_prev7d": float(mock["rain_mm_prev7d"][i]),
        })
        print(f"  {date} {d['label']:<11} open {stats[date]['open_flood_km2']:6.1f} km2  "
              f"veg {stats[date]['veg_flood_km2']:6.1f} km2  cloud {date_entries[-1]['optical_cloud_pct']:.0f}%")

    roads_pts = sample_roads(make_roads(world, grid), grid)
    hexes, totals = exposure(world, grid, floods, dates, cfg, roads_pts, make_facilities(world, rng))
    for date in dates:
        stats[date].update(totals[date])

    write_json(out / "stats.json", {"per_date": stats})
    write_json(out / "hexes.geojson", hexes, compact=True)
    write_json(out / "buildings.geojson", make_buildings(world, grid, rng), compact=True)
    write_json(out / "places.geojson", make_places(world, grid))
    write_json(out / "manifest.json", {
        "title": cfg["title"] + " (SIMULATED)",
        "simulated": True,
        "crs": f"EPSG:{grid.epsg}",
        "bbox_utm": grid.bbox_utm,
        "bbox_wgs84": grid.bbox_wgs84,
        "grid": {"width": grid.width, "height": grid.height, "pixel_m": grid.pixel_m},
        "dem": "dem.png",
        "landcover": "landcover.png",
        "dates": date_entries,
        "stats": "stats.json",
        "hexes": "hexes.geojson",
        "buildings": "buildings.geojson",
        "places": "places.geojson",
        "sources": sources(),
        # Optional extensions (the frontend works without them):
        "stretch_db": cfg["stretch_db"],
        "exposure_weights": cfg["exposure"]["weights"],
    })
    size = sum(f.stat().st_size for f in out.iterdir()) / 1e6
    print(f"wrote {len(list(out.iterdir()))} files, {size:.1f} MB -> {out}")
    print(f"  hexes {len(hexes['features'])}  nodata {world['nodata'].mean() * 100:.2f}%  "
          f"palm {np.mean(world['lc'] == PALM) * 100:.0f}%  urban {np.mean(world['lc'] == URBAN) * 100:.1f}%")


if __name__ == "__main__":
    main()
