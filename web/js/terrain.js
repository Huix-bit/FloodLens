// 3D terrain from dem.png, draped with the current sensor's image and the flood masks.
// The mesh is lifted to an estimated water surface where the flood raster says "flooded";
// that height is ILLUSTRATIVE (derived from the DEM, not measured) and labelled so in the legend.
import * as THREE from 'three';
import { COLORS, FLOOD, MODES, V_EXAG } from './config.js';

const VERT = /* glsl */`
attribute float hA;
attribute float hB;
uniform float uT;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vWorld = vec3(position.x, mix(hA, hB, uT), position.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;

const FRAG = /* glsl */`
uniform sampler2D tImgA, tImgB, tLensA, tLensB, tMaskA, tMaskB, tXA, tXB, tNormal;
uniform float uT, uMode, uLensMode, uLens, uLensR, uDetect, uTime, uFogNear, uFogFar, uReveal, uMiss;
uniform vec2 uRes;
uniform vec3 uFogColor, uOpen, uVeg;
varying vec2 vUv;
varying vec3 vWorld;

// mask channels: r open-water flood, g flooded vegetation, b permanent water, a no data
// x channels:    r open-water flood found by C-band, g flagged by L-band but not by C-band
vec3 look(float mode, vec3 img, vec4 m, vec4 x, float light) {
  vec2 p = vWorld.xz * 0.35;                         // illustrative water shimmer / sheen
  float rip = sin(p.x + uTime * 1.4 + sin(p.y * 0.7)) * sin(p.y * 1.3 - uTime * 1.1);
  if (mode < 0.5) {
    vec3 col = img * mix(1.0, light, 0.35);
    return col + max(m.r, m.b) * 0.03 * rip;
  }
  vec3 col = vec3(img.r) * mix(1.0, light, 0.2);
  if (uDetect > 0.5) {
    vec3 water = uOpen * (1.0 + 0.16 * rip) + 0.05 * rip;
    if (mode > 1.5) {
      col = mix(col, water, 0.9 * m.r);
      col = mix(col, uVeg * (0.86 + 0.14 * sin(uTime * 2.2)), 0.88 * m.g);
      // the pixels only L-band finds flash when you arrive from C-band
      col = mix(col, vec3(0.80, 1.0, 0.96), x.g * uReveal * (0.55 + 0.45 * sin(uTime * 13.0)));
    } else {
      col = mix(col, water, 0.9 * x.r);
      // ... and drain out of C-band's picture when you swing back
      col = mix(col, water, 0.75 * x.g * uMiss * (1.0 - x.r));
    }
  }
  float hatch = step(0.5, fract((vWorld.x + vWorld.z) * 0.08));
  return mix(col, mix(vec3(0.05, 0.01, 0.04), vec3(0.22, 0.03, 0.14), hatch), m.a);
}

