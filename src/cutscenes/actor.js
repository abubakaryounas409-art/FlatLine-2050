// =============================================================================
// FLATLINE: 2050 — cutscenes/actor.js
// A character (or prop) that cutscenes and missions can direct:
//
//   actor.play('agree', 0.25)            crossfade to a clip (rule A7.5)
//   await actor.moveTo([x, y, z], 1.4)   walk there at 1.4 m/s, facing the way
//   await actor.lookAt(target)           turn to face a point / object / actor
//
// Movement and animation advance in update(dt) with TIME-SCALED dt, so slow
// motion slows actors too. Missing clips (placeholder models) are ignored
// with one warning, so scripts never crash.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();

/** Shortest signed angle from a to b (radians). */
function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export class Actor {
  /**
   * @param {string} name
   * @param {THREE.Object3D} object   root placed in the world (feet at origin)
   * @param {THREE.AnimationClip[]} clips
   * @param {object} o
   * @param {number} o.walkSpeed     speed (m/s) at which the walk clip matches the feet
   * @param {number} o.runSpeed      same for the run clip
   */
  constructor(name, object, clips = [], { walkSpeed = 1.35, runSpeed = 4.2 } = {}) {
    this.name = name;
    this.object = object;
    this.clips = clips;
    this.walkSpeed = walkSpeed;
    this.runSpeed = runSpeed;
    this.mixer = clips.length ? new THREE.AnimationMixer(object) : null;
    this.actions = new Map();
    this.current = null;      // current AnimationAction
    this.currentName = null;
    this._warned = new Set();

    this._move = null;        // { target, speed, resolve, arriveAnim }
    this._turn = null;        // { yaw, rate, resolve }
  }

  /** Get (and cache) the action for a clip name, or null if missing. */
  action(name) {
    if (!this.mixer) return null;
    name = name.toLowerCase(); // clip names are normalised to lowercase by the loader
    if (this.actions.has(name)) return this.actions.get(name);
    const clip = THREE.AnimationClip.findByName(this.clips, name);
    if (!clip) {
      if (!this._warned.has(name)) {
        this._warned.add(name);
        console.warn(`[actor:${this.name}] no animation "${name}" (has: ${this.clips.map((c) => c.name).join(', ') || 'none'})`);
      }
      return null;
    }
    const a = this.mixer.clipAction(clip);
    this.actions.set(name, a);
    return a;
  }

  hasClip(name) {
    return !!THREE.AnimationClip.findByName(this.clips, name.toLowerCase());
  }

  /**
   * Crossfade to a clip. Never snaps (rule A7.5).
   * @param {string} name
   * @param {number} blend seconds (0.15–0.3 recommended)
   * @param {object} o  { loop: true, timeScale: 1, clamp: false }
   */
  play(name, blend = CONFIG.animation.blendDefault, { loop = true, timeScale = 1, clamp = false } = {}) {
    const next = this.action(name);
    if (!next) return this;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = clamp || !loop;
    next.timeScale = timeScale;
    if (next === this.current) return this;
    name = name.toLowerCase();

    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current) this.current.crossFadeTo(next, blend, true);
    else next.fadeIn(blend);
    this.current = next;
    this.currentName = name;
    return this;
  }

  /** Play a one-shot clip, then return to `then` (e.g. a gesture → idle). */
  gesture(name, then = 'idle', blend = CONFIG.animation.blendDefault) {
    const a = this.action(name);
    if (!a) return Promise.resolve();
    this.play(name, blend, { loop: false });
    return new Promise((resolve) => {
      const onDone = (e) => {
        if (e.action !== a) return;
        this.mixer.removeEventListener('finished', onDone);
        this.play(then, blend);
        resolve();
      };
      this.mixer.addEventListener('finished', onDone);
    });
  }

  /**
   * Walk / run to a point. Resolves on arrival.
   * @param {THREE.Vector3|number[]} point
   * @param {number} speed m/s
   * @param {object} o { anim: 'walk' | 'run' | null (auto), arriveAnim: 'idle' }
   */
  moveTo(point, speed = this.walkSpeed, { anim = null, arriveAnim = 'idle' } = {}) {
    const target = Array.isArray(point) ? new THREE.Vector3(...point) : point.clone();
    target.y = this.object.position.y; // stay on the ground plane
    this._move?.resolve();
    const clipName = anim ?? (speed > (this.walkSpeed + this.runSpeed) / 2 ? 'run' : 'walk');
    const natural = clipName === 'run' ? this.runSpeed : this.walkSpeed;
    // Match the clip speed to the movement speed so feet don't slide.
    this.play(clipName, CONFIG.animation.blendDefault, { timeScale: speed / natural });
    return new Promise((resolve) => {
      this._move = { target, speed, arriveAnim, resolve };
    });
  }

  /**
   * Turn to face a point / Object3D / Actor. Resolves when facing it.
   * @param {number} rate radians per second
   */
  lookAt(target, rate = 3) {
    const p = target instanceof Actor ? target.object.position : target.isObject3D ? target.getWorldPosition(tmpV) : Array.isArray(target) ? tmpV.set(...target) : target;
    const yaw = Math.atan2(p.x - this.object.position.x, p.z - this.object.position.z);
    this._turn?.resolve();
    return new Promise((resolve) => {
      this._turn = { yaw, rate, resolve };
    });
  }

  /** Teleport (no animation). */
  place(position, yaw = this.object.rotation.y) {
    this.object.position.set(...(Array.isArray(position) ? position : position.toArray()));
    this.object.rotation.y = yaw;
  }

  /** Call every frame with time-scaled dt. */
  update(dt) {
    if (this._move) {
      const m = this._move;
      const pos = this.object.position;
      tmpV.subVectors(m.target, pos);
      const dist = tmpV.length();
      const step = m.speed * dt;
      if (dist <= step || dist < 1e-3) {
        pos.copy(m.target);
        this._move = null;
        if (m.arriveAnim) this.play(m.arriveAnim);
        m.resolve();
      } else {
        pos.addScaledVector(tmpV.normalize(), step);
        // face the walking direction (smoothly)
        const yaw = Math.atan2(tmpV.x, tmpV.z);
        this.object.rotation.y += angleDelta(this.object.rotation.y, yaw) * Math.min(1, dt * 8);
      }
    }
    if (this._turn && !this._move) {
      const t = this._turn;
      const d = angleDelta(this.object.rotation.y, t.yaw);
      const step = t.rate * dt;
      if (Math.abs(d) <= step) {
        this.object.rotation.y = t.yaw;
        this._turn = null;
        t.resolve();
      } else {
        this.object.rotation.y += Math.sign(d) * step;
      }
    }
    this.mixer?.update(dt);
  }

  /** Save position / rotation / clip so a borrowed actor can be put back. */
  snapshot() {
    return {
      position: this.object.position.clone(),
      quaternion: this.object.quaternion.clone(),
      anim: this.currentName,
      visible: this.object.visible,
    };
  }

  restore(s) {
    this._move?.resolve();
    this._turn?.resolve();
    this._move = this._turn = null;
    this.object.position.copy(s.position);
    this.object.quaternion.copy(s.quaternion);
    this.object.visible = s.visible;
    if (s.anim) this.play(s.anim, 0.01);
  }

  /** World position of the head (approx.) — handy camera target. */
  headPosition(out = new THREE.Vector3(), height = 1.62) {
    return out.copy(this.object.position).addScaledVector(UP, height);
  }
}

