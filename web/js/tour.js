// Guided tour: a 30-second scripted flight (3 s title card, then the story) that tells the story of the current case with its own
// numbers. Made for screen recording (key G). Any other key or a click stops it.
import { MODES, TEAM } from './config.js';
import { $, state } from './state.js';
import { setMode, swingTo } from './swing.js';

let man, stats, actions, run = null;
const DAY = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
const day = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', DAY);
const km2 = v => (v == null ? null : (+v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const int = v => Math.round(+v || 0).toLocaleString('en-US');

function caption(html, title = false) {
  const el = $('caption');
  el.classList.remove('on');
  el.classList.toggle('title', title);
  el.classList.remove('opening');
  void el.offsetWidth;                       // restart the fade
  el.innerHTML = html;
  el.classList.add('on');
}

/** The script is built from the manifest and stats, so it is true for whichever case is loaded. */
function script() {
  const named = man.dates.findIndex(d => d.date === man.default_date);
  const flood = named >= 0 ? named : man.dates.length - 1, before = Math.max(0, flood - 1);
  const d = man.dates[flood], s = stats.per_date?.[d.date] || {}, det = s.detected_km2 || {};
  const place = (man.title || '').split(',')[0];
  const steps = [
    [0, () => { actions.setDate(flood, { quiet: true }); setMode(0);      // always open on the optical view, no swing
      caption(`<b>Team ${TEAM.name}</b><span>${TEAM.challenge}</span><span>${TEAM.tagline}</span>`, true); }],
    [3, () => caption(`<b>${day(d.date)}</b> ${place}`)],
    [5.5, () => caption(d.optical_cloud_pct == null ? 'No optical image this week.'
      : `Optical satellite: <b>${Math.round(d.optical_cloud_pct)}%</b> of the scene is cloud or shadow.`)],
    [9, () => { swingTo(1); caption(`C-band radar sees through cloud: <b>${km2(det.cband) ?? 'no image,'}${det.cband == null ? '' : ' km²'}</b> of open-water flood.`); }],
    [14, () => {
      swingTo(2);
      caption(d.lband_pending ? `NISAR L-band flew over on <b>${(man.pending_passes || [])[0] ? day(man.pending_passes[0].date) : 'a later day'}</b>. NASA has not released that pass yet.`
        : s.lband_only_km2 != null ? `NISAR L-band: <b>${km2(det.lband)} km²</b>. <b>${km2(s.lband_only_km2)} km²</b> of it is missed by C-band.`
          : `NISAR L-band: <b>${km2(det.lband)} km²</b>, with <b>${km2(s.veg_flood_km2)} km²</b> of it under vegetation.`);
    }],
    [19, () => { actions.setDate(before, { quiet: true }); caption(`The same ground on <b>${day(man.dates[before].date)}</b>, before the flood.`); }],
    [22.5, () => { actions.setDate(flood, { quiet: true }); caption(`<b>${day(d.date)}</b>: about <b>${int(s.people_exposed)}</b> residents and <b>${km2(s.roads_flooded_km)} km</b> of roads on flagged ground.`); }],
    [26.5, () => caption('<b>FloodLens</b> See the flood behind the cloud.')],
    [29.8, () => stopTour()],
  ];
  return steps;
}

export function stopTour() {
  if (!run) return;
  run = null;
  document.body.classList.remove('tour');
  $('caption').classList.remove('on', 'title');
}

export function toggleTour() {
  if (run) { stopTour(); return false; }
  actions.closeModals();
  actions.goHome({ quiet: true });
  run = { t: 0, next: 0, steps: script(), yaw0: state.yaw };
  document.body.classList.remove('help');
  document.body.classList.add('tour');
  return true;
}

/** Called every frame: fires due steps and glides the camera forward with a slow pan. */
export function updateTour(dt) {
  if (!run) return;
  run.t += dt;
  while (run && run.next < run.steps.length && run.t >= run.steps[run.next][0]) run.steps[run.next++][1]();
  if (!run) return;
  const speed = 16;
  state.pos.x += -Math.sin(state.yaw) * speed * dt;
  state.pos.z += -Math.cos(state.yaw) * speed * dt;
  state.pos.y = Math.max(state.pos.y - 1.2 * dt, state.pos.y * 0 + 40);
  state.yaw = run.yaw0 + Math.sin(run.t / 29.8 * Math.PI) * 0.22;
}

export function initTour(ctx, a) {
  ({ man, stats } = ctx); actions = a;
  $('btnTour').addEventListener('click', () => toggleTour());
  addEventListener('keydown', e => { if (run && !['KeyG', 'KeyP'].includes(e.code)) stopTour(); }, true);
  addEventListener('pointerdown', e => { if (run && !e.target.closest('#btnTour')) stopTour(); }, true);
}

export { MODES as _modes };
