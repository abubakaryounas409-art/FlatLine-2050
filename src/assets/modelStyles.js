// =============================================================================
// FLATLINE: 2050 — assets/modelStyles.js
// Re-skins downloaded models to match the game's art direction (CLAUDE.md A4)
// by replacing materials by name. Used wherever the model appears (menu,
// cutscenes, missions), so a model always looks the same.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Kael's 2050 car: pearl-white body, red trim, glowing lights.
 * @param {THREE.Object3D} car
 * @param {(x) => x} track  optional: register materials for disposal
 */
export function styleCar2050(car, track = (m) => m) {
  const body = track(
    new THREE.MeshPhysicalMaterial({ color: 0xd6d8de, metalness: 0.4, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.05 }),
  );
  const red = track(
    new THREE.MeshPhysicalMaterial({ color: 0xc40f24, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
  );
  const glass = track(
    new THREE.MeshPhysicalMaterial({ color: 0x07080c, metalness: 0.2, roughness: 0.02, transparent: true, opacity: 0.6, clearcoat: 1 }),
  );
  const emissive = (color, intensity) =>
    track(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity }));

  const replace = {
    Body_Color: body,
    Ferrari_Yellow: red,
    Glass_Gray: glass,
    Taillight_Glass: emissive(0xff1030, 3),
    Projector_Glass: emissive(0xdcecff, 0.7),
    Turn_Signal_LED: emissive(CONFIG.colors.time, 4),
  };
  car.traverse((o) => {
    if (o.isMesh && replace[o.material.name]) o.material = replace[o.material.name];
  });
}

/**
 * Kael's hero model (kael_hero.glb / kael_hero_2050.glb, Quaternius UE skeleton) carries its outfit baked
 * into the textures by .dev/mergehero.mjs. Older scripts look up the stand-in's hand bones by name
 * ('WristL' for the M2 scar glow, 'WristR' for Umbra's muzzle), so give the hero matching handles.
 */
export function addBoneAliases(root) {
  for (const [alias, bone] of [['WristL', 'hand_l'], ['WristR', 'hand_r']]) {
    const b = root.getObjectByName(bone);
    if (!b || root.getObjectByName(alias)) continue;
    const handle = new THREE.Object3D();
    handle.name = alias;
    b.add(handle);
  }
}

const isHero = (root) => {
  let hero = false;
  root.traverse((o) => {
    if (o.isMesh && /^MI_Kael_/.test(o.material?.name ?? '')) hero = true;
  });
  return hero;
};

/**
 * Kael in his 2050 racing suit. On the hero model the white/red suit is baked in and its seams
 * glow (emissive map); on the Mixamo X Bot: white suit panels, red joints with a faint glow.
 */
export function styleKael2050(root, track = (m) => m) {
  if (isHero(root)) {
    root.traverse((o) => {
      if (!o.isMesh || o.material?.name !== 'MI_Kael_2050') return;
      o.material = track(o.material.clone());
      o.material.emissiveIntensity = 2.4; // red seam glow (bloom picks it up)
      o.material.envMapIntensity = 1.2;   // glossy suit
    });
    addBoneAliases(root);
    return;
  }
  const suit = track(new THREE.MeshStandardMaterial({ color: 0xe9eaee, roughness: 0.42, metalness: 0.15 }));
  const seams = track(
    new THREE.MeshStandardMaterial({ color: 0x8a0c18, roughness: 0.35, metalness: 0.3, emissive: 0xff1a33, emissiveIntensity: 0.55 }),
  );
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material?.name ?? '';
    if (name.includes('Joints')) o.material = seams;
    else if (name.includes('Beta') || name.includes('Limbs')) o.material = suit;
  });
}

/**
 * A rival's livery: metallic body in the team colour, dark trim, glowing lights.
 * Works on the 2050 racer (and its light version).
 */
export function styleRival(car, color, track = (m) => m) {
  const body = track(
    new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }),
  );
  const trim = track(new THREE.MeshPhysicalMaterial({ color: 0x15161b, metalness: 0.6, roughness: 0.35, clearcoat: 1 }));
  const glass = track(
    new THREE.MeshPhysicalMaterial({ color: 0x07080c, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.7 }),
  );
  const glow = (c, i) => track(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: i }));
  const replace = {
    Body_Color: body,
    Ferrari_Yellow: trim,
    Glass_Gray: glass,
    Taillight_Glass: glow(0xff1030, 3),
    Projector_Glass: glow(0xdcecff, 0.8),
    Turn_Signal_LED: glow(color, 4),
  };
  car.traverse((o) => {
    if (o.isMesh && replace[o.material.name]) o.material = replace[o.material.name];
  });
}

/**
 * Kael in 2020: black tactical jacket, dark hoodie, charcoal cargo pants, worn
 * boots, no backpack. Baked into the hero model's textures; on the Quaternius
 * Adventurer stand-in it's done here by material swaps (models whose material
 * names don't match are left alone).
 */
export function styleKael2020(root, track = (m) => m) {
  if (isHero(root)) {
    addBoneAliases(root); // outfit (jacket, hoodie, cargo pants, boots, gloves, scarred left hand) is baked in
    return;
  }
  const mat = (color, roughness = 0.8, metalness = 0) => track(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const replace = {
    Green: mat(0x16171b, 0.62),       // jacket
    LightGreen: mat(0x26272d, 0.85),  // hoodie
    Brown: mat(0x2b2a28, 0.9),        // cargo pants
    Brown2: mat(0x1b1714, 0.7),       // boots
    Black: mat(0x0b0b0d, 0.6),
    Grey: mat(0x3a3b40, 0.8),
    Gold: mat(0x5a5650, 0.4, 0.8),    // buckles, zip
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (/backpack/i.test(o.name)) o.visible = false;
    const mats = [].concat(o.material);
    const next = mats.map((m) => replace[m.name] ?? m);
    o.material = Array.isArray(o.material) ? next : next[0];
  });
}
