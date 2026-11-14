// HUD: one slim bar (three sensor numbers that double as the sensor selector, one status line),
// minimap read-outs, legend and pass facts (shown in the Exposure sheet), toast, view modes.
import { COLORS, MODES } from './config.js';
import { $, on, state } from './state.js';

let man, stats, toastTimer;
const fmt = (v, d = 1) => (v == null || Number.isNaN(+v) ? '–' : (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
/** Big-number format: whole km² once the figure is large enough for decimals not to matter. */
const big = v => (v == null ? '–' : fmt(v, v >= 10 ? 0 : 1));

/** One hint at a time; it fades by itself. */
export function toast(msg, ms = 4000) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

const DAY = { day: 'numeric', month: 'short', timeZone: 'UTC' };
const dayOf = iso => (iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', DAY) : '');

/** When the image on screen was taken, which is rarely the same day for all three sensors. */
function imageDate(d) {
  if (state.mode === 0) return d.optical_acquired ? dayOf(d.optical_acquired) : '';
  if (state.mode === 1) return d.cband_acquired ? dayOf(d.cband_acquired) : '';
  if (d.lband_pending) return dayOf(d.lband_from);
  return d.nisar_time_utc ? dayOf(d.nisar_time_utc) : '';
}

/** The single status line under the numbers. Says plainly what the figures are and are not. */
function statusLine(d, s) {
  const next = (man.pending_passes || [])[0];
  if (d.lband_pending) {
    return [state.mode === 2
      ? `No NISAR pass on ${dayOf(d.date)}: this is the ${dayOf(d.lband_from)} image.${next ? ` The ${dayOf(next.date)} pass is awaiting release by NASA.` : ''}`
      : `NISAR did not pass on ${dayOf(d.date)}${next ? `; its ${dayOf(next.date)} pass is awaiting release by NASA` : ''}.`, true];
  }
  if ([d.optical_missing, d.cband_missing, d.lband_missing][state.mode]) return ['No image from this sensor within a week of this pass.', true];
  const when = imageDate(d), other = when && when !== dayOf(d.date) ? ` ${MODES[state.mode].short} image taken ${when}.` : '';
  if (s.is_reference) return [`Pre-flood pass: these figures are the detector's background level.${other}`, false];
  if (s.lband_only_km2 != null && s.lband_only_km2 >= 0.5) return [`${fmt(s.lband_only_km2)} km² is flagged by L-band but missed by C-band.${other}`, false];
  return [`${MODES[state.mode].sub}${other}`, false];
}

/** Bottom bar: flood area each sensor flags on the current pass. The cells are the sensor selector. */
function renderBar() {
  const md = MODES[state.mode], d = man.dates[state.dateIdx], s = stats.per_date?.[d.date] || {}, det = s.detected_km2 || {};
  document.documentElement.style.setProperty('--acc', md.acc);
  document.querySelectorAll('.seg').forEach((el, k) => {
    const v = det[MODES[k].key];
    el.classList.toggle('on', k === state.mode);
    el.setAttribute('aria-selected', k === state.mode);
    // An optical "0 km²" under cloud would read as "no flood": say what the sensor actually saw.
    const cloudy = k === 0 && d.optical_cloud_pct != null && d.optical_cloud_pct >= 50 && !(v > 1);
    el.querySelector('b').textContent = cloudy ? `${Math.round(d.optical_cloud_pct)}%` : big(v);
    el.querySelector('i').textContent = cloudy ? 'cloud' : v == null ? (MODES[k].key === 'lband' && d.lband_pending ? 'no pass' : 'no image') : 'km²';
  });
  const [text, warn] = statusLine(d, s);
  $('note').textContent = text;
  $('note').classList.toggle('warn', warn);
  $('scan').classList.toggle('on', state.mode > 0);
  $('passKv').innerHTML =
    `<span>Cloud cover</span><span>${fmt(d.optical_cloud_pct, 0)}%</span>`
    + `<span>Rain, last 7 days</span><span>${fmt(d.rain_mm_prev7d, 0)} mm</span>`
    + `<span>People exposed</span><span>${fmt(s.people_exposed, 0)}</span>`
    + `<span>Roads flooded</span><span>${fmt(s.roads_flooded_km)} km</span>`
    + `<span>Facilities hit</span><span>${fmt(s.facilities_affected, 0)}</span>`
    + (man.simulated ? '<span class="foot">Simulated numbers in this build.</span>' : '')
    + (man.event?.reported || []).filter(r => r.date === d.date)
      .map(r => `<span class="foot">Reported that day: ${r.text}.</span>`).join('');
}

function renderLegend() {
  const m = state.mode;
  const items = m === 0
    ? [['#8fa37a', 'True-colour satellite image'], ['#f2f2f2', 'White: cloud, as imaged']]
    : [
      ['#05080a', 'Dark: smooth water'],
      state.detect && [COLORS.open, m === 1 ? 'Flood flagged by C-band' : 'Flood flagged by both radars'],
      m === 2
        ? (state.detect ? [COLORS.only, 'Flagged by L-band only: C-band misses it'] : ['#d8d8d8', 'Bright trees: flooded below'])
        : ['#6c7277', 'Canopy and standing crops: C-band stops here'],
      ['#ffffff', 'Bright: buildings, trunks'],
      ['#5a1040', 'Hatched: no data'],
    ].filter(Boolean);
  const head = m === 0 ? 'Key' : `Key · overlay ${state.detect ? 'on' : 'off'} <kbd>T</kbd>`;
  $('legend').innerHTML = `<h4>${head}</h4>`
    + items.map(([c, t]) => `<div class="i"><i style="background:${c}"></i>${t}</div>`).join('')
    + '<div class="ill">Illustrative, not data: rain, shimmer, water height, tree and building models. Relief ×2.</div>';
}

// Views: default (clean flight view) -> full instruments -> nothing but the scene.
const VIEWS = ['', 'full', 'clean'], VIEW_NAME = ['Flight view', 'Full instruments: compass, probe and controls', 'Scene only: press P to bring the display back'];
let view = 0;
export function cycleView() {
  view = (view + 1) % VIEWS.length;
  document.body.classList.remove('full', 'clean');
  if (VIEWS[view]) document.body.classList.add(VIEWS[view]);
  toast(VIEW_NAME[view]);
}

export function toggleHelp(force) {
  const on = document.body.classList.toggle('help', force);
  $('hint').setAttribute('aria-expanded', on);
  return on;
}

export function toggleProbe(force) {
  return document.body.classList.toggle('probe', force);
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

/** Per-tick readouts: heading and altitude (in the minimap frame), date line for the probe. */
export function renderReadouts(aglMetres) {
  const hdg = ((-state.yaw * 180 / Math.PI) % 360 + 360) % 360;
  if (document.body.classList.contains('full')) drawTape(hdg);
  $('alt').textContent = Math.round(aglMetres);
  $('hdg').textContent = String(Math.round(hdg) % 360).padStart(3, '0');
  const d = man.dates[state.dateIdx], when = imageDate(d);
  $('readout').textContent = `${d.date} · ${d.label} · ${MODES[state.mode].label}${when ? ` (image of ${when})` : ''}`;
}

export function initHud(ctx, { swingTo }) {
  ({ man, stats } = ctx);
  $('caseTitle').textContent = man.title || '';
  $('simBadge').hidden = !man.simulated;
  $('seg').innerHTML = MODES.map((m, k) =>
    `<button class="seg" role="tab" data-k="${k}" style="--k:${m.acc}" title="${m.label}: ${m.band}"><small>${m.short}</small><span><b>0</b><i>km²</i></span></button>`).join('');
  $('seg').addEventListener('click', e => { const b = e.target.closest('.seg'); if (b) swingTo(+b.dataset.k); });
  $('hint').addEventListener('click', () => toggleHelp());
  on('mode', () => { renderBar(); renderLegend(); });
  on('date', renderBar);
  on('detect', renderLegend);
  renderBar(); renderLegend();
}
