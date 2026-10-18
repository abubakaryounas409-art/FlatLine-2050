// =============================================================================
// FLATLINE: 2050 — systems/timeRewind.js
// ⏳ TIME — rewind engine (CLAUDE.md Phase 7.2, used from Phase 3 in the race).
//
// Anything rewindable registers an adapter:
//   const off = timeRewind.register({ snapshot: () => state, restore: (state) => {} });
// record(dt) samples every adapter (CONFIG.time.rewindHz, last rewindSeconds).
// While rewinding, step(dt) walks the history backwards (rewindSpeed × real
// time) and restores each frame; releasing resumes from that moment.
// =============================================================================

import { CONFIG } from '../config.js';
import { timeScale } from '../core/timeScale.js';

class TimeRewind {
  constructor() {
    this.targets = new Set();
    this.history = [];      // [{ t, states: Map(target → state) }], oldest first
    this.clock = 0;
    this.rewinding = false;
    this._acc = 0;
  }

  register(target) {
    this.targets.add(target);
    return () => this.targets.delete(target);
  }

  clear() {
    this.history.length = 0;
    this.rewinding = false;
    timeScale.rewinding = false;
  }

  /** Seconds of history available to rewind. */
  get available() {
    return this.history.length ? this.clock - this.history[0].t : 0;
  }

  /** Call every fixed step while NOT rewinding. */
  record(dt) {
    if (this.rewinding) return;
    this.clock += dt;
    this._acc += dt;
    if (this._acc < 1 / CONFIG.time.rewindHz) return;
    this._acc = 0;
    const states = new Map();
    this.targets.forEach((t) => states.set(t, t.snapshot()));
    this.history.push({ t: this.clock, states });
    const oldest = this.clock - CONFIG.time.rewindSeconds;
    while (this.history.length && this.history[0].t < oldest) this.history.shift();
  }

  start() {
    if (this.rewinding || this.history.length < 2) return false;
    this.rewinding = true;
    timeScale.rewinding = true;
    return true;
  }

  /** Walk back through history. Returns false when the buffer runs out. */
  step(dt, speed = 2) {
    if (!this.rewinding) return false;
    this.clock -= dt * speed;
    while (this.history.length > 1 && this.history[this.history.length - 1].t > this.clock) this.history.pop();
    const frame = this.history[this.history.length - 1];
    frame?.states.forEach((state, target) => this.targets.has(target) && target.restore(state));
    if (this.history.length <= 1) {
      this.stop();
      return false;
    }
    return true;
  }

  stop() {
    if (!this.rewinding) return;
    this.rewinding = false;
    timeScale.rewinding = false;
    const last = this.history[this.history.length - 1];
    if (last) this.clock = last.t;
  }
}

export const timeRewind = new TimeRewind();
