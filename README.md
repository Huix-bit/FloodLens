# FloodLens

**See the flood behind the cloud.**
NASA Space Apps Challenge 2026 · challenge *Dancing with the SARs*.

**Try it: https://tzehern0703.github.io/FloodLens/** (desktop or phone, no login, no install)

FloodLens is a browser flight over a real flood, rebuilt from satellite data. You swing between
three satellites' views of the same ground on the same day and see what each one finds:

| Sensor | Data | What it sees |
|---|---|---|
| Optical | NASA HLS true colour | Sunlight. In a storm: cloud. |
| C-band radar | Sentinel-1 (NASA OPERA RTC-S1) | Through cloud. Open water, but its 5.6 cm wave scatters in crops, reeds and tree crowns. |
| L-band radar | NASA / ISRO NISAR (GCOV, HH and HV) | Through cloud and through much of that vegetation, with a 24 cm wave. |

A bar shows the flood area each sensor flags. Swinging from C-band to L-band highlights, in lime,
the flood that only L-band finds. A ranking lists who is exposed, per 1 km hexagon.

## The two cases (both real data, nothing simulated)

| Case | What the data shows |
|---|---|
| **Chókwè, Mozambique, 17 January 2026** (Limpopo flood; five NISAR passes) | Optical: 100 % cloud. C-band: **93.1 km²**. NISAR L-band: **128.8 km²**. 55.8 km² is flagged by L-band and missed by C-band, mostly flooded farmland with vegetation standing in the water. About 4,400 residents and 100 km of roads are on flagged ground. On the four pre-flood passes the detector flags 0.1 to 3.5 km². |
| **Kuala Selangor, Malaysia, November 2026** (live event; four NISAR passes before the flood) | On 7 Nov, 3,834 people were evacuated across Selangor. Optical: 84 % cloud. C-band: 0.24 km² in our area, no more than on dry dates. NISAR imaged the flood on 12 Nov 2026; NASA had not published that product at code freeze (15 Nov 2026), so the app shows an empty "awaiting NASA" slot. |

## Validation

