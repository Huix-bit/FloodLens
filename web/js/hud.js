// HUD: mode box, sensor comparison panel, legend, toast, presentation views.
import { COLORS, MODES } from './config.js';
import { $, on, state } from './state.js';

let man, stats, toastTimer;
const fmt = (v, d = 1) => (v == null || Number.isNaN(+v) ? '–' : (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

function renderMode() {
  const md = MODES[state.mode];
  document.documentElement.style.setProperty('--acc', md.acc);
  $('modeName').textContent = md.name; $('modeSub').textContent = md.sub;
  $('pips').innerHTML = '◀ ' + MODES.map((_, k) => `<span class="${k === state.mode ? 'on' : ''}">●</span>`).join(' ') + ' ▶';
  $('scan').classList.toggle('on', state.mode > 0);
}

/** Sensor comparison: flood area each sensor detects on the current date (stats.json). */
function renderStats() {
  const d = man.dates[state.dateIdx], s = stats.per_date?.[d.date];
  if (!s) { $('rows').innerHTML = ''; $('note').textContent = 'No statistics for this date.'; return; }
  const det = s.detected_km2 || {};
  const peak = Math.max(0.01, ...Object.values(stats.per_date).map(x => x.detected_km2?.lband ?? 0));
  $('rows').innerHTML = MODES.map((m, k) => {
    const v = det[m.key] ?? 0;
    return `<div class="row ${k === state.mode ? 'on' : ''}"><span class="mono">${m.short}</span>`
      + `<span class="bar"><i style="width:${Math.min(100, v / peak * 100)}%;background:${m.acc}"></i></span>`
      + `<span class="v mono">${fmt(v)} km²</span></div>`;
  }).join('');
  const hidden = s.veg_flood_km2 ?? 0, total = (s.open_flood_km2 ?? 0) + hidden;
  const lead = total < 0.05
    ? 'No flood detected on this pass: only permanent water.'
    : `Hidden under canopy: <b>+${fmt(hidden)} km²</b> that only L-band sees`
      + (total > 0 ? ` (${Math.round(hidden / total * 100)}% of the flood).` : '.');
  $('note').innerHTML = `${lead}<div class="kv">`
    + `<span>Optical cloud cover</span><span>${fmt(d.optical_cloud_pct, 0)}%</span>`
    + `<span>Rain, previous 7 days</span><span>${fmt(d.rain_mm_prev7d, 0)} mm</span>`
    + `<span>People exposed</span><span>${fmt(s.people_exposed, 0)}</span>`
    + `<span>Roads flooded</span><span>${fmt(s.roads_flooded_km)} km</span>`
    + `<span>Facilities affected</span><span>${fmt(s.facilities_affected, 0)}</span></div>`
    + (man.simulated ? '<div class="foot">All numbers are simulated in this build.</div>' : '');
}

function renderLegend() {
  const m = state.mode;
  const items = m === 0
    ? [['#8fa37a', 'True-colour image draped on terrain'], ['#f2f2f2', 'White = cloud, as the satellite saw it']]
    : [
      ['#05080a', 'Dark = smooth water (radar mirrors away)'],
      state.detect && [COLORS.open, 'Detected open-water flood'],
      m === 2
        ? (state.detect ? [COLORS.veg, 'Flooded UNDER canopy (double bounce)'] : ['#d8d8d8', 'Bright tree cover = flooded below (double bounce)'])
        : ['#6c7277', 'Tree canopy: C-band cannot see below'],
      ['#ffffff', 'Bright = buildings, trunks (double bounce)'],
      ['#5a1040', 'Hatched = no data (layover / shadow)'],
    ].filter(Boolean);
  const head = m === 0 ? 'LEGEND' : `LEGEND · OVERLAY ${state.detect ? 'ON' : 'OFF'} [T]`;
  $('legend').innerHTML = `<div class="mono t">${head}</div>`
    + items.map(([c, t]) => `<div class="i"><i style="background:${c}"></i>${t}</div>`).join('')
    + '<div class="ill">Illustrative, not data: rain, water shimmer and water-surface height, tree and building models. Terrain relief ×2.</div>';
}

const VIEWS = ['', 'present', 'clean'], VIEW_NAME = ['Full HUD', 'Presentation view (help hidden)', 'Clean view (no HUD) · P to restore'];
let view = 0;
export function cycleView() {
  view = (view + 1) % VIEWS.length;
  document.body.classList.remove('present', 'clean');
  if (VIEWS[view]) document.body.classList.add(VIEWS[view]);
  toast(VIEW_NAME[view]);
}

/** Per-tick readouts (heading, altitude, date line). */
export function renderReadouts(aglMetres) {
  const hdg = ((-state.yaw * 180 / Math.PI) % 360 + 360) % 360;
  $('hdg').textContent = 'HDG ' + String(Math.round(hdg) % 360).padStart(3, '0') + '°';
  $('alt').textContent = 'ALT ' + String(Math.round(aglMetres)).padStart(3, '0') + ' m';
  const d = man.dates[state.dateIdx];
  $('readout').textContent = `${d.date} · ${d.label.toUpperCase()} · ${MODES[state.mode].name}`;
}

export function initHud(ctx) {
  ({ man, stats } = ctx);
  $('caseTitle').textContent = man.title || '';
  $('simBadge').hidden = !man.simulated;
  on('mode', () => { renderMode(); renderStats(); renderLegend(); });
  on('date', renderStats);
  on('detect', renderLegend);
  renderMode(); renderStats(); renderLegend();
}
