// =============================================================================
// FLATLINE: 2050 — dev/assetGallery.js
// Dev scene (?gallery): every downloaded model lined up by category, at its
// real-world size, characters playing "idle". For checking new assets.
// =============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MODELS } from '../assets/manifest.js';
import { loadModel, loadMaterial, loadHDRI, createModelInstance } from '../assets/loader.js';
import { styleCar2050, styleKael2050 } from '../assets/modelStyles.js';
import { Actor } from '../cutscenes/actor.js';

const ROW_GAP = 9;      // metres between category rows
const ITEM_GAP = 1.2;   // extra metres between items in a row

export async function createAssetGallery(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0b10);
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 500);
  camera.position.set(-6, 9, 26);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(12, 1, 10);
  controls.enableDamping = true;

  // Lighting: night-city HDRI + a key light
  const hdri = await loadHDRI('night_city_2020');
  if (hdri.texture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(hdri.texture).texture;
    pmrem.dispose();
  }
  scene.environmentIntensity = 0.9;
  scene.add(new THREE.HemisphereLight(0xbfd0ff, 0x202020, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(10, 20, 15);
  scene.add(sun);

  // Ground: the downloaded asphalt
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), await loadMaterial('asphalt', { repeat: 30 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const actors = [];
  let row = 0;
  for (const [category, entries] of Object.entries(MODELS)) {
    let x = 0;
    let placedAny = false;
    for (const key of Object.keys(entries)) {
      const t = await loadModel(category, key);
      if (t.isPlaceholder || key === 'umbra') continue;
      const obj = createModelInstance(t);
      if (key === 'car_2050_kael') styleCar2050(obj);
      if (key === 'kael_2050') styleKael2050(obj);
      obj.updateMatrixWorld(true); // skinned bounds need up-to-date bone matrices
      const box = new THREE.Box3().setFromObject(obj, true);
      const size = box.getSize(new THREE.Vector3());
      obj.position.set(x - box.min.x, 0, row * ROW_GAP);
      // Weapons float at hand height so they're visible
      if (category === 'weapons') obj.position.y = 1.2;
      scene.add(obj);
      if (t.animations.length) {
        const a = new Actor(key, obj, t.animations);
        a.play('idle', 0.01);
        actors.push(a);
      }
      scene.add(makeLabel(`${key}\n${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} m`, x + size.x / 2, Math.max(size.y, 0.4) + (category === 'weapons' ? 1.6 : 0.4), row * ROW_GAP));
      x += size.x + ITEM_GAP;
      placedAny = true;
    }
    if (placedAny) {
      scene.add(makeLabel(category.toUpperCase(), -3, 1, row * ROW_GAP, '#3fa9ff', 1.6));
      row += 1;
    }
  }

  return {
    scene,
    camera,
    controlsTarget: controls.target, // lets tests / the console aim the orbit
    update(dt) {
      controls.update();
      actors.forEach((a) => a.update(dt));
    },
  };
}

/** Text sprite that always faces the camera. */
function makeLabel(text, x, y, z, color = '#ffffff', scale = 1) {
  const lines = text.split('\n');
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64 * lines.length;
  const ctx = c.getContext('2d');
  ctx.font = '600 40px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? color : '#9aa3b5';
    ctx.fillText(l, 256, 32 + i * 64);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.4 * scale, 0.3 * lines.length * scale, 1);
  sprite.position.set(x, y, z);
  return sprite;
}
