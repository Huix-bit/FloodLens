// "How it works" explainer and "Data sources" list (built from manifest.sources).
import { $ } from './state.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SCENE = `
  <rect x="0" y="104" width="200" height="26" fill="#123a5e"/>
  <rect x="96" y="62" width="5" height="44" fill="#8b6b45"/>
  <ellipse cx="98" cy="58" rx="34" ry="13" fill="#2f6b2a"/>
  <path d="M14 14h16v8H14zM6 16h8v4H6zM30 16h8v4h-8z" fill="#cfe6f5"/>`;

const DIAGRAMS = {
  optical: `<svg viewBox="0 0 200 130">${SCENE}
    <path d="M40 34q14-14 30-4q14-12 30 0q16-10 30 2q16-6 26 8q8 14-10 18H44q-22-4-4-24z" fill="#e9eef2"/>
    <path d="M30 22L74 42" stroke="#ffd166" stroke-width="2.5" stroke-dasharray="5 4"/>
    <text x="100" y="124" fill="#ffd166" font-size="9" text-anchor="middle" font-family="monospace">sunlight stops at the cloud</text></svg>`,
  cband: `<svg viewBox="0 0 200 130">${SCENE}
    <path d="M30 22L84 54" stroke="#8ecbff" stroke-width="2.5"/>
    <path d="M84 54l-14-12M84 54l2-18M84 54l16-10M84 54l-18 2" stroke="#8ecbff" stroke-width="1.5" opacity=".8"/>
    <text x="100" y="124" fill="#8ecbff" font-size="9" text-anchor="middle" font-family="monospace">5.6 cm wave scatters in the fronds</text></svg>`,
  lband: `<svg viewBox="0 0 200 130">${SCENE}
    <path d="M30 22L74 104L96 86" stroke="#00ffd0" stroke-width="2.5" fill="none"/>
    <path d="M96 84L34 20" stroke="#00ffd0" stroke-width="2.5" stroke-dasharray="6 4"/>
    <circle cx="96" cy="86" r="5" fill="none" stroke="#fff" stroke-width="1.5"/>
    <text x="100" y="124" fill="#00ffd0" font-size="9" text-anchor="middle" font-family="monospace">water → trunk → back: double bounce</text></svg>`,
};

function howHtml(man) {
  const L = man.method?.lband?.open_water_hh_db != null ? man.method.lband : null;
  const pending = man.pending_passes || [];
  const num = v => (+v).toFixed(1).replace('-', '−');
  return `
  <p>One flood, three satellites, three very different pictures. FloodLens lets you swing between them over the same ground and the same dates.</p>
  <div class="eye" style="--k:var(--o)">${DIAGRAMS.optical}<div><h4>Optical: blind in the monsoon</h4>
    <p>Optical sensors record reflected sunlight. Sunlight cannot pass cloud, and monsoon floods happen under cloud, so the image shows cloud tops instead of the ground.</p></div></div>
  <div class="eye" style="--k:var(--c)">${DIAGRAMS.cband}<div><h4>C-band: stops at the canopy</h4>
    <p>Radar brings its own illumination and passes cloud and rain. But a 5.6 cm wave is about the size of leaves and fronds: it scatters inside the crown and never reaches the water below.</p></div></div>
  <div class="eye" style="--k:var(--l)">${DIAGRAMS.lband}<div><h4>L-band NISAR: sees under the palms</h4>
    <p>NISAR's 24 cm wave is larger than the fronds, so much of it passes through, mirrors off the flood water, hits a trunk and returns straight to the satellite.</p></div></div>
  <h3>Why open water goes dark</h3>
  <p>Radar looks sideways. Calm water is a mirror, so the pulse reflects <i>away</i> from the satellite (specular reflection) and almost nothing comes back: flooded fields turn black in both radar bands. Dry soil and crops are rough and scatter some energy back, so they look grey.</p>
  <h3>Why flooded palms go bright</h3>
  <p>Water under trees forms a right-angle corner with the trunks. A pulse that reaches it bounces twice (water, then trunk) and returns along the path it came: <b>double bounce</b>. At L-band this raises HH backscatter over flooded plantation by several decibels compared with the same trees on dry ground. C-band shows no such change because its signal never gets through the crown.</p>
  <h3>How the flood map is made</h3>
  <ul>
    <li>Every NISAR pass on one track is compared, pixel by pixel, with the median of the pre-flood passes${L ? ` (${(man.method.reference_dates || []).length} here)` : ''}.</li>
    <li><b style="color:#2b70ff">Open-water flood</b>: HH is below ${L ? `${num(L.open_water_hh_db)} dB` : 'a water threshold'} <i>and</i> at least ${L ? num(L.open_water_drop_db) : '3'} dB lower than before.</li>
    <li><b style="color:var(--l)">Flooded vegetation</b>: over tree or palm land cover, HH is at least ${L ? num(L.flooded_veg_rise_db) : '3'} dB higher than before, and rises at least as much as HV.</li>
    <li>Permanent water, ground well above the nearest drainage, and tiny patches are removed. The water threshold comes from the image histogram (Otsu's method)${L?.noise_sigma_db ? `; the change thresholds are several times the measured pass-to-pass noise (${num(L.noise_sigma_db.tree_cover)} dB over trees)` : ''}.</li>
    <li>Sentinel-1 C-band gets the same open-water rule. It has no flooded-vegetation rule because its signal does not reach the ground under a canopy.</li>
    <li>The crosshair read-out and the small chart show the backscatter of the pixel you are looking at, pass by pass.</li>
  </ul>
  ${pending.length ? `<h3>What this build can and cannot show yet</h3>
  <p class="warn">${pending.map(p => esc(p.note)).join(' ')} Until that pass is released, the L-band passes here are all from before the flood, and the flood date shows only what Sentinel-1 C-band could find. The explanation above is established radar physics; on this event it is still to be confirmed.</p>` : ''}
  <h3>Honest limits</h3>
  <ul>
    <li>Building walls also double-bounce, so towns are bright in every pass; change, not brightness alone, is what flags a flood.</li>
    <li>Wind or heavy rain roughens water and can hide open flood; very dense forest can still block L-band.</li>
    <li>Radar measures extent, not depth. The 3D water surface, rain, shimmer, trees and buildings are illustrative.</li>
    <li>The Flood Exposure Ranking is a screening aid from open data, not a rescue order.</li>
  </ul>
  ${man.simulated ? '<p class="warn">This build runs on simulated stand-in data, so the pictures follow the physics above by construction.</p>' : ''}`;
}

function sourcesHtml(man) {
  const list = (man.sources || []).map(s => `
    <div class="s"><b>${esc(s.name)}</b>${s.nasa ? '<span class="tagn nasa">NASA</span>' : ''}${s.simulated ? '<span class="tagn simd">not yet loaded</span>' : ''}
      <div class="p">${esc(s.provider)}</div>
      <div class="u">Used for: ${esc(s.used_for)}</div>
      ${s.detail ? `<div class="u">${esc(s.detail)}</div>` : ''}
      ${/^https?:\/\//.test(s.url || '') ? `<div class="u"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></div>` : ''}
    </div>`).join('');
  return `
  ${man.simulated ? '<p class="warn">Simulated build. Everything on screen was generated by <code>pipeline/00_mock_data.py</code>. The datasets below are what the real pipeline reads; none of them is displayed yet.</p>' : ''}
  <p>Everything drawn from data is read from the files listed in <code>data/manifest.json</code>. Datasets marked NASA are free and open NASA Earth-science resources.</p>
  <div class="src">${list || '<p>No sources listed in manifest.json.</p>'}</div>
  <h3>Illustrative elements, not data</h3>
  <p>Rain, fog, water shimmer, the height of the water surface, tree and palm models, and building heights flagged as estimated. Terrain relief is exaggerated ×2.</p>`;
}

export function closeModals() {
  document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
}

export function openModal(id) {
  const was = !$(id).hidden;
  closeModals();
  $(id).hidden = was;
}

export function initModals(man) {
  $('howBody').innerHTML = howHtml(man);
  $('srcBody').innerHTML = sourcesHtml(man);
  $('btnHow').addEventListener('click', () => openModal('modalHow'));
  $('btnSrc').addEventListener('click', () => openModal('modalSrc'));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => {
    if (e.target === m || e.target.closest('[data-close]')) closeModals();
  }));
}
