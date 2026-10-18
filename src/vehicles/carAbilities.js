// =============================================================================
// FLATLINE: 2050 — vehicles/carAbilities.js
// The three themes as driving mechanics (not just colour):
//
//   🔥 FIRE    — Burn (Shift): the boost. Drifting builds heat that refills it.
//               Jet flames from the exhausts; a burn started from a well-filled
//               meter leaves a FIRE WAKE that scorches rivals who drive into it.
//   🌑 SHADOWS — Draft in a rival's slipstream to fill the shadow meter;
//               T = Shadow Dash: the car turns to void and phases through cars.
//   ⏳ TIME    — Hold R: rewind the whole race (you, rivals, clock) up to 5 s.
//               Drains the time meter, which slowly refills.
//
// Phase 7 brings the same three to the on-foot game (incendiary rounds / fire
// spread, shooting out lights + Shadow Step, Time Rewind), sharing
// systems/timeRewind.js.
// =============================================================================

import * as THREE from 'three';
import { BatchedRenderer } from 'three.quarks';
import { CONFIG } from '../config.js';
import { audio } from '../core/audio.js';
import { physics } from '../core/physics.js';
import { input } from '../core/input.js';
import { timeRewind } from '../systems/timeRewind.js';
import { createExhaustFlame } from '../vfx/fireFX.js';
import { createShadowSmoke } from '../vfx/smokeFX.js';
import { glowTexture } from '../vfx/particleTextures.js';

const T = CONFIG.carThemes;
const EXHAUSTS = [[-2.28, 0.42, 0.34], [-2.28, 0.42, -0.34]]; // car (physics) space
const WAKE_POOL = 36;

export class CarAbilities {
  /**
   * @param {object} o  { scene, car, rivals, race, postfx, trails }
   */
  constructor({ scene, car, rivals, race, postfx, trails = [] }) {
    this.scene = scene;
    this.car = car;
    this.rivals = rivals;
    this.race = race;
    this.postfx = postfx;
    this.trails = trails;
    this.events = [];

    // Particles
    this.batch = new BatchedRenderer();
    scene.add(this.batch);

    // 🔥 Exhaust flames
    this.flames = EXHAUSTS.map((p) => {
      const sys = createExhaustFlame();
      sys.emitter.position.set(...p);
      sys.emitter.rotation.y = -Math.PI / 2; // emit along -X (out the back)
      car.root.add(sys.emitter);
      this.batch.addSystem(sys);
      return sys;
    });
    this.burnFromFull = false;
    this.lastWakeS = -Infinity;

    // 🔥 Fire wake: pooled flickering patches on the road
    const wakeMat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xff6a1a).multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.wakeMat = wakeMat;
    this.wake = Array.from({ length: WAKE_POOL }, () => {
      const sprite = new THREE.Sprite(wakeMat.clone());
      sprite.visible = false;
      scene.add(sprite);
      return { sprite, life: 0, hit: new Set() };
    });
    this.wakeIndex = 0;

    // 🌑 Shadow dash: void material + smoke trail
    this.voidMat = new THREE.MeshStandardMaterial({ color: 0x020005, roughness: 0.3, metalness: 0.2, emissive: 0x5a1cff, emissiveIntensity: 0.6, transparent: true, opacity: 0.82 });
    this.originalMats = new Map();
    car.model.traverse((o) => o.isMesh && this.originalMats.set(o, o.material));
    this.smoke = createShadowSmoke({ width: 1.8, depth: 4, rate: 0, opacity: 0.7, worldSpace: true, prewarm: false });
    this.smoke.emitter.position.set(-1, 0.6, 0);
    this.smoke.emitter.rotation.x = -Math.PI / 2;
    car.root.add(this.smoke.emitter);
    this.batch.addSystem(this.smoke);
    this.wasPhased = false;

