# FloodLens — Project Brief for Claude

NASA Space Apps Challenge 2026 · Challenge: **"Dancing with the SARs"**
Challenge statement: build an interactive application that uses radar data from the NASA-ISRO
Synthetic Aperture Radar (NISAR) mission to track and visualize one or more types of surface
change at locations around the world.

**Deadline: 2026-11-15 23:59 (Malaysia time, UTC+8).** Code must be feature-complete by
2026-11-15 12:00 so the afternoon can go to video, poster and PDF. Commit and push after every milestone.

---

## 0. Competition context (read before making trade-offs)

### The challenge
- Event: NASA International Space Apps Challenge 2026, theme "The Next Frontier", Earth Science track,
  difficulty Intermediate/Advanced. Local event: NASA Space Apps Kuala Lumpur 2026 (online), category
  Tertiary (18–30).
- Challenge "Dancing with the SARs": build an **interactive application** that uses **NISAR radar
  data** to **track and visualize surface change** (one or more types) at locations around the world.
  Our chosen change type: **flood inundation**, including flooding under vegetation, which is
  NISAR L-band's distinctive strength.
- Must use real NASA data to be eligible for Global Awards. NASA and partner data must be cited.

### Local judging rubric (10 criteria × 10 points = 100)
Scores per criterion are 1–2 / 3–4 / 5–6 / 9 / 10 — there is no 7 or 8. **Gold = 90+**, so every
criterion must reach at least "Good" (9). No weak spots: a single "Satisfactory" costs ~3–4 points.

| # | Criterion | What it means for the code |
|---|---|---|
| 1 | Relevance to Theme | NISAR data front and centre; the app clearly shows *change over time* |
| 2 | Originality | FPV + swing-to-switch-sensor + "flood hidden under canopy" reveal |
| 3 | Construction Technique | Clean, reproducible pipeline; tidy repo; README explains how to run |
| 4 | Diversity of Material Used | Many datasets, each with a clear purpose, listed in the Data Sources panel |
| 5 | Demonstrated Understanding | In-app "How it works" explainer: why open water goes dark, why flooded palms go bright (double bounce), L-band vs C-band penetration |
| 6 | Degree of Practicality | Real data, validation vs reported impacts, honest limitations, usable 2D map mode |
| 7 | Degree of Commercialization | Outputs a real user could take away (download hex ranking as CSV/GeoJSON, a copyable situation summary); design so a new AOI is just a new `config.yaml` (shows it can scale to other states/countries) |
| 8 | Materials Submitted | Code must make screenshots/recordings easy: a clean "presentation mode" (hide help panels), stable camera start, keyboard shortcuts for each beat of the demo |
| 9 | Presentation Style | Strong first 5 seconds, readable HUD, smooth transitions |
| 10 | Utilization of FREE NASA Resources | Prefer NASA datasets where a choice exists (HLS, NASADEM, GPM IMERG, SEDAC, OPERA); label NASA sources explicitly in the app |

### Submission requirements (handled by the team, but the app must support them)
Due on the Space Apps project page by **2026-11-15 23:59 local**, everything in **English**:
1. Project name + team poster
2. Project summary
3. 30-second demo video (compulsory)
4. Final project: 3–5 minute video + public link to the software (this GitHub Pages site)
5. Project details (what it does, how, tools/languages used)
6. Use of AI tools (declare Claude)
7. NASA data with citations
8. Space-agency-partner and other data with citations
Plus a PDF report (Intro / Methodology / Results / Discussion / Conclusion / References).
All links (Drive, GitHub Pages, YouTube) must open for a logged-out user, or the project is disqualified.
Videos may be narrated in another language only with English subtitles.

---

## 1. What we are building

A browser-based, game-like **first-person drone (FPV) flight** over a real Malaysian flood zone
(case study: late-November 2025 floods, Kelantan / Terengganu, ~20 × 20 km area of interest
containing a river, a town and oil-palm plantations).

**Core mechanic: "swing your head to change which satellite's eyes you see with."**

