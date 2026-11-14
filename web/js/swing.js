// "Swing your head" to change sensor: yaw + roll out and back over 0.55 s, mode switches at the midpoint.
import { MODES } from './config.js';
import { $, emit, state } from './state.js';

const DURATION = 0.55, ROLL = 0.3, YAW = 0.38;
let cur = null, pending = 0;

function restart(el, cls) { el.className = ''; void el.offsetWidth; el.className = cls; }

export function swing(dir) {
  if (!state.started) return;
  if (cur) { pending = dir; return; }      // a swing pressed mid-swing is queued
  cur = { t: 0, dir, done: false };
  restart($('wipe'), dir > 0 ? 'r' : 'l');
}

/** Swing towards a specific sensor (used by the on-screen selector). */
export function swingTo(k) {
  if (k === state.mode) return;
  swing((k - state.mode + MODES.length) % MODES.length === 1 ? 1 : -1);
}

export function setMode(m) {
  state.mode = (m + MODES.length) % MODES.length;
  emit('mode', state.mode);
}

/** Advance the animation; returns the camera offsets for this frame. */
export function updateSwing(dt) {
  if (!cur) return { roll: 0, yaw: 0 };
  cur.t += dt / DURATION;
  const p = Math.min(1, cur.t), k = Math.sin(Math.PI * p), dir = cur.dir;
  if (p >= 0.5 && !cur.done) {
    cur.done = true;
    setMode(state.mode + dir);
    restart($('flash'), 'go');
  }
  if (p >= 1) {
    cur = null;
    if (pending) { const d = pending; pending = 0; swing(d); }
  }
  return { roll: -dir * k * ROLL, yaw: -dir * k * YAW };
}
