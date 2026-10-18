// =============================================================================
// FLATLINE: 2050 — systems/heartbeat.js
// The Heartbeat Meter (CLAUDE.md Phase 7.1): Kael's body is dying in 2050,
// and every bend of time costs him beats.
//
//   heartbeat.spend(3, 'rewind')   → false if he can't afford it
//   heartbeat.restore(6)           memory fragments
//   heartbeat.on((event, data) => …)   'change' | 'spend' | 'restore' | 'low' | 'flatline' | 'reset'
//
// Costs live in CONFIG.heartbeat.cost. At 0 beats: FLATLINE (game over).
// =============================================================================

import { CONFIG } from '../config.js';
import { settings } from './settings.js';

class Heartbeat {
  constructor() {
    this.listeners = new Set();
    this.beats = CONFIG.heartbeat.start;
    this.max = CONFIG.heartbeat.max;
  }

  get low() {
    return this.beats < CONFIG.heartbeat.lowThreshold;
  }

  /** 0..1 of the full meter. */
  get fraction() {
    return this.beats / this.max;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(event, data) {
    this.listeners.forEach((fn) => fn(event, data));
  }

  reset(value = CONFIG.heartbeat.start) {
    this.beats = value;
    this._emit('reset', { beats: value });
    this._emit('change', { beats: value });
  }

  canAfford(n) {
    return this.beats >= n && this.beats > 0;
  }

  /**
   * Pay for an ability. Returns false (and spends nothing) if there aren't
   * enough beats — except `force` (dying always costs).
   */
  spend(n, reason = '', { force = false } = {}) {
    // difficulty scales what abilities and deaths cost (scripted drains pass force + reason 'fire'/'umbra'/'test')
    if (!['fire', 'umbra', 'test'].includes(reason)) n = Math.max(1, Math.round(n * (CONFIG.heartbeat.difficulty[settings.get('difficulty')] ?? 1)));
    if (!force && !this.canAfford(n)) {
      this._emit('denied', { n, reason });
      return false;
    }
    const wasLow = this.low;
    this.beats = Math.max(0, this.beats - n);
    this._emit('spend', { n, reason, beats: this.beats });
    this._emit('change', { beats: this.beats });
    if (!wasLow && this.low) this._emit('low', { beats: this.beats });
    if (this.beats === 0) this._emit('flatline', { reason });
    return true;
  }

  restore(n) {
    this.beats = Math.min(this.max, this.beats + n);
    this._emit('restore', { n, beats: this.beats });
    this._emit('change', { beats: this.beats });
  }
}

export const heartbeat = new Heartbeat();
