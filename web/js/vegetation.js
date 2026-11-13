// Palms and forest trees. ILLUSTRATIVE models: positions are sampled from the land-cover raster on a
// triangular planting grid around the camera, they are not individual mapped trees.
import * as THREE from 'three';
import { FLOOD, LC } from './config.js';
import { getDate } from './loader.js';
import { on, state } from './state.js';

const SPACING = 6;            // world units between palms (30 m; real estates plant at ~9 m)
const ROW = SPACING * 0.866;  // triangular lattice row pitch

const LOOK = [
  { crown: [0x2f6b2a, 1, false], trunk: 0x6b5135, forest: [0x24522a, 1] },
  { crown: [0x6c7277, 1, false], trunk: 0x50565a, forest: [0x767b80, 1] },
  { crown: [0x2affd5, 0.2, true], trunk: 0xffffff, forest: [0x9aa3a8, 0.3] },
];

function hash(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createVegetation({ scene, geo, land, terrain, quality }) {
  const R = quality.treeRadius;
  const mat = {
    crown: new THREE.MeshLambertMaterial({ color: 0x2f6b2a, transparent: true, flatShading: true }),
    trunk: new THREE.MeshLambertMaterial({ color: 0x6b5135 }),
    trunkL: new THREE.MeshBasicMaterial({ color: 0xffffff }),   // L-band: bright trunks, tinted per instance
    forest: new THREE.MeshLambertMaterial({ color: 0x24522a, transparent: true, flatShading: true }),
  };
  const trunkG = new THREE.CylinderGeometry(0.15, 0.24, 3.6, 6); trunkG.translate(0, 1.8, 0);
  const crownG = new THREE.IcosahedronGeometry(2.7, 0); crownG.scale(1, 0.42, 1); crownG.translate(0, 4.1, 0);
  const treeG = new THREE.IcosahedronGeometry(1, 0); treeG.translate(0, 0.8, 0);

  const mk = (g, m, n) => {
    const im = new THREE.InstancedMesh(g, m, n);
    im.frustumCulled = false; im.count = 0; scene.add(im); return im;
  };
  const trunks = mk(trunkG, mat.trunk, quality.maxPalms);
  const crowns = mk(crownG, mat.crown, quality.maxPalms);
  const forest = mk(treeG, mat.forest, quality.maxTrees);
  const white = new THREE.Color(1, 1, 1), dryL = new THREE.Color(0.32, 0.38, 0.38);
  for (let k = 0; k < quality.maxPalms; k++) trunks.setColorAt(k, white);

  const dummy = new THREE.Object3D();
  let cx = Infinity, cz = Infinity;

  function rebuild(x0, z0) {
    cx = x0; cz = z0;
    const flood = getDate(state.dateIdx)?.flood, lband = state.mode === 2;
    let np = 0, nt = 0;
    const j0 = Math.floor((z0 - R) / ROW), j1 = Math.ceil((z0 + R) / ROW);
    for (let j = j0; j <= j1; j++) {
      const off = (j & 1) * 0.5;
      const i0 = Math.floor((x0 - R) / SPACING), i1 = Math.ceil((x0 + R) / SPACING);
      for (let i = i0; i <= i1; i++) {
        const r1 = hash(i, j), r2 = hash(j + 7919, i);
        const x = (i + off) * SPACING + (r1 - 0.5) * 1.6, z = j * ROW + (r2 - 0.5) * 1.6;
        const d = Math.hypot(x - x0, z - z0);
        if (d > R) continue;
        const [col, row] = geo.worldToPx(x, z);
        if (col < 0 || row < 0 || col >= geo.width || row >= geo.height) continue;
        const p = (row | 0) * geo.width + (col | 0), lc = land[p];
        const fade = Math.min(1, (R - d) / (R * 0.22));
        if (lc === LC.PALM && np < quality.maxPalms) {
          dummy.position.set(x, terrain.groundAt(x, z), z);
          dummy.rotation.set(0, r1 * 6.283, 0);
          dummy.scale.setScalar((0.85 + 0.3 * r2) * fade);
          dummy.updateMatrix();
          trunks.setMatrixAt(np, dummy.matrix); crowns.setMatrixAt(np, dummy.matrix);
          trunks.setColorAt(np, lband && flood && flood[p] !== FLOOD.VEG ? dryL : white);
          np++;
        } else if (lc === LC.FOREST && r2 < 0.62 && nt < quality.maxTrees) {
          dummy.position.set(x, terrain.groundAt(x, z) - 0.6, z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar((3 + 2.4 * r1) * fade);
          dummy.updateMatrix();
          forest.setMatrixAt(nt++, dummy.matrix);
        }
      }
    }
    trunks.count = crowns.count = np; forest.count = nt;
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = forest.instanceMatrix.needsUpdate = true;
    trunks.instanceColor.needsUpdate = true;
  }

  function applyMode(m) {
    const l = LOOK[m];
    mat.crown.color.setHex(l.crown[0]); mat.crown.opacity = l.crown[1]; mat.crown.wireframe = l.crown[2];
    mat.crown.depthWrite = l.crown[1] >= 1;
    mat.trunk.color.setHex(l.trunk);
    trunks.material = m === 2 ? mat.trunkL : mat.trunk;
    mat.forest.color.setHex(l.forest[0]); mat.forest.opacity = l.forest[1]; mat.forest.depthWrite = l.forest[1] >= 1;
    cx = Infinity;   // re-tint trunks
  }
  on('mode', applyMode);
  on('date', () => { cx = Infinity; });

  return {
    /** Re-seat the ring of instances when the camera has moved far enough. */
    update(pos) { if (Math.hypot(pos.x - cx, pos.z - cz) > 14) rebuild(pos.x, pos.z); },
  };
}
