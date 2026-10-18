// =============================================================================
// FLATLINE: 2050 — runner/abilities.js
// The three powers of THE RUN. Each has a 3-charge meter filled by its orbs,
// a key, a duration and a signature (colour grade + sound + VFX, applied by
// the world through the callbacks below).
//
//   ⏳ TIME    R / X       every moving hazard freezes (and stays jammed)
//   🌑 SHADOW  Q / T / RB  Kael turns to smoke: pass through lasers, squads, walls
//   🔥 BURN    E / Y       a blazing dash: smash through barricades, beams, squads
//
// Powers unlock one per act (time → shadow → fire), as the story gives them.
// =============================================================================

import { CONFIG } from '../config.js';

export const POWERS = ['time', 'shadow', 'fire'];
const CFG_KEY = { time: 'time', shadow: 'shadow', fire: 'burn' };

export class Abilities {
  constructor() {
    this.charges = { time: 0, shadow: 0, fire: 0 };
    this.unlocked = { time: false, shadow: false, fire: false };
    this.active = { time: 0, shadow: 0, fire: 0 }; // seconds left
    this.uses = { time: 0, shadow: 0, fire: 0 };
    this.disabled = false; // the finale: nothing works in the last fire
    this.onActivate = () => {};
    this.onEnd = () => {};
    this.onDenied = () => {};
  }

  unlock(type, charges = CONFIG.runner.startCharges) {
    this.unlocked[type] = true;
    this.charges[type] = Math.max(this.charges[type], charges);
  }

  add(type, amount = CONFIG.runner.orbCharge * 2) {
    this.charges[type] = Math.min(3, this.charges[type] + amount);
  }

  isActive(type) {
    return this.active[type] > 0;
  }

  /** Try to use a power. Returns true if it fired. */
  trigger(type) {
    if (this.disabled || !this.unlocked[type] || this.charges[type] < 1 || this.active[type] > 0) {
      this.onDenied(type);
      return false;
    }
    this.charges[type] -= 1;
    this.active[type] = CONFIG.runner[CFG_KEY[type]].duration;
    this.uses[type] += 1;
    this.onActivate(type);
    return true;
  }

  /** Real seconds (powers run on the real clock, so slow-mo doesn't stretch them). */
  update(dt) {
    for (const t of POWERS) {
      if (this.active[t] <= 0) continue;
      this.active[t] -= dt;
      if (this.active[t] <= 0) {
        this.active[t] = 0;
        this.onEnd(t);
      }
    }
  }

  /** The strongest active power (colours Kael). */
  get dominant() {
    if (this.active.fire > 0) return 'fire';
    if (this.active.shadow > 0) return 'shadow';
    if (this.active.time > 0) return 'time';
    return null;
  }

  endAll() {
    for (const t of POWERS) {
      if (this.active[t] > 0) {
        this.active[t] = 0;
        this.onEnd(t);
      }
    }
  }

  snapshotState() {
    return { charges: { ...this.charges }, unlocked: { ...this.unlocked } };
  }

  restoreState(s) {
    Object.assign(this.charges, s.charges);
    Object.assign(this.unlocked, s.unlocked);
  }
}
