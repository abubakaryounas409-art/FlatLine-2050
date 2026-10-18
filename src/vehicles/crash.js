// =============================================================================
// FLATLINE: 2050 — vehicles/crash.js
// Mission 1's scripted crash at the last corner — it happens no matter what
// (CLAUDE.md Phase 4):
//   1. helmet HUD glitches "20.20.20" (static)        ⏳ the time motif
//   2. BRAKE FAILURE, steering stops responding, throttle stuck
//   3. impact → slow motion 0.15: flip, glass, sparks, visor cracks, orbit cam
//   4. explosion (fire + smoke + bloom flash), real speed returns, shake
//   5. white flash → black
// The black screen / heart-monitor epilogue is played by the mission.
// =============================================================================

import * as THREE from 'three';
import { BatchedRenderer } from 'three.quarks';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { cutscenes } from '../cutscenes/cutscenePlayer.js';
import { at, cam, sfx, flash, fade, slowMo, glitch, setMood, call } from '../cutscenes/steps.js';
import { createGlassShards, createSparks, createExplosion } from '../vfx/crashFX.js';

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

export class ScriptedCrash {
  /**
   * @param {object} o
   * @param {object} o.world     race world (car, race, track, hud, scene)
   * @param {HelmetHUD} o.helmet
   * @param {number} o.triggerProgress  unwrapped progress where it starts
   */
  constructor({ world, helmet, triggerProgress }) {
    this.world = world;
    this.helmet = helmet;
    this.trigger = triggerProgress;
    this.state = 'armed'; // armed → sabotage → impact → done
    this.wasLeading = false;

    // Effects live in the race scene and slow down with time scale
    this.batch = new BatchedRenderer();
    world.scene.add(this.batch);
    this.fx = { glass: createGlassShards(), sparks: createSparks(), explosion: createExplosion() };
    Object.values(this.fx).forEach((f) => f.systems.forEach((s) => {
      world.scene.add(s.emitter);
      this.batch.addSystem(s);
    }));
    this.fireLight = new THREE.PointLight(0xff7a2a, 0, 40, 2);
    world.scene.add(this.fireLight);
    this.offFrame = game.onFrame((realDt) => {
      const dt = timeScale.scaled(realDt);
      this.batch.update(dt);
      this.fireLight.intensity *= Math.exp(-dt * 1.4);
    });
  }

  /** Call every frame. Resolves `done` once the crash has fully played. */
  update() {
    const race = this.world.race;
    if (this.state !== 'armed') return;
    if (race.playerPosition === 1) this.wasLeading = true;
    if (race.state === 'racing' && race.playerEntry.progress >= this.trigger) {
      this.state = 'sabotage';
      this.done = this._run();
    }
  }

  async _run() {
    const { car, race, hud } = this.world;
    const led = race.playerPosition === 1;
    race.state = 'scripted'; // abilities, laps and rewinding stop here

    // 1. The clock glitch
    game.postfx.glitch(0.9, 0.9);
    game.postfx.setMood('TIME', 0.3);
    hud.setVisible(false);
    await this.helmet.timeGlitch(1.3);

    // 2. Sabotage: no brakes, frozen wheel (nudged toward the outside wall), stuck throttle
    this.helmet.brakeFailure();
    car.brakesFailed = true;
    car.steerFailed = true;
    car.steer = -0.18; // physics: negative = right, the outside of the final left-hander
    this.world.inputOverride = { throttle: 1, brake: 1, steer: 0, handbrake: false, boost: false };
    audio.sfx('tire_skid', { volume: 0.8 });

    // Impact when the wall is hit (sudden speed loss) or after 1.7 s
    const start = performance.now();
    let lastSpeed = Math.abs(car.speed);
    await new Promise((resolve) => {
      const check = () => {
        const s = Math.abs(car.speed);
        const hit = lastSpeed - s > 6 || performance.now() - start > 1700;
        lastSpeed = s;
        if (hit) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });

    // 3–5. The crash itself, directed as a cutscene
    this.state = 'impact';
    await cutscenes.play(this._crashScript(), { world: this.world });
    this.state = 'done';
    return { led: led || this.wasLeading };
  }

  _crashScript() {
    const { car } = this.world;
    const pos = () => car.position.clone();
    const fx = this.fx;
    const placeAt = (f, offset = new THREE.Vector3()) => f.systems.forEach((s) => s.emitter.position.copy(car.position).add(offset));
    let centre;
    return {
      id: 'm1_crash',
      handheld: 0.02,
      letterbox: true,
      skippable: false,
      keepMood: false,
      steps: [
        at(0, call(() => {
          centre = pos().setY(1);
          this._flip();
          placeAt(fx.sparks, new THREE.Vector3(0, 0.3, 0));
          placeAt(fx.glass, new THREE.Vector3(0, 1.1, 0));
          fx.sparks.burst();
          fx.glass.burst();
          this.helmet.crackVisor();
          game.postfx.setChromaticAberration(1, 0.1);
        })),
        at(0, slowMo(0.15, 3.0, 0.08)),
        at(0, sfx('car_crash', { volume: 1, rate: 0.7 })),
        at(0.05, sfx('glass_shatter', { volume: 1, rate: 0.75 })),
        at(0, call((ctx) => ctx.camera.orbit(() => centre.lerp(pos().setY(Math.max(1, car.position.y)), 0.2), 8.5, this._yawBehind() + 0.4, this._yawBehind() + 2.4, 1.6, 3.2, 'sine.inOut'))),
        at(0.9, call(() => {
          placeAt(fx.sparks, new THREE.Vector3(0, 0.2, 0));
          fx.sparks.burst();
        })),
        at(0.9, sfx('bullet_impact', { volume: 0.8, rate: 0.6 })),
        at(1.6, setMood('FIRE', 0.6)),
        at(2.9, call(() => {
          placeAt(fx.explosion, new THREE.Vector3(0, 0.8, 0));
          fx.explosion.burst();
          this.fireLight.position.copy(car.position).setY(2);
          this.fireLight.intensity = 900;
          this.helmet.clear(0.2);
        })),
        at(2.9, sfx('explosion', { volume: 1 })),
        at(2.9, flash('#ffd2a0', 0.6)),
        at(2.95, cam.shake(0.55, 1.4)),
        at(3.0, glitch(0.5, 0.7)),
        at(4.3, fade.out(0.35, '#ffffff')),
        at(4.75, fade.out(1.1, '#000000')),
      ],
    };
  }

  /** Throw the car: up, roll over, a little yaw. Physics stays in charge. */
  _flip() {
    const { car } = this.world;
    car.crashed = true;
    const fwd = car.forward();
    const v = car.body.linvel();
    car.body.setLinvel({ x: v.x * 0.55, y: 9, z: v.z * 0.55 }, true);
    // roll about the forward axis + some yaw
    car.body.setAngvel({ x: fwd.x * 7.5, y: 2.2, z: fwd.z * 7.5 }, true);
  }

  _yawBehind() {
    const f = this.world.car.forward();
    return Math.atan2(-f.x, -f.z); // orbit angle convention: 0 = +Z side
  }

  dispose() {
    this.offFrame();
    this.batch.removeFromParent();
    this.fireLight.removeFromParent();
    timeScale.set(1, 0.01);
  }
}

export { wait };
