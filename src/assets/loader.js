// =============================================================================
// FLATLINE: 2050 — assets/loader.js
// Loads models, textures, HDRIs and audio listed in manifest.js.
//
// PLACEHOLDER-FIRST (CLAUDE.md rule A7.2): if a file is missing or broken, the
// loader never throws. It logs one clear warning and returns a colored
// capsule/box (or flat color / silence) so the game keeps running.
// =============================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
// HDRLoader is the r180+ name of RGBELoader (same loader, RGBELoader is deprecated).
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

import { MODELS, TEXTURES, HDRI, MUSIC, SFX, VOICE } from './manifest.js';
import { audio } from '../core/audio.js';

const BASE = import.meta.env.BASE_URL; // '/' in dev, adjusts for sub-folder builds
const url = (path) => BASE + path;

// --- Shared loader instances --------------------------------------------------
// Recent three.js versions locate the Draco/Basis decoders via import.meta.url,
// so Vite bundles them automatically: no decoder path or CDN needed (works offline).
const draco = new DRACOLoader();
const ktx2 = new KTX2Loader();
// Meshopt (EXT_meshopt_compression) packs skinned characters + their clips small (e.g. kael_hero.glb).
const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
const textureLoader = new THREE.TextureLoader();
const hdrLoader = new HDRLoader();

// Caches so a file is only downloaded once (Umbra + Kael share one .glb, etc.)
const cache = new Map();          // url -> Promise<result>
const missing = new Set();        // every path that fell back to a placeholder

/** Call once after the renderer exists (KTX2 needs to know GPU support). */
export function initLoader(renderer) {
  ktx2.detectSupport(renderer);
  gltfLoader.setKTX2Loader(ktx2);
}

/** List of asset paths currently using placeholders (for debug overlays). */
export function getMissingAssets() {
  return [...missing];
}

// -----------------------------------------------------------------------------
// Missing-file detection
// -----------------------------------------------------------------------------
class MissingAssetError extends Error {}

/**
 * Fetch a file and make sure it is really there. Vite's dev server answers
 * unknown paths with index.html (HTTP 200), so we also reject HTML responses.
 */
async function fetchChecked(path) {
  let res;
  try {
    res = await fetch(url(path));
  } catch (err) {
    throw new MissingAssetError(`network error: ${err.message}`);
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new MissingAssetError(`HTTP ${res.status}`);
  if (type.includes('text/html')) throw new MissingAssetError('file not found');
  // 204 = intercepted by a download manager (see core/audio.js) — treat as missing.
  if (res.status === 204) throw new MissingAssetError('blocked (HTTP 204, download manager?)');
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength === 0) throw new MissingAssetError('empty file');
  return buffer;
}

function warnMissing(kind, path, reason) {
  if (missing.has(path)) return; // warn once per file
  missing.add(path);
  console.warn(
    `%c[ASSET MISSING]%c ${kind} "${path}" (${reason}) → using placeholder. See ASSETS_TODO.md`,
    'color:#ff6a1a;font-weight:bold',
    'color:inherit',
  );
}

// -----------------------------------------------------------------------------
// Placeholder meshes
// -----------------------------------------------------------------------------

/**
 * Build a colored stand-in for a missing model.
 * The group's origin sits at the bottom (feet / wheels) like a real model.
 */
export function createPlaceholder(spec = {}, label = 'placeholder') {
  const { shape = 'box', color = 0xff00ff, size = [1, 1, 1] } = spec;
  const [sx, sy, sz] = size;

  let geometry;
  switch (shape) {
    case 'capsule': {
      const radius = sx;
      geometry = new THREE.CapsuleGeometry(radius, Math.max(0.01, sy - radius * 2), 6, 16);
      break;
    }
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(sx, sx, sy, 20);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(sx, 24, 16);
      break;
    default:
      geometry = new THREE.BoxGeometry(sx, sy, sz);
  }

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.1,
    emissive: new THREE.Color(color).multiplyScalar(0.08),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = sy / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.name = `placeholder:${label}`;
  group.add(mesh);

  // Characters get a glowing "visor" so you can see which way they face (+Z).
  if (shape === 'capsule') {
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(sx * 1.1, 0.08, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x3fa9ff, emissiveIntensity: 3 }),
    );
    visor.position.set(0, sy - 0.25, sx * 0.85);
    group.add(visor);
  }

  group.userData.isPlaceholder = true;
  return group;
}