void main() {
  vec4 m = mix(texture2D(tMaskA, vUv), texture2D(tMaskB, vUv), uT);
  vec3 n = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
  float light = clamp(dot(n, vec3(-0.5, 0.74, -0.45)) / 0.74, 0.35, 1.5);
  vec4 x = mix(texture2D(tXA, vUv), texture2D(tXB, vUv), uT);
  vec3 col = look(uMode, mix(texture2D(tImgA, vUv), texture2D(tImgB, vUv), uT).rgb, m, x, light);
  if (uLens > 0.5) {
    float d = length(gl_FragCoord.xy - uRes * 0.5);
    if (d < uLensR) {
      col = look(uLensMode, mix(texture2D(tLensA, vUv), texture2D(tLensB, vUv), uT).rgb, m, x, light);
      col *= 1.0 - 0.35 * smoothstep(uLensR * 0.8, uLensR, d);
    }
  }
  float fog = smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  #include <colorspace_fragment>
}`;

/** Separable box sum (not mean) with radius r; used as numerator/denominator of a masked mean. */
function boxSum(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let x = 0; x <= r && x < w; x++) acc += src[o + x];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = acc;
      if (x + r + 1 < w) acc += src[o + x + r + 1];
      if (x - r >= 0) acc -= src[o + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = 0; y <= r && y < h; y++) acc += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc;
      if (y + r + 1 < h) acc += tmp[(y + r + 1) * w + x];
      if (y - r >= 0) acc -= tmp[(y - r) * w + x];
    }
  }
  return out;
}

/** Estimated surface (m): DEM where dry; where flooded, the local mean ground height of wet pixels. */
function waterSurface(dem, flood, w, h) {
  const n = w * h, num = new Float32Array(n), den = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = flood[i];
    if (c === FLOOD.PERM || c === FLOOD.OPEN || c === FLOOD.VEG) { num[i] = dem[i]; den[i] = 1; }
  }
  const sn = boxSum(num, w, h, 6), sd = boxSum(den, w, h, 6), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = flood[i];
    out[i] = (c === FLOOD.OPEN || c === FLOOD.VEG) ? Math.max(dem[i], sn[i] / sd[i]) + 0.3 : dem[i];
  }
  return out;
}

function maskTexture(flood, w, h) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < flood.length; i++, j += 4) {
    const c = flood[i];
    if (c === FLOOD.OPEN) px[j] = 255;
    else if (c === FLOOD.VEG) px[j + 1] = 255;
    else if (c === FLOOD.PERM) px[j + 2] = 255;
    else if (c === FLOOD.NODATA) px[j + 3] = 255;
  }
  const t = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

/** r = C-band's own open-water flood, g = flagged by L-band but not by C-band. Without a C-band
 *  mask (older data sets) C-band mode falls back to the open-water class and nothing is "L-only". */
function compareTexture(flood, cflood, w, h) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < flood.length; i++, j += 4) {
    const c = flood[i], wet = c === FLOOD.OPEN || c === FLOOD.VEG;
    if (cflood) { if (cflood[i]) px[j] = 255; else if (wet) px[j + 1] = 255; }
    else if (c === FLOOD.OPEN) px[j] = 255;
  }
  const t = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

function normalTexture(dem, w, h, pixelM) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
    const dx = (dem[y * w + xr] - dem[y * w + xl]) / ((xr - xl) * pixelM) * V_EXAG;
    const dz = (dem[yd * w + x] - dem[yu * w + x]) / ((yd - yu) * pixelM) * V_EXAG;
    const inv = 1 / Math.hypot(dx, 1, dz), j = (y * w + x) * 4;
    px[j] = (-dx * inv * 0.5 + 0.5) * 255; px[j + 1] = (inv * 0.5 + 0.5) * 255; px[j + 2] = (-dz * inv * 0.5 + 0.5) * 255; px[j + 3] = 255;
  }
  const t = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

function imageTexture(bitmap, aniso) {
  const t = new THREE.Texture(bitmap);
  t.flipY = false;                      // row 0 = north = v 0
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}

export function createTerrain({ man, geo, dem, quality, maxAniso }) {
  const { width: w, height: h } = man.grid;
  const SEG = quality.seg, N = SEG + 1, NV = N * N;
  const aniso = Math.min(quality.aniso, maxAniso);

  const pos = new Float32Array(NV * 3), uv = new Float32Array(NV * 2), pix = new Uint32Array(NV);
  for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++, k++) {
    pos[k * 3] = -geo.W / 2 + geo.W * i / SEG; pos[k * 3 + 2] = -geo.H / 2 + geo.H * j / SEG;
    uv[k * 2] = i / SEG; uv[k * 2 + 1] = j / SEG;
    pix[k] = Math.min(h - 1, Math.floor(j / SEG * h)) * w + Math.min(w - 1, Math.floor(i / SEG * w));
  }
  const index = new Uint32Array(SEG * SEG * 6);
  for (let j = 0, q = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    index[q++] = a; index[q++] = c; index[q++] = b; index[q++] = b; index[q++] = c; index[q++] = d;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const hA = new THREE.BufferAttribute(new Float32Array(NV), 1), hB = new THREE.BufferAttribute(new Float32Array(NV), 1);
  geom.setAttribute('hA', hA); geom.setAttribute('hB', hB);
  geom.setIndex(new THREE.BufferAttribute(index, 1));

  const U = {
    tImgA: { value: null }, tImgB: { value: null }, tLensA: { value: null }, tLensB: { value: null },
    tMaskA: { value: null }, tMaskB: { value: null }, tXA: { value: null }, tXB: { value: null },
    uReveal: { value: 0 }, uMiss: { value: 0 }, tNormal: { value: normalTexture(dem, w, h, man.grid.pixel_m) },
    uT: { value: 1 }, uMode: { value: 0 }, uLensMode: { value: 2 }, uLens: { value: 0 }, uLensR: { value: 200 },
    uDetect: { value: 1 }, uTime: { value: 0 }, uFogNear: { value: 1000 }, uFogFar: { value: 6000 },
    uRes: { value: new THREE.Vector2(1, 1) }, uFogColor: { value: new THREE.Color() },
    uOpen: { value: new THREE.Color(COLORS.open) }, uVeg: { value: new THREE.Color(COLORS.veg) },
  };
  const mesh = new THREE.Mesh(geom, new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG }));
  mesh.frustumCulled = false;

  const dates = [];             // per date: { surf, mask, tex: {optical, cband, lband} }
  let from = 0, to = 0, mode = 0, lensMode = 2;
  const collide = new Float32Array(NV);

  function bindImages() {
    U.tImgA.value = dates[from].tex[MODES[mode].key]; U.tImgB.value = dates[to].tex[MODES[mode].key];
    U.tLensA.value = dates[from].tex[MODES[lensMode].key]; U.tLensB.value = dates[to].tex[MODES[lensMode].key];
  }

  function bilinear(arr, cols, rows, fx, fy) {
    fx = Math.max(0, Math.min(cols - 1.001, fx)); fy = Math.max(0, Math.min(rows - 1.001, fy));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, o = y0 * cols + x0;
    return (arr[o] * (1 - tx) + arr[o + 1] * tx) * (1 - ty) + (arr[o + cols] * (1 - tx) + arr[o + cols + 1] * tx) * ty;
  }

  return {
    mesh, uniforms: U,
    isReady: i => !!dates[i],
    /** Build GPU + CPU resources for one loaded date (idempotent). */
    prepareDate(i, data) {
      if (dates[i]) return;
      const surfPx = waterSurface(dem, data.flood, w, h), surf = new Float32Array(NV);
      for (let k = 0; k < NV; k++) surf[k] = geo.yOf(surfPx[pix[k]]);
      dates[i] = {
        surf, mask: maskTexture(data.flood, w, h), cmp: compareTexture(data.flood, data.cflood, w, h),
        tex: { optical: imageTexture(data.optical, aniso), cband: imageTexture(data.cband, aniso), lband: imageTexture(data.lband, aniso) },
      };
    },
    setDates(a, b) {
      from = a; to = b;
      hA.array.set(dates[a].surf); hB.array.set(dates[b].surf); hA.needsUpdate = hB.needsUpdate = true;
      U.tMaskA.value = dates[a].mask; U.tMaskB.value = dates[b].mask;
      U.tXA.value = dates[a].cmp; U.tXB.value = dates[b].cmp;
      const sa = dates[a].surf, sb = dates[b].surf;
      for (let k = 0; k < NV; k++) collide[k] = Math.max(sa[k], sb[k]);
      bindImages();
    },
    setMix(t) { U.uT.value = t; },
    setMode(m) { mode = m; U.uMode.value = m; bindImages(); },
    setLens(on, m = 2) { lensMode = m; U.uLens.value = on ? 1 : 0; U.uLensMode.value = m; bindImages(); },
    setDetect(on) { U.uDetect.value = on ? 1 : 0; },
    /** Top surface (terrain or water) in world units, for camera collision. */
    heightAt: (x, z) => bilinear(collide, N, N, (x + geo.W / 2) / geo.W * SEG, (z + geo.H / 2) / geo.H * SEG),
    /** Bare ground from the DEM in world units, for trees, buildings and labels. */
    groundAt: (x, z) => geo.yOf(bilinear(dem, w, h, (x + geo.W / 2) / geo.upp - 0.5, (z + geo.H / 2) / geo.upp - 0.5)),
  };
}
