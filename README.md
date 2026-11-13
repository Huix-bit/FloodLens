# FloodLens

**See the flood the way NISAR does.** A browser-based first-person drone flight over a Malaysian
flood zone. Swing your head to change which satellite's eyes you see with:

| Swing to | Sensor | What you see |
|---|---|---|
| OPTICAL EYE | NASA HLS true colour | Clear before the flood; cloud and rain at the peak. Optical is blind in the monsoon. |
| C-BAND RADAR | Sentinel-1 (OPERA RTC-S1 / DSWx-S1) | Sees through cloud and finds open-water flood, but not water under tree canopy. |
| L-BAND · NISAR | NISAR GCOV HH | Sees open water **and** the flood hidden under oil-palm canopy (double-bounce brightening). |

NASA Space Apps Challenge 2026 · challenge *Dancing with the SARs* · case study: Kelantan floods,
November to December 2025.

> **Build status: SIMULATED DATA.** The app currently runs on synthetic stand-in data written by
> `pipeline/00_mock_data.py` (`manifest.json` has `"simulated": true` and the app shows a SIMULATED
> badge). Terrain, imagery, flood extent and every number are synthetic. The real-data steps of
> the pipeline (`01`–`06`) are not written yet; they will overwrite the same files in `web/data/`
> with no change to the frontend.

## Run it

No build step, no backend. Any static file server works.

```bash
cd web
python -m http.server 8000
# open http://localhost:8000
```

Regenerate the simulated dataset (optional, the files are committed):

```bash
pip install numpy scipy pillow pyyaml
python pipeline/00_mock_data.py      # writes web/data/
python pipeline/check_contract.py    # validates web/data/ against the data contract
```

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
  config.yaml          AOI, grid, dates, thresholds. A new area = a new config file.
  common.py            config loading, the shared grid, UTM maths
  00_mock_data.py      writes a complete SIMULATED web/data/ in the contract format
  check_contract.py    validates web/data/ (sizes, class codes, stats vs rasters, vectors)
  requirements.txt
web/                   the deployed static site
  index.html  css/  js/ (plain ES modules, Three.js from a CDN via import map)
  data/                manifest.json + rasters + GeoJSON (the only thing the frontend reads)
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

## Data sources

These are the datasets the real pipeline is designed around. **None of them is loaded in the
current simulated build.**

| Dataset | Provider | Used for |
|---|---|---|
| NISAR L2 GCOV (L-band HH/HV) | NASA / ISRO via ASF DAAC | L-band mode, flood and flooded-vegetation detection |
| HLS v2.0 (HLSL30 / HLSS30) | NASA LP DAAC | Optical mode, cloud cover |
| OPERA RTC-S1 / DSWx-S1 (Copernicus Sentinel-1) | NASA JPL OPERA; ESA Copernicus | C-band mode, open-water flood |
| NASADEM HGT v001 | NASA LP DAAC | 3D terrain, high-ground mask |
| GPM IMERG Final Daily V07 | NASA GES DISC | Rainfall before each pass |
| GPW v4.11 Population Count | NASA SEDAC | People exposed |
| ESA WorldCover 10 m v200 | ESA | Land cover |
| Global oil palm map (Descals et al., 2021) | ESSD / Zenodo | Oil palm class |
| JRC Global Surface Water | EC JRC | Permanent water mask |
| OpenStreetMap | OpenStreetMap contributors (ODbL) | Buildings, places, roads, facilities |

Links are in `web/data/manifest.json → sources` and in the in-app Data Sources panel.

## Use of AI tools

This project was built with AI assistance: Claude (Anthropic), via Claude Code, was used to write
and test code and documentation. All data-processing choices and results are reviewed by the team.

## Licence

MIT, see `LICENSE`.