| Mode | Data | What the viewer sees |
|---|---|---|
| 0 · OPTICAL EYE | NASA HLS true colour + Fmask clouds | Clear before the flood; rain and cloud at the peak — optical satellites are blind |
| 1 · C-BAND RADAR | Sentinel-1 (or OPERA DSWx-S1) | Sees through cloud, detects open-water flood, but NOT flooding under tree canopy |
| 2 · L-BAND · NISAR | NISAR GCOV (HH, HV) | Sees open water AND water under the oil-palm canopy (double-bounce brightening) |

Story in one line: *During the monsoon, optical satellites see cloud, C-band misses the flood under
the palms, NISAR L-band sees all of it.*

### Features (priority order)
1. **FPV flight** over 3D terrain (WASD + drag-to-look, R/F up/down, Shift boost; touch controls on mobile).
2. **Swing to switch modes**: Q/E keys, fast mouse/touch flick left/right, on-screen buttons,
   and **phone gyroscope** (a quick physical left/right flick of the phone). The camera yaws and
   rolls ~0.3 rad and back over ~0.55 s; the mode switches at the midpoint with a scan-wipe effect.
   A swing pressed mid-swing is queued.
3. **Timeline** of NISAR passes (pre-flood → peak → receding, more if available). The water surface
   animates between dates. Keys 1–9, mouse wheel, clickable chips. Number of dates comes from
   `manifest.json` — never hard-code 3.
4. **Sensor comparison panel**: flood area (km²) each sensor detects on the current date,
   "hidden under canopy" area that only L-band sees, optical cloud cover %.
5. **Flood Exposure Ranking**: 1 km hexagon grid; per hex: flooded area, people exposed, flooded road
   km, facilities affected; ranked list, labelled with the nearest village/town name from OSM.
6. **2D map mode** (MapLibre GL JS) toggled with one button / key M: same layers, clear legend, hex
   ranking, click a hex for details.
7. **Minimap** (top-right), HUD with mode name, date, heading, altitude, legend.
8. **Mobile**: responsive HUD, touch controls, gyroscope swing (iOS needs a permission tap via
   `DeviceOrientationEvent.requestPermission()` from a click; requires HTTPS), lower quality tier
   (fewer trees, no rain, textures ≤ 1024 px).

UI language: **English only.**

### Visual reference
`reference/prototype.html` is a working single-file prototype with simulated data (Three.js r128).
Reuse its **interaction feel and scene treatment only**: accent colour per mode (optical `#ffd166`,
C-band `#8ecbff`, L-band `#00ffd0`), radar scanlines, swing wipe, rain + fog in optical mode at
cloudy dates, wireframe/transparent palm crowns and bright trunks in L-band mode. The new build
replaces procedural terrain/flood with the real data files described below.

**Do NOT copy the prototype's panel styling** (decided 2026-11-14: it read as generic AI sci-fi).
The interface follows a flight-instrument language instead, defined in `web/css/style.css`:
- Flat opaque surfaces, square corners, 1 px hairline rules. No blur, glow, gradients, rounded
  cards or corner brackets. No wide-tracked all-caps labels; use sentence case.
- Type: B612 + B612 Mono (the Airbus cockpit typeface).
- Data that belongs to the view (heading tape, altitude, crosshair probe, place names) is drawn
  straight onto the scene like an FPV on-screen display; everything else lives in the docked
  bottom console (sensor comparison, time axis of passes with flood columns, pass facts, key).
- Sensor choice is a three-segment selector at top centre; the active segment is filled with the
  mode colour. Mode colours are used only for the active sensor, key numbers and map swatches.
- Real instrument conventions: compass tape, scale bar and north mark on the minimap, a time axis
  where passes sit at their true dates.

### Honesty rules (judges check this)
- Anything drawn from data must come from the files in `web/data/`. Purely visual effects (rain,
  water shimmer, tree models, building heights if estimated) must be labelled as illustrative.
- Keep a small "Data sources" panel/modal in the app listing every dataset with citation.
- If a layer falls back to mock data, show a visible "SIMULATED" badge.

---

## 2. Architecture

Static site, no backend. All geoprocessing happens offline in Python; the browser only loads
small pre-rendered files.

