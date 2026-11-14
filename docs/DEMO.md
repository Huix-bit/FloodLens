# FloodLens: what it is, how to demo it, and video scripts

Live site: https://tzehern0703.github.io/FloodLens/

## What we built, in plain words

During a flood, three kinds of satellite look at the same ground and see three different things:

- **Optical** (NASA HLS) photographs sunlight. In a storm it photographs cloud.
- **C-band radar** (Sentinel-1) sees through cloud and finds open water, but its short wave is
  scattered by crops, reeds and tree crowns standing in the water.
- **L-band radar** (NASA / ISRO NISAR) has a longer wave that gets through that vegetation, so
  it maps more of the flood.

FloodLens lets anyone fly over a real flood in the browser and **swing between the three
satellites' views** of the same place on the same day. A bar at the bottom shows how many km²
each one flags. It also ranks 1 km hexagons by exposure (people, roads, facilities on flooded
ground) and lets you download that list.

Everything on screen comes from real, free data, processed by our own pipeline:
NISAR, Sentinel-1 (OPERA RTC-S1), HLS, NASADEM, NASA POWER rainfall, WorldPop, OpenStreetMap.

## The two cases, and the honest headline for each

**Chókwè, Mozambique, 17 January 2026 (the proof).**
Optical: 100 % cloud. C-band: 93 km². NISAR L-band: 129 km². L-band finds 55.8 km² that C-band
misses, mostly flooded farmland with vegetation standing in the water. About 4,400 residents and
100 km of roads are on flagged ground. On the four passes before the flood the detector flags
only 0.1 to 3.5 km².

**Kuala Selangor, Malaysia, November 2026 (the live case).**
On 7 November 3,834 people were evacuated across Selangor. Optical was 84 % cloud and C-band
flagged 0.2 km² in our area, no more than on dry days. NISAR flew over on 12 November; NASA had
not released that image when we submitted. The app shows four real pre-flood NISAR passes and
says plainly that the flood pass is pending.

**Do not claim** that we proved flooding under oil palm in Malaysia, or that the Mozambique result
is validated on the ground. Say "flagged", not "confirmed". Judges check this, and saying it
ourselves is a strength.

## How to demo it live (about 2 minutes)

Use a laptop with a mouse, Chrome or Edge, full screen (F11). Open the site before you start.

| Step | Do this | Say this |
|---|---|---|
| 1 | Start screen, Mozambique is selected. Click **Start flight**. | "This is Chókwè, Mozambique, 17 January 2026, rebuilt from satellite data." |
| 2 | Press **Q** once (optical). | "This is what an optical satellite saw: cloud. One hundred percent." |
| 3 | Press **E** (C-band). | "Sentinel-1 radar sees through the cloud: 93 square kilometres of flood." |
| 4 | Press **E** again (L-band). Pause for the caption. | "Now NISAR. Plus 55.8 square kilometres. The lime area is flood that C-band missed." |
| 5 | Press **4**, then **5**. | "Twelve days earlier: nothing. Then the flood." |
| 6 | Press **K**. | "Who is exposed: ranked one-kilometre hexagons, downloadable as CSV or GeoJSON." |
| 7 | Press **Esc**, then **M**. | "The same data as a 2D map." Press **M** to return. |
| 8 | Reload, choose **Kuala Selangor**, Start. | "This one is happening now. NISAR passed over on 12 November. When NASA releases it, one command adds it." |

Useful keys: **0** start view, **H** controls, **P** hide everything for clean recording,
**V** probe (coordinates and backscatter under the crosshair), **X** lens, **L** play the timeline.

If something goes wrong: press **0** to return to the start view, or reload the page.

## Script: 30-second video

Replace `[TEAM NAME]` with your team name. 66 words with a four-word team name; the limit we set
is 75. Both videos must name the team and the challenge in the first 5 seconds.

| Time | On screen | Narration |
|---|---|---|
| 0:00 | Title card: team name | "We are [TEAM NAME]." |
| 0:02 | Title card: NASA Space Apps Challenge 2026 · Dancing with the SARs | "NASA Space Apps Challenge 2026, Dancing with the SARs." |
| 0:05 | Start of the flight, FloodLens wordmark | "This is FloodLens: see the flood the way NISAR does." |
| 0:10 | Optical (cloud), swing to C-band, swing to L-band with the "+55.8 km²" caption | "It combines NASA's NISAR radar with Sentinel-1 and optical data. Mozambique, January 2026: optical saw cloud, Sentinel-1 found 93 square kilometres of flood, NISAR found 129." |
| 0:20 | Exposure ranking (K), then back to the L-band view | "FloodLens ranks who is in the water, so help can reach them sooner, in any flood, anywhere." |
| 0:30 | End card: site address | (silence) |

