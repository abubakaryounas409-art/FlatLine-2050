// =============================================================================
// FLATLINE: 2050 — systems/explosions.js
// One blast for everything (barrels, grenades, gas tanks): flash, debris
// sparks, black smoke, a shove for loose bodies, damage with falloff, a
// camera kick and a fire left behind (🔥).
//
//   explode(at, { radius, damage, fx, rig, victims: [{ position, hurt(n) }] })
// =============================================================================

import * as THREE from 'three';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { fire } from './fire.js';

const UP = new THREE.Vector3(0, 1, 0);
let flash = null;

/** Create the blast light up front (call when a world is built). */
export function initExplosions(scene) {
  flash = new THREE.PointLight(0xff8a3a, 0, 25, 2);
  scene.add(flash);
}

/**
 * @param {THREE.Vector3} at
 * @param {object} o
 * @param {number} [o.radius]
 * @param {number} [o.damage]     at the centre (falls off to 0 at the radius)
 * @param {CombatFX} o.fx
 * @param {CameraRig} [o.rig]     for the shake
 * @param {THREE.Scene} [o.scene] for the light flash
 * @param {{position: THREE.Vector3, hurt: (n: number) => void}[]} [o.victims]
 * @param {object|null} [o.echo]
 * @param {boolean} [o.burn]      leave a fire
 */
export function explode(at, { radius = 5, damage = 120, fx, rig = null, scene = null, victims = [], echo = null, burn = true }) {
  audio.sfxAt('explosion', at, { volume: 1, refDistance: 10, echo });
  if (scene) {
    if (!flash || flash.parent !== scene) initExplosions(scene); // (fallback: costs one shader recompile)
    flash.distance = radius * 5;
    flash.position.copy(at);
    flash.intensity = 500;
    const fade = () => {
      flash.intensity *= 0.8;
      if (flash.intensity > 1) requestAnimationFrame(fade);
      else flash.intensity = 0;
    };
    requestAnimationFrame(fade);
  }
  for (let i = 0; i < 4; i++) fx.impact(at, UP, 'metal', { decal: false, incendiary: true });
  for (let i = 0; i < 30; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random() * 3);
    v.y = Math.abs(v.y) + 1;
    fx.puffs.emit(at, v, [0.12, 0.1, 0.09], 0.5 + Math.random() * 0.6, 1.5 + Math.random(), 0.6, 3);
  }
  if (rig) {
    const d = rig.camera.position.distanceTo(at);
    rig.shake = Math.max(rig.shake, Math.min(1.2, 8 / Math.max(1, d)));
  }
  for (const v of victims) {
    const d = v.position.distanceTo(at);
    if (d < radius) v.hurt(damage * (1 - d / radius), at);
  }
  physics.world.bodies.forEach((b) => {
    if (!b.isDynamic()) return;
    const p = b.translation();
    const dir = new THREE.Vector3(p.x - at.x, p.y - at.y + 0.5, p.z - at.z);
    const d = dir.length();
    if (d < radius * 1.2) b.applyImpulse(dir.normalize().multiplyScalar((radius * 1.2 - d) * 6 * b.mass()), true);
  });
  if (burn) fire.ignite(at.clone().setY(at.y - 0.3), { size: 0.9, fuel: 7 });
}
