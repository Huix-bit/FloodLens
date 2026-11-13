// Place names from places.geojson floating over the terrain.
import * as THREE from 'three';
import { $ } from './state.js';

export function initLabels({ geo, terrain, places, camera }) {
  const host = $('labels');
  const items = (places?.features || []).filter(f => f.geometry?.type === 'Point' && f.properties?.name).map(f => {
    const [x, z] = geo.lonLatToWorld(...f.geometry.coordinates);
    const el = document.createElement('div');
    const town = f.properties.place === 'town' || f.properties.place === 'city';
    el.className = 'place' + (town ? ' town' : '');
    el.textContent = f.properties.name;
    host.appendChild(el);
    return { el, town, p: new THREE.Vector3(x, terrain.groundAt(x, z) + 14, z) };
  });
  const v = new THREE.Vector3();

  return function update() {
    for (const it of items) {
      const dist = it.p.distanceTo(camera.position), reach = it.town ? 3200 : 1500;
      v.copy(it.p).project(camera);
      const show = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && dist < reach;
      if (!show) { it.el.style.opacity = 0; continue; }
      const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
      it.el.style.opacity = Math.min(1, (reach - dist) / (reach * 0.25)).toFixed(2);
      it.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-150%)`;
    }
  };
}
