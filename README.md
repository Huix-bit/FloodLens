# FloodLens

**See the flood the way NISAR does.** A browser-based first-person drone flight over a Malaysian
flood zone. Swing your head to change which satellite's eyes you see with:

| Swing to | Sensor | What you see |
|---|---|---|
| OPTICAL EYE | NASA HLS true colour | Clear before the flood; cloud and rain at the peak. Optical is blind in the monsoon. |
| C-BAND RADAR | Sentinel-1 (OPERA RTC-S1 / DSWx-S1) | Sees through cloud and finds open-water flood, but not water under tree canopy. |
| L-BAND · NISAR | NISAR GCOV HH | Sees open water **and** the flood hidden under oil-palm canopy (double-bounce brightening). |

NASA Space Apps Challenge 2026 · challenge *Dancing with the SARs*. Two case studies on real data,
chosen on the start screen:

| Case | What it is | What the data shows |
|---|---|---|
| **Chókwè, Mozambique, January 2026** | Limpopo river flood; five NISAR passes (four before, one during). The flood NASA visualized at [svs.gsfc.nasa.gov/5661](https://svs.gsfc.nasa.gov/5661). | 17 Jan 2026: NISAR L-band flags **128.8 km²**; Sentinel-1 C-band, 24 minutes earlier, flags **93.1 km²**; optical is 100 % cloud. Pre-flood passes: 0.1 to 3.5 km². |
| **Kuala Selangor, Malaysia, November 2026** | Live event in oil-palm country. Four NISAR passes before the flood. | NISAR imaged the flood on 12 Nov 2026; NASA had not released that product when this build was made. On 7 Nov Sentinel-1 found 0.24 km² of open water, no more than on dry dates. |

> **Build status: REAL DATA in both cases.** Nothing on screen is simulated. In the Mozambique
> case most of the extra area L-band finds is flooded farmland with vegetation standing in the
> water; only 3.6 km² is flagged as flood under tree cover. The claim "L-band sees the flood
> under the palms" is **not yet demonstrated** in the Malaysian case, because the flood pass is
> not published; the app says so on screen. `pipeline/validation.md` has the numbers, the
> false-alarm levels and the limits. Rerunning the pipeline adds the 12 Nov pass with no code
> change.

## Run it

No build step, no backend. Any static file server works.

```bash
cd web
python -m http.server 8000
# open http://localhost:8000
```

### Rebuild the data from NASA's archive

```bash
pip install -r pipeline/requirements.txt
# NASA Earthdata login in ~/.netrc:  machine urs.earthdata.nasa.gov login USER password PASS
python pipeline/01_search_nisar.py   # which NISAR passes are published (no login needed)
python pipeline/02_fetch_subset.py   # reads only the AOI window of each 6 GB granule (about 130 MB each)
python pipeline/04_ancillary.py      # DEM, land cover, OSM, water, population, Sentinel-1, HLS, rainfall
python pipeline/03_flood_detect.py   # change detection, thresholds logged
python pipeline/05_exposure.py       # 1 km hexagon ranking
python pipeline/06_export_web.py     # writes web/data/
python pipeline/check_contract.py    # validates web/data/ against the data contract
```

Each case is one config file: `pipeline/config.yaml` (Kuala Selangor) and
`pipeline/config.mozambique.yaml` (Chókwè); pass the second with `--config` to every step. Each
writes its own folder under `web/data/` and registers itself in `web/data/cases.json`.
`python pipeline/00_mock_data.py` writes a synthetic scene instead (flagged SIMULATED in the app).

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` / arrows, drag | Fly and look |
| `R` / `F` (or `Space` / `C`), `Shift` | Up / down, boost |
| `E` / `Q`, or a fast left/right flick | **Swing** to the next / previous sensor |
| `1`–`9`, mouse wheel, timeline chips, `L` | Jump between satellite passes, play the timeline |
| `X` | Lens: a circle around the crosshair shows another sensor (NISAR, or optical when already in NISAR) |
| `T` | Flood-detection overlay on / off (shows the raw backscatter) |
| `H` | Back to the start view |
| `P` | Presentation view → clean view (no HUD) → full HUD, for recording |
| `I`, `O` | "How it works" explainer, data sources |
| `K` | Flood exposure ranking: ranked 1 km hexagons, CSV / GeoJSON download, copyable summary |
| `M` | 2D map (MapLibre): same sensor image and flood classes, ranking hexagons, click for details |
| `G` | Guided tour: a 30-second scripted flight with captions, for recording |
| Click the minimap | Jump there |

The URL hash stores camera, sensor and date, so any view can be bookmarked and reopened.

## What is on screen, and what is not data

Drawn from data files in `web/data/` only: terrain (`dem.png`), the three sensor images, the flood
classes, the area statistics, place names, building footprints.

Illustrative, and labelled so in the app: rain, fog, water shimmer, the height of the water surface
(radar gives extent, not depth; the surface is estimated from the DEM), tree and palm models
(placed where the land-cover raster says palm or forest, not individual mapped trees), building
heights flagged `height_estimated`. Terrain relief is exaggerated ×2.

The crosshair read-out shows the land-cover class, backscatter in dB and flood class of the pixel
you are looking at, and a small chart of L-band and C-band backscatter at that pixel across all
passes.

## Repository layout

```
pipeline/
  config.yaml          the case study: AOI, grid, dates, thresholds. A new area = a new config file.
  config.mock.yaml     synthetic scene for 00_mock_data.py
  common.py            config loading, the shared grid, UTM maths, remote HDF5 range reader
  00_mock_data.py      writes a complete SIMULATED web/data/ in the contract format
  01_search_nisar.py   NASA CMR search for NISAR GCOV passes that cover the whole AOI
  02_fetch_subset.py   reads the AOI window of each granule over HTTPS range requests
  03_flood_detect.py   Lee filter, median reference, Otsu threshold, flood classes, C-band and optical tests
  04_ancillary.py      NASADEM, WorldCover, JRC water, OSM, WorldPop, OPERA RTC-S1, HLS, rainfall
  05_exposure.py       Flood Exposure Ranking on 1 km hexagons
  06_export_web.py     writes web/data/; flags anything missing or pending instead of inventing it
  validation.md        what the data shows and does not show, false-alarm level, limitations
  check_contract.py    validates web/data/ (sizes, class codes, stats vs rasters, vectors)
  requirements.txt
web/                   the deployed static site
  index.html  css/  js/ (plain ES modules, Three.js from a CDN via import map)
  data/cases.json      list of case studies
  data/<case>/         manifest.json + rasters + GeoJSON (the only thing the frontend reads)
reference/prototype.html   the original single-file look-and-feel prototype
CLAUDE.md              full project brief, including the data contract (section 3)
```

Frontend modules: `loader.js` (data contract), `geo.js` (grid ↔ world ↔ lon/lat), `terrain.js`
(DEM mesh, sensor textures, flood masks, water surface), `vegetation.js`, `buildings.js`,
`atmosphere.js`, `controls.js`, `swing.js`, `timeline.js`, `hud.js`, `minimap.js`, `probe.js`,
`labels.js`, `modals.js`, `main.js`.

## Data contract in short

All rasters share one north-up UTM grid (1024 × 1024 at 20 m here). Full details in `CLAUDE.md` §3.

- `dem.png`: Terrain-RGB, `height_m = -10000 + (R·65536 + G·256 + B) · 0.1`
- `landcover.png`: 0 other, 1 permanent water, 2 urban, 3 oil palm / tree crop, 4 cropland/grass, 5 forest
- `optical_<date>.png`: 8-bit true colour, clouds left in
- `cband_<date>.png`, `lband_<date>.png`: 8-bit backscatter. **Stretch rule:** linear in dB,
  −25 dB → 0 and 0 dB → 255, clipped (`stretch_db` in `config.yaml`, echoed in `manifest.json`)
- `flood_<date>.png`: 0 dry, 1 permanent water, 2 open-water flood, 3 flooded vegetation, 255 no data
- `stats.json`, `hexes.geojson`, `buildings.geojson`, `places.geojson`

The number of dates is read from `manifest.json`; nothing in the app assumes three.

### Flood Exposure Ranking score

Per 1 km hexagon and per date:

```
score = 100 × ( 0.40 · people / max(people)
              + 0.25 · flooded_fraction
              + 0.20 · flooded_road_km / max(flooded_road_km)
              + 0.15 · facilities / max(facilities) )
```

Maxima are taken over all hexagons and dates. Weights live in `config.yaml`. It is a screening aid
built from open data, not a rescue order.

## How the flood map is made

1. Each NISAR pass is multilooked from 10 m to the 20 m grid and speckle-filtered (5×5 Lee).
2. The reference is the per-pixel median of the other pre-flood passes on the same track.
3. **Open-water flood**: HH below the water threshold and at least 3 dB lower than the reference.
4. **Flooded vegetation**: tree or palm land cover, HH at least 3 dB higher than the reference,
   and HH rising at least as much as HV (double bounce is a co-polarised effect).
5. Permanent water (JRC, WorldCover, OSM), ground more than 15 m above the nearest drainage,
   and patches under 12 pixels are removed.

The water threshold comes from Otsu's method on a balanced water / land sample; the change
thresholds are the larger of the configured value and three times the measured pass-to-pass
noise. Every value used is written to `manifest.json → method` and shown in the app.
Sentinel-1 gets the same open-water rule, each acquisition against earlier ones on its own track.

## Data sources

All of these are loaded in the current build.

| Dataset | Provider | Used for |
|---|---|---|
| **NISAR L2 GCOV** (L-band HH / HV, track 112 ascending) | NASA / ISRO via ASF DAAC | L-band mode, flood and flooded-vegetation detection |
| **OPERA RTC-S1 v1** (Sentinel-1 C-band backscatter) | NASA JPL OPERA via ASF DAAC; contains modified Copernicus Sentinel data | C-band mode, open-water flood |
| **HLS v2.0** (HLSS30 / HLSL30) | NASA LP DAAC | Optical mode, cloud cover, optical water test |
| **NASADEM HGT v001** | NASA LP DAAC | 3D terrain, height-above-drainage mask |
| **NASA POWER** daily precipitation (MERRA-2 / GEOS-IT) | NASA Langley Research Center | Rainfall in the 7 days before each pass |
| ESA WorldCover 10 m 2021 v200 | ESA / VITO | Land cover |
| JRC Global Surface Water v1.4 (from the NASA / USGS Landsat archive) | EC JRC / Google | Permanent water mask |
| WorldPop 2026 constrained 100 m, Malaysia | WorldPop, University of Southampton | People exposed |
| OpenStreetMap | OpenStreetMap contributors (ODbL) | Buildings, roads, places, facilities, water and forest outlines |

Bold rows are NASA datasets. Links and DOIs are in `web/data/manifest.json → sources` and in the
in-app Data sources panel. Evacuee counts quoted in the app are from the Malaysian Social Welfare
Department (JKM) as reported by BERNAMA; they are context, not satellite data.

## Use of AI tools

This project was built with AI assistance: Claude (Anthropic), via Claude Code, was used to write
and test code and documentation. All data-processing choices and results are reviewed by the team.

## Licence

MIT, see `LICENSE`.
