// Sky colour, fog and rain. All ILLUSTRATIVE; only the cloud fraction that drives them is data
// (manifest.dates[].optical_cloud_pct).
import * as THREE from 'three';
import { state } from './state.js';

export function createAtmosphere({ scene, quality, terrain, canvas }) {
  // bg is the colour at the horizon (and of the fog); the sky above it is a CSS gradient behind the canvas
  const skyClear = new THREE.Color(0x9cc6e8), skyCloud = new THREE.Color(0x7b838a), radarBg = new THREE.Color(0x1c3541);
  const bg = new THREE.Color(), top = new THREE.Color();
  let skyCss = '';
  scene.fog = new THREE.Fog(0x9cc6e8, 1000, 6400);

  const RN = quality.rain, SPAN = 480, TALL = 270;
  const off = new Float32Array(RN * 3), seg = new Float32Array(RN * 6);
  for (let k = 0; k < RN; k++) {
    off[k * 3] = (Math.random() - 0.5) * SPAN; off[k * 3 + 1] = Math.random() * TALL - 60; off[k * 3 + 2] = (Math.random() - 0.5) * SPAN;
  }
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.BufferAttribute(seg, 3));
  const rMat = new THREE.LineBasicMaterial({ color: 0xd6e8f4, transparent: true, opacity: 0.5 });
  const rain = new THREE.LineSegments(rGeo, rMat);
  rain.frustumCulled = false; rain.visible = false;
  if (RN) scene.add(rain);

  function fall(dt, p) {
    for (let k = 0; k < RN; k++) {
      let y = off[k * 3 + 1] - dt * 400;
      if (y < -60) { y += TALL; off[k * 3] = (Math.random() - 0.5) * SPAN; off[k * 3 + 2] = (Math.random() - 0.5) * SPAN; }
      off[k * 3 + 1] = y;
      const x = p.x + off[k * 3], z = p.z + off[k * 3 + 2], yy = p.y + y;
      seg[k * 6] = x; seg[k * 6 + 1] = yy; seg[k * 6 + 2] = z;
      seg[k * 6 + 3] = x + 1.8; seg[k * 6 + 4] = yy + 10; seg[k * 6 + 5] = z + 0.9;
    }
    rGeo.attributes.position.needsUpdate = true;
  }

  return {
    update(dt) {
      const fog = scene.fog, c = state.cloud;
      if (state.mode === 0) {
        bg.copy(skyClear).lerp(skyCloud, c);
        fog.near = 1040 * (1 - c) + 80; fog.far = 6400 * (1 - c) + 900 * c;
      } else {
        bg.copy(radarBg); fog.near = 700; fog.far = 3600;
      }
      top.copy(bg).multiplyScalar(state.mode === 0 ? 0.62 : 0.12);
      const css = `linear-gradient(#${top.getHexString()} 0%, #${bg.getHexString()} 46%, #${bg.getHexString()} 100%)`;
      if (css !== skyCss) { skyCss = css; canvas.style.background = css; }
      fog.color.copy(bg);
      terrain.uniforms.uFogColor.value.copy(bg);
      terrain.uniforms.uFogNear.value = fog.near; terrain.uniforms.uFogFar.value = fog.far;

      const raining = RN > 0 && state.mode === 0 && c > 0.25;
      rain.visible = raining;
      if (raining) { rMat.opacity = Math.min(0.6, c * 0.65); fall(dt, state.pos); }
    },
  };
}