```
floodlens/
  CLAUDE.md
  README.md                 # English, for judges: what, how to run, data sources
  reference/prototype.html
  pipeline/                 # Python, run locally
    requirements.txt
    config.yaml             # AOI bbox, dates, file paths, thresholds
    00_mock_data.py         # writes a complete fake web/data/ in the exact contract format
    01_search_nisar.py      # asf_search / earthaccess: list GCOV granules over AOI
    02_fetch_subset.py      # read ONLY the AOI subset of each GCOV (h5py + remote/fsspec); never download whole files if avoidable
    03_flood_detect.py      # change detection -> flood class rasters
    04_ancillary.py         # DEM, HLS, Sentinel-1, land cover, JRC water, population, OSM
    05_exposure.py          # hex grid + exposure metrics
    06_export_web.py        # write web/data/* per contract below
  web/                      # deployed to GitHub Pages as-is
    index.html
    js/  (ES modules, no build step; Three.js + MapLibre via import map from a CDN)
    css/
    data/
```

No bundler. Plain ES modules + `<script type="importmap">`. Must run from any static server
(`python -m http.server` in `web/`) and from GitHub Pages.

---

## 3. Data contract (`web/data/`) — the frontend reads ONLY this

All rasters share one grid: same extent, same width × height (target 1024 × 1024, max 2048),
north-up, in the AOI's UTM projection. Row 0 = north edge.

### `manifest.json`
```json
{
  "title": "Kelantan floods, Nov-Dec 2025",
  "simulated": false,
  "crs": "EPSG:32648",
  "bbox_utm": [xmin, ymin, xmax, ymax],
  "bbox_wgs84": [lon_min, lat_min, lon_max, lat_max],
  "grid": { "width": 1024, "height": 1024, "pixel_m": 20 },
  "dem": "dem.png",
  "landcover": "landcover.png",
  "dates": [
    {
      "date": "2025-11-14",
      "label": "Before",
      "nisar_track": "TBD",
      "optical": "optical_2025-11-14.png",
      "optical_cloud_pct": 6.0,
      "cband": "cband_2025-11-14.png",
      "lband": "lband_2025-11-14.png",
      "flood": "flood_2025-11-14.png",
      "rain_mm_prev7d": 42.0
    }
  ],
  "stats": "stats.json",
  "hexes": "hexes.geojson",
  "buildings": "buildings.geojson",
  "places": "places.geojson",
  "sources": [ { "name": "NISAR L2 GCOV", "provider": "NASA/ISRO via ASF DAAC", "url": "...", "used_for": "L-band mode, flood detection" } ]
}
```

### Rasters
| File | Encoding |
|---|---|
| `dem.png` | Terrain-RGB: `height_m = -10000 + (R*65536 + G*256 + B) * 0.1` |
| `landcover.png` | R channel class code: 0 other, 1 permanent water, 2 urban, 3 oil palm / tree crop, 4 cropland/grass, 5 forest |
| `optical_<date>.png` | 8-bit RGB true colour (clouds left in — they are the point) |
| `cband_<date>.png` | 8-bit greyscale backscatter (dB stretched, e.g. −25…0 dB → 0…255) |
| `lband_<date>.png` | 8-bit greyscale NISAR HH backscatter, same stretch rule (document it in README) |
| `flood_<date>.png` | R channel class: 0 dry, 1 permanent water, 2 open-water flood, 3 flooded vegetation, 255 no data (layover/shadow/outside swath) |

### `stats.json`
```json
{ "per_date": { "2025-11-26": {
    "open_flood_km2": 0, "veg_flood_km2": 0,
    "detected_km2": { "optical": 0, "cband": 0, "lband": 0 },
    "people_exposed": 0, "roads_flooded_km": 0, "facilities_affected": 0 } } }
```
`optical` = open-water flood visible in cloud-free pixels only; `cband` = open-water flood from
Sentinel-1/DSWx-S1; `lband` = open + vegetated flood from NISAR.

### Vectors (WGS84 GeoJSON)
- `hexes.geojson`: 1 km hexagons; properties per date:
  `{ "id", "name", "flood_frac": {date: 0-1}, "people": {date}, "roads_km": {date}, "facilities": {date}, "score": {date}, "rank": {date} }`
