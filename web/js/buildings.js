// Extrude buildings.geojson footprints. Footprints are data; heights flagged height_estimated are illustrative.
import * as THREE from 'three';
import { on } from './state.js';

const COLOR = [0xb9b3a8, 0xdadada, 0xffffff];

function ringToWorld(ring, geo) {
  const pts = ring.map(([lon, lat]) => geo.lonLatToWorld(lon, lat));
  const a = pts[0], b = pts[pts.length - 1];
  if (pts.length > 3 && a[0] === b[0] && a[1] === b[1]) pts.pop();
  return pts;
}

export function createBuildings({ scene, geo, terrain, buildings }) {
  if (!buildings?.features?.length) return null;
  const v = [];
  const tri = (a, b, c) => v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (const f of buildings.features) {
    const g = f.geometry;
    const rings = g?.type === 'Polygon' ? [g.coordinates[0]] : g?.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : [];
    for (const ring of rings) {
      const pts = ringToWorld(ring, geo);
      if (pts.length < 3) continue;
      let lo = Infinity, hi = -Infinity;
      for (const [x, z] of pts) { const y = terrain.groundAt(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      const top = hi + geo.yOf(+f.properties?.height_m || 4), base = lo - 0.5;
      for (let i = 0; i < pts.length; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
        tri([x0, base, z0], [x1, base, z1], [x1, top, z1]);
        tri([x0, base, z0], [x1, top, z1], [x0, top, z0]);
      }
      const faces = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
      for (const [a, b, c] of faces) tri([pts[a][0], top, pts[a][1]], [pts[b][0], top, pts[b][1]], [pts[c][0], top, pts[c][1]]);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: COLOR[0], side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geom, mat);
  scene.add(mesh);
  on('mode', m => { mat.color.setHex(COLOR[m]); mat.emissive.setHex(m === 2 ? 0x555555 : 0x000000); });
  return mesh;
}
