// FPV flight: keyboard, drag-to-look, flick-to-swing, wheel-to-date, on-screen pad.
import { $, clamp, emit, state } from './state.js';
import { swing } from './swing.js';

const SPEED = 220, BOOST = 560, MAX_ALT = 1400, CLEARANCE = 3;
const keys = {};
let holdForward = false, drag = null, wheelLock = 0;
let bob = 0;

export function initControls({ canvas, geo, terrain, actions }) {
  addEventListener('keydown', e => {
    if (e.code === 'Escape') { actions.closeModals(); return; }
    if (!state.started || e.ctrlKey || e.metaKey || e.altKey) return;
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit) actions.setDate(+digit[1] - 1);
    else if (e.code === 'KeyE') swing(1);
    else if (e.code === 'KeyQ') swing(-1);
    else if (e.code === 'KeyT') actions.toggleDetect();
    else if (e.code === 'KeyX') actions.toggleLens();
    else if (e.code === 'KeyL') actions.togglePlay();
    else if (e.code === 'KeyP') actions.cycleView();
    else if (e.code === 'KeyH') actions.goHome();
    else if (e.code === 'KeyI') actions.openModal('modalHow');
    else if (e.code === 'KeyO') actions.openModal('modalSrc');
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; holdForward = false; });

  canvas.addEventListener('pointerdown', e => {
    if (!state.started) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, samples: [{ t: performance.now(), x: e.clientX, yaw: state.yaw }] };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    state.yaw -= dx * 0.0035;
    state.pitch = clamp(state.pitch - dy * 0.0035, -1.45, 0.6);
    const now = performance.now();
    drag.samples.push({ t: now, x: e.clientX, yaw: state.yaw });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 110) drag.samples.shift();
  });
  const endDrag = () => {
    if (!drag) return;
    const s = drag.samples, a = s[0], b = s[s.length - 1], dt = b.t - a.t;
    if (dt > 0 && performance.now() - b.t < 60) {       // released while still moving fast = flick
      const vx = (b.x - a.x) / dt;
      if (Math.abs(vx) > 1.4 && Math.abs(b.x - a.x) > 50) { state.yaw = a.yaw; swing(vx > 0 ? 1 : -1); }
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (!state.started) return;
    const now = performance.now();
    if (now < wheelLock || Math.abs(e.deltaY) < 4) return;
    wheelLock = now + 650;
    actions.stepDate(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  const fwd = $('bF');
  fwd.addEventListener('pointerdown', e => { e.preventDefault(); holdForward = true; });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => fwd.addEventListener(ev, () => { holdForward = false; }));
  $('bQ').addEventListener('click', () => swing(-1));
  $('bE').addEventListener('click', () => swing(1));

  /** Integrate movement for one frame. Returns head-bob offsets for the camera. */
  return function update(dt) {
    let mz = 0, mx = 0, my = 0;
    if (state.started) {
      if (keys.KeyW || keys.ArrowUp || holdForward) mz += 1;
      if (keys.KeyS || keys.ArrowDown) mz -= 1;
      if (keys.KeyD) mx += 1;
      if (keys.KeyA) mx -= 1;
      if (keys.KeyR || keys.Space) my += 1;
      if (keys.KeyF || keys.KeyC) my -= 1;
      if (keys.ArrowLeft) state.yaw += 1.6 * dt;
      if (keys.ArrowRight) state.yaw -= 1.6 * dt;
    } else {
      state.yaw += dt * 0.04;     // slow idle pan behind the start screen
    }
    const boost = keys.ShiftLeft || keys.ShiftRight, sp = boost ? BOOST : SPEED;
    const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw), p = state.pos;
    p.x += (-sy * mz + cy * mx) * sp * dt;
    p.z += (-cy * mz - sy * mx) * sp * dt;
    p.y += my * sp * 0.7 * dt;
    p.x = clamp(p.x, -geo.W / 2 - 200, geo.W / 2 + 200);
    p.z = clamp(p.z, -geo.H / 2 - 200, geo.H / 2 + 200);
    const floor = terrain.heightAt(p.x, p.z) + CLEARANCE;
    p.y = clamp(p.y, floor, MAX_ALT);
    state.agl = p.y - floor + CLEARANCE;

    const moving = mz !== 0 || mx !== 0;
    bob += dt * (moving ? (boost ? 11 : 8) : 1.3);
    if (moving || my) emit('moved');
    return {
      y: Math.sin(bob) * (moving ? 1.2 : 0.45),
      pitch: moving ? Math.sin(bob * 2) * 0.004 : 0,
      roll: Math.sin(bob * 0.5) * (moving ? 0.012 : 0.004),
    };
  };
}
