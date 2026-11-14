// FloodLens bootstrap: load the data contract, build the scene, run the loop.
import * as THREE from 'three';
import { MODES, UNIT_M, V_EXAG, pickQuality } from './config.js';
import { $, clamp, emit, on, state } from './state.js';
import { makeGeo } from './geo.js';
import { loadDate, loadManifest, loadStatic } from './loader.js';
import { createTerrain } from './terrain.js';
import { createVegetation } from './vegetation.js';
import { createBuildings } from './buildings.js';
import { createAtmosphere } from './atmosphere.js';
import { initControls } from './controls.js';
import { setMode, swingTo, updateSwing } from './swing.js';
import { initTimeline, setDate, stepDate, togglePlay, updateTimeline } from './timeline.js';
import { cycleView, initHud, renderReadouts, toast } from './hud.js';
import { initMinimap } from './minimap.js';
import { initProbe } from './probe.js';
import { initLabels } from './labels.js';
import { closeModals, initModals, openModal } from './modals.js';

const status = msg => { $('loadMsg').textContent = msg; };

/** Date with the largest L-band flood: the app opens on the most dramatic pass. */
function peakDate(man, stats) {
  let best = 0, max = -1;
  man.dates.forEach((d, i) => {
    const v = stats.per_date?.[d.date]?.detected_km2?.lband ?? 0;
    if (v > max) { max = v; best = i; }
  });
  return best;
}

/** Stable opening shot: above the top-ranked exposure hexagon (or the first town), looking at it. */
function homePose(geo, terrain, hexes, places, date) {
  let target = [0, 0];
  const top = hexes?.features?.find(f => f.properties.rank?.[date] === 1);
  const town = places?.features?.find(f => f.properties.place === 'town') || places?.features?.[0];
  if (top) {
    const ring = top.geometry.coordinates[0].slice(0, -1);
    target = geo.lonLatToWorld(ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length);
  } else if (town) target = geo.lonLatToWorld(...town.geometry.coordinates);
  const x = clamp(target[0] + 230, -geo.W / 2, geo.W / 2), z = clamp(target[1] + 300, -geo.H / 2, geo.H / 2);
  return {
    pos: new THREE.Vector3(x, terrain.groundAt(x, z) + 115, z),
    yaw: Math.atan2(-(target[0] - x), -(target[1] - z)), pitch: -0.3,
  };
}

function readHash(nDates) {
  const q = new URLSearchParams(location.hash.slice(1)), c = (q.get('c') || '').split(',').map(Number);
  const m = parseInt(q.get('m'), 10), d = parseInt(q.get('d'), 10);
  return {
    pose: c.length === 5 && c.every(Number.isFinite) ? { pos: new THREE.Vector3(c[0], c[1], c[2]), yaw: c[3], pitch: c[4] } : null,
    mode: m >= 0 && m < MODES.length ? m : null,
    date: d >= 0 && d < nDates ? d : null,
  };
}

function writeHash() {
  const p = state.pos, c = [p.x, p.y, p.z].map(v => v.toFixed(0)).concat(state.yaw.toFixed(3), state.pitch.toFixed(3));
  try { history.replaceState(null, '', `#c=${c.join(',')}&m=${state.mode}&d=${state.dateIdx}`); } catch { /* sandboxed */ }
}

function applyPose(pose) {
  state.pos.copy(pose.pos); state.yaw = pose.yaw; state.pitch = pose.pitch;
}

