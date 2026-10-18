// =============================================================================
// FLATLINE: 2050 — runner/runnerHUD.js
// The HUD of THE RUN (DOM, styled in style.css under "THE RUN"):
//   top-left    the heart: beats left + a live ECG trace
//   top-centre  act name + progress through the act
//   top-right   score, shards, multiplier
//   bottom      the three powers: icon, 3 charge pips, key — glowing when ready
//   centre      tutorial key prompts, popups (CLOSE!, SMASH!, +4 ♥), warnings
// =============================================================================

import gsap from 'gsap';
import { POWERS } from './abilities.js';

const ICON = { time: '⏳', shadow: '🌑', fire: '🔥' };
const NAME = { time: 'TIME STOP', shadow: 'SHADOW', fire: 'BURN' };
const KEY = { time: 'R', shadow: 'Q', fire: 'E' };

export class RunnerHUD {
  constructor() {
    const el = document.createElement('div');
    el.className = 'run-hud';
    el.innerHTML = `
      <div class="run-heart">
        <div class="run-heart-icon">❤</div>
        <div class="run-heart-n"><b>72</b><span>BEATS LEFT</span></div>
        <canvas class="run-ecg" width="220" height="54"></canvas>
      </div>
      <div class="run-act">
        <div class="run-act-name"></div>
        <div class="run-act-bar"><i></i></div>
      </div>
      <div class="run-score">
        <b class="run-score-n">0</b>
        <span class="run-score-sub"><em class="run-shards">0</em> SHARDS · <em class="run-mult">x1</em></span>
      </div>
      <div class="run-powers">
        ${POWERS.map((p) => `
          <div class="run-power is-locked" data-p="${p}">
            <div class="run-power-icon">${ICON[p]}</div>
            <div class="run-power-pips"><i></i><i></i><i></i></div>
            <div class="run-power-name">${NAME[p]}</div>
            <div class="run-power-key">${KEY[p]}</div>
            <div class="run-power-fill"></div>
          </div>`).join('')}
      </div>
      <div class="run-prompt"></div>
      <div class="run-warn"></div>
      <div class="run-pops"></div>
      <div class="run-vignette"></div>`;
    document.getElementById('ui-root').appendChild(el);
    this.el = el;
    this.q = (s) => el.querySelector(s);
    this.beatsEl = this.q('.run-heart-n b');
    this.heartIcon = this.q('.run-heart-icon');
    this.ecg = this.q('.run-ecg');
    this.ecgCtx = this.ecg.getContext('2d');
    this.ecgData = new Float32Array(110);
    this.ecgT = 0;
    this.beatPulse = 0;
    this.powers = Object.fromEntries(POWERS.map((p) => [p, el.querySelector(`.run-power[data-p="${p}"]`)]));
    this._promptTween = null;
    this._lastBeats = -1;
    this._lastScore = -1;
    this.setVisible(false);
  }

  setVisible(v) {
    this.el.classList.toggle('is-hidden', !v);
  }

  setAct(index, act) {
    this.q('.run-act-name').innerHTML = `ACT ${['I', 'II', 'III'][index] ?? ''} · <b>${act.title}</b> · ${act.year}`;
    this.el.dataset.act = act.id;
  }

  /** A heartbeat: pulse the icon, spike the ECG. */
  beat() {
    this.beatPulse = 1;
    gsap.fromTo(this.heartIcon, { scale: 1.35 }, { scale: 1, duration: 0.35, ease: 'power2.out' });
  }

  /**
   * @param {object} s  { beats, maxBeats, progress, score, shards, mult, abilities, dt, needs }
   */
  update(s) {
    if (s.beats !== this._lastBeats) {
      this.beatsEl.textContent = Math.max(0, Math.ceil(s.beats));
      this.el.classList.toggle('is-low', s.beats <= 20);
      this._lastBeats = s.beats;
    }
    this._bar ??= this.q('.run-act-bar i');
    const bar = `scaleX(${Math.min(1, Math.max(0, s.progress)).toFixed(3)})`;
    if (this._barV !== bar) this._bar.style.transform = this._barV = bar;
    if (s.score !== this._lastScore) {
      this.q('.run-score-n').textContent = Math.floor(s.score).toLocaleString('en-US');
      this.q('.run-shards').textContent = s.shards;
      this.q('.run-mult').textContent = `x${s.mult}`;
      this._lastScore = s.score;
    }
    const ab = s.abilities;
    for (const p of POWERS) {
      const el = this.powers[p];
      const c = ab.charges[p];
      el.classList.toggle('is-locked', !ab.unlocked[p] || ab.disabled);
      el.classList.toggle('is-ready', ab.unlocked[p] && c >= 1 && !ab.disabled);
      el.classList.toggle('is-active', ab.active[p] > 0);
      el.classList.toggle('is-needed', s.needs === p);
      el._pips ??= [...el.querySelectorAll('.run-power-pips i')];
      el._fill ??= el.querySelector('.run-power-fill');
      el._pips.forEach((pip, i) => pip.classList.toggle('on', c >= i + 1));
      const fill = `scaleX(${(c % 1).toFixed(2)})`;
      if (el._fillV !== fill) el._fill.style.transform = el._fillV = fill;
    }
    this._drawEcg(s.dt, s.beats);
  }