How to get the footage: start the flight and press **G**. The guided tour runs 29 seconds, opens on
the optical cloud view, swings to C-band at 7 s and to L-band at 12 s, and writes its own captions
from the data. Use the first 5 seconds of your video for the two title cards, then cut in the tour
from its start and trim the end. Record the K sheet separately for the 0:20 beat if you want it.

## Script: 3 to 5 minute video

Total 4:55. Times are targets; read at a calm pace and trim words rather than rushing.

**0:00 Opening (10 s).** Screen: title card.
> We are [TEAM NAME]. This is our entry for the NASA Space Apps Challenge 2026, challenge
> Dancing with the SARs. Our project is FloodLens.

**0:10 Problem (25 s).** Screen: Selangor case, optical view, cloud and rain.
> Every monsoon, floods in Malaysia displace thousands of people. Responders need to know where the
> water is. But floods happen under cloud, and in plantation country they happen under trees.
> The satellites we rely on cannot see either.

**0:35 Idea (25 s).** Screen: press I, the three diagrams in "How it works".
> Optical sensors stop at cloud. C-band radar passes cloud but scatters in vegetation. NISAR,
> launched by NASA and ISRO in 2025, uses a 24-centimetre L-band wave that gets through.
> FloodLens lets anyone see that difference for themselves.

**1:00 Demo, Mozambique (70 s).** Screen: Start flight, Q, E, E, then 4 and 5.
> This is Chókwè, Mozambique, on 17 January 2026, built entirely from real data. Optical: one
> hundred percent cloud. Swing to Sentinel-1: 93 square kilometres of flood. Swing to NISAR: 129.
> The lime area, 55.8 square kilometres, is flood that C-band missed, mostly farmland with crops
> standing in water. On the four passes before the flood, our detector flags almost nothing.

**2:10 Who is affected (25 s).** Screen: K sheet, then M map, click a hexagon.
> We turn the flood map into a ranking. For each one-kilometre hexagon: how many people, how much
> road, how many schools or clinics are on flooded ground. About 4,400 people here. It downloads
> as CSV or GeoJSON. It is a screening aid, not a rescue order.

**2:35 Malaysia, live (35 s).** Screen: Selangor case, opening caption, timeline with the empty marker.
> Now home. On 7 November, 3,834 people were evacuated across Selangor. Optical saw cloud.
> Sentinel-1 flagged a fifth of a square kilometre here, no more than on a dry day. NISAR flew
> over on 12 November. NASA has not released that image yet, so we show four real passes before
> the flood and an honest empty slot. One command adds it when it arrives.

**3:10 How it works (30 s).** Screen: repository, pipeline folder.
> Our pipeline reads only a 20-kilometre window from each 6-gigabyte NISAR file, straight from
> NASA's archive. It compares each pass with the passes before it, sets its thresholds from the
> data, and logs every number. NASA data used: NISAR, OPERA Sentinel-1, HLS, NASADEM and POWER.

**3:40 Validation (20 s).** Screen: side-by-side of our flood outline and the reference map.
> TO FILL IN once the comparison is done. Template:
> "We compared our 17 January flood outline with [Copernicus EMS activation ___ / UNOSAT product
> ___] for the same area. [__] percent of our flagged area falls inside theirs, and we flag
> [__] square kilometres they do not. NASA's own NISAR image of this flood uses the same two dates."
>
> Until then, say only what is true today: "On the four passes before the flood our detector
> flags between 0.1 and 3.5 square kilometres, against 129 on the flood pass. We have not yet
> compared our outline with an independent flood map."

**4:00 Who would use it, and how it pays for itself (30 s).** Screen: ranking sheet, then the case picker.
> The first users are disaster agencies such as NADMA and the Department of Irrigation and
> Drainage, JPS, who need to know where to look first. For them FloodLens would be free. Insurers
> and plantation companies need the same maps to assess losses; they would pay for an API and
> for per-event reports. Scaling is cheap: a new area is one configuration file, which is how we
> added Mozambique in an afternoon.

**4:30 Limits and next (18 s).** Screen: back to the L-band view.
> We have not yet shown flooding under oil palm in Malaysia; that needs the 12 November pass.
> We have no ground truth, so we say flagged, not confirmed. Next: more passes and validation
> against relief-centre records.

**4:48 Close (7 s).** Screen: end card with the site address.
> FloodLens. See the flood the way NISAR does.

## Recording tips

- Record at 1920×1080, browser full screen. Press **P** twice if you want no interface at all.
- The reveal caption appears only when swinging from C-band to L-band, so always go Q, E, E.
- English narration, or English subtitles if you narrate in another language (rule of the challenge).
- Every link in the submission must open while logged out: test the site, the videos and the
  Drive folder in a private window.
- Declare AI use: Claude (Anthropic) was used to write and test code and documentation.
