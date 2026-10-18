// =============================================================================
// FLATLINE: 2050 — systems/heartbeatFX.js
// What a weak heart feels like (CLAUDE.md Phase 7.1): below the low threshold
// the vignette pulses with each beat, colour drains, the heartbeat gets louder
// and faster, and the music speeds up. Call update(realDt) every frame in
// 2020 worlds; stop() when leaving.
// =============================================================================

import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { heartbeat } from './heartbeat.js';

class HeartbeatFX {
  constructor() {
    this.t = 0;
    this.level = 0; // 0 healthy … 1 nearly flatlined (smoothed)
  }

  update(realDt) {
    const low = CONFIG.heartbeat.lowThreshold;
    const target = heartbeat.beats < low ? 1 - heartbeat.beats / low : 0;
    this.level += (target - this.level) * Math.min(1, realDt * 2);
    const fx = game.postfx;
    if (this.level < 0.01) {
      if (fx) fx.lowHeart = 0;
      audio.setMusicRate(1);
      return;
    }
    // beat rate rises as beats run out
    const bpm = 80 + this.level * 70;
    this.t += realDt * (bpm / 60);
    let pulse = 0;
    if (this.t >= 1) {
      this.t -= 1;
      audio.sfx('heartbeat', { volume: 0.35 + this.level * 0.6, rate: 1 + this.level * 0.3 });
    }
    pulse = Math.exp(-this.t * 6); // sharp thump, then decay
    if (fx) {
      fx.lowHeart = this.level;
      fx.lowHeartPulse = pulse;
    }
    audio.setMusicRate(1 + this.level * 0.12);
  }

  stop() {
    this.level = 0;
    if (game.postfx) game.postfx.lowHeart = 0;
    audio.setMusicRate(1);
  }
}

export const heartbeatFX = new HeartbeatFX();
