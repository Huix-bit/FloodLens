// Timeline of satellite passes. The number of dates comes from manifest.json, never from code.
import { loadDate } from './loader.js';
import { $, clamp, ease, emit, state } from './state.js';
import { toast } from './hud.js';

const FADE_S = 1.6, PLAY_EVERY_MS = 3400;
let man, terrain, stats, request = 0, playTimer = null;

const DAY = { day: 'numeric', month: 'short', timeZone: 'UTC' };
const dayOf = t => new Date(t).toLocaleDateString('en-GB', DAY);

/** A real time axis: each pass sits where its date falls, with a column showing how much was flooded. */
function renderChips() {
  const n = man.dates.length;
  const times = man.dates.map(d => Date.parse(d.date + 'T00:00:00Z'));
  const dated = times.every(Number.isFinite), t0 = Math.min(...times), span = Math.max(...times) - t0;
  const per = man.dates.map(d => stats.per_date?.[d.date] || {});
  const peak = Math.max(0.01, ...per.map(s => (s.open_flood_km2 ?? 0) + (s.veg_flood_km2 ?? 0)));
  const el = $('chips');
  el.classList.toggle('dense', n > 6);
  el.innerHTML = man.dates.map((d, k) => {
    const open = per[k].open_flood_km2 ?? 0, veg = per[k].veg_flood_km2 ?? 0;
    const frac = n < 2 ? 0.5 : dated && span > 0 ? (times[k] - t0) / span : k / (n - 1);
    return `<button class="chip ${k === state.dateIdx ? 'on' : ''}" data-k="${k}" style="left:${8 + frac * 84}%"`
      + ` title="${d.date}: ${(open + veg).toFixed(1)} km² flooded, ${veg.toFixed(1)} km² of it under canopy">`
      + `<span class="col"><i class="veg" style="height:${veg / peak * 100}%"></i><i class="open" style="height:${open / peak * 100}%"></i></span>`
      + `<span class="tick"></span><b>${dated ? dayOf(times[k]) : d.date}</b>`
      + `<small>${k < 9 ? `${k + 1} · ` : ''}${d.label}</small></button>`;
  }).join('');
  if (dated) {
    const year = t => new Date(t).getUTCFullYear(), last = t0 + span;
    $('tlTitle').textContent = `Satellite passes · ${dayOf(t0)}${year(t0) !== year(last) ? ' ' + year(t0) : ''} to ${dayOf(last)} ${year(last)}`;
  }
}

export async function setDate(k, { quiet = false } = {}) {
  k = clamp(k, 0, man.dates.length - 1);
  if (k === state.dateIdx) return;
  const mine = ++request;
  if (!terrain.isReady(k)) toast(`Loading pass ${man.dates[k].date}…`);
  let data;
  try { data = await loadDate(k); } catch (err) { toast(`Could not load ${man.dates[k].date}: ${err.message}`); return; }
  if (mine !== request) return;             // a newer request superseded this one
  terrain.prepareDate(k, data);
  state.fromIdx = state.dateIdx; state.dateIdx = k; state.mix = 0;
  terrain.setDates(state.fromIdx, k); terrain.setMix(0);
  renderChips();
  emit('date', k);
  if (!quiet) toast(`Satellite pass ${man.dates[k].date} · ${man.dates[k].label}`);
}

export const stepDate = dir => setDate(state.dateIdx + dir);

export function togglePlay(force) {
  const play = force ?? !playTimer;
  clearInterval(playTimer); playTimer = null;
  if (play) playTimer = setInterval(() => setDate((state.dateIdx + 1) % man.dates.length), PLAY_EVERY_MS);
  $('play').textContent = play ? 'Pause' : 'Play';
  return play;
}

/** Advance the cross-fade and the interpolated cloud fraction. */
export function updateTimeline(dt) {
  if (state.mix < 1) {
    state.mix = Math.min(1, state.mix + dt / FADE_S);
    terrain.setMix(ease(state.mix));
  }
  const a = man.dates[state.fromIdx].optical_cloud_pct ?? 0, b = man.dates[state.dateIdx].optical_cloud_pct ?? 0;
  state.cloud = (a + (b - a) * ease(state.mix)) / 100;
}

export function initTimeline(ctx) {
  ({ man, terrain, stats } = ctx);
  renderChips();
  $('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) setDate(+b.dataset.k); });
  $('play').addEventListener('click', () => togglePlay());
}