// -----------------------------------------------------------------------------
// Models
// -----------------------------------------------------------------------------

function findModelEntry(category, key) {
  const entry = MODELS[category]?.[key];
  if (!entry) throw new Error(`manifest.js has no model "${category}.${key}"`);
  return entry;
}

/**
 * Animation clip names differ per source ("CharacterArmature|Idle",
 * "Man_Walk", "headShake"). Normalise them to plain lowercase names
 * ("idle", "walk", "headshake") so every character answers to the same names.
 */
const CLIP_ALIASES = { hitrecieve: 'hit', hitrecieve_2: 'hit_2' }; // fix the source typo
export function normalizeClipName(name) {
  const n = name.replace(/^.*\|/, '').replace(/^(Man|Female)_/, '').toLowerCase();
  return CLIP_ALIASES[n] ?? n;
}

/**
 * Scale a model to a real-world size (manifest `fit`), e.g.
 *   fit: { axis: 'y', size: 1.8 }            → 1.8 m tall, feet on the ground
 *   fit: { axis: 'z', size: 4.6 }            → 4.6 m long car
 *   fit: { axis: 'x', size: 0.2, ground: false }  → weapon, origin untouched
 * Returns a wrapper group so instances keep a clean root transform.
 */
function fitModel(scene, fit) {
  const root = new THREE.Group();
  root.name = scene.name || 'model';
  root.add(scene);
  if (!fit) return root;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true); // precise: includes skinning
  const size = box.getSize(new THREE.Vector3());
  const k = fit.size / Math.max(1e-6, size[fit.axis ?? 'y']);
  scene.scale.multiplyScalar(k);
  if (fit.ground !== false) scene.position.y -= box.min.y * k;
  return root;
}

function parseGLTF(buffer, path) {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  return new Promise((resolve, reject) => gltfLoader.parse(buffer, url(dir), resolve, reject));
}

/**
 * Load a model template. Resolves to:
 *   { scene, animations, isPlaceholder, key }
 * Use createModelInstance() to get a copy you can add to the scene.
 */
export function loadModel(category, key) {
  const entry = findModelEntry(category, key);
  const cacheKey = `model:${entry.path}:${category}.${key}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const promise = (async () => {
    try {
      const buffer = await fetchChecked(entry.path);
      const gltf = await parseGLTF(buffer, entry.path);
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      gltf.animations.forEach((clip) => {
        clip.userData = { ...clip.userData, sourceName: clip.name };
        clip.name = normalizeClipName(clip.name);
      });
      return { scene: fitModel(gltf.scene, entry.fit), animations: gltf.animations, isPlaceholder: false, key };
    } catch (err) {
      warnMissing('model', entry.path, err.message || 'parse error');
      return { scene: createPlaceholder(entry.placeholder, key), animations: [], isPlaceholder: true, key };
    }
  })();

  cache.set(cacheKey, promise);
  return promise;
}

/** Clone a loaded model (skinned meshes keep working thanks to SkeletonUtils). */
export function createModelInstance(template) {
  const root = SkeletonUtils.clone(template.scene);
  root.userData.isPlaceholder = template.isPlaceholder;
  root.userData.animations = template.animations;
  return root;
}

// -----------------------------------------------------------------------------
// Textures
// -----------------------------------------------------------------------------

/** Load one texture file. Resolves to a THREE.Texture or null if missing. */
export function loadTexture(path, { srgb = true, repeat = 1 } = {}) {
  const cacheKey = `tex:${path}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const promise = new Promise((resolve) => {
    textureLoader.load(
      url(path),
      (tex) => {
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat, repeat);
        tex.anisotropy = 8;
        resolve(tex);
      },
      undefined,
      () => {
        warnMissing('texture', path, 'not found');
        resolve(null);
      },
    );
  });
  cache.set(cacheKey, promise);
  return promise;
}

