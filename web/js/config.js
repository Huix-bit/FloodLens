// Shared constants. Nothing here is data: everything data-driven comes from web/data/manifest.json.

export const UNIT_M = 5;   // metres per world unit (horizontal)
export const V_EXAG = 2;   // vertical exaggeration of terrain (labelled in the legend)

export const MODES = [
  { key: 'optical', name: 'OPTICAL EYE', short: 'OPTICAL', acc: '#ffd166',
    sub: 'What an optical satellite sees · true colour, clouds included' },
  { key: 'cband', name: 'C-BAND RADAR', short: 'C-BAND', acc: '#8ecbff',
    sub: 'Sentinel-1 · 5.6 cm waves · through cloud, not under trees' },
  { key: 'lband', name: 'L-BAND · NISAR', short: 'L-BAND·NISAR', acc: '#00ffd0',
    sub: '24 cm waves pass the canopy · flooded palms light up' },
];
export const LBAND = 2;

export const LANDCOVER = ['OTHER / BARE', 'PERMANENT WATER', 'URBAN', 'OIL PALM / TREE CROP', 'CROPLAND / GRASS', 'FOREST'];
export const LC = { OTHER: 0, WATER: 1, URBAN: 2, PALM: 3, CROP: 4, FOREST: 5 };
export const FLOOD = { DRY: 0, PERM: 1, OPEN: 2, VEG: 3, NODATA: 255 };
export const FLOOD_NAME = { 0: 'DRY', 1: 'PERMANENT WATER', 2: 'OPEN-WATER FLOOD', 3: 'FLOODED VEGETATION', 255: 'NO DATA' };
export const COLORS = { open: '#2b70ff', veg: '#00ffd0' };
export const DEFAULT_STRETCH_DB = [-25, 0];

export function pickQuality() {
  const mobile = matchMedia('(pointer:coarse)').matches || Math.min(innerWidth, innerHeight) < 560;
  return mobile
    ? { tier: 'mobile', seg: 256, treeRadius: 115, maxPalms: 1500, maxTrees: 900, rain: 0, dpr: 1.5, aniso: 2 }
    : { tier: 'desktop', seg: 512, treeRadius: 195, maxPalms: 4000, maxTrees: 2500, rain: 2200, dpr: 2, aniso: 8 };
}