async function boot() {
  const quality = pickQuality();
  status('reading manifest');
  const man = await loadManifest();
  $('startSim').hidden = !man.simulated;
  const geo = makeGeo(man);
  let done = 0;
  const stat = await loadStatic(() => status(`loading terrain ${++done}/6`));
  const hash = readHash(man.dates.length);
  const startIdx = hash.date ?? peakDate(man, stat.stats);
  status(`loading pass ${man.dates[startIdx].date}`);
  const first = await loadDate(startIdx);

  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 1, 15000);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x3a4a2a, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-600, 900, -300);
  scene.add(sun);

  const terrain = createTerrain({ man, geo, dem: stat.dem, quality, maxAniso: renderer.capabilities.getMaxAnisotropy() });
  scene.add(terrain.mesh);
  terrain.prepareDate(startIdx, first);
  state.dateIdx = state.fromIdx = startIdx;
  terrain.setDates(startIdx, startIdx);

  const ctx = { man, geo, terrain, scene, camera, quality, land: stat.land, stats: stat.stats, places: stat.places, buildings: stat.buildings };
  const atmosphere = createAtmosphere(ctx);
  const vegetation = createVegetation(ctx);
  createBuildings(ctx);

  state.home = homePose(geo, terrain, stat.hexes, stat.places, man.dates[peakDate(man, stat.stats)].date);
  applyPose(hash.pose || state.home);

  const setLens = onOff => {
    state.lens = onOff;
    const lensMode = state.mode === 2 ? 0 : 2;       // looking through L-band already? lens shows optical
    terrain.setLens(onOff, lensMode);
    $('lensRing').classList.toggle('on', onOff);
    $('lensRing').firstElementChild.textContent = lensMode === 2 ? 'NISAR L-band lens' : 'Optical lens';
    $('lensRing').style.borderColor = MODES[lensMode].acc;
  };
  const actions = {
    setDate, stepDate, openModal, closeModals, cycleView,
    togglePlay: () => toast(togglePlay() ? 'Timeline playing' : 'Timeline paused'),
    toggleDetect() { state.detect = !state.detect; terrain.setDetect(state.detect); emit('detect'); toast('Flood overlay ' + (state.detect ? 'ON' : 'OFF')); },
    toggleLens() { setLens(!state.lens); toast(state.lens ? 'Lens ON · the circle shows another sensor' : 'Lens OFF'); },
    goHome() { applyPose(state.home); toast('Back to the start view'); },
  };

  on('mode', m => { terrain.setMode(m); if (state.lens) setLens(true); });
  initHud(ctx, { swingTo }); initTimeline(ctx); initModals(man);
  const updateControls = initControls({ canvas, geo, terrain, actions });
  const drawMini = initMinimap(ctx), updateProbe = initProbe(ctx), updateLabels = initLabels(ctx);
  setMode(hash.mode ?? 0);

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    const buf = renderer.getDrawingBufferSize(terrain.uniforms.uRes.value);
    terrain.uniforms.uLensR.value = Math.min(buf.x, buf.y) * 0.2;
  }
  addEventListener('resize', resize); resize();

  let last = performance.now(), time = 0, hudT = 1, hashT = 0, dirty = false;
  on('moved', () => { dirty = true; }); on('mode', () => { dirty = true; }); on('date', () => { dirty = true; });
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
    const bob = updateControls(dt);
    updateTimeline(dt);
    const sw = updateSwing(dt);
    camera.position.set(state.pos.x, state.pos.y + bob.y, state.pos.z);
    camera.rotation.set(state.pitch + bob.pitch, state.yaw + sw.yaw, sw.roll + bob.roll);
    atmosphere.update(dt);
    vegetation.update(state.pos);
    terrain.uniforms.uTime.value = time;
    renderer.render(scene, camera);
    updateLabels();
    hudT += dt; hashT += dt;
    if (hudT > 0.08) { hudT = 0; drawMini(); renderReadouts((state.agl || 0) * UNIT_M / V_EXAG); updateProbe(); }
    if (hashT > 1.5 && dirty && state.started) { hashT = 0; dirty = false; writeHash(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const go = $('go');
  go.disabled = false; go.textContent = 'Start flight'; status('');
  go.addEventListener('click', () => {
    $('start').hidden = true; state.started = true; document.body.classList.add('started');
    toast('Swing right with E, or flick, to see through the cloud');
  });

  // Remaining passes load in the background so the first frame is never held up.
  for (let i = 0; i < man.dates.length; i++) {
    if (i === startIdx) continue;
    try { terrain.prepareDate(i, await loadDate(i)); } catch (err) { console.warn('date', i, err); }
  }
  window.floodlens = { state, man, actions, setMode, terrain, renderer };   // console / demo scripting
}

boot().catch(err => {
  console.error(err);
  status('');
  const el = $('startErr');
  el.hidden = false;
  el.textContent = `Could not start: ${err.message}. Serve the web/ folder over HTTP (python -m http.server) and check data/manifest.json.`;
  $('go').textContent = 'Could not start';
});