/**
 * Load a PBR texture set from TEXTURES and return a MeshStandardMaterial.
 * Missing maps are simply left out; if all are missing, a flat color is used.
 */
export async function loadMaterial(key, { repeat = 4 } = {}) {
  const entry = TEXTURES[key];
  if (!entry) throw new Error(`manifest.js has no texture set "${key}"`);

  const [map, normalMap, roughnessMap] = await Promise.all([
    loadTexture(entry.maps.map, { srgb: true, repeat }),
    loadTexture(entry.maps.normalMap, { srgb: false, repeat }),
    loadTexture(entry.maps.roughnessMap, { srgb: false, repeat }),
  ]);

  // Optional per-set look tweaks from the manifest (e.g. wet = glossier).
  const look = entry.look ?? {};
  const material = new THREE.MeshStandardMaterial({
    color: map ? (look.color ?? 0xffffff) : entry.placeholder.color,
    roughness: look.roughness ?? 1,      // multiplies the roughness map
    metalness: look.metalness ?? 0,
    envMapIntensity: look.envMapIntensity ?? 1,
  });
  if (map) material.map = map;
  if (normalMap) {
    material.normalMap = normalMap;
    if (look.normalScale) material.normalScale.setScalar(look.normalScale);
  }
  if (roughnessMap) material.roughnessMap = roughnessMap;
  material.userData.isPlaceholder = !map;
  return material;
}

// -----------------------------------------------------------------------------
// HDRI environments
// -----------------------------------------------------------------------------

/**
 * Load an HDRI. Resolves to { texture, color, isPlaceholder }.
 * texture is null when missing; callers fall back to `color` as background.
 */
export function loadHDRI(key) {
  const entry = HDRI[key];
  if (!entry) throw new Error(`manifest.js has no HDRI "${key}"`);
  const cacheKey = `hdri:${entry.path}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const promise = (async () => {
    try {
      const buffer = await fetchChecked(entry.path);
      const data = hdrLoader.parse(buffer);
      const texture = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, data.type);
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = true;
      texture.needsUpdate = true;
      return { texture, color: entry.placeholder.color, isPlaceholder: false };
    } catch (err) {
      warnMissing('hdri', entry.path, err.message || 'parse error');
      return { texture: null, color: entry.placeholder.color, isPlaceholder: true };
    }
  })();
  cache.set(cacheKey, promise);
  return promise;
}

// -----------------------------------------------------------------------------
// Batch preloading (drives the loading screen)
// -----------------------------------------------------------------------------

const AUDIO_TABLES = { music: MUSIC, sfx: SFX, voice: VOICE };

/** Load one 'category.key' id from a PRELOAD group. Never rejects. */
function loadById(id) {
  const [category, key] = id.split('.');
  if (MODELS[category]) return loadModel(category, key);
  if (category === 'hdri') return loadHDRI(key);
  if (category === 'textures') return loadMaterial(key);
  if (AUDIO_TABLES[category]) {
    const entry = AUDIO_TABLES[category][key];
    if (!entry) return Promise.resolve(null);
    return audio.load(category, key).then((ok) => {
      if (!ok) warnMissing(category, entry.path, 'not found');
      return ok;
    });
  }
  console.warn(`[loader] Unknown preload id "${id}"`);
  return Promise.resolve(null);
}

/**
 * Load a list of ids, reporting progress 0..1 as each one finishes.
 * Resolves to a Map(id -> result).
 */
export async function preload(ids, onProgress = () => {}) {
  const results = new Map();
  let done = 0;
  onProgress(ids.length ? 0 : 1);
  await Promise.all(
    ids.map(async (id) => {
      try {
        results.set(id, await loadById(id));
      } catch (err) {
        console.error(`[loader] ${id}:`, err); // manifest typo etc. — still don't crash
        results.set(id, null);
      }
      done += 1;
      onProgress(done / ids.length);
    }),
  );
  return results;
}
