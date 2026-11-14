// Top-right minimap: the current sensor image + flood overlay, places, camera arrow. Click to jump.
import { FLOOD, MODES } from './config.js';
import { getDate } from './loader.js';
import { $, emit, on, state } from './state.js';

const SIZE = 256;

export function initMinimap({ man, geo, places }) {
  const mini = $('mini'), ctx = mini.getContext('2d');
  const base = document.createElement('canvas'); base.width = base.height = SIZE;
  const bctx = base.getContext('2d');
  const over = document.createElement('canvas'); over.width = over.height = SIZE;
  const octx = over.getContext('2d'), img = octx.createImageData(SIZE, SIZE);

  const dots = (places?.features || []).map(f => {
    const [x, z] = geo.lonLatToWorld(...f.geometry.coordinates);
    return { u: (x + geo.W / 2) / geo.W, v: (z + geo.H / 2) / geo.H, name: f.properties.name, town: f.properties.place === 'town' };
  });

  function paintOverlay(flood) {
    const d = img.data, { width: w, height: h } = man.grid, lband = state.mode === 2;
    for (let y = 0, j = 0; y < SIZE; y++) {
      const row = Math.min(h - 1, (y + 0.5) / SIZE * h | 0) * w;
      for (let x = 0; x < SIZE; x++, j += 4) {
        const c = flood[row + Math.min(w - 1, (x + 0.5) / SIZE * w | 0)];
        if (c === FLOOD.OPEN) { d[j] = 43; d[j + 1] = 112; d[j + 2] = 255; d[j + 3] = 200; }
        else if (c === FLOOD.VEG && lband) { d[j] = 0; d[j + 1] = 255; d[j + 2] = 208; d[j + 3] = 215; }
        else d[j + 3] = 0;
      }
    }
    octx.putImageData(img, 0, 0);
  }

  function repaint() {
    const data = getDate(state.dateIdx);
    if (!data) return;
    bctx.imageSmoothingEnabled = true;
    bctx.drawImage(data[MODES[state.mode].key], 0, 0, SIZE, SIZE);
    if (state.mode > 0 && state.detect) { paintOverlay(data.flood); bctx.drawImage(over, 0, 0); }
  }
  on('mode', repaint); on('date', repaint); on('detect', repaint);
  repaint();

  mini.addEventListener('click', e => {
    if (!state.started) return;
    const r = mini.getBoundingClientRect();
    state.pos.x = ((e.clientX - r.left) / r.width - 0.5) * geo.W;
    state.pos.z = ((e.clientY - r.top) / r.height - 0.5) * geo.H;
    emit('moved');
  });

  // Scale bar: the largest round distance that fits in 40% of the map width.
  const extentKm = man.grid.width * man.grid.pixel_m / 1000;
  const barKm = [50, 20, 10, 5, 2, 1, 0.5].find(v => v <= extentKm * 0.4) || 0.5;
  $('scaleBar').style.width = (barKm / extentKm * 100).toFixed(1) + '%';
  $('scaleLbl').textContent = `${barKm} km`;

  function label(text, x, y) {
    ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
  }

  return function draw() {
    const s = mini.width;
    ctx.drawImage(base, 0, 0, s, s);
    ctx.font = '700 15px "B612 Mono", monospace'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
    for (const p of dots) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.u * s, p.v * s, p.town ? 5 : 2.5, 0, 6.283); ctx.stroke(); ctx.fill();
      if (p.town) label(p.name, Math.min(s - 140, p.u * s + 10), p.v * s + 5);
    }
    const px = (state.pos.x + geo.W / 2) / geo.W * s, py = (state.pos.z + geo.H / 2) / geo.H * s;
    ctx.save();
    ctx.translate(px, py); ctx.rotate(Math.atan2(-Math.cos(state.yaw), -Math.sin(state.yaw)));
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, s * 0.22, -0.62, 0.62); ctx.closePath(); ctx.fill();
    ctx.fillStyle = MODES[state.mode].acc; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-9, -9); ctx.lineTo(-4, 0); ctx.lineTo(-9, 9); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
  };
}
