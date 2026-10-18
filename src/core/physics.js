// =============================================================================
// FLATLINE: 2050 — core/physics.js
// Rapier physics world on a FIXED 60 Hz step (CLAUDE.md rule A7.6).
//
// The render loop calls physics.update(realDt). Real time is scaled by the
// global timeScale, accumulated, and consumed in fixed steps. Bodies linked
// with physics.link(body, object3D) are copied into Three.js after stepping,
// interpolated between the last two steps so motion stays smooth at any FPS.
// =============================================================================

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { timeScale } from './timeScale.js';

class Physics {
  constructor() {
    this.RAPIER = null;
    this.world = null;
    this.step = 1 / CONFIG.loop.physicsHz;
    this.accumulator = 0;
    this.links = [];           // { body, object, prevPos, prevRot }
    this.fixedListeners = [];  // callbacks run every fixed step: fn(stepDt)
    this.generation = 0;       // bumps on clear(); lets a world clear only physics it owns
  }

  /** Must be awaited once before anything uses physics (loads the WASM). */
  async init() {
    await RAPIER.init();
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    this.world.timestep = this.step;
  }

  /** Register logic that must run at the fixed rate (controllers, AI forces). */
  onFixedUpdate(fn) {
    this.fixedListeners.push(fn);
    return () => (this.fixedListeners = this.fixedListeners.filter((f) => f !== fn));
  }

  /** Keep a Three.js object glued to a rigid body. */
  link(body, object) {
    const t = body.translation();
    const r = body.rotation();
    this.links.push({
      body,
      object,
      prevPos: new THREE.Vector3(t.x, t.y, t.z),
      prevRot: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      currPos: new THREE.Vector3(t.x, t.y, t.z),
      currRot: new THREE.Quaternion(r.x, r.y, r.z, r.w),
    });
  }

  unlink(object) {
    this.links = this.links.filter((l) => l.object !== object);
  }

  /** Remove everything (used when a mission unloads). Returns the new generation. */
  clear() {
    this.generation += 1;
    this.accumulator = 0;
    this.links = [];
    this.fixedListeners = [];
    if (this.world) {
      this.world.free();
      this.world = new this.RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
      this.world.timestep = this.step;
    }
    return this.generation;
  }

  /**
   * Advance physics. Returns the number of fixed steps taken this frame.
   * @param {number} realDt unscaled seconds since the last frame
   */
  update(realDt) {
    if (!this.world) return 0;
    this.accumulator += timeScale.scaled(realDt);

    let steps = 0;
    while (this.accumulator >= this.step && steps < CONFIG.loop.maxSubSteps) {
      for (const l of this.links) {
        l.prevPos.copy(l.currPos);
        l.prevRot.copy(l.currRot);
      }
      for (const fn of this.fixedListeners) fn(this.step);
      this.world.step();
      for (const l of this.links) {
        const t = l.body.translation();
        const r = l.body.rotation();
        l.currPos.set(t.x, t.y, t.z);
        l.currRot.set(r.x, r.y, r.z, r.w);
      }
      this.accumulator -= this.step;
      steps += 1;
    }
    // Too far behind (very slow frame): drop the backlog instead of stalling.
    if (steps === CONFIG.loop.maxSubSteps) this.accumulator = 0;

    // Interpolate render transforms between the last two physics states.
    const alpha = this.accumulator / this.step;
    for (const l of this.links) {
      l.object.position.lerpVectors(l.prevPos, l.currPos, alpha);
      l.object.quaternion.slerpQuaternions(l.prevRot, l.currRot, alpha);
    }
    return steps;
  }
}

export const physics = new Physics();
