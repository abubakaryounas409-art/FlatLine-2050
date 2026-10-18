// =============================================================================
// FLATLINE: 2050 — vfx/rainFX.js
// 2020 rain: thousands of thin streaks in a box that follows the camera
// (one draw call), angled by the wind, plus lightning flashes with thunder.
// Uses time-scaled dt, so rain hangs in the air during slow motion and
// freezes during rewind.
//
//   const rain = new Rain(scene, { count: 4000 })
//   rain.update(dt, camera)   rain.lightning()
// =============================================================================

import * as THREE from 'three';
import { audio } from '../core/audio.js';

export class Rain {
  constructor(scene, { count = 4000, area = 26, height = 18, speed = 16, wind = new THREE.Vector3(1.2, 0, 0.6), color = 0x8fa4c4 } = {}) {
    this.scene = scene;
    this.count = count;
    this.area = area;
    this.height = height;
    this.speed = speed;
    this.wind = wind;
    this.offsets = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.offsets[i * 3] = (Math.random() - 0.5) * area;
      this.offsets[i * 3 + 1] = Math.random() * height;
      this.offsets[i * 3 + 2] = (Math.random() - 0.5) * area;
    }
    this.positions = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.flash = new THREE.DirectionalLight(0xc8d8ff, 0);
    this.flash.position.set(10, 40, -10);
    scene.add(this.flash);
    this._flashT = 0;
    this.nextStrike = 8 + Math.random() * 10;
    this.storm = true;
  }

  /** A lightning strike: two flickers, thunder a beat later. */
  lightning({ thunder = true } = {}) {
    this._flashT = 0.35;
    if (!thunder) return; // the caller times the thunder itself
    const delay = 400 + Math.random() * 1200;
    setTimeout(() => audio.sfx('thunder', { volume: 0.7, rate: 0.9 + Math.random() * 0.2 }), delay);
  }

  update(dt, camera) {
    const fall = this.speed * dt;
    const c = camera.position;
    const streak = 0.045 * this.speed;
    const w = this.wind;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      let y = this.offsets[j + 1] - fall;
      if (y < 0) y += this.height;
      this.offsets[j + 1] = y;
      // wrap the box around the camera so rain is always near
      const x = c.x + ((((this.offsets[j] + w.x * y * 0.05 - c.x) % this.area) + this.area * 1.5) % this.area) - this.area / 2;
      const z = c.z + ((((this.offsets[j + 2] + w.z * y * 0.05 - c.z) % this.area) + this.area * 1.5) % this.area) - this.area / 2;
      const top = c.y - this.height * 0.35 + y;
      const k = i * 6;
      this.positions[k] = x;
      this.positions[k + 1] = top;
      this.positions[k + 2] = z;
      this.positions[k + 3] = x - w.x * 0.03;
      this.positions[k + 4] = top - streak;
      this.positions[k + 5] = z - w.z * 0.03;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    // lightning
    if (this.storm && dt > 0) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.lightning();
        this.nextStrike = 12 + Math.random() * 16;
      }
    }
    if (this._flashT > 0) {
      this._flashT -= Math.max(dt, 0.016);
      const on = this._flashT > 0.22 || (this._flashT > 0.06 && this._flashT < 0.14);
      this.flash.intensity = on ? 3.5 : 0;
    } else this.flash.intensity = 0;
  }

  dispose() {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    this.flash.removeFromParent();
  }
}
