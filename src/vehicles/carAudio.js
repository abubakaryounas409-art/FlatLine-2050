// =============================================================================
// FLATLINE: 2050 — vehicles/carAudio.js
// Engine sound tied to speed (CLAUDE.md Phase 3.7): electric whine + turbine
// pitched by speed, wind rising with speed², tyre skid while drifting, a hit
// of sound when boost kicks in.
// =============================================================================

import { CONFIG } from '../config.js';
import { audio } from '../core/audio.js';

const LOOPS = ['engine_electric', 'engine_turbine', 'wind', 'tire_skid'];

export class CarAudio {
  constructor() {
    this.ids = {};
    this.level = { skid: 0, wind: 0 };
    this.wasBoosting = false;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    LOOPS.forEach((k) => (this.ids[k] = audio.sfx(k, { volume: 0 })));
  }

  /** Call every frame (real dt). */
  update(dt, car, throttle = 0) {
    if (!this.running) return;
    const ratio = Math.min(1.3, Math.abs(car.speed) / CONFIG.car.topSpeed);
    const set = (k, v) => audio.set('sfx', k, this.ids[k], v);

    set('engine_electric', { rate: 0.7 + ratio * 1.15, volume: 0.32 + 0.38 * throttle + 0.15 * ratio });
    set('engine_turbine', { rate: 0.6 + ratio * 0.85 + (car.boosting ? 0.15 : 0), volume: ratio * 0.35 + (car.boosting ? 0.35 : 0) });
    this.level.wind += (ratio * ratio * 0.75 - this.level.wind) * Math.min(1, dt * 3);
    set('wind', { volume: this.level.wind });
    const skidTarget = car.drifting ? Math.min(0.8, 0.25 + car.slipAngle / 40) : 0;
    this.level.skid += (skidTarget - this.level.skid) * Math.min(1, dt * 8);
    set('tire_skid', { volume: this.level.skid, rate: 0.9 + ratio * 0.2 });

    if (car.boosting && !this.wasBoosting) audio.sfx('boost', { volume: 0.9 });
    this.wasBoosting = car.boosting;
  }

  stop(fade = 0.6) {
    if (!this.running) return;
    this.running = false;
    LOOPS.forEach((k) => audio.stop('sfx', k, this.ids[k], fade));
  }
}
