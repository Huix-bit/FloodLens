// Grid <-> world <-> lon/lat. UTM (WGS84) series as in pipeline/common.py.
import { UNIT_M, V_EXAG } from './config.js';

const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2), K0 = 0.9996;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

function parseZone(crs) {
  const m = /EPSG:32([67])(\d\d)/.exec(crs || '');
  return m ? { lon0: rad(+m[2] * 6 - 183), north: m[1] === '6' } : null;
}

function lonLatToUtm(lon, lat, z) {
  const phi = rad(lat), lam = rad(lon), s = Math.sin(phi), c = Math.cos(phi), tn = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * s * s), t = tn * tn, cc = EP2 * c * c, a = (lam - z.lon0) * c;
  const e4 = E2 * E2, e6 = e4 * E2;
  const m = A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
  const x = 500000 + K0 * n * (a + (1 - t + cc) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * cc - 58 * EP2) * a ** 5 / 120);
  let y = K0 * (m + n * tn * (a * a / 2 + (5 - t + 9 * cc + 4 * cc * cc) * a ** 4 / 24
    + (61 - 58 * t + t * t + 600 * cc - 330 * EP2) * a ** 6 / 720));
  if (!z.north) y += 1e7;
  return [x, y];
}

function utmToLonLat(x, y, z) {
  x -= 500000; if (!z.north) y -= 1e7;
  const e4 = E2 * E2, e6 = e4 * E2;
  const mu = (y / K0) / (A * (1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), tn = Math.tan(p1);
  const n1 = A / Math.sqrt(1 - E2 * s * s), t1 = tn * tn, c1 = EP2 * c * c;
  const r1 = A * (1 - E2) / (1 - E2 * s * s) ** 1.5, d = x / (n1 * K0);
  const phi = p1 - (n1 * tn / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6 / 720);
  const lam = z.lon0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / c;
  return [deg(lam), deg(phi)];
}

/** Coordinate helpers for one manifest. World: +x east, +z south, +y up, origin at AOI centre. */
export function makeGeo(man) {
  const [xmin, ymin, xmax, ymax] = man.bbox_utm;
  const [lon0, lat0, lon1, lat1] = man.bbox_wgs84;
  const { width, height, pixel_m } = man.grid;
  const upp = pixel_m / UNIT_M;            // world units per pixel
  const W = width * upp, H = height * upp;
  const zone = parseZone(man.crs);         // null -> fall back to linear bbox interpolation

  const utmToWorld = (x, y) => [(x - xmin) / UNIT_M - W / 2, (ymax - y) / UNIT_M - H / 2];
  const worldToUtm = (wx, wz) => [xmin + (wx + W / 2) * UNIT_M, ymax - (wz + H / 2) * UNIT_M];
  return {
    W, H, upp, width, height, pixel_m,
    pixelKm2: (pixel_m / 1000) ** 2,
    yOf: metres => metres / UNIT_M * V_EXAG,
    worldToPx: (wx, wz) => [(wx + W / 2) / upp, (wz + H / 2) / upp],
    pxToWorld: (col, row) => [col * upp - W / 2, row * upp - H / 2],
    lonLatToWorld(lon, lat) {
      if (zone) return utmToWorld(...lonLatToUtm(lon, lat, zone));
      return [(lon - lon0) / (lon1 - lon0) * W - W / 2, (lat1 - lat) / (lat1 - lat0) * H - H / 2];
    },
    worldToLonLat(wx, wz) {
      if (zone) return utmToLonLat(...worldToUtm(wx, wz), zone);
      return [lon0 + (wx + W / 2) / W * (lon1 - lon0), lat1 - (wz + H / 2) / H * (lat1 - lat0)];
    },
  };
}
