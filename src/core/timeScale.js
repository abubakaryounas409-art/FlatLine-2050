// =============================================================================
// FLATLINE: 2050 — core/timeScale.js
// One global time multiplier that every system reads (CLAUDE.md Phase 0.6).
//
//   scale = 1     normal speed
//   scale = 0.15  crash slow motion
//   scale = 0     frozen (pause / hit-stop)
//
// Rewind is NOT a negative scale: rewinding systems read `rewinding` and
// play back their recorded history instead (see systems/timeRewind.js).
//
// Usage in any system:   update(dt) { const sdt = timeScale.scaled(dt); ... }
// =============================================================================

import gsap from 'gsap';
import { CONFIG } from '../config.js';

class TimeScale {
  constructor() {
    this.scale = 1;          // current multiplier (tweened)
    this.rewinding = false;  // true while Time Rewind plays history backwards
    this.paused = false;     // pause menu: hard freeze regardless of scale
    this.elapsed = 0;        // total scaled game time in seconds
    this._tween = null;
  }

  /** Scale a real (unscaled) delta into game time. */
  scaled(dt) {
    return this.paused ? 0 : dt * this.scale;
  }

  /**
   * Smoothly change speed. Returns a promise that resolves when reached.
   * timeScale.set(0.15, 0.2)  → ease into slow-mo over 0.2 real seconds
   */
  set(scale, blendSeconds = CONFIG.time.defaultBlend) {
    this._tween?.kill();
    if (blendSeconds <= 0) {
      this.scale = scale;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._tween = gsap.to(this, {
        scale,
        duration: blendSeconds,
        ease: 'power2.out',
        onComplete: resolve,
      });
    });
  }

  /** Slow motion for `holdSeconds` real seconds, then return to normal. */
  async slowMo(scale, holdSeconds, blendSeconds = CONFIG.time.defaultBlend) {
    await this.set(scale, blendSeconds);
    await new Promise((r) => setTimeout(r, holdSeconds * 1000));
    await this.set(1, blendSeconds);
  }

  /** A short freeze on big impacts (Phase 11 hit-stop). Real-time seconds. */
  hitStop(seconds = 0.033) {
    const previous = this.scale;
    this._tween?.kill();
    this.scale = 0;
    setTimeout(() => (this.scale = previous), seconds * 1000);
  }

  /** Called once per frame by the main loop. */
  tick(realDt) {
    this.elapsed += this.scaled(realDt);
  }

  reset() {
    this._tween?.kill();
    this.scale = 1;
    this.rewinding = false;
    this.paused = false;
  }
}

export const timeScale = new TimeScale();
