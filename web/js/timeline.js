// Timeline of satellite passes. The number of dates comes from manifest.json, never from code.
import { loadDate } from './loader.js';
import { $, clamp, ease, emit, state } from './state.js';
import { toast } from './hud.js';

const FADE_S = 1.6, PLAY_EVERY_MS = 3400;
let man, terrain, stats, request = 0, playTimer = null;

function renderChips() {
  const peak = Math.max(0.01, ...man.dates.map(d => stats.per_date?.[d.date]?.detected_km2?.lband ?? 0));
  $('chips').innerHTML = man.dates.map((d, k) => {
    const km2 = stats.per_date?.[d.date]?.detected_km2?.lband ?? 0;
    const key = k < 9 ? `${k + 1} · ` : '';
    return `<button class="chip ${k === state.dateIdx ? 'on' : ''}" data-k="${k}" title="${km2.toFixed(1)} km² flooded (L-band)">`
      + `${key}${d.label}<small>${d.date}</small><span class="w"><i style="width:${km2 / peak * 100}%"></i></span></button>`;
  }).join('');
  $('chips').querySelector('.chip.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  $('play').classList.toggle('on', play); $('play').textContent = play ? '❚❚' : '▶';
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
