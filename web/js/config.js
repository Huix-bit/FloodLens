// Shared constants. Nothing here is data: everything data-driven comes from web/data/manifest.json.

export const UNIT_M = 5;   // metres per world unit (horizontal)
export const V_EXAG = 2;   // vertical exaggeration of terrain (labelled in the legend)

export const MODES = [
  { key: 'optical', name: 'OPTICAL EYE', label: 'Optical', band: 'visible light · HLS', short: 'Optical', acc: '#ffd166',
    sub: 'True colour, as an optical satellite sees it. Clouds included.' },
  { key: 'cband', name: 'C-BAND RADAR', label: 'C-band radar', band: '5.6 cm · Sentinel-1', short: 'C-band', acc: '#8ecbff',
    sub: 'Sees through cloud and rain, but stops at the tree canopy.' },
  { key: 'lband', name: 'L-BAND · NISAR', label: 'L-band radar', band: '24 cm · NISAR', short: 'L-band NISAR', acc: '#00ffd0',
    sub: 'Passes the canopy. Flooded trees light up by double bounce.' },
];
export const LBAND = 2;

export const LANDCOVER = ['Other / bare', 'Permanent water', 'Urban', 'Oil palm / tree crop', 'Cropland / grass', 'Forest / woodland'];
export const LC = { OTHER: 0, WATER: 1, URBAN: 2, PALM: 3, CROP: 4, FOREST: 5 };
export const FLOOD = { DRY: 0, PERM: 1, OPEN: 2, VEG: 3, NODATA: 255 };
export const FLOOD_NAME = { 0: 'dry', 1: 'permanent water', 2: 'open-water flood', 3: 'flooded vegetation', 255: 'no data' };
export const COLORS = { open: '#2b70ff', veg: '#00ffd0' };
export const DEFAULT_STRETCH_DB = [-25, 0];

export function pickQuality() {
  const mobile = matchMedia('(pointer:coarse)').matches || Math.min(innerWidth, innerHeight) < 560;
  return mobile
    ? { tier: 'mobile', seg: 256, treeRadius: 115, maxPalms: 1500, maxTrees: 900, rain: 0, dpr: 1.5, aniso: 2 }
    : { tier: 'desktop', seg: 512, treeRadius: 195, maxPalms: 4000, maxTrees: 2500, rain: 2200, dpr: 2, aniso: 8 };
}
