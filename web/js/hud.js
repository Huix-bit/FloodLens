// HUD: sensor selector, heading tape, sensor comparison, pass facts, legend, toast, presentation views.
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
  document.querySelectorAll('.seg').forEach((el, k) => {
    el.classList.toggle('on', k === state.mode);
    el.setAttribute('aria-selected', k === state.mode);
  });
  $('modeSub').textContent = md.sub;
  $('scan').classList.toggle('on', state.mode > 0);
}

/** Sensor comparison: flood area each sensor detects on the current date (stats.json). */
function renderStats() {
  const d = man.dates[state.dateIdx], s = stats.per_date?.[d.date];
  if (!s) { $('rows').innerHTML = ''; $('note').textContent = 'No statistics for this pass.'; $('passKv').innerHTML = ''; return; }
  const det = s.detected_km2 || {};
  const peak = Math.max(0.01, ...Object.values(stats.per_date).map(x => x.detected_km2?.lband ?? 0));
  $('rows').innerHTML = MODES.map((m, k) => {
    const v = det[m.key] ?? 0;
    return `<div class="row ${k === state.mode ? 'on' : ''}"><span class="n">${m.short}</span>`
      + `<span class="bar"><i style="width:${Math.min(100, v / peak * 100)}%;background:${m.acc}"></i></span>`
      + `<span class="v">${fmt(v)} km²</span></div>`;
  }).join('');
  const hidden = s.veg_flood_km2 ?? 0, total = (s.open_flood_km2 ?? 0) + hidden;
  $('note').innerHTML = total < 0.05
    ? '<div class="callout none"><b>0</b><span>No flood on this pass,<br>only permanent water.</span></div>'
    : `<div class="callout"><b>+${fmt(hidden)}</b><span>km² hidden under canopy.<br>${Math.round(hidden / total * 100)}% of the flood, seen only by L-band.</span></div>`;
  $('passKv').innerHTML =
    `<span>Cloud cover</span><span>${fmt(d.optical_cloud_pct, 0)}%</span>`
    + `<span>Rain, last 7 days</span><span>${fmt(d.rain_mm_prev7d, 0)} mm</span>`
    + `<span>People exposed</span><span>${fmt(s.people_exposed, 0)}</span>`
    + `<span>Roads flooded</span><span>${fmt(s.roads_flooded_km)} km</span>`
    + `<span>Facilities hit</span><span>${fmt(s.facilities_affected, 0)}</span>`
    + (man.simulated ? '<span class="foot">Simulated numbers in this build.</span>' : '');
}

function renderLegend() {
  const m = state.mode;
  const items = m === 0
    ? [['#8fa37a', 'True-colour satellite image'], ['#f2f2f2', 'White: cloud, as imaged']]
    : [
      ['#05080a', 'Dark: smooth water'],
      state.detect && [COLORS.open, 'Open-water flood'],
      m === 2
        ? (state.detect ? [COLORS.veg, 'Flooded under canopy'] : ['#d8d8d8', 'Bright trees: flooded below'])
        : ['#6c7277', 'Canopy: C-band stops here'],
      ['#ffffff', 'Bright: buildings, trunks'],
      ['#5a1040', 'Hatched: no data'],
    ].filter(Boolean);
  const head = m === 0 ? 'Key' : `Key · overlay ${state.detect ? 'on' : 'off'} <kbd>T</kbd>`;
  $('legend').innerHTML = `<h4>${head}</h4>`
    + items.map(([c, t]) => `<div class="i"><i style="background:${c}"></i>${t}</div>`).join('')
    + '<div class="ill">Illustrative, not data: rain, shimmer, water height, tree and building models. Relief ×2.</div>';
}

const VIEWS = ['', 'present', 'clean'], VIEW_NAME = ['Full display', 'Presentation view: help hidden', 'Clean view: press P to bring the display back'];
let view = 0;
export function cycleView() {
  view = (view + 1) % VIEWS.length;
  document.body.classList.remove('present', 'clean');
  if (VIEWS[view]) document.body.classList.add(VIEWS[view]);
  toast(VIEW_NAME[view]);
}

/** Compass tape, drawn like a flight instrument: ticks every 5°, labels every 30°, fixed centre caret. */
function drawTape(hdg) {
  const c = $('tape'), g = c.getContext('2d'), W = c.width, pxPerDeg = W / 90;
  g.clearRect(0, 0, W, c.height);
  g.textAlign = 'center'; g.lineJoin = 'round';
  const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (const [color, grow] of [['#000', 3], ['#fff', 0]]) {
    g.strokeStyle = g.fillStyle = color;
    for (let d = Math.ceil((hdg - 45) / 5) * 5; d <= hdg + 45; d += 5) {
      const x = W / 2 + (d - hdg) * pxPerDeg, dd = ((d % 360) + 360) % 360;
      g.globalAlpha = 1 - Math.abs(x - W / 2) / (W / 2) ** 1 * 0.85;
      g.lineWidth = 2 + grow;
      g.beginPath(); g.moveTo(x, 34); g.lineTo(x, dd % 10 ? 42 : 50); g.stroke();
      if (dd % 30 === 0) {
        g.font = `700 ${card[dd] ? 24 : 19}px "B612 Mono", monospace`;
        if (grow) { g.lineWidth = 5; g.strokeText(card[dd] || String(dd).padStart(3, '0'), x, 24); }
        else g.fillText(card[dd] || String(dd).padStart(3, '0'), x, 24);
      }
    }
    g.globalAlpha = 1;
    g.lineWidth = 2 + grow;
    g.beginPath(); g.moveTo(W / 2, 54); g.lineTo(W / 2 - 9, 66); g.lineTo(W / 2 + 9, 66); g.closePath();
    if (grow) g.stroke(); else g.fill();
    g.font = '700 21px "B612 Mono", monospace';
    const txt = String(Math.round(hdg) % 360).padStart(3, '0') + '°';
    if (grow) { g.lineWidth = 5; g.strokeText(txt, W / 2, 86); } else g.fillText(txt, W / 2, 86);
  }
}

/** Per-tick readouts (heading, altitude, date line). */
export function renderReadouts(aglMetres) {
  drawTape(((-state.yaw * 180 / Math.PI) % 360 + 360) % 360);
  $('alt').textContent = Math.round(aglMetres);
  const d = man.dates[state.dateIdx];
  $('readout').textContent = `${d.date} · ${d.label} · ${MODES[state.mode].label}`;
}

export function initHud(ctx, { swingTo }) {
  ({ man, stats } = ctx);
  $('caseTitle').textContent = man.title || '';
  $('simBadge').hidden = !man.simulated;
  $('seg').innerHTML = MODES.map((m, k) =>
    `<button class="seg" role="tab" data-k="${k}" style="--k:${m.acc}"><b>${m.label}</b><small>${m.band}</small></button>`).join('');
  $('seg').addEventListener('click', e => { const b = e.target.closest('.seg'); if (b) swingTo(+b.dataset.k); });
  on('mode', () => { renderMode(); renderStats(); renderLegend(); });
  on('date', renderStats);
  on('detect', renderLegend);
  renderMode(); renderStats(); renderLegend();
}
