"""Shared helpers for the FloodLens pipeline: config loading, the AOI grid and UTM maths.

The UTM transform is written out here (Snyder / USGS series, WGS84) so the mock-data
step runs with numpy alone; the real-data steps use pyproj and agree to < 1 cm.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parent.parent

_A = 6378137.0
_F = 1 / 298.257223563
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)
_K0 = 0.9996


def load_config(path: str | Path | None = None) -> dict:
    path = Path(path) if path else ROOT / "pipeline" / "config.yaml"
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def utm_zone_from_epsg(epsg: int) -> tuple[int, bool]:
    """Return (zone, is_north) for EPSG:326xx / 327xx."""
    if 32601 <= epsg <= 32660:
        return epsg - 32600, True
    if 32701 <= epsg <= 32760:
        return epsg - 32700, False
    raise ValueError(f"EPSG:{epsg} is not a WGS84 UTM zone")


def epsg_for_lonlat(lon: float, lat: float) -> int:
    zone = int((lon + 180) // 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def _meridian_arc(phi):
    e2, e4, e6 = _E2, _E2**2, _E2**3
    return _A * (
        (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
        - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * np.sin(2 * phi)
        + (15 * e4 / 256 + 45 * e6 / 1024) * np.sin(4 * phi)
        - (35 * e6 / 3072) * np.sin(6 * phi)
    )


def lonlat_to_utm(lon, lat, epsg: int):
    zone, north = utm_zone_from_epsg(epsg)
    lon0 = math.radians(zone * 6 - 183)
    lam = np.radians(np.asarray(lon, dtype=np.float64))
    phi = np.radians(np.asarray(lat, dtype=np.float64))
    n = _A / np.sqrt(1 - _E2 * np.sin(phi) ** 2)
    t = np.tan(phi) ** 2
    c = _EP2 * np.cos(phi) ** 2
    a = (lam - lon0) * np.cos(phi)
    m = _meridian_arc(phi)
    x = 500000 + _K0 * n * (
        a + (1 - t + c) * a**3 / 6 + (5 - 18 * t + t**2 + 72 * c - 58 * _EP2) * a**5 / 120
    )
    y = _K0 * (
        m
        + n * np.tan(phi) * (
            a**2 / 2
            + (5 - t + 9 * c + 4 * c**2) * a**4 / 24
            + (61 - 58 * t + t**2 + 600 * c - 330 * _EP2) * a**6 / 720
        )
    )
    if not north:
        y = y + 10_000_000
    return x, y


def utm_to_lonlat(x, y, epsg: int):
    zone, north = utm_zone_from_epsg(epsg)
    lon0 = math.radians(zone * 6 - 183)
    x = np.asarray(x, dtype=np.float64) - 500000
    y = np.asarray(y, dtype=np.float64) - (0 if north else 10_000_000)
    e2, e4, e6 = _E2, _E2**2, _E2**3
    mu = (y / _K0) / (_A * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    phi1 = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * np.sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * np.sin(4 * mu)
        + (151 * e1**3 / 96) * np.sin(6 * mu)
        + (1097 * e1**4 / 512) * np.sin(8 * mu)
    )
    n1 = _A / np.sqrt(1 - e2 * np.sin(phi1) ** 2)
    t1 = np.tan(phi1) ** 2
    c1 = _EP2 * np.cos(phi1) ** 2
    r1 = _A * (1 - e2) / (1 - e2 * np.sin(phi1) ** 2) ** 1.5
    d = x / (n1 * _K0)
    phi = phi1 - (n1 * np.tan(phi1) / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * _EP2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * _EP2 - 3 * c1**2) * d**6 / 720
    )
    lam = lon0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * _EP2 + 24 * t1**2) * d**5 / 120
    ) / np.cos(phi1)
    return np.degrees(lam), np.degrees(phi)


@dataclass(frozen=True)
class Grid:
    """The one grid every raster in web/data/ shares. Row 0 = north edge."""

    epsg: int
    xmin: float
    ymin: float
    width: int
    height: int
    pixel_m: float

    @property
    def xmax(self) -> float:
        return self.xmin + self.width * self.pixel_m

    @property
    def ymax(self) -> float:
        return self.ymin + self.height * self.pixel_m

    @property
    def bbox_utm(self) -> list[float]:
        return [self.xmin, self.ymin, self.xmax, self.ymax]

    @property
    def bbox_wgs84(self) -> list[float]:
        xs = np.array([self.xmin, self.xmax, self.xmin, self.xmax])
        ys = np.array([self.ymin, self.ymin, self.ymax, self.ymax])
        lon, lat = utm_to_lonlat(xs, ys, self.epsg)
        return [round(float(v), 6) for v in (lon.min(), lat.min(), lon.max(), lat.max())]

    @property
    def pixel_km2(self) -> float:
        return (self.pixel_m / 1000.0) ** 2

    def px_to_utm(self, col, row):
        """Pixel coordinates (fractional, origin = NW corner) -> UTM metres."""
        return self.xmin + np.asarray(col) * self.pixel_m, self.ymax - np.asarray(row) * self.pixel_m

    def px_to_lonlat(self, col, row):
        return utm_to_lonlat(*self.px_to_utm(col, row), self.epsg)


def grid_from_config(cfg: dict) -> Grid:
    aoi = cfg["aoi"]
    epsg = int(aoi.get("epsg") or epsg_for_lonlat(aoi["center_lon"], aoi["center_lat"]))
    px = float(aoi["pixel_m"])
    w, h = int(aoi["width"]), int(aoi["height"])
    cx, cy = lonlat_to_utm(aoi["center_lon"], aoi["center_lat"], epsg)
    xmin = round((float(cx) - w * px / 2) / px) * px
    ymin = round((float(cy) - h * px / 2) / px) * px
    return Grid(epsg, xmin, ymin, w, h, px)


def write_json(path: Path, obj, compact: bool = False) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        if compact:
            json.dump(obj, fh, separators=(",", ":"), ensure_ascii=False)
        else:
            json.dump(obj, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
