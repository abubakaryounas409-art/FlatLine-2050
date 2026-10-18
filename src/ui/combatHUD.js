// =============================================================================
// FLATLINE: 2050 — ui/combatHUD.js
// On-foot HUD (CLAUDE.md Phases 6–7): dynamic crosshair (gap = spread),
// hit / kill markers, ammo + weapon, reload bar, incendiary rounds, sniper
// scope with breath sway and "hold Shift to steady", and the Heartbeat Meter
// (animated heart + ECG) bottom-left.
// =============================================================================

import gsap from 'gsap';
import { heartbeat } from '../systems/heartbeat.js';

export class CombatHUD {
  constructor() {
    const root = document.createElement('div');
    root.className = 'combat-hud';
    root.innerHTML = `
      <div class="ch-cross">
        <i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><b class="ch-dot"></b>
        <div class="ch-hit"><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="ch-scope">
        <div class="ch-scope-ring"></div>
        <div class="ch-scope-h"></div><div class="ch-scope-v"></div>
        <div class="ch-scope-steady">HOLD <b>SHIFT</b> TO STEADY <span>· 1 BEAT</span></div>
      </div>
      <div class="ch-ammo">
        <div class="ch-weapon"></div>
        <div class="ch-count"><span class="ch-mag">0</span><span class="ch-reserve">/ 0</span></div>
        <div class="ch-special">🔥 <span class="ch-inc">0</span> <em>V</em></div>
        <div class="ch-reload"><i></i></div>
      </div>
      <div class="ch-heart">
        <svg class="ch-heart-icon" viewBox="0 0 32 30"><path d="M16 29 3.5 16.5A8 8 0 0 1 16 5.6 8 8 0 0 1 28.5 16.5Z"/></svg>
        <div class="ch-heart-val"><span class="ch-beats">72</span><small>BEATS</small></div>
        <svg class="ch-ecg" viewBox="0 0 120 24" preserveAspectRatio="none"><polyline points="0,12 30,12 36,12 40,3 45,21 49,12 120,12"/></svg>
      </div>`;
    document.getElementById('ui-root').appendChild(root);
    this.root = root;
    this.$ = (s) => root.querySelector(s);
    this.cross = this.$('.ch-cross');
    this.scope = this.$('.ch-scope');
    this.lastBeats = heartbeat.beats;
    this._beatT = 0;

    this.offHeart = heartbeat.on((ev, d) => {
      if (ev === 'change') this._setBeats(d.beats);
      if (ev === 'spend') this._pulse('spend');
      if (ev === 'restore') this._pulse('restore');
      if (ev === 'denied') this._pulse('denied');
    });
    this._setBeats(heartbeat.beats);
  }

  _setBeats(b) {
    this.$('.ch-beats').textContent = b;
    this.root.classList.toggle('is-low', heartbeat.low);
  }

  _pulse(kind) {
    const el = this.$('.ch-heart');
    el.classList.remove('is-spend', 'is-restore', 'is-denied');
    void el.offsetWidth;
    el.classList.add(`is-${kind}`);
  }

  /**
   * @param {object} s
   * @param {number} s.spread      crosshair gap in px
   * @param {boolean} s.visible    crosshair shown (aiming or recently fired)
   * @param {boolean} s.scoped     sniper scope overlay
   * @param {boolean} s.steadying
   * @param {number} s.realDt
   */
  update({ spread = 8, visible = true, scoped = false, steadying = false, realDt = 0.016 }) {
    const gap = Math.round(spread);
    this.cross.style.setProperty('--gap', `${gap}px`);
    this.cross.classList.toggle('is-visible', visible && !scoped);
    this.scope.classList.toggle('is-on', scoped);
    this.scope.classList.toggle('is-steady', steadying);
    // the heart icon beats at the current BPM (fewer beats left → it races)
    const bpm = 60 + (1 - heartbeat.fraction) * 70;
    this._beatT += realDt * (bpm / 60);
    if (this._beatT >= 1) {
      this._beatT -= 1;
      gsap.fromTo(this.$('.ch-heart-icon'), { scale: 1.22 }, { scale: 1, duration: 0.35, ease: 'power2.out' });
    }
  }

  setWeapon({ name, mag, reserve, incendiary = 0, incendiaryOn = false }) {
    this.$('.ch-weapon').textContent = name;
    this.$('.ch-mag').textContent = mag;
    this.$('.ch-reserve').textContent = `/ ${reserve}`;
    this.$('.ch-inc').textContent = incendiary;
    this.$('.ch-special').classList.toggle('is-on', incendiaryOn);
    this.$('.ch-ammo').classList.toggle('is-empty', mag === 0);
  }

  reloadProgress(k) {
    const bar = this.$('.ch-reload');
    bar.style.opacity = k > 0 && k < 1 ? 1 : 0;
    bar.firstElementChild.style.transform = `scaleX(${k.toFixed(3)})`;
  }

  hitMarker(kill = false) {
    const el = this.$('.ch-hit');
    el.classList.toggle('is-kill', kill);
    gsap.killTweensOf(el);
    gsap.fromTo(el, { opacity: 1, scale: kill ? 1.4 : 1.15 }, { opacity: 0, scale: 1, duration: kill ? 0.5 : 0.25, ease: 'power2.out' });
  }

  setVisible(v) {
    gsap.to(this.root, { opacity: v ? 1 : 0, duration: 0.3 });
  }

  destroy() {
    this.offHeart();
    this.root.remove();
  }
}
