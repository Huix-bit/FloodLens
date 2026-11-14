"""Step 3 - flood detection by change detection against the pre-flood passes.

For every pass:
  * speckle-filter HH / HV (5x5 Lee filter on linear power), convert to dB
  * reference = per-pixel median of the OTHER pre-flood passes (config: reference_dates)
  * open-water flood      : HH below a water threshold AND a clear HH decrease vs reference
  * flooded vegetation    : tree / palm land cover AND a clear HH increase vs reference
                            (double bounce between water surface and trunks), with HH rising
                            at least as much as HV
  * masks                 : permanent water (JRC occurrence, WorldCover, OSM), ground too high
                            above the nearest drainage, no-data pixels
The water threshold comes from Otsu's method on a balanced water / land sample; the change
thresholds are the larger of the config value and 3 x the measured pass-to-pass noise. Every
value actually used is logged to <work_dir>/flood/detect.json.

The same open-water rule is applied to Sentinel-1 C-band (OPERA RTC-S1 VV) when available,
and an optical water test (NDWI on cloud-free HLS pixels) gives the "optical" figure.

Run from the repo root:   python pipeline/03_flood_detect.py [--config ...]
"""
from __future__ import annotations

import argparse
import json

import numpy as np
from scipy import ndimage as ndi

from common import grid_from_config, load_config, rasterize_lonlat, work_dir, write_json

DRY, PERM, OPEN, VEG, NODATA = 0, 1, 2, 3, 255
LC_WATER, LC_PALM, LC_FOREST = 1, 3, 5


def lee(img: np.ndarray, size: int = 5):
    """NaN-aware Lee speckle filter on linear power. Returns (filtered, estimated ENL)."""
    ok = np.isfinite(img)
    v = np.where(ok, img, 0.0).astype("float64")
    n = np.maximum(ndi.uniform_filter(ok.astype("float64"), size), 1e-6)
    mean = ndi.uniform_filter(v, size) / n
    var = np.maximum(ndi.uniform_filter(v * v, size) / n - mean * mean, 0)
    ci2 = var / np.maximum(mean * mean, 1e-20)
    sample = ci2[ok & (n > 0.99)]
    enl = float(np.clip(1.0 / max(np.percentile(sample, 25), 1e-6), 2, 80)) if sample.size else 10.0
    w = np.clip(1 - (1 / enl) / np.maximum(ci2, 1e-12), 0, 1)
    out = mean + w * (v - mean)
    out[~ok] = np.nan
    return out.astype("float32"), enl


def to_db(x):
    with np.errstate(divide="ignore", invalid="ignore"):
        return (10 * np.log10(x)).astype("float32")


def robust_sigma(x):
    x = x[np.isfinite(x)]
    if x.size < 100:
        return float("nan")
    return float(1.4826 * np.median(np.abs(x - np.median(x))))


def otsu_water(db_ref, water, land, lo, hi, fallback, rng):
    """Otsu threshold between water and land on a balanced sample; fallback if unusable."""
    from skimage.filters import threshold_otsu
    core = ndi.binary_erosion(water, iterations=2) & np.isfinite(db_ref)
    lnd = land & np.isfinite(db_ref)
    n = int(min(core.sum(), lnd.sum(), 40000))
    if n < 300:
        return fallback, f"config value (only {int(core.sum())} permanent-water pixels to sample)"
    a = rng.choice(db_ref[core], n, replace=False)
    b = rng.choice(db_ref[lnd], n, replace=False)
    t = float(threshold_otsu(np.concatenate([a, b])))
    if not lo <= t <= hi:
        return fallback, f"config value (Otsu gave {t:.1f} dB, outside {lo}..{hi})"
    return round(t, 2), f"Otsu on {n} water + {n} land pixels (water median {np.median(a):.1f} dB, land median {np.median(b):.1f} dB)"


