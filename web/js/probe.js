// Crosshair probe: what the data says at the point you are looking at, plus a backscatter
// time series across all loaded passes (pixel-inspector idea borrowed from EO Browser).
import { DEFAULT_STRETCH_DB, FLOOD, FLOOD_NAME, LANDCOVER, MODES } from './config.js';
import { getDate } from './loader.js';
import { $, state } from './state.js';

export function initProbe({ man, geo, land, terrain }) {
  const { width: w, height: h } = man.grid;
  const stretch = { c: man.stretch_db?.cband || DEFAULT_STRETCH_DB, l: man.stretch_db?.lband || DEFAULT_STRETCH_DB };
  const toDb = (v, [lo, hi]) => lo + v / 255 * (hi - lo);
  const spark = $('spark'), sctx = spark.getContext('2d');

  /** March the view ray until it goes under the terrain. Returns world x,z or null. */
  function hit() {
    const cp = Math.cos(state.pitch), dx = -Math.sin(state.yaw) * cp, dy = Math.sin(state.pitch), dz = -Math.cos(state.yaw) * cp;
    const p = state.pos;
    let t = 2, prev = 0;
    for (let i = 0; i < 260 && t < 9000; i++) {
      const x = p.x + dx * t, z = p.z + dz * t;
      if (Math.abs(x) > geo.W / 2 || Math.abs(z) > geo.H / 2) { if (dy >= 0) return null; }
      else if (p.y + dy * t <= terrain.heightAt(x, z)) {
        let a = prev, b = t;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2;
          if (p.y + dy * m <= terrain.heightAt(p.x + dx * m, p.z + dz * m)) b = m; else a = m;
        }
        return [p.x + dx * b, p.z + dz * b];
      }
      prev = t; t += Math.max(2, t * 0.03);
    }
    return null;
  }

  /** 3x3 mean of an 8-bit raster, converted to dB. */
  function meanDb(arr, col, row, st) {
    let sum = 0, n = 0;
    for (let y = Math.max(0, row - 1); y <= Math.min(h - 1, row + 1); y++)
      for (let x = Math.max(0, col - 1); x <= Math.min(w - 1, col + 1); x++) { sum += arr[y * w + x]; n++; }
    return toDb(sum / n, st);
  }

  function drawSpark(col, row) {
    const W = spark.width, H = spark.height, n = man.dates.length;
    sctx.clearRect(0, 0, W, H);
    if (n < 2) return;
    const xOf = k => 8 + k / (n - 1) * (W - 16), yOf = db => 6 + (1 - (db + 25) / 25) * (H - 12);
    sctx.strokeStyle = 'rgba(255,255,255,.25)'; sctx.lineWidth = 1;
    sctx.beginPath(); sctx.moveTo(xOf(state.dateIdx), 2); sctx.lineTo(xOf(state.dateIdx), H - 2); sctx.stroke();
    for (const [key, color, st] of [['cbandR', MODES[1].acc, stretch.c], ['lbandR', MODES[2].acc, stretch.l]]) {
      sctx.strokeStyle = sctx.fillStyle = color; sctx.lineWidth = 2.5;
      sctx.beginPath();
      let started = false;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const d = getDate(k);
        if (!d) { started = false; continue; }
        const y = yOf(Math.max(-25, Math.min(0, meanDb(d[key], col, row, st))));
        if (started) sctx.lineTo(xOf(k), y); else sctx.moveTo(xOf(k), y);
        started = true; pts.push([xOf(k), y]);
      }
      sctx.stroke();
      for (const [x, y] of pts) { sctx.beginPath(); sctx.arc(x, y, 3.5, 0, 6.283); sctx.fill(); }
    }
  }

  return function update() {
    const data = getDate(state.dateIdx), at = hit(), el = $('target');
    if (!data || !at) { el.textContent = 'No ground under the crosshair'; sctx.clearRect(0, 0, spark.width, spark.height); return; }
    const [fc, fr] = geo.worldToPx(at[0], at[1]);
    const col = Math.max(0, Math.min(w - 1, fc | 0)), row = Math.max(0, Math.min(h - 1, fr | 0)), i = row * w + col;
    const [lon, lat] = geo.worldToLonLat(at[0], at[1]);
    const where = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
    const parts = [where, LANDCOVER[land[i]] || 'Unknown'];
    if (state.mode === 1) parts.push(`C ${meanDb(data.cbandR, col, row, stretch.c).toFixed(1)} dB`);
    if (state.mode === 2) parts.push(`L-HH ${meanDb(data.lbandR, col, row, stretch.l).toFixed(1)} dB`);
    const f = data.flood[i];
    if (f === FLOOD.VEG && state.mode !== 2) parts.push('looks dry to this sensor');
    else if (f !== FLOOD.DRY) parts.push((f === FLOOD.OPEN || f === FLOOD.VEG ? 'NISAR: ' : '') + FLOOD_NAME[f]);
    el.textContent = parts.join(' · ');
    drawSpark(col, row);
  };
}
