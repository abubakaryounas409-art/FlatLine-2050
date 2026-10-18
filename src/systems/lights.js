// =============================================================================
// FLATLINE: 2050 — systems/lights.js
// 🌑 SHADOWS — shootable lights and the darkness they leave (CLAUDE.md 6.6).
//
//   const lamp = lights.add({ light, bulb, position, radius })
//   lights.hit(collider)        → true if a bulb was shot out
//   lights.isDark(point)        → is this spot dark enough to hide / Shadow Step?
//   lights.darkness(point)      → 0 (lit) … 1 (pitch dark)
//
// Each light has a small solid collider on its bulb so bullets can hit it.
// Darkness is estimated from the lights still on (inverse-square falloff up to
// each light's range), so shooting a lamp really creates a dark zone that
// Shadow Step (Phase 7) and enemy vision (Phase 8) can use.
// =============================================================================

import * as THREE from 'three';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';

class ShootableLights {
  constructor() {
    this.items = [];
    this.byCollider = new Map(); // collider handle → item
    this.ambient = 0.04;         // light everywhere (moon, windows)
    this.darkThreshold = 0.35;   // darkness above this counts as "dark"
    this.onShotOut = null;       // (item) => void — FX hook
  }

  /** Forget everything (new level). */
  clear() {
    this.items.length = 0;
    this.byCollider.clear();
  }

  /**
   * @param {object} o
   * @param {THREE.PointLight|THREE.SpotLight} o.light
   * @param {THREE.Mesh} [o.bulb]     glowing mesh, hidden when shot
   * @param {THREE.Vector3} o.position  where the bulb is (collider centre)
   * @param {number} [o.radius]       bulb collider radius
   * @param {number} [o.reach]        how far the pool of light counts (m)
   */
  add({ light, bulb = null, position, radius = 0.22, reach = light.distance || 12 }) {
    const R = physics.RAPIER;
    const collider = physics.world.createCollider(R.ColliderDesc.ball(radius).setTranslation(position.x, position.y, position.z));
    const item = { light, bulb, position: position.clone(), reach, on: true, intensity: light.intensity, collider, flicker: 0 };
    this.items.push(item);
    this.byCollider.set(collider.handle, item);
    return item;
  }

  /** A bullet hit `collider`: if it's a bulb, shoot it out. */
  hit(collider) {
    const item = collider && this.byCollider.get(collider.handle);
    if (!item || !item.on) return false;
    this.shootOut(item);
    return true;
  }

  shootOut(item) {
    item.on = false;
    item.flicker = 0.35; // dying flicker, then dark
    audio.sfxAt?.('glass_shatter', item.position, { volume: 0.7, rate: 1.4 });
    this.onShotOut?.(item);
  }

  /** How dark a point is: 0 lit … 1 dark. */
  darkness(point) {
    let light = this.ambient;
    for (const it of this.items) {
      if (!it.on) continue;
      const d = it.position.distanceTo(point);
      if (d > it.reach) continue;
      const falloff = 1 - d / it.reach;
      light += falloff * falloff;
    }
    return THREE.MathUtils.clamp(1 - light, 0, 1);
  }

  isDark(point) {
    return this.darkness(point) > 1 - this.darkThreshold;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.on || it.flicker <= 0) {
        if (!it.on) it.light.intensity = 0;
        continue;
      }
      it.flicker -= dt;
      const on = Math.random() < 0.45 && it.flicker > 0;
      it.light.intensity = on ? it.intensity * (0.3 + Math.random() * 0.6) : 0;
      if (it.bulb) it.bulb.visible = on;
      if (it.flicker <= 0 && it.bulb) it.bulb.visible = false;
    }
  }
}

export const lights = new ShootableLights();