- `buildings.geojson`: OSM footprints in AOI, `height_m` (OSM tag or estimate; flag `height_estimated: true`).
- `places.geojson`: OSM villages/towns (points with `name`).

---

## 4. Processing method (pipeline)

1. **Find NISAR GCOV** over the AOI for ~2025-11-01 → 2025-12-20. Use ONE track/direction
   (same look geometry) for the whole timeline. Record track, frame, dates. BETA/pre-calibration
   products are acceptable for relative change detection; note it in limitations.
2. **Subset** HH (and HV) covariance terms to the AOI grid; convert to backscatter dB; apply a
   speckle filter (e.g. 5×5 Lee or median).
3. **Change detection** against the pre-flood date:
   - Open-water flood: low post-event HH **and** a clear decrease vs pre-event.
   - Flooded vegetation: a clear HH **increase** (double bounce) in tree/palm land-cover pixels.
   - Pick thresholds from the image histograms (Otsu or bimodal fit); the values in `config.yaml`
     are starting points only. Log the thresholds used.
   - Remove permanent water (JRC GSW occurrence high), high ground (HAND or DEM above floodplain),
     and layover/shadow pixels.
4. **C-band**: Sentinel-1 RTC (or OPERA DSWx-S1 directly) on dates closest to each NISAR pass.
5. **Optical**: HLS (L30/S30) closest to each pass, true colour + Fmask cloud % over AOI;
   pre-flood clear composite if no single clear scene.
6. **Ancillary**: NASADEM (or Copernicus GLO-30), ESA WorldCover + an oil-palm map, JRC GSW,
   GPM IMERG rainfall, SEDAC GPW or WorldPop population, OSM roads/buildings/places/facilities.
7. **Exposure**: 1 km hex grid; flooded fraction, population × flooded fraction, flooded road length,
   schools/clinics/mosques/police in flooded cells. Score = transparent weighted sum, documented in
   README and in the app ("Flood Exposure Ranking", not a rescue order).
8. **Validation**: compare against reported evacuation numbers / affected areas (JKM InfoBencana,
   JPS Public InfoBanjir, news) and against Sentinel-1/DSWx where they overlap. Save a short
   `pipeline/validation.md`.

Python stack: numpy, h5py, rasterio, pyproj, shapely, geopandas, scikit-image, pillow,
asf_search, earthaccess, (optional) xarray, h3 or a simple hex generator, osmnx.
Earthdata login via `~/.netrc` or earthaccess interactive login — never commit credentials.

---

## 5. Build order / milestones

1. `pipeline/00_mock_data.py` → full fake `web/data/` matching the contract (so the frontend
   never waits for real data). Set `"simulated": true`.
2. Frontend core: data loader from manifest, Three.js terrain from `dem.png`, per-mode textures,
   flood overlay, water plane, FPV controls, swing + timeline, HUD, minimap. **Commit.**
3. NISAR search + subset + flood detection on real data. **Commit.**
4. Ancillary data + exposure + export real `web/data/`; swap in; fix whatever breaks. **Commit.**
   (Target: by end of Day 1.)
5. 2D MapLibre mode + hex ranking + data sources modal. **Commit.**
6. Mobile: touch, gyroscope swing, quality tier. **Commit.**
7. Deploy to GitHub Pages; test on phone and in a logged-out browser. README for judges.
8. Polish only after everything above works. Code freeze 2026-11-15 12:00.

## 6. Conventions
- Keep functions small; one module per concern (`loader.js`, `terrain.js`, `modes.js`,
  `controls.js`, `swing.js`, `timeline.js`, `hud.js`, `minimap.js`, `map2d.js`, `gyro.js`).
- Wrap `localStorage` in try/catch; the app must work without it.
- Performance: 60 fps on a mid laptop; ≤ 4k palm instances desktop, ≤ 1.5k mobile.
- Every external dataset used must appear in `manifest.json → sources` and in README references.
- Mention in README that the project was built with AI assistance (Claude); the submission form
  requires declaring AI tools.
