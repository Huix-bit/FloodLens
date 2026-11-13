// One mutable app state + a tiny event bus so modules stay decoupled.
import * as THREE from 'three';

export const state = {
  started: false,
  mode: 0,          // index into MODES
  dateIdx: 0,       // date being shown (transition target)
  fromIdx: 0,       // date being faded out
  mix: 1,           // 0..1 progress fromIdx -> dateIdx
  detect: true,     // flood detection overlay in radar modes
  lens: false,      // NISAR spy lens
  cloud: 0,         // optical cloud fraction 0..1, interpolated between dates
  pos: new THREE.Vector3(),
  yaw: 0,
  pitch: -0.3,
  home: null,       // { pos, yaw, pitch } stable start pose
};

const subs = {};
export const on = (evt, fn) => { (subs[evt] ||= []).push(fn); };
export const emit = (evt, data) => { (subs[evt] || []).forEach(fn => fn(data)); };

export const $ = id => document.getElementById(id);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ease = t => t * t * (3 - 2 * t);