def drop_small(mask, min_px):
    lab, n = ndi.label(mask, structure=np.ones((3, 3)))
    if n == 0:
        return mask
    size = ndi.sum(mask, lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = size >= min_px
    return keep[lab]


def reference(stack: dict, date: str, ref_dates: list[str]):
    """Median of the reference passes, leaving out the pass being tested."""
    use = [stack[d] for d in ref_dates if d in stack and d != date]
    if not use:
        return None
    return np.nanmedian(np.stack(use), axis=0).astype("float32") if len(use) > 1 else use[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default=None)
    args = ap.parse_args()
    cfg = load_config(args.config)
    grid = grid_from_config(cfg)
    work = work_dir(cfg)
    thr = cfg["thresholds"]
    rng = np.random.default_rng(7)
    out = work / "flood"
    out.mkdir(exist_ok=True)
    km2 = grid.pixel_km2

    import importlib
    anc = importlib.import_module("04_ancillary")
    lc = np.load(work / "landcover.npy")
    dem = np.load(work / "dem.npy")
    occ = np.load(work / "jrc_occurrence.npy") if (work / "jrc_occurrence.npy").exists() else np.zeros_like(dem)
    osm_water = rasterize_lonlat(anc.osm_polygons(work, "water"), grid)
    rivers = rasterize_lonlat([g for g, _ in anc.osm_lines(work, "water")], grid, all_touched=True)
    perm = (occ >= thr["permanent_water_occurrence"]) | (lc == LC_WATER) | osm_water
    drainage = perm | rivers
    if drainage.any():
        idx = ndi.distance_transform_edt(~drainage, return_distances=False, return_indices=True)
        hand = dem - dem[idx[0], idx[1]]
    else:
        hand = dem - np.percentile(dem, 2)
    low = hand <= thr["max_hand_m"]
    trees = np.isin(lc, (LC_PALM, LC_FOREST))
    land = ~perm
    np.save(out / "permanent_water.npy", perm)
    np.save(out / "hand.npy", hand.astype("float32"))

    dates = [d["date"] for d in cfg["dates"] if (work / "nisar" / f"{d['date']}.npz").exists()]
    if not dates:
        raise SystemExit("no NISAR subsets in work/nisar - run 02_fetch_subset.py")
    refs = [d for d in cfg.get("reference_dates", dates[:1]) if d in dates]
    log = {"reference_dates": refs, "permanent_water_km2": round(float(perm.sum() * km2), 2),
           "config_thresholds": thr, "lband": {}, "cband": {}, "optical": {}, "per_date": {}}

    # ----------------------------------------------------------------- L-band (NISAR)
    hh, hv, enl = {}, {}, {}
    for d in dates:
        z = np.load(work / "nisar" / f"{d}.npz")
        f, enl[d] = lee(z["hh"])
        hh[d] = to_db(f)
        hv[d] = to_db(lee(z["hv"])[0]) if np.isfinite(z["hv"]).any() else None
        np.save(out / f"lband_db_{d}.npy", hh[d])
    ref_all = reference(hh, "", refs)
    t_low, why = otsu_water(ref_all, perm, land, -27, -13, thr["open_water_hh_db"], rng)
    # pass-to-pass noise of the change image, measured between the pre-flood passes themselves
    noise_land, noise_veg = [], []
    for d in refs:
        r = reference(hh, d, refs)
        if r is not None:
            noise_land.append(robust_sigma((hh[d] - r)[land & ~trees]))
            noise_veg.append(robust_sigma((hh[d] - r)[land & trees]))
    s_land = float(np.nanmedian(noise_land)) if noise_land else float("nan")
    s_veg = float(np.nanmedian(noise_veg)) if noise_veg else float("nan")
    drop = max(thr["open_water_drop_db"], 3 * s_land) if np.isfinite(s_land) else thr["open_water_drop_db"]
    rise = max(thr["flooded_veg_rise_db"], 3 * s_veg) if np.isfinite(s_veg) else thr["flooded_veg_rise_db"]
    log["lband"] = {"speckle_filter": "Lee 5x5 on linear power", "enl_estimate": {d: round(v, 1) for d, v in enl.items()},
                    "open_water_hh_db": t_low, "open_water_hh_db_source": why,
                    "noise_sigma_db": {"non_tree_land": round(s_land, 2), "tree_cover": round(s_veg, 2)},
                    "open_water_drop_db": round(drop, 2), "flooded_veg_rise_db": round(rise, 2),
                    "rule_note": "change thresholds = max(config value, 3 x noise sigma)"}
    print(f"L-band: water threshold {t_low} dB [{why}]")
    print(f"        noise sigma land {s_land:.2f} dB, trees {s_veg:.2f} dB -> drop {drop:.2f} dB, rise {rise:.2f} dB")

    flood = {}
    for d in dates:
        r = reference(hh, d, refs)
        cur = hh[d]
        nod = ~np.isfinite(cur)
        cls = np.zeros(cur.shape, dtype="uint8")
        if r is not None:
            delta = cur - r
            open_w = (cur < t_low) & (delta < -drop) & land & low
            veg = trees & (delta > rise) & land & low
            if hv[d] is not None:
                rv = reference({k: v for k, v in hv.items() if v is not None}, d, refs)
                if rv is not None:
                    veg &= (delta >= (hv[d] - rv)) | ~np.isfinite(hv[d] - rv)
            both = drop_small(open_w | veg, thr.get("min_patch_px", 12))
            cls[veg & both] = VEG
            cls[open_w & both] = OPEN
            np.save(out / f"delta_hh_{d}.npy", delta.astype("float32"))
        cls[perm] = PERM
        cls[nod] = NODATA
        flood[d] = cls
        np.save(out / f"flood_{d}.npy", cls)
        log["per_date"][d] = {"open_flood_km2": round(float((cls == OPEN).sum() * km2), 2),
                              "veg_flood_km2": round(float((cls == VEG).sum() * km2), 2),
                              "nodata_pct": round(float(nod.mean() * 100), 2),
                              "is_reference": d in refs,
                              "detected_km2": {"lband": round(float(((cls == OPEN) | (cls == VEG)).sum() * km2), 2)}}
        print(f"  {d}: open {log['per_date'][d]['open_flood_km2']} km2, under canopy {log['per_date'][d]['veg_flood_km2']} km2"
              f"{'  (reference pass: this is the false-alarm level)' if d in refs else ''}")

    # ----------------------------------------------------------------- C-band (Sentinel-1)
    cb = {}
    for d in dates:
        p = work / "cband" / f"{d}.npy"
        if p.exists():
            cb[d] = to_db(lee(np.load(p))[0])
            np.save(out / f"cband_db_{d}.npy", cb[d])
    if cb:
        crefs = [d for d in refs if d in cb]
        cref = reference(cb, "", crefs)
        if cref is not None:
            ct, cwhy = otsu_water(cref, perm, land, -27, -12, thr["open_water_hh_db"], rng)
            cs = [robust_sigma((cb[d] - reference(cb, d, crefs))[land]) for d in crefs if reference(cb, d, crefs) is not None]
            cs = float(np.nanmedian(cs)) if cs else float("nan")
            cdrop = max(thr["open_water_drop_db"], 3 * cs) if np.isfinite(cs) else thr["open_water_drop_db"]
            log["cband"] = {"polarization": "VV", "open_water_db": ct, "open_water_db_source": cwhy,
                            "noise_sigma_db": round(cs, 2), "open_water_drop_db": round(cdrop, 2)}
            print(f"C-band: water threshold {ct} dB [{cwhy}], drop {cdrop:.2f} dB")
            for d in cb:
                r = reference(cb, d, crefs)
                if r is None:
                    continue
                m = drop_small((cb[d] < ct) & ((cb[d] - r) < -cdrop) & land & low, thr.get("min_patch_px", 12))
                np.save(out / f"cband_open_{d}.npy", m)
                log["per_date"][d]["detected_km2"]["cband"] = round(float(m.sum() * km2), 2)
                # how much of the NISAR under-canopy flood does C-band also flag?
                v = flood[d] == VEG
                log["per_date"][d]["cband_sees_pct_of_veg_flood"] = round(float((m & v).sum() / max(v.sum(), 1) * 100), 1)
                print(f"  {d}: C-band open-water flood {log['per_date'][d]['detected_km2']['cband']} km2")

    # ----------------------------------------------------------------- optical (HLS)
    for d in dates:
        p = work / "optical" / f"{d}.npz"
        if not p.exists():
            continue
        z = np.load(p)
        fm, rgbn = z["fmask"], z["rgb"]
        valid = fm != 255
        cloud = ((fm & 0b00001110) > 0) & valid                      # cloud, adjacent to cloud, cloud shadow
        clear = valid & ~cloud
        if rgbn.shape[0] >= 4:
            g, nir = rgbn[1], rgbn[3]
            with np.errstate(divide="ignore", invalid="ignore"):
                ndwi = (g - nir) / (g + nir)
            water = clear & (ndwi > 0.0) & np.isfinite(ndwi)
        else:
            water = clear & ((fm & 0b00100000) > 0)
        m = drop_small(water & land & low, thr.get("min_patch_px", 12))
        np.save(out / f"optical_water_{d}.npy", m)
        log["per_date"][d]["detected_km2"]["optical"] = round(float(m.sum() * km2), 2)
        log["per_date"][d]["optical_cloud_pct"] = round(float(cloud.sum() / max(valid.sum(), 1) * 100), 1)
        print(f"  {d}: optical sees {log['per_date'][d]['detected_km2']['optical']} km2 of non-permanent water, "
              f"cloud/shadow {log['per_date'][d]['optical_cloud_pct']}%")
    log["optical"] = {"rule": "NDWI (green, NIR) > 0 on HLS pixels that Fmask marks free of cloud, cloud-adjacent and shadow; "
                              "permanent water removed"}
    write_json(out / "detect.json", log)
    print(f"wrote {out / 'detect.json'}")


if __name__ == "__main__":
    main()
