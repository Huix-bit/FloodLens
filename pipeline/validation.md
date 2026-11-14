# Validation notes

Two case studies. **Case A (Chókwè, Mozambique, January 2026)** is a completed flood with NISAR
passes before and during it; it is where the method is actually tested. **Case B (Kuala Selangor,
Malaysia, November 2026)** is a live event whose NISAR flood pass NASA had not yet released.

# Case A: Limpopo floods at Chókwè, Mozambique, January 2026

Area: 20.48 km × 20.48 km centred on 33.00°E, 24.53°S (Chókwè town, the Limpopo river and its
irrigated floodplain). Land cover (ESA WorldCover): 43 % grass, 27 % crop, 19 % tree cover,
7 % built-up. Config: `pipeline/config.mozambique.yaml`. Numbers from
`pipeline/work/mozambique/flood/detect.json`, 14 November 2026.

## A1. Data

| Sensor | Passes used |
|---|---|
| NISAR L-band, track 114 ascending, frame 165, HH+HV, L2 GCOV **Beta** v1.0.2 | 30 Nov, 12 Dec, 24 Dec 2025, 5 Jan 2026 (pre-flood), **17 Jan 2026 03:42 UTC** (flood) |
| Sentinel-1 C-band (OPERA RTC-S1, VV), track 79 | same five days, 03:18 UTC (24 minutes before NISAR), plus other pre-event acquisitions as reference |
| HLS optical | nearest acquisition to each pass; for the flood pass, 19 Jan 2026 |

## A2. Result on the flood pass (17 January 2026)

| | Area flagged (km²) |
|---|---|
| NISAR L-band, open-water flood | 125.2 |
| NISAR L-band, flooded vegetation (tree cover, within 300 m of open water) | 3.6 |
| **NISAR L-band total** | **128.8** (32 % of the land in the box) |
| Sentinel-1 C-band, open-water flood, same morning | 93.1 |
| HLS optical, 19 Jan | 0.0 (the whole box is cloud; see A4) |

Agreement between the two radars: 73.0 km² flagged by both, **55.8 km² by L-band only**,
20.1 km² by C-band only. By land cover, the L-band-only area is 27.8 km² crop, 16.3 km² grass,
10.5 km² tree cover. In those L-band-only pixels the median backscatter is −17.4 dB at L-band
but −13.0 dB at C-band: the short C-band wave is scattered back by crops, reeds and wind ripples
standing in the water, so the surface does not look like open water to it.

What this does and does not show:
- It shows L-band mapping about 38 % more flood than C-band on the same morning, mostly over
  flooded farmland with vegetation standing in the water.
- It does **not** show a large flood hidden under closed tree canopy. Only 3.6 km² was flagged by
  the double-bounce rule here; this floodplain is mostly open farmland, not plantation.
- No ground truth was available to us, so "flagged" is not the same as "confirmed flooded".

## A3. Detector behaviour on the pre-flood passes

| Pass | Rain, previous 7 days (mm) | Open water (km²) | Flooded vegetation (km²) |
|---|---|---|---|
| 30 Nov 2025 | 166 | 0.08 | 0.0 |
| 12 Dec 2025 | 8 | 3.05 | 0.0 |
| 24 Dec 2025 | 73 | 0.57 | 0.0 |
| 5 Jan 2026 | 15 | 3.46 | 0.01 |
| **17 Jan 2026** | 218 | **125.17** | **3.64** |

The background is 0.1 to 3.5 km²; the flood pass is 36 times the largest of these.
Pass-to-pass noise of the HH change image: 1.1 dB (higher than in Malaysia because rain changes
soil moisture between passes), so the thresholds rose automatically to 3.3 dB (drop) and 3.1 dB
(rise).

One correction was needed and is recorded in the config. Without a distance limit, the
flooded-vegetation rule flagged 11.4 km² of woodland on 30 Nov (after 166 mm of rain) and
15.7 km² on 17 Jan, mostly far from the river: rain-wet woodland brightens at L-band too. With
`veg_max_distance_to_open_m: 300` the 30 Nov figure falls to 0.0 km² and the 17 Jan figure to
3.6 km². This limit suits a river flood; it is switched off for Case B, where flooding under
plantation need not touch open water.

