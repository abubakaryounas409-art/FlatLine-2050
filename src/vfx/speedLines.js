// =============================================================================
// FLATLINE: 2050 — vfx/speedLines.js
// Speed lines (CLAUDE.md Phase 3.3): thin streaks rushing past the camera,
// living in camera space so they always frame the view. Strength 0..1.
// =============================================================================

import * as THREE from 'three';

const COUNT = 140;

export class SpeedLines {
  constructor(camera) {
    this.camera = camera;
    this.strength = 0;
    this.streaks = [];
    const positions = new Float32Array(COUNT * 2 * 3);
    const colors = new Float32Array(COUNT * 2 * 3);
    for (let i = 0; i < COUNT; i++) this.streaks.push(this._spawn({}, true));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 7;
    camera.add(this.lines);
  }

  /** A streak somewhere in a tube around the view axis (camera space: -Z forward). */
  _spawn(s, anywhere = false) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 2.2 + Math.random() * 7;
    s.x = Math.cos(angle) * radius;
    s.y = Math.sin(angle) * radius * 0.6;
    s.z = anywhere ? -Math.random() * 70 : -70 - Math.random() * 20;
    s.bright = 0.4 + Math.random() * 0.6;
    s.blue = Math.random() < 0.35;
    return s;
  }

  update(dt, speed, strength) {
    this.strength += (strength - this.strength) * Math.min(1, dt * 5);
    const k = this.strength;
    this.lines.visible = k > 0.02;
    if (!this.lines.visible) return;
    const pos = this.lines.geometry.attributes.position.array;
    const col = this.lines.geometry.attributes.color.array;
    const len = 1.5 + speed * 0.09;
    this.streaks.forEach((s, i) => {
      s.z += speed * 1.4 * dt;
      if (s.z > 2) this._spawn(s);
      pos.set([s.x, s.y, s.z, s.x, s.y, s.z - len], i * 6);
      const c = s.bright * k * 0.9;
      const r = s.blue ? 0.35 * c : c;
      const g = s.blue ? 0.75 * c : c;
      col.set([r, g, c, 0, 0, 0], i * 6); // head bright, tail fades to nothing
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    this.lines.removeFromParent();
  }
}