  _drawEcg(dt, beats) {
    // scroll a trace; a beat injects the P-QRS-T shape
    this.ecgT += dt;
    const step = 1 / 55;
    while (this.ecgT > step) {
      this.ecgT -= step;
      this.ecgData.copyWithin(0, 1);
      let v = (Math.random() - 0.5) * 0.04;
      if (this.beatPulse > 0) {
        const k = 1 - this.beatPulse;
        // pulse runs 1 → 0 over ~0.32 s
        v += k < 0.1 ? 0.12 : k < 0.18 ? -0.25 : k < 0.26 ? 1 : k < 0.34 ? -0.45 : k < 0.6 ? 0.16 * Math.sin((k - 0.34) * 12) : 0;
        this.beatPulse = Math.max(0, this.beatPulse - step / 0.32);
      }
      this.ecgData[this.ecgData.length - 1] = v;
    }
    const g = this.ecgCtx;
    const w = this.ecg.width;
    const h = this.ecg.height;
    g.clearRect(0, 0, w, h);
    g.lineJoin = 'round';
    const low = beats <= 20;
    const col = low ? '255,60,60' : '255,90,110';
    // glow by stroking wide + faint, then thin + bright
    for (const [lw, a] of [[6, 0.15], [3, 0.35], [1.5, 1]]) {
      g.strokeStyle = `rgba(${col},${a})`;
      g.lineWidth = lw;
      g.beginPath();
      this.ecgData.forEach((v, i) => {
        const x = (i / (this.ecgData.length - 1)) * w;
        const y = h * 0.62 - v * h * 0.5;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
    }
  }

  /** A tutorial prompt: keycaps + text (null clears). */
  prompt(keys, text, ability = null) {
    const el = this.q('.run-prompt');
    this._promptTween?.kill();
    if (!keys) {
      this._promptTween = gsap.to(el, { opacity: 0, y: 10, duration: 0.25 });
      return;
    }
    el.dataset.p = ability ?? '';
    el.innerHTML = `<div class="run-keys">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</div><div class="run-prompt-text">${text}</div>`;
    this._promptTween = gsap.fromTo(el, { opacity: 0, y: 14, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'back.out(2)' });
  }

  /** A short warning line (e.g. "NEED ⏳ — GET A TIME ORB"). */
  warn(text) {
    const el = this.q('.run-warn');
    if (el.textContent === (text ?? '')) return;
    el.textContent = text ?? '';
    el.classList.toggle('on', !!text);
  }

  /** A popup that floats up and fades (CLOSE!, SMASH!, +4 ♥). */
  pop(text, cls = '') {
    const p = document.createElement('div');
    p.className = `run-pop ${cls}`;
    p.textContent = text;
    this.q('.run-pops').appendChild(p);
    gsap.fromTo(p, { opacity: 0, y: 16, scale: 0.7 }, { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: 'back.out(3)' });
    gsap.to(p, { opacity: 0, y: -40, duration: 0.5, delay: 0.7, onComplete: () => p.remove() });
  }

  /** Flash a power's meter (used / denied). */
  flashPower(p, denied = false) {
    const el = this.powers[p];
    el.classList.remove('flash', 'deny');
    void el.offsetWidth;
    el.classList.add(denied ? 'deny' : 'flash');
  }

  /** The finale: the meters crack and go dark. */
  breakPowers() {
    this.el.classList.add('powers-broken');
  }

  destroy() {
    this._promptTween?.kill();
    this.el.remove();
  }
}
