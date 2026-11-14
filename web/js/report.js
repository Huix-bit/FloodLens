// Flood Exposure Ranking sheet: ranked hexagons for the current pass, CSV / GeoJSON downloads
// and a plain-text summary that can be copied into a message or a report.
import { MODES } from './config.js';
import { $, on, state } from './state.js';
import { toast } from './hud.js';

let man, stats, hexes, geo, jump;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 0) => (v == null ? 'n/a' : (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

function centroid(f) {
  const ring = f.geometry.coordinates[0].slice(0, -1);
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}

/** One flat record per ranked hexagon for a date, best rank first. */
export function rankedRows(date) {
  return (hexes?.features || []).map(f => {
    const p = f.properties, [lon, lat] = centroid(f);
    return {
      id: p.id, name: p.name, lon: +lon.toFixed(5), lat: +lat.toFixed(5), rank: p.rank?.[date] ?? null,
      score: p.score?.[date] ?? 0, flood_frac: p.flood_frac?.[date] ?? 0, people: p.people?.[date] ?? 0,
      roads_km: p.roads_km?.[date] ?? 0, facilities: p.facilities?.[date] ?? 0, population: p.population ?? null, feature: f,
    };
  }).filter(r => r.rank != null).sort((a, b) => a.rank - b.rank);
}

function save(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const slug = () => (man.title || 'floodlens').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const COLS = ['rank', 'id', 'name', 'lon', 'lat', 'score', 'flood_frac', 'people', 'roads_km', 'facilities'];

function csv(date) {
  const cell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return [`# FloodLens Flood Exposure Ranking, ${man.title}, satellite pass ${date}. Screening aid from satellite detections and open data, not a rescue order.`,
    COLS.join(',')].concat(rankedRows(date).map(r => COLS.map(c => cell(r[c])).join(','))).join('\n') + '\n';
}

function geojson(date) {
  return JSON.stringify({
    type: 'FeatureCollection', name: `floodlens_exposure_${date}`,
    description: `FloodLens Flood Exposure Ranking, ${man.title}, pass ${date}. Screening aid, not a rescue order.`,
    features: rankedRows(date).map(r => ({
      type: 'Feature', geometry: r.feature.geometry,
      properties: Object.fromEntries(COLS.filter(c => c !== 'lon' && c !== 'lat').map(c => [c, r[c]]).concat([['date', date]])),
    })),
  });
}

/** Plain-language summary of the current pass. Says what was and was not measured. */
export function summaryText() {
  const d = man.dates[state.dateIdx], s = stats.per_date?.[d.date] || {}, det = s.detected_km2 || {};
  const top = rankedRows(d.date).slice(0, 5);
  const lines = [`FloodLens: ${man.title}`, `Satellite pass ${d.date} (${d.label}).`, ''];
  if (d.lband_pending) {
    lines.push(`NISAR did not pass on this date. Sentinel-1 C-band found ${num(det.cband, 1)} km² of open-water flood; flooding under vegetation cannot be assessed without L-band.`);
  } else {
    lines.push(`NISAR L-band flagged ${num(det.lband, 1)} km²: ${num(s.open_flood_km2, 1)} km² open water and ${num(s.veg_flood_km2, 1)} km² under vegetation.`);
    if (s.is_reference) lines.push('This is a pre-flood pass: treat the figure as the detector\'s background level.');
    lines.push(`Same days: Sentinel-1 C-band found ${num(det.cband, 1)} km² of open water; optical (HLS) found ${num(det.optical, 1)} km² with ${num(d.optical_cloud_pct)} % of the scene under cloud or shadow.`);
  }
  if (d.rain_mm_prev7d != null) lines.push(`Rain in the previous 7 days: ${num(d.rain_mm_prev7d)} mm.`);
  lines.push(`On flagged pixels: about ${num(s.people_exposed)} residents, ${num(s.roads_flooded_km, 1)} km of roads, ${num(s.facilities_affected)} schools, clinics or other facilities.`);
  for (const r of man.event?.reported || []) if (r.date === d.date) lines.push(`Reported that day: ${r.text}.`);
  if (top.length) {
    lines.push('', 'Highest exposure (1 km hexagons):');
    top.forEach(r => lines.push(`${r.rank}. near ${r.name} (${r.lat}, ${r.lon}): score ${num(r.score)}, ${num(r.flood_frac * 100)} % flagged, about ${num(r.people)} people, ${num(r.roads_km, 1)} km roads`));
  }
  for (const p of man.pending_passes || []) lines.push('', p.note);
  lines.push('', 'Radar shows flood extent, not depth. The ranking is a screening aid from satellite detections and open data (WorldPop, OpenStreetMap), not a rescue order.',
    `Data: ${(man.sources || []).filter(x => x.nasa).map(x => x.name.split(' (')[0]).join('; ')}.`);
  return lines.join('\n');
}

function render() {
  const d = man.dates[state.dateIdx], rows = rankedRows(d.date), s = stats.per_date?.[d.date] || {};
  const w = man.exposure_weights || {};
  const note = d.lband_pending ? 'No NISAR pass on this date: the ranking uses only what Sentinel-1 C-band found (open water).'
    : s.is_reference ? 'Pre-flood pass: these are the detector\'s background detections, not a flood.' : '';
  $('rankBody').innerHTML = `
    <p class="sub">${esc(d.date)} · ${esc(d.label)} · ${rows.length} of ${hexes?.features?.length || 0} hexagons (1 km) have flagged pixels.</p>
    ${note ? `<p class="warn">${note}</p>` : ''}
    <div class="tools">
      <button class="link" data-do="csv">Download CSV</button>
      <button class="link" data-do="geojson">Download GeoJSON</button>
      <button class="link" data-do="copy">Copy summary</button>
    </div>
    ${rows.length ? `<table class="rank"><thead><tr><th>#</th><th>Nearest place</th><th>Score</th><th>Flagged</th><th>People</th><th>Roads</th><th>Sites</th></tr></thead><tbody>
      ${rows.slice(0, 15).map(r => `<tr data-id="${esc(r.id)}" tabindex="0"><td>${r.rank}</td><td>${esc(r.name)}</td><td><span class="sbar"><i style="width:${Math.min(100, r.score)}%"></i></span>${num(r.score)}</td>`
        + `<td>${num(r.flood_frac * 100)} %</td><td>${num(r.people)}</td><td>${num(r.roads_km, 1)} km</td><td>${num(r.facilities)}</td></tr>`).join('')}
    </tbody></table><p class="sub">Select a row to fly there.</p>` : '<p>No hexagon has flagged pixels on this pass.</p>'}
    <h3>Summary to copy</h3>
    <pre id="sumText">${esc(summaryText())}</pre>
    <h3>How the score is built</h3>
    <p>score = 100 × ( ${num(w.people, 2)} · people ÷ max + ${num(w.flood_frac, 2)} · flagged share + ${num(w.roads_km, 2)} · road km ÷ max + ${num(w.facilities, 2)} · facilities ÷ max ). Maxima are taken over all hexagons and passes of this case. People are WorldPop residents on flagged pixels; roads and facilities are from OpenStreetMap. It is a screening aid, <b>not a rescue order</b>.</p>`;
}

export function initReport(ctx, actions) {
  ({ man, stats, hexes, geo } = ctx);
  jump = actions.jumpTo;
  const body = $('rankBody');
  const open = () => !$('modalRank').hidden;
  on('date', () => { if (open()) render(); });
  $('btnRank').addEventListener('click', () => actions.openModal('modalRank'));
  new MutationObserver(() => { if (open()) render(); }).observe($('modalRank'), { attributes: true, attributeFilter: ['hidden'] });
  body.addEventListener('click', async e => {
    const date = man.dates[state.dateIdx].date, act = e.target.closest('[data-do]')?.dataset.do, row = e.target.closest('tr[data-id]');
    if (act === 'csv') save(`${slug()}_exposure_${date}.csv`, csv(date), 'text/csv');
    else if (act === 'geojson') save(`${slug()}_exposure_${date}.geojson`, geojson(date), 'application/geo+json');
    else if (act === 'copy') {
      try { await navigator.clipboard.writeText(summaryText()); toast('Summary copied'); }
      catch { const r = document.createRange(); r.selectNodeContents($('sumText')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Press Ctrl+C to copy the selected summary'); }
    } else if (row) {
      const r = rankedRows(date).find(x => x.id === row.dataset.id);
      if (r) { actions.closeModals(); jump(r.lon, r.lat); toast(`Hexagon ${r.rank}: near ${r.name}`); }
    }
  });
  body.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('tr[data-id]')?.click(); });
}

export { MODES as _modes };   // keeps the import used if a bundler ever tree-shakes; harmless otherwise