**Independent check (Mozambique).** The Copernicus Emergency Management Service mapped the same
flood (activation [EMSR857](https://mapping.emergency.copernicus.eu/activations/EMSR857/)). Where
its area overlaps ours, on the shared 20 m grid:

| Copernicus product (image time, UTC) | EMS flood | Our NISAR map | Share of EMS flood we flag | Share of ours outside EMS | Overlap score (IoU) |
|---|---|---|---|---|---|
| First estimate (16 Jan 16:22) | 91.7 km² | 94.5 km² | **86.0 %** | 16.5 % (15.6 km²) | 73.6 % |
| Delineation (18 Jan 14:55) | 137.1 km² | 122.3 km² | **80.3 %** | 10.0 % (12.2 km²) | 73.7 % |

Our own Sentinel-1 C-band rule flags only 55 to 63 % of the Copernicus flood, so the L-band map
agrees with the independent map better than the C-band map does. The Copernicus images are from
11 hours before and 35 hours after the NISAR pass, and theirs is also a satellite map, not
ground truth.

**False-alarm level.** Each pre-flood pass is tested against the others: Mozambique 0.1 to
3.5 km², Selangor 0.0 to 0.5 km², against 128.8 km² on the flood pass.

Full numbers, method and reproduction steps: [`pipeline/validation.md`](pipeline/validation.md)
and `pipeline/07_validate_ems.py`.

## Limitations (please read)

- **Not yet shown: flooding under plantation canopy in Malaysia.** That needs the 12 Nov NISAR
  pass. In Mozambique only 3.6 km² is flagged as flood under tree cover; the L-band advantage
  there is mostly over flooded farmland.
- **"Flagged" is not "confirmed".** There is no ground truth. The Copernicus comparison is one
  satellite method against another.
- Radar gives flood extent, not depth. The height of the water surface in 3D is illustrative.
- The Selangor passes mix Provisional and Validated NISAR products; Mozambique uses Beta products.
- "Plantation / tree crop" is ESA WorldCover *tree cover* outside OpenStreetMap forest polygons
  (73 % of the Selangor box). WorldCover has no oil-palm class and no oil-palm map was used.
- Sentinel-1 and optical images are from the nearest available day (same morning in Mozambique,
  up to 4 days away in Selangor); the app shows each image's date.
- NASADEM is a surface model, so over trees it follows the canopy, not the ground.
- The exposure ranking is a screening aid from open data, **not a rescue order**.
- Tested in desktop Chrome / Edge and at phone size in an emulator; not on a physical phone, nor
  in Firefox or Safari.

## Controls

| Input | Action |
|---|---|
| `E` / `Q`, a fast sideways flick, or tap a number in the bar | **Swing** to the next / previous sensor |
| `W` `A` `S` `D` / arrows, drag | Fly and look |
| `R` / `F`, `Shift` | Up / down, boost |
| `1`–`9`, mouse wheel, timeline, `L` | Change satellite pass, play the timeline |
| `K` | Exposure ranking and pass details: ranked hexagons, CSV / GeoJSON download, copyable summary, key |
| `M` | 2D map of the same data; click for details, "Fly here in 3D" |
| `G` | Guided tour (just under 30 seconds: title card, then captions from the data) |
| `I`, `O` | How it works, data sources |
| `H` | Controls panel (hidden by default) |
| `V`, or hold `Shift` | Probe under the crosshair: coordinates, land cover, backscatter, pass-by-pass chart |
| `X`, `T` | Lens onto another sensor; flood overlay on / off |
| `0`, `P` | Start view; more / fewer instruments |

Colours: in C-band mode, blue is what C-band flagged. In L-band mode, blue is flood flagged by
both radars and lime is flood flagged by L-band only.

## Data sources

NASA data:

| Dataset | Provider | Link | Used for |
|---|---|---|---|
| **NISAR L2 GCOV**, Validated V1 | NASA / ISRO via ASF DAAC | https://doi.org/10.5067/NIL2GCOV-V1 | Selangor pass of 31 Oct 2026 |
| **NISAR L2 GCOV**, Provisional V1 | NASA / ISRO via ASF DAAC | https://doi.org/10.5067/NIL2GCOV-P1 | Selangor passes of 25 Sep, 7 Oct, 19 Oct 2026 |
| **NISAR L2 GCOV**, Beta V1 | NASA / ISRO via ASF DAAC | https://doi.org/10.5067/NIL2GCOV-B1 | Mozambique, five passes, 30 Nov 2025 to 17 Jan 2026 |
| **OPERA RTC-S1 V1** (Sentinel-1 backscatter) | NASA JPL OPERA via ASF DAAC; contains modified Copernicus Sentinel data | https://doi.org/10.5067/SNWG/OPERA_L2_RTC-S1_V1 | C-band view and detection |
| **HLS v2.0** Sentinel-2 (HLSS30) | NASA LP DAAC | https://doi.org/10.5067/HLS/HLSS30.002 | Optical view, cloud cover |
| **HLS v2.0** Landsat (HLSL30) | NASA LP DAAC | https://doi.org/10.5067/HLS/HLSL30.002 | Optical view, cloud cover |
| **NASADEM** 1 arc-second v001 | NASA LP DAAC | https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001 | 3D terrain, height-above-drainage mask |
| **NASA POWER** daily precipitation | NASA Langley Research Center | https://power.larc.nasa.gov/ | Rain in the 7 days before each pass |

Partner and other data:

| Dataset | Provider | Link | Used for |
|---|---|---|---|
| ESA WorldCover 10 m 2021 v200 | ESA / VITO | https://doi.org/10.5281/zenodo.7254221 | Land cover |
| JRC Global Surface Water v1.4 (Pekel et al. 2016, *Nature* 540, 418-422) | European Commission JRC / Google | https://doi.org/10.1038/nature20584 · https://global-surface-water.appspot.com/ | Permanent-water mask |
| Copernicus EMS Rapid Mapping, EMSR857 | European Commission, Copernicus EMS | https://mapping.emergency.copernicus.eu/activations/EMSR857/ | Independent validation |
| WorldPop 2015-2030 (R2025A), constrained 100 m, 2026 | WorldPop, University of Southampton | https://www.worldpop.org/ | People exposed |
| OpenStreetMap | OpenStreetMap contributors (ODbL) | https://www.openstreetmap.org/copyright | Buildings, roads, places, facilities |

Evacuee counts are from the Malaysian Social Welfare Department (JKM) as reported by BERNAMA;
they are context, not satellite data. NASA also published this Mozambique flood from the same two
NISAR dates (svs.gsfc.nasa.gov/5661). All links above were opened and checked on 15 Nov 2026.

## How the flood map is made

1. Read only the 20 km window of each 6 GB NISAR file from NASA's archive (about 130 MB each).
2. Multilook to a 20 m grid; 5×5 Lee speckle filter.
3. Reference = per-pixel median of the other pre-flood passes on the same track.
4. **Open-water flood**: HH below a water threshold and at least 3 dB lower than the reference.
5. **Flooded vegetation**: tree cover, HH at least 3 dB higher than the reference, and rising at
   least as much as HV (double bounce).
6. Remove permanent water, ground well above the nearest drainage, and tiny patches.

The water threshold comes from Otsu's method; the change thresholds are at least three times the
measured pass-to-pass noise. Sentinel-1 gets the same open-water rule against earlier images on
its own track. Every value used is written to each case's `manifest.json`.

Exposure score per 1 km hexagon: `100 × (0.40·people/max + 0.25·flagged share + 0.20·road km/max + 0.15·facilities/max)`.

## Run it yourself

```bash
cd web && python -m http.server 8000        # then open http://localhost:8000
```

Rebuild the data (needs a free NASA Earthdata login in `~/.netrc`):

```bash
pip install -r pipeline/requirements.txt
python pipeline/01_search_nisar.py     # which NISAR passes are published (no login)
python pipeline/02_fetch_subset.py     # read the AOI window of each granule
python pipeline/04_ancillary.py        # terrain, land cover, OSM, population, Sentinel-1, HLS, rain
python pipeline/03_flood_detect.py     # flood classes, thresholds logged
python pipeline/05_exposure.py         # hexagon ranking
python pipeline/06_export_web.py       # write web/data/<case>/
python pipeline/check_contract.py      # validate the output
```

One config file per case: `pipeline/config.yaml` (Kuala Selangor) and
`pipeline/config.mozambique.yaml` (add `--config pipeline/config.mozambique.yaml` to each step).
A new area is a new config file. `web/` is a static site: plain ES modules, Three.js and MapLibre
from a CDN, no build step. The data contract is in `CLAUDE.md` section 3; a demo guide and video
scripts are in [`docs/DEMO.md`](docs/DEMO.md).

## Built with AI assistance (Claude)

This project was built with AI assistance: Claude (Anthropic), through Claude Code, wrote and
tested the code and documentation under the team's direction. The team chose the cases, reviewed
the results and is responsible for the claims made here.

## Licence

MIT, see `LICENSE`.
