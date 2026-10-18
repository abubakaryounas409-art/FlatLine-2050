// =============================================================================
// FLATLINE: 2050 — systems/fragments.js
// Memory fragments (CLAUDE.md Phase 7.1): glowing shards of Kael's past.
// Walking into one restores heartbeats and plays a line of memory.
//
//   const frags = new MemoryFragments(scene)
//   frags.add(position, { line: 'Dad\'s workshop smelled of solder.' })
//   frags.update(dt, player.position)
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { audio } from '../core/audio.js';
import { heartbeat } from './heartbeat.js';
import { subtitles } from '../cutscenes/subtitles.js';

export class MemoryFragments {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.geo = new THREE.OctahedronGeometry(0.16, 0);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x0a1420, emissive: new THREE.Color(0x6fd0ff), emissiveIntensity: 3.2, roughness: 0.2, metalness: 0.4 });
  }

  /** @param {THREE.Vector3|number[]} position  @param {{ line?: string, speaker?: string }} o */
  add(position, { line = '', speaker = 'kael' } = {}) {
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.set(...(Array.isArray(position) ? position : position.toArray()));
    mesh.position.y += 1;
    const light = new THREE.PointLight(0x6fd0ff, 3, 4, 2);
    mesh.add(light);
    this.scene.add(mesh);
    const item = { mesh, light, line, speaker, taken: false, base: mesh.position.y, phase: Math.random() * 6 };
    this.items.push(item);
    return item;
  }

  update(dt, playerPos) {
    for (const it of this.items) {
      if (it.taken) continue;
      it.phase += dt;
      it.mesh.rotation.y += dt * 1.6;
      it.mesh.rotation.x = Math.sin(it.phase * 0.7) * 0.3;
      it.mesh.position.y = it.base + Math.sin(it.phase * 2) * 0.08;
      it.light.intensity = 2.5 + Math.sin(it.phase * 4) * 0.8;
      const dx = playerPos.x - it.mesh.position.x;
      const dz = playerPos.z - it.mesh.position.z;
      if (dx * dx + dz * dz < 0.8 && Math.abs(playerPos.y + 1 - it.mesh.position.y) < 1.4) this._take(it);
    }
  }

  _take(it) {
    it.taken = true;
    heartbeat.restore(CONFIG.heartbeat.memoryFragmentRestore);
    audio.sfx('scifi_beep', { volume: 0.6, rate: 1.2 });
    audio.sfx('heartbeat', { volume: 0.6 });
    if (it.line) subtitles.show(it.speaker, it.line, 4);
    gsap.to(it.mesh.scale, { x: 2.2, y: 2.2, z: 2.2, duration: 0.35, ease: 'power2.out' });
    gsap.to(it.light, { intensity: 14, duration: 0.15, yoyo: true, repeat: 1 });
    gsap.to(it.mesh.scale, { x: 0, y: 0, z: 0, duration: 0.3, delay: 0.35, ease: 'power2.in', onComplete: () => it.mesh.removeFromParent() });
  }

  dispose() {
    this.items.forEach((it) => it.mesh.removeFromParent());
    this.geo.dispose();
    this.mat.dispose();
  }
}