    // ⏳ Rewind registration (player, rivals, race clock)
    timeRewind.clear();
    this.offRewind = [car, race, ...rivals].map((t) => timeRewind.register(t));
    this.clockSound = null;
    this.offFixed = physics.onFixedUpdate((dt) => this._fixedTime(dt));
  }

  /** Listen for ability events ('dash', 'rewind-start', 'rewind-end', 'scorch'). */
  onEvent(fn) {
    this.events.push(fn);
  }

  _emit(type, data) {
    this.events.forEach((fn) => fn(type, data));
  }

  // ---------------------------------------------------------------------------
  // ⏳ TIME (fixed step)
  // ---------------------------------------------------------------------------
  _fixedTime(dt) {
    const car = this.car;
    const racing = this.race.state === 'racing';
    const want = racing && input.isDown('KeyR') && car.time > T.time.minToStart;
    if (want && !timeRewind.rewinding) {
      if (timeRewind.start()) this._rewindFx(true);
    }
    if (timeRewind.rewinding) {
      const going = want && car.time > 0 && timeRewind.step(dt, T.time.rewindSpeed);
      car.time = Math.max(0, car.time - T.time.drainPerSecond * dt);
      if (!going) {
        timeRewind.stop();
        this._rewindFx(false);
      }
      return;
    }
    if (racing) timeRewind.record(dt);
    car.time = Math.min(1, car.time + T.time.refill * dt);
  }

  _rewindFx(on) {
    if (on) {
      audio.sfx('reverse_whoosh', { volume: 0.9 });
      this.clockSound = audio.sfx('clock_tick', { volume: 0.7, rate: 1.6 });
      this.postfx.setMood('TIME', 0.25);
      this.postfx.glitch(0.35, 0.6);
      this._emit('rewind-start');
    } else {
      audio.stop('sfx', 'clock_tick', this.clockSound, 0.3);
      this.postfx.setMood('NEUTRAL', 0.6);
      this.postfx.glitch(0.25, 0.4);
      this.trails.forEach((t) => t.reset()); // trails would show the "future" path
      this._emit('rewind-end');
    }
  }

  get rewinding() {
    return timeRewind.rewinding;
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  update(dt) {
    const car = this.car;

    // 🌑 Shadow Dash trigger + visuals
    if (input.wasPressed('KeyT') && this.race.state === 'racing' && car.dash()) {
      audio.sfx('shadow_step', { volume: 1 });
      this.postfx.glitch(0.4, 0.7);
      this.postfx.setMood('SHADOWS', 0.15);
      this._emit('dash');
    }
    if (car.phased !== this.wasPhased) {
      this.wasPhased = car.phased;
      this.originalMats.forEach((mat, mesh) => (mesh.material = car.phased ? this.voidMat : mat));
      if (!car.phased && !this.rewinding) this.postfx.setMood('NEUTRAL', 0.5);
    }
    this.smoke.emissionOverTime.value = car.phased ? 70 : 0;
    if (car.phased) this.voidMat.emissiveIntensity = 0.4 + Math.random() * 0.5; // unstable flicker

    // 🔥 Burn: flames + fire wake
    const burning = car.boosting && !this.rewinding;
    this.flames.forEach((f) => (f.emissionOverTime.value = burning ? 180 : 0));
    if (car.boosting && !this._wasBurning) this.burnFromFull = car.boost >= T.fireWake.minMeter;
    this._wasBurning = car.boosting;
    if (burning && this.burnFromFull) {
      const s = this.race.playerEntry.progress;
      if (s - this.lastWakeS > T.fireWake.spacing) {
        this.lastWakeS = s;
        this._dropFire();
      }
    }
    this._updateWake(dt);

    this.batch.update(dt);
  }

  _dropFire() {
    const patch = this.wake[this.wakeIndex];
    this.wakeIndex = (this.wakeIndex + 1) % WAKE_POOL;
    const behind = new THREE.Vector3(-2.6, 0.5, 0).applyQuaternion(this.car.root.quaternion).add(this.car.position);
    patch.sprite.position.copy(behind);
    patch.life = T.fireWake.life;
    patch.hit.clear();
    patch.sprite.visible = true;
  }

  _updateWake(dt) {
    const R2 = T.fireWake.radius ** 2;
    for (const p of this.wake) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = Math.max(0, p.life / T.fireWake.life);
      p.sprite.scale.setScalar((2.2 + Math.random() * 0.8) * (0.4 + k * 0.8));
      p.sprite.material.opacity = Math.min(1, k * 2) * (0.75 + Math.random() * 0.25);
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      for (const r of this.rivals) {
        if (p.hit.has(r)) continue;
        if (r.root.position.distanceToSquared(p.sprite.position) < R2) {
          p.hit.add(r);
          r.scorch(T.fireWake.slow);
          audio.sfx('whoosh', { volume: 0.6, rate: 0.7, minInterval: 300 });
          this._emit('scorch', r);
        }
      }
    }
  }

  dispose() {
    this.offFixed();
    this.offRewind.forEach((off) => off());
    timeRewind.clear();
    audio.stop('sfx', 'clock_tick', this.clockSound, 0.1);
    this.wake.forEach((p) => {
      p.sprite.material.dispose();
      p.sprite.removeFromParent();
    });
    this.wakeMat.dispose();
    this.voidMat.dispose();
    this.batch.removeFromParent();
  }
}