## A4. Optical

The HLS scene nearest the flood pass (19 Jan) is uniformly bright (reflectance about 0.6 in
all bands). Fmask labels 21 % of it cloud and 79 % snow / ice, which cannot be right at 24°S in
summer. The pipeline now counts the snow / ice flag as cloud, giving 100 % cloud for this scene.

## A5. Comparison with NASA's own visualization

NASA's Scientific Visualization Studio published "NISAR Reveals Major Flooding In Mozambique"
(https://svs.gsfc.nasa.gov/5661), using the same two NISAR dates (5 and 17 January 2026) with
close-ups of Chókwè and Macia. We use the same track, the same dates and one of the same places.
We could not download that page's images from the pipeline, so the comparison of flood outlines
is still to be done by eye by the team; it is not claimed here as a quantitative validation.

## A6. Limitations specific to this case

- Beta-quality NISAR products (pre-calibration); fine for change detection, not for absolute values.
- Sentinel-1 is 24 minutes earlier than NISAR and has a different look direction.
- The water threshold sample (JRC occurrence of 95 % or more) is a narrow river here, so it
  includes bank pixels and is brighter than open water; this makes the open-water rule conservative.

# Case B: Kuala Selangor floods, Malaysia, November 2026

Case study: Kuala Selangor floods, November 2026. Area of interest: 20.48 km × 20.48 km centred on
101.35°E, 3.30°N (Ijok, Bukit Rotan, Jeram, Bukit Kuching). Land cover in the area: 73 % tree
cover outside mapped forest (oil palm and other tree crops), 8 % crop / grass, 6 % built-up,
10 % water (mostly sea). About 141,000 residents (WorldPop 2026).

All numbers in this case come from `pipeline/work/flood/detect.json`, written by `03_flood_detect.py` on
14 November 2026. Rerun the pipeline to refresh them.

## B1. What data exists for this flood

| Sensor | Pre-flood | During the flood | Status |
|---|---|---|---|
| NISAR L-band (track 112 ascending, frame 3, HH+HV, 40 MHz) | 25 Sep, 7 Oct, 19 Oct, 31 Oct | **12 Nov 22:50 UTC** | The four pre-flood passes are published (L2 GCOV). The 12 Nov pass was acquired (L0B raw data published 13 Nov) but its L2 GCOV product was **not yet published** when this was written. |
| Sentinel-1 C-band (OPERA RTC-S1, VV) track 70 | 20 Sep, 2 Oct, 14 Oct | **7 Nov 11:33 UTC** | Published and used. |
| Sentinel-1 C-band track 91 | 21 Sep, 3 Oct, 15 Oct, 27 Oct | none yet | Published and used for the baseline dates. |
| HLS optical | 25 Sep, 9 Oct, 19 Oct, 3 Nov | 4 Nov (84 % cloud / shadow) | Published and used. |

So the central claim of FloodLens (L-band sees the flood under the canopy that C-band misses) is
**not yet tested on this event**. It will be as soon as NASA releases the 12 Nov product:
`python pipeline/01_search_nisar.py` then steps 02 to 06 add it with no code change.

Why not the Kelantan floods of November 2025, the original plan: NASA's catalogue holds no NISAR
L2 GCOV over Peninsular Malaysia before 21 June 2026.

## B2. Detector behaviour on the pre-flood passes (false-alarm level)

Every pre-flood NISAR pass was tested against the median of the other three. Anything flagged
here is either a false alarm or a small real change (for example a waterlogged block after rain);
we cannot tell which, so we report it as the detector's background level.

| Pass | Open water (km²) | Under canopy (km²) | Total | Share of land area |
|---|---|---|---|---|
| 25 Sep 2026 | 0.04 | 0.44 | 0.48 | 0.13 % |
| 7 Oct 2026 | 0.00 | 0.01 | 0.01 | < 0.01 % |
| 19 Oct 2026 | 0.01 | 0.07 | 0.08 | 0.02 % |
| 31 Oct 2026 | 0.01 | 0.18 | 0.19 | 0.05 % |

Land area excluding permanent water: about 373 km². A flood signal on the 12 Nov pass should be
read against this background of 0.0 to 0.5 km².

Measured pass-to-pass noise of the HH change image (robust standard deviation between pre-flood
passes, after a 5×5 Lee filter): 0.73 dB over non-tree land, 0.62 dB over tree cover. The change
thresholds used are 3.0 dB (drop, open water) and 3.0 dB (rise, flooded vegetation), which is
4 to 5 times that noise. Estimated equivalent number of looks at 20 m: about 16.

Water threshold: Otsu's method on 40,000 water and 40,000 land pixels gave −12.1 dB for L-band HH
(water median −18.0 dB, land median −6.2 dB). The water sample is JRC surface-water occurrence
of 95 % or more, which here is mostly sea and tidal river; wind roughens the sea, so calm flood
water should fall well below this threshold.

## B3. What Sentinel-1 C-band shows on 7 November

The same open-water rule applied to Sentinel-1 VV, each acquisition compared with the pre-event
acquisitions on its own track:

| Acquisition | Open-water flood (km²) | Note |
|---|---|---|
| 20 Sep (track 70) | 0.03 | pre-event |
| 2 Oct (track 70) | 0.35 | pre-event |
| 14 Oct (track 70) | 0.01 | pre-event |
| **7 Nov (track 70)** | **0.24** | flood |
| 21 Sep to 27 Oct (track 91, four acquisitions) | 0.00 to 0.01 | pre-event |

The 7 November figure (0.24 km²) is inside the range seen on dry dates (0.01 to 0.35 km²). On the
day the Social Welfare Department counted 3,834 evacuees in Selangor (districts of Kuala
Selangor, Gombak and Sabak Bernam), **C-band found no open-water flood in this area that stands
out from its own background.** HLS optical for the same week was 84 % cloud or shadow and showed
no non-permanent water in its clear pixels.

This is consistent with flooding that sits under palm canopy and between houses, where neither
sensor can see it, but it does not prove it. It is also possible that most of the 7 November
flooding lay outside this 20 km box (the 3,834 figure covers three districts). Only the NISAR
flood pass can settle this.

## B4. Ground reports used for comparison

Evacuee counts are from the Social Welfare Department (JKM) InfoBencana portal as reported by
BERNAMA and Malaysian newspapers:

- 7 Nov 2026: 3,834 evacuees in Selangor (Kuala Selangor, Gombak, Sabak Bernam).
- 10 Nov 2026: 848 evacuees in 5 relief centres in Kuala Selangor.
- 14 Nov 2026 (08:00): 1,498 evacuees in 7 relief centres in Kuala Selangor: SK Parit Mahang
  (428), SK Dato' Maharaja Lela (393), SRA Bukit Kuching (311), Dewan Bukit Kuching Tengah,
  KAFA Integrasi Hidayah Bukit Cherakah, SRA Batu 8 Ijok, Dewan Komuniti Penyayang Tanjung Siam.

Of these, SK Dato' Maharaja Lela could be located in OpenStreetMap (101.3524°E, 3.2712°N) and is
labelled in the app. A relief centre marks where displaced people shelter, not the flooded
ground itself, so it is context and not a validation point.

## B5. Known limitations

- NISAR products used are Provisional (v1.0.11) for three passes and Validated (v1.0.20) for one.
  Mixing calibration versions can add a small bias to change detection; the pass-to-pass medians
  per land-cover class agree within 0.4 dB.
- The "oil palm / tree crop" class is ESA WorldCover tree cover outside OpenStreetMap forest,
  wood, wetland and protected-area polygons. It is not a dedicated oil-palm map.
- NASADEM is a surface model: over plantations it follows the canopy top, not the ground, so
  the height-above-drainage mask is loose (15 m) on purpose.
- Sentinel-1 and HLS images are from the nearest available day, up to 4 days from the NISAR pass
  (the app shows the image date next to the pass date).
- Rainfall is NASA POWER (MERRA-2 / GEOS-IT, about 50 km grid), used because the GPM IMERG
  archive needs a separate approval on the Earthdata account.
- The exposure figures count people, roads and facilities on flagged pixels only. With no flood
  pass yet they describe the background level, not the flood.
