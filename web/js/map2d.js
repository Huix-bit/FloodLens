// 2D map mode (MapLibre GL JS, loaded on first use). Same layers as the flight view: the current
// sensor image, the flood classes, and the Flood Exposure Ranking hexagons. No basemap tiles and no
// font server are needed, so the map works offline apart from the MapLibre library itself.
import { COLORS, FLOOD, MODES } from './config.js';
import { getDate } from './loader.js';
import { $, on, state } from './state.js';
import { toast } from './hud.js';

const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
let ctx, actions, map = null, active = false, corners, popup = null, drone = null, under = null;

function loadLib() {
  if (window.maplibregl) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LIB + '.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LIB + '.js'; js.onload = resolve; js.onerror = () => reject(new Error('MapLibre could not be loaded'));
    document.head.appendChild(js);
  });
}

/**
 * The sensor image and flood classes are painted on an ordinary 2D canvas that sits under the
 * (transparent) map and is moved with it. MapLibre's own raster layers drew these images black
 * in testing, and at 20 km across an affine fit to the map projection is exact to a pixel.
 */
function paintUnderlay() {
  const { width: w, height: h } = ctx.man.grid, data = getDate(state.dateIdx), key = MODES[state.mode].key;
  const g = under.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (!data) return;
  if (data[key]) g.drawImage(data[key], 0, 0);
  if (!state.detect || state.mode === 0) return;
  const layer = new ImageData(w, h), px = layer.data, f = data.flood, cf = state.mode === 1 ? data.cflood : null;
  const open = [0x2b, 0x70, 0xff], veg = [0x00, 0xff, 0xd0];
  for (let i = 0, j = 0; i < f.length; i++, j += 4) {
    const v = f[i];
    let col = null, alpha = 215;
    if (cf ? cf[i] : v === FLOOD.OPEN) col = open;
    else if (v === FLOOD.VEG && state.mode === 2) col = veg;           // only L-band shows flooded vegetation
    else if (v === 255 && ((i % w) + ((i / w) | 0)) % 6 < 2) { col = [0x5a, 0x10, 0x40]; alpha = 200; }
    if (col) { px[j] = col[0]; px[j + 1] = col[1]; px[j + 2] = col[2]; px[j + 3] = alpha; }
  }
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').putImageData(layer, 0, 0);
  g.drawImage(tmp, 0, 0);
}

/** Keep the underlay glued to the map: an affine transform from three projected corners. */
function placeUnderlay() {
  const { width: w, height: h } = ctx.man.grid;
  const nw = map.project(corners[0]), ne = map.project(corners[1]), sw = map.project(corners[3]);
  under.style.transform = `matrix(${(ne.x - nw.x) / w},${(ne.y - nw.y) / w},${(sw.x - nw.x) / h},${(sw.y - nw.y) / h},${nw.x},${nw.y})`;
}

function hexData() {
  const date = ctx.man.dates[state.dateIdx].date;
  return {
    type: 'FeatureCollection',
    features: (ctx.hexes?.features || []).map(f => {
      const p = f.properties;
      return {
        type: 'Feature', geometry: f.geometry, properties: {
          id: p.id, name: p.name, rank: p.rank?.[date] ?? 0, score: p.score?.[date] ?? 0, flood: Math.round((p.flood_frac?.[date] ?? 0) * 100),
          people: p.people?.[date] ?? 0, roads: p.roads_km?.[date] ?? 0, sites: p.facilities?.[date] ?? 0,
        },
      };
    }),
  };
}

function refresh() {
  if (!map || !active) return;
  paintUnderlay();
  map.getSource('hex')?.setData(hexData());
  popup?.remove();
}

function placeDrone() {
  if (!map || !active) return;
  const [lon, lat] = ctx.geo.worldToLonLat(state.pos.x, state.pos.z);
  drone.setLngLat([lon, lat]).setRotation(-state.yaw * 180 / Math.PI);
}

function fit() {
  const [w, s, e, n] = ctx.man.bbox_wgs84, wide = innerWidth > 900;
  map.fitBounds([[w, s], [e, n]], { padding: { top: wide ? 120 : 70, bottom: wide ? 200 : 150, left: wide ? 290 : 16, right: wide ? 60 : 16 }, duration: 0 });
}

