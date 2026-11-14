// 2D map mode (MapLibre GL JS, loaded on first use). Same layers as the flight view: the current
// sensor image, the flood classes, and the Flood Exposure Ranking hexagons. No basemap tiles and no
// font server are needed, so the map works offline apart from the MapLibre library itself.
import { COLORS, FLOOD, MODES } from './config.js';
import { dataUrl, getDate } from './loader.js';
import { $, on, state } from './state.js';
import { toast } from './hud.js';

const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
let ctx, actions, map = null, active = false, corners, popup = null, drone = null;
const shown = { sensor: '', flood: '' };

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

/** Flood classes of the current pass as a transparent image, in the colours of the flight view. */
function floodImage() {
  const { width: w, height: h } = ctx.man.grid, data = getDate(state.dateIdx);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  if (!data || !state.detect || state.mode === 0) return c.toDataURL();
  const g = c.getContext('2d'), img = g.createImageData(w, h), px = img.data, f = data.flood;
  const open = [0x2b, 0x70, 0xff], veg = [0x00, 0xff, 0xd0];
  for (let i = 0, j = 0; i < f.length; i++, j += 4) {
    const v = f[i];
    let col = null, a = 215;
    if (v === FLOOD.OPEN) col = open;
    else if (v === FLOOD.VEG && state.mode === 2) col = veg;           // only L-band shows flooded vegetation
    else if (v === 255 && ((i % w) + ((i / w) | 0)) % 6 < 2) { col = [0x5a, 0x10, 0x40]; a = 200; }
    if (col) { px[j] = col[0]; px[j + 1] = col[1]; px[j + 2] = col[2]; px[j + 3] = a; }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
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
  const d = ctx.man.dates[state.dateIdx], key = MODES[state.mode].key;
  // updateImage on a source that is still loading leaves it blank, so only swap when the picture changes
  const url = new URL(dataUrl(d[key]), location.href).href, fl = floodImage();
  if (url !== shown.sensor) { map.getSource('sensor')?.updateImage({ url, coordinates: corners }); shown.sensor = url; }
  if (fl !== shown.flood) { map.getSource('flood')?.updateImage({ url: fl, coordinates: corners }); shown.flood = fl; }
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
  const d = man.dates[state.dateIdx];
  shown.sensor = new URL(dataUrl(d[MODES[state.mode].key]), location.href).href;
  shown.flood = floodImage();
  map = new maplibregl.Map({
    container: 'map2d', attributionControl: false, dragRotate: false, pitchWithRotate: false, maxZoom: 16,
    style: {
      version: 8,
      sources: {
        sensor: { type: 'image', url: shown.sensor, coordinates: corners },
        flood: { type: 'image', url: shown.flood, coordinates: corners },
        hex: { type: 'geojson', data: hexData() },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b1114' } },
        { id: 'sensor', type: 'raster', source: 'sensor', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } },
        { id: 'flood', type: 'raster', source: 'flood', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } },
        { id: 'hex-fill', type: 'fill', source: 'hex', filter: ['>', ['get', 'rank'], 0],
          paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'score'], 0, '#ffd166', 50, '#ff8c42', 100, '#ff2e63'], 'fill-opacity': ['interpolate', ['linear'], ['get', 'score'], 0, 0.08, 100, 0.5] } },
        { id: 'hex-line', type: 'line', source: 'hex', filter: ['>', ['get', 'rank'], 0],
          paint: { 'line-color': '#ffd166', 'line-width': ['case', ['<=', ['get', 'rank'], 5], 2.2, 0.7], 'line-opacity': 0.9 } },
      ],
    },
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  fit();

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
  if (active) { map.resize(); refresh(); placeDrone(); toast('2D map · select a hexagon for details · M returns to the flight'); }
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
