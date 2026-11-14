// The moment the project is about: swinging from C-band to L-band. Pixels that L-band flags and
// C-band does not pulse for a moment, with the area in a large caption. Swinging back shows the
// same pixels fading out of C-band's picture. Both sets come from the data (flood and C-band masks).
import { $, on, state } from './state.js';

const PULSE_S = 1.6, FADE_S = 1.8, CAPTION_MS = 2300;
let man, stats, uniforms, prev = 0, pulse = 0, miss = 0, timer;

function caption(html, ms = CAPTION_MS) {
  const el = $('reveal');
  el.innerHTML = html;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('on'), ms);
}

function onMode(m) {
  const d = man.dates[state.dateIdx], s = stats.per_date?.[d.date] || {}, extra = s.lband_only_km2;
  // Only when both radars really imaged this pass and the difference is more than detector noise.
  const real = d.cband_flood && !d.lband_pending && !s.is_reference && extra != null && extra >= 0.5;
  if (real && prev === 1 && m === 2) {
    pulse = 1; miss = 0;
    caption(`<b>+${extra.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km²</b><span>revealed by NISAR L-band</span>`);
  } else if (real && prev === 2 && m === 1) {
    miss = 1; pulse = 0;
    caption('<span>C-band misses this</span>', 1700);
  } else { pulse = 0; miss = 0; }
  prev = m;
}

/** Decay the two effects; called every frame. */
export function updateReveal(dt) {
  if (pulse > 0) pulse = Math.max(0, pulse - dt / PULSE_S);
  if (miss > 0) miss = Math.max(0, miss - dt / FADE_S);
  uniforms.uReveal.value = pulse;
  uniforms.uMiss.value = miss;
}

export function initReveal(ctx) {
  ({ man, stats } = ctx);
  uniforms = ctx.terrain.uniforms;
  prev = state.mode;
  on('mode', onMode);
  on('date', () => { pulse = 0; miss = 0; });
}
