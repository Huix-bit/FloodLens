"""Step 2 - read ONLY the AOI window of each NISAR GCOV granule, straight from NASA's archive.

The GCOV HDF5 file (several GB) is opened remotely with h5py over authenticated HTTPS range
requests; only the chunks that cover the AOI are transferred. The HH and HV backscatter
(gamma0, linear power) are multilooked and resampled to the shared AOI grid and cached as
<work_dir>/nisar/<date>.npz.

Needs a NASA Earthdata login in ~/.netrc (machine urs.earthdata.nasa.gov login ... password ...).

Run from the repo root:   python pipeline/02_fetch_subset.py [--config ...] [--inspect] [--force]
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np

from common import HttpRangeFile, earthdata_login, grid_from_config, load_config, warp_to_grid, work_dir, write_json


def text(v):
    v = v[()] if hasattr(v, "shape") else v
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    if isinstance(v, np.ndarray):
        return [text(x) for x in v.tolist()]
    return v.item() if hasattr(v, "item") else v


def inspect(h, limit=400):
    n = 0

    def visit(name, obj):
        nonlocal n
        n += 1
        if n > limit:
            return
        if hasattr(obj, "shape"):
            print(f"  {name}  {obj.shape} {obj.dtype} chunks={obj.chunks}")
    h.visititems(visit)


def read_pass(h, grid, freq: str):
    """Return (hh, hv, meta) on the AOI grid from an open GCOV file."""
    from affine import Affine
    from rasterio.warp import transform_bounds
    band = next(b for b in ("LSAR", "SSAR") if f"science/{b}" in h)
    g = h[f"science/{band}/GCOV/grids/frequency{freq}"]
    x = g["xCoordinates"][:]
    y = g["yCoordinates"][:]
    epsg = int(text(g["projection"])) if g["projection"].shape == () else int(g["projection"].attrs["epsg_code"])
    dx, dy = float(x[1] - x[0]), float(y[1] - y[0])                 # dy < 0: row 0 is north
    b = transform_bounds(f"EPSG:{grid.epsg}", f"EPSG:{epsg}", *grid.bbox_utm, densify_pts=21)
    pad = 6 * max(abs(dx), abs(dy))
    cols = np.where((x >= b[0] - pad) & (x <= b[2] + pad))[0]
    rows = np.where((y >= b[1] - pad) & (y <= b[3] + pad))[0]
    if cols.size == 0 or rows.size == 0:
        raise RuntimeError("AOI is outside this granule")
    c0, c1, r0, r1 = cols[0], cols[-1] + 1, rows[0], rows[-1] + 1
    tf = Affine(dx, 0, x[c0] - dx / 2, 0, dy, y[r0] - dy / 2)
    out = {}
    for term in ("HHHH", "HVHV"):
        if term not in g:
            continue
        src = g[term][r0:r1, c0:c1].astype("float32")
        src[~np.isfinite(src) | (src <= 0)] = np.nan
        # 'average' in linear power = spatial multilooking down to the 20 m grid
        out[term] = warp_to_grid(src, tf, f"EPSG:{epsg}", grid, "average", src_nodata=np.nan)
    ident = h[f"science/{band}/identification"]
    meta = {"epsg_source": epsg, "posting_m": [abs(dx), abs(dy)], "window_px": [int(r1 - r0), int(c1 - c0)],
            "polarizations": text(g["listOfPolarizations"]) if "listOfPolarizations" in g else None}
    for key in ("absoluteOrbitNumber", "trackNumber", "frameNumber", "orbitPassDirection", "lookDirection",
                "zeroDopplerStartTime", "zeroDopplerEndTime", "productVersion", "processingType", "missionId",
                "isUrgentObservation", "granuleId"):
        if key in ident:
            meta[key] = text(ident[key])
    params = f"science/{band}/GCOV/metadata/processingInformation/parameters"
    if params in h:
        for key in ("rtc/outputBackscatterNormalizationConvention", "rtc/outputBackscatterExpressionConvention",
                    "radiometricTerrainCorrectionApplied", "noiseCorrectionApplied", "rfiMitigationApplied",
                    "shadowMaskingApplied", "preprocessing/frequencyA/numberOfAzimuthLooks",
                    "preprocessing/frequencyA/numberOfRangeLooks"):
            if key in h[params]:
                meta[key.split("/")[-1]] = text(h[params][key])
    return out.get("HHHH"), out.get("HVHV"), meta


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default=None)
    ap.add_argument("--inspect", action="store_true", help="print the HDF5 layout of the first granule and stop")
    ap.add_argument("--force", action="store_true", help="re-read passes that are already cached")
    args = ap.parse_args()
    cfg = load_config(args.config)
    grid = grid_from_config(cfg)
    work = work_dir(cfg)
    listing = work / "nisar_granules.json"
    if not listing.exists():
        raise SystemExit("run 01_search_nisar.py first")
    passes = {g["date"]: g for g in json.loads(listing.read_text(encoding="utf-8"))["passes"]}
    ea = earthdata_login()
    if not ea:
        raise SystemExit("No NASA Earthdata login found. Put this one line in ~/.netrc and run again:\n"
                         "  machine urs.earthdata.nasa.gov login YOUR_USERNAME password YOUR_PASSWORD")
    import h5py
    session = ea.get_requests_https_session()
    out = work / "nisar"
    out.mkdir(exist_ok=True)
    for d in cfg["dates"]:
        date = d["date"]
        if date not in passes:
            print(f"{date}: no published granule - skipped")
            continue
        dest = out / f"{date}.npz"
        if dest.exists() and not args.force and not args.inspect:
            print(f"{date}: cached")
            continue
        g = passes[date]
        t = time.time()
        print(f"{date}: opening {g['granule']}")
        with HttpRangeFile(g["https"], session) as fobj, h5py.File(fobj, "r") as h:
            if args.inspect:
                inspect(h)
                return
            hh, hv, meta = read_pass(h, grid, cfg["nisar"].get("frequency", "A"))
        meta.update(granule=g["granule"], collection=g["collection"], start=g["start"], https=g["https"])
        np.savez_compressed(dest, hh=hh, hv=hv if hv is not None else np.full_like(hh, np.nan))
        write_json(out / f"{date}.json", meta)
        ok = np.isfinite(hh)
        print(f"   {time.time() - t:.0f} s  read {fobj.fetched / 1e6:.0f} MB of {fobj.size / 1e9:.1f} GB  source {meta['posting_m']} m EPSG:{meta['epsg_source']}  window {meta['window_px']}  "
              f"valid {ok.mean() * 100:.1f}%  HH median {10 * np.log10(np.nanmedian(hh)):.1f} dB")


if __name__ == "__main__":
    main()