async function build() {
  await loadLib();
  const { geo, man } = ctx, hw = geo.W / 2, hh = geo.H / 2;
  corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, z]) => geo.worldToLonLat(x, z));   // NW, NE, SE, SW
  map = new maplibregl.Map({
    container: 'map2d', attributionControl: false, dragRotate: false, pitchWithRotate: false, maxZoom: 16,
    style: {
      version: 8,
      sources: { hex: { type: 'geojson', data: hexData() } },
      layers: [
        { id: 'hex-fill', type: 'fill', source: 'hex', filter: ['>', ['get', 'rank'], 0],
          paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'score'], 0, '#ffd166', 50, '#ff8c42', 100, '#ff2e63'], 'fill-opacity': ['interpolate', ['linear'], ['get', 'score'], 0, 0.08, 100, 0.5] } },
        { id: 'hex-line', type: 'line', source: 'hex', filter: ['>', ['get', 'rank'], 0],
          paint: { 'line-color': '#ffd166', 'line-width': ['case', ['<=', ['get', 'rank'], 5], 2.2, 0.7], 'line-opacity': 0.9 } },
      ],
    },
  });
  under = document.createElement('canvas');
  under.id = 'mapUnder';
  under.width = man.grid.width; under.height = man.grid.height;
  map.getContainer().prepend(under);
  map.on('move', placeUnderlay); map.on('resize', placeUnderlay);
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  fit(); placeUnderlay();

  for (const f of ctx.places?.features || []) {
    const kind = f.properties.place;
    if (kind !== 'town' && kind !== 'city' && kind !== 'relief_centre') continue;
    const el = document.createElement('div');
    el.className = 'mplace' + (kind === 'relief_centre' ? ' relief' : '');
    el.textContent = f.properties.name;
    new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(f.geometry.coordinates).addTo(map);
  }
  const el = document.createElement('div');
  el.className = 'mdrone'; el.title = 'Your drone';
  drone = new maplibregl.Marker({ element: el, rotationAlignment: 'map' }).setLngLat(corners[0]).addTo(map);

  map.on('mouseenter', 'hex-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'hex-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', e => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['hex-fill'] })[0], { lng, lat } = e.lngLat;
    const body = hit
      ? `<b>#${hit.properties.rank} · near ${hit.properties.name}</b><dl><dt>Exposure score</dt><dd>${(+hit.properties.score).toFixed(0)}</dd>`
        + `<dt>Flagged area</dt><dd>${hit.properties.flood} %</dd><dt>People on flagged pixels</dt><dd>${(+hit.properties.people).toLocaleString('en-US')}</dd>`
        + `<dt>Roads flagged</dt><dd>${(+hit.properties.roads).toFixed(1)} km</dd><dt>Facilities</dt><dd>${hit.properties.sites}</dd></dl>`
      : `<b>${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}</b>`;
    popup?.remove();
    popup = new maplibregl.Popup({ closeButton: false, maxWidth: '260px' }).setLngLat(e.lngLat)
      .setHTML(`${body}<button class="link" id="flyHere">Fly here in 3D</button>`).addTo(map);
    document.getElementById('flyHere')?.addEventListener('click', () => { toggleMap(false); actions.jumpTo(lng, lat); });
  });
  await new Promise(res => (map.loaded() ? res() : map.once('load', res)));
}

/** The MapLibre instance, or null before first use (for scripting and tests). */
export const getMap = () => map;

export async function toggleMap(force) {
  const want = force ?? !active;
  if (want === active) return active;
  document.body.classList.toggle('map2d', want);       // the container must be visible before MapLibre measures it
  if (want && !map) {
    toast('Loading the 2D map…');
    try { await build(); } catch (err) { document.body.classList.remove('map2d'); map = null; toast(err.message); return false; }
  }
  active = want;
  $('btnMap').firstChild.textContent = active ? '3D flight ' : '2D map ';
  if (active) { map.resize(); placeUnderlay(); refresh(); placeDrone(); toast('2D map · select a hexagon for details · M returns to the flight'); }
  return active;
}

/** Centre the 2D map on a place (used by the ranking list when the map is showing). */
export function mapFlyTo(lon, lat) {
  if (active && map) map.flyTo({ center: [lon, lat], zoom: 13.2 });
  return active;
}

export function initMap2d(c, a) {
  ctx = c; actions = a;
  on('mode', refresh); on('date', refresh); on('detect', refresh);
  on('moved', placeDrone);
  $('btnMap').addEventListener('click', () => toggleMap());
}
