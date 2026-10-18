// =============================================================================
// FLATLINE: 2050 — vehicles/rivalCar.js
// A rival racer (CLAUDE.md Phase 3.5): a kinematic body that follows the track
// spline with its own skill, brakes for corners, overtakes / follows when it
// catches a car, and makes small random mistakes (runs wide, lifts, wobbles).
// The player can bump it; it reacts with a wobble but keeps its line.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { quatFromYaw, GROUPS } from './carController.js';

const R = CONFIG.rivals;
const MODEL_YAW = -Math.PI / 2;
const rand = (a, b) => a + Math.random() * (b - a);

export class RivalCar {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.object   visual model (front = -Z)
   * @param {string[]} o.wheelNames
   * @param {RaceTrack} o.track
   * @param {{ s: number, lateral: number }} o.start
   * @param {number} o.skill            0..1
   */
  constructor({ object, wheelNames = [], track, start, skill = 0.5, name = 'RIVAL', color = 0xffffff }) {
    const { RAPIER, world } = physics;
    this.name = name;
    this.color = color;
    this.track = track;
    this.skill = skill;
    this.root = new THREE.Group();
    object.rotation.y = MODEL_YAW;
    this.root.add(object);
    this.wheels = wheelNames.map((n) => object.getObjectByName(n)).filter(Boolean);
    this.wheels.forEach((w) => (w.rotation.order = 'YXZ'));

    // Racing state
    this.s = start.s;               // distance along the lap (unwrapped: grows past laps)
    this.lateral = start.lateral;   // metres left (+) / right (-) of the centre line
    this.targetLateral = start.lateral;
    this.speed = 0;
    this.topSpeed = THREE.MathUtils.lerp(R.topSpeed[0], R.topSpeed[1], skill);
    this.grip = THREE.MathUtils.lerp(R.lateralG[0], R.lateralG[1], skill) * 9.81;
    this.racing = false;
    this.mistake = null;            // { type, t, dur, amount }
    this.nextMistake = rand(...R.mistakeEvery);
    this.wobble = 0;                // visual yaw wobble (bump reactions)
    this.spin = 0;

    const f = track.sampleAt(this.s);
    const p = f.position.clone().addScaledVector(f.normal, this.lateral);
    this.yaw = Math.atan2(-f.tangent.z, f.tangent.x);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, 0, p.z).setRotation(quatFromYaw(this.yaw)),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(2.2, 0.55, 0.95).setTranslation(0, 0.6, 0).setFriction(0.2).setCollisionGroups(GROUPS.RIVAL), this.body);
    physics.link(this.body, this.root);
    this._f = {};
  }

  /**
   * Fixed-step AI. `others` = [{ s, lateral, speed }] for every other car
   * (progress already unwrapped). `rubber` = -1..1 (behind / ahead of player).
   */
  fixedUpdate(dt, others, rubber = 0) {
    const track = this.track;
    if (!this.racing) {
      this.speed = 0;
    } else {
      // --- Corner speed: look ahead proportional to speed --------------------------------
      let limit = this.topSpeed * (1 - rubber * R.rubberBand);
      const look = 20 + this.speed * 1.4;
      for (let d = 10; d <= look; d += 10) {
        const k = Math.abs(track.sampleAt(this.s + d, this._f).curvature);
        if (k > 1e-4) {
          const vCorner = Math.sqrt(this.grip / k);
          // the braking distance must fit before the corner
          const vAllowed = Math.sqrt(vCorner * vCorner + 2 * R.brake * d);
          limit = Math.min(limit, vAllowed);
        }
      }
      // --- Traffic: follow or pull out to overtake ----------------------------------------
      let blocked = null;
      for (const o of others) {
        const gap = o.s - this.s;
        if (gap > 0 && gap < 14 && Math.abs(o.lateral - this.lateral) < 2.6) blocked = o;
      }
      if (blocked && blocked.speed < this.speed + 1) {
        const halfW = track.width / 2 - 2;
        const left = blocked.lateral + 4.2;
        const right = blocked.lateral - 4.2;
        // pick the side with room (prefer the inside of the next corner)
        const inside = Math.sign(track.sampleAt(this.s + 40, this._f).curvature) || 1;
        const options = inside > 0 ? [left, right] : [right, left];
        const free = options.find((l) => Math.abs(l) < halfW);
        if (free !== undefined) this.targetLateral = free;
        else limit = Math.min(limit, blocked.speed);
      }
      // --- Mistakes ----------------------------------------------------------------------------
      this.nextMistake -= dt;
      if (!this.mistake && this.nextMistake <= 0) {
        const types = ['wide', 'lift', 'wobble'];
        this.mistake = { type: types[Math.floor(Math.random() * types.length)], t: 0, dur: rand(1.0, 2.0), amount: rand(0.6, 1) };
        this.nextMistake = rand(...R.mistakeEvery) * (1.4 - this.skill * 0.6);
      }
      let lateralExtra = 0;
      if (this.mistake) {
        const m = this.mistake;
        m.t += dt;
        const env = Math.sin(Math.min(1, m.t / m.dur) * Math.PI); // 0 → 1 → 0
        if (m.type === 'lift') limit *= 1 - 0.18 * env * m.amount;
        if (m.type === 'wide') lateralExtra = -Math.sign(track.sampleAt(this.s, this._f).curvature || 1) * 3.2 * env * m.amount;
        if (m.type === 'wobble') this.wobble = Math.sin(m.t * 14) * 0.06 * env * m.amount;
        if (m.t >= m.dur) this.mistake = null;
      }

      // --- Speed control ---------------------------------------------------------------------
      if (this.speed < limit) this.speed = Math.min(limit, this.speed + R.accel * dt * (1 - (this.speed / (this.topSpeed + 10)) ** 2));
      else this.speed = Math.max(limit, this.speed - R.brake * dt);

      // --- Lateral: ease toward the racing line (+ any mistake) --------------------------------
      const halfW = track.width / 2 - 1.3;
      if (!blocked) this.targetLateral += (this._idealLateral() - this.targetLateral) * Math.min(1, dt * 0.4);
      const target = THREE.MathUtils.clamp(this.targetLateral + lateralExtra, -halfW, halfW);
      this.lateralVel = (target - this.lateral) * 1.6;
      this.lateral += this.lateralVel * dt;
      this.s += this.speed * dt;
    }

    this._place();
    this.spin += (this.speed * dt) / 0.36;
  }

  /** Put the kinematic body at (s, lateral). */
  _place() {
    const track = this.track;
    const f = track.sampleAt(this.s, this._f);
    const p = f.position.clone().addScaledVector(f.normal, this.lateral);
    const heading = Math.atan2(-f.tangent.z, f.tangent.x);
    const slide = this.speed > 1 ? Math.atan2(this.lateralVel ?? 0, this.speed) : 0;
    this.yaw = heading + slide + this.wobble;
    this.wobble *= 0.92;
    this.body.setNextKinematicTranslation({ x: p.x, y: 0, z: p.z });
    this.body.setNextKinematicRotation(quatFromYaw(this.yaw));
  }

  /** A simple racing line: drift to the outside before corners, inside at the apex. */
  _idealLateral() {
    const now = this.track.sampleAt(this.s + 15, this._f).curvature;
    const soon = this.track.sampleAt(this.s + 60, this._f).curvature;
    const w = this.track.width / 2 - 2.5;
    if (Math.abs(now) > 0.004) return Math.sign(now) * w * 0.7;      // apex: inside
    if (Math.abs(soon) > 0.004) return -Math.sign(soon) * w * 0.6;   // set up: outside
    return this.lateral * 0.98;
  }

  /** ⏳ State for systems/timeRewind.js */
  snapshot() {
    return { s: this.s, lateral: this.lateral, targetLateral: this.targetLateral, speed: this.speed, wobble: this.wobble, spin: this.spin, mistake: this.mistake && { ...this.mistake } };
  }

  restore(st) {
    Object.assign(this, st);
    this.lateralVel = 0;
    this._place();
  }

  /** 🔥 Drove through fire: lose speed, shake. */
  scorch(slow) {
    this.speed *= slow;
    this.wobble += (Math.random() < 0.5 ? -1 : 1) * 0.12;
  }

  /** Bumped by the player: shake, lose a little speed. */
  bump(strength) {
    this.wobble += (Math.random() < 0.5 ? -1 : 1) * Math.min(0.25, strength * 0.02);
    this.speed *= 1 - Math.min(0.25, strength * 0.01);
  }

  syncVisual() {
    this.wheels.forEach((w, i) => {
      w.rotation.x = -this.spin;
      w.rotation.y = i < 2 ? THREE.MathUtils.clamp((this.lateralVel ?? 0) * 0.08, -0.3, 0.3) : 0;
    });
  }

  dispose() {
    physics.unlink(this.root);
  }
}
