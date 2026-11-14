// Reads web/data/ strictly through manifest.json (the data contract). Nothing else touches the network.

let BASE = 'data/';

/**
 * Case studies: data/cases.json lists them, each in its own folder holding one full data contract.
 * ?case=<id> picks one; otherwise the registry's default. With no registry, data/ itself is the case.
 */
/** URL of a file of the current case (for consumers that take a URL, such as the 2D map). */
export const dataUrl = name => BASE + name;

export async function loadCases() {
  let reg = null;
  try { const r = await fetch('data/cases.json', { cache: 'no-cache' }); if (r.ok) reg = await r.json(); } catch { /* single-case build */ }
  const list = reg?.cases || [], want = new URLSearchParams(location.search).get('case');
  let current = null;
  if (want && /^[\w-]+$/.test(want)) { current = want; BASE = `data/${(list.find(c => c.id === want)?.path) || want + '/'}`; }
  else if (list.length) { const c = list.find(x => x.id === reg.default) || list[0]; current = c.id; BASE = 'data/' + c.path; }
  return { list, current };
}
let manifest = null;
const dateCache = new Map();

async function fetchJson(name) {
  const r = await fetch(BASE + name, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

async function fetchBitmap(name) {
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  // No colour conversion / premultiply: DEM and class rasters must keep exact byte values.
  return createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

function rgba(bitmap) {
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

function redChannel(bitmap) {
  const d = rgba(bitmap), out = new Uint8Array(d.length >> 2);
  for (let i = 0; i < out.length; i++) out[i] = d[i << 2];
  return out;
}

function decodeDem(bitmap) {
  const d = rgba(bitmap), out = new Float32Array(d.length >> 2);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = -10000 + (d[j] * 65536 + d[j + 1] * 256 + d[j + 2]) * 0.1;
  return out;
}

function checkGrid(bitmap, name) {
  const { width, height } = manifest.grid;
  if (bitmap.width !== width || bitmap.height !== height) {
    throw new Error(`${name} is ${bitmap.width}x${bitmap.height}, manifest grid is ${width}x${height}`);
  }
}

export async function loadManifest() {
  manifest = await fetchJson('manifest.json');
  for (const k of ['grid', 'bbox_utm', 'bbox_wgs84', 'dem', 'landcover', 'dates', 'stats']) {
    if (!(k in manifest)) throw new Error(`manifest.json is missing "${k}"`);
  }
  if (!manifest.dates.length) throw new Error('manifest.json lists no dates');
  return manifest;
}

/** DEM, land cover, stats and vectors. Vectors are optional: a missing file degrades, never breaks. */
export async function loadStatic(onProgress = () => {}) {
  const optional = name => (name ? fetchJson(name).catch(() => null) : Promise.resolve(null));
  const tick = p => p.then(v => (onProgress(), v));
  const [demBmp, lcBmp, stats, hexes, buildings, places] = await Promise.all([
    tick(fetchBitmap(manifest.dem)), tick(fetchBitmap(manifest.landcover)), tick(fetchJson(manifest.stats)),
    tick(optional(manifest.hexes)), tick(optional(manifest.buildings)), tick(optional(manifest.places)),
  ]);
  checkGrid(demBmp, manifest.dem); checkGrid(lcBmp, manifest.landcover);
  const dem = decodeDem(demBmp), land = redChannel(lcBmp);
  demBmp.close(); lcBmp.close();
  return { dem, land, stats, hexes, buildings, places };
}

/** All rasters of one date. Cached; safe to call repeatedly. */
export function loadDate(i) {
  if (!dateCache.has(i)) {
    const d = manifest.dates[i];
    // cband_flood (what C-band itself flagged) is an optional extension of the contract
    const cf = d.cband_flood ? fetchBitmap(d.cband_flood).catch(() => null) : Promise.resolve(null);
    const p = Promise.all([fetchBitmap(d.optical), fetchBitmap(d.cband), fetchBitmap(d.lband), fetchBitmap(d.flood), cf])
      .then(([optical, cband, lband, floodBmp, cfBmp]) => {
        checkGrid(floodBmp, d.flood);
        const flood = redChannel(floodBmp);
        floodBmp.close();
        const cflood = cfBmp ? redChannel(cfBmp) : null;
        cfBmp?.close();
        const data = { optical, cband, lband, flood, cflood, cbandR: redChannel(cband), lbandR: redChannel(lband) };
        loaded.set(i, data);
        return data;
      });
    p.catch(() => dateCache.delete(i));   // allow a retry after a network error
    dateCache.set(i, p);
  }
  return dateCache.get(i);
}

const loaded = new Map();
/** Synchronous access to a date that has already been loaded (or null). */
export function getDate(i) { return loaded.get(i) || null; }
