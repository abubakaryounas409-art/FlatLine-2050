// =============================================================================
// FLATLINE: 2050 — ui/bootIntro.js
// The opening (CLAUDE.md Phase 1.1):
//
//   gate:   "click to begin" — browsers only allow sound after a click / key
//   0.0 s   black
//   0.6 s   a thin heart-monitor line starts tracing across the screen
//   1.4 s   beat 1  ┐ heartbeat + monitor beep, the line spikes with each
//   2.4 s   beat 2  │
//   3.4 s   beat 3  ┘
//   4.0 s   flatline tone, the line goes flat
//   4.9 s   the line contracts and the title FLATLINE rises out of it
//   5.9 s   "2050" glitches in, in blue; embers and shadow smoke drift in
//   7.0 s   done → main menu
//
// After the first full view, any key or click skips it (saveGame.introSeen).
// =============================================================================

import gsap from 'gsap';
import { audio } from '../core/audio.js';
import { saveGame } from '../systems/saveGame.js';
import { glitchText, scrambleText } from '../vfx/glitchFX.js';

const BEATS = [1.4, 2.4, 3.4];  // seconds after start
const TRACE_START = 0.6;
const TRACE_END = 4.9;          // head reaches the right edge
const FLATLINE_AT = 4.0;
const COLLAPSE_AT = 4.9;
const TITLE_AT = 5.35;
const YEAR_AT = 5.9;
const END_AT = 7.0;

export class BootIntro {
  /**
   * @param {object} o
   * @param {object} o.garage   garage world (for embers / smoke)
   * @param {HTMLElement} o.parent
   */
  constructor({ garage, parent = document.getElementById('ui-root') }) {
    this.garage = garage;
    this.root = document.createElement('div');
    this.root.className = 'boot';
    this.root.innerHTML = `
      <canvas class="boot-ecg"></canvas>
      <div class="boot-title" aria-label="FLATLINE 2050">
        <div class="boot-title-main" data-text="FLATLINE">FLATLINE</div>
        <div class="boot-title-year" data-text="2050">2050</div>
      </div>
      <button class="boot-gate" type="button">
        <span class="boot-gate-label">Click to begin</span>
        <span class="boot-gate-hint">Headphones recommended</span>
        <span class="boot-gate-warning" hidden></span>
      </button>
      <div class="boot-skip" hidden>Press any key to skip</div>
    `;
    parent.appendChild(this.root);

    this.canvas = this.root.querySelector('.boot-ecg');
    this.ctx = this.canvas.getContext('2d');
    this.titleEl = this.root.querySelector('.boot-title');
    this.mainEl = this.root.querySelector('.boot-title-main');
    this.yearEl = this.root.querySelector('.boot-title-year');
    this.gateEl = this.root.querySelector('.boot-gate');
    this.skipEl = this.root.querySelector('.boot-skip');

    this.points = [];       // traced ECG samples { x: 0..1, y: px offset }
    this.lastSampleT = 0;
    this.state = { t: 0, collapse: 0, lineAlpha: 1, white: 0 };
    this.timeline = null;
    this.sounds = {};
    this._raf = 0;
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._resize();
  }

  // ---------------------------------------------------------------------------
  // Gate: wait for a click / key so audio is allowed to play.
  // ---------------------------------------------------------------------------
  waitForGesture() {
    if (audio.blockedByDownloadManager) {
      const warn = this.root.querySelector('.boot-gate-warning');
      warn.hidden = false;
      warn.textContent = 'Sound is blocked by a download manager (e.g. IDM). Add "localhost" to its exceptions.';
    }
    gsap.fromTo(this.gateEl, { opacity: 0 }, { opacity: 1, duration: 1, ease: 'sine.out' });
    return new Promise((resolve) => {
      const go = (e) => {
        if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
        window.removeEventListener('keydown', go);
        this.gateEl.removeEventListener('click', go);
        audio.sfx('ui_click');
        gsap.to(this.gateEl, {
          opacity: 0,
          duration: 0.35,
          onComplete: () => {
            this.gateEl.remove();
            resolve();
          },
        });
      };
      window.addEventListener('keydown', go);
      this.gateEl.addEventListener('click', go);
      this.gateEl.focus({ preventScroll: true });
    });
  }

  // ---------------------------------------------------------------------------
  // The sequence
  // ---------------------------------------------------------------------------
  /** Plays the intro. Resolves when finished (or skipped). */
  play() {
    const skippable = saveGame.data.introSeen;
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._raf = requestAnimationFrame((t) => this._frame(t));

      const tl = gsap.timeline({ onComplete: () => this._finish() });
      this.timeline = tl;

      // Trace time drives the ECG head (linear, real time).
      tl.to(this.state, { t: END_AT, duration: END_AT, ease: 'none' }, 0);

      BEATS.forEach((t) =>
        tl.call(() => {
          audio.sfx('heartbeat', { volume: 1 });
          setTimeout(() => audio.sfx('monitor_beep', { volume: 1 }), 60);
        }, null, t),
      );

      tl.call(() => (this.sounds.flatline = audio.sfx('flatline', { volume: 0.55 })), null, FLATLINE_AT);

      // The line flattens and contracts into the title, turning white.
      tl.to(this.state, { collapse: 1, white: 1, duration: 0.55, ease: 'power3.inOut' }, COLLAPSE_AT);
      tl.call(() => this._revealTitle(), null, TITLE_AT);
      tl.to(this.state, { lineAlpha: 0, duration: 0.9, ease: 'sine.in' }, TITLE_AT + 0.35);
      tl.call(() => audio.stop('sfx', 'flatline', this.sounds.flatline, 2.2), null, TITLE_AT + 0.2);
      tl.call(() => audio.playMusic('main_theme', 4), null, TITLE_AT);
      tl.call(() => this._revealYear(), null, YEAR_AT);
      tl.call(() => this.garage.setAtmosphere({ embers: 1, smoke: 1 }), null, TITLE_AT - 0.2);

      if (skippable) {
        this.skipEl.hidden = false;
        gsap.fromTo(this.skipEl, { opacity: 0 }, { opacity: 0.6, duration: 1, delay: 0.8 });
        this._onSkip = (e) => {
          if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
          this.skip();
        };
        window.addEventListener('keydown', this._onSkip);
        window.addEventListener('pointerdown', this._onSkip);
      }
    });
  }

  /** Jump straight to the finished title. */
  skip() {
    if (!this.timeline) return;
    this.timeline.kill();
    audio.stop('sfx', 'flatline', this.sounds.flatline, 0.3);
    audio.playMusic('main_theme', 2);
    this.state.lineAlpha = 0;
    this.garage.setAtmosphere({ embers: 1, smoke: 1 });
    this.mainEl.style.clipPath = 'inset(0 0 0 0)';
    this.titleEl.classList.add('is-lit');
    this.yearEl.textContent = '2050';
    this.yearEl.style.opacity = 1;
    this._finish();
  }

  _finish() {
    if (!this._resolve) return;
    window.removeEventListener('keydown', this._onSkip);
    window.removeEventListener('pointerdown', this._onSkip);
    this.skipEl.hidden = true;
    saveGame.markIntroSeen();
    const resolve = this._resolve;
    this._resolve = null;
    resolve();
  }

  _revealTitle() {
    this.titleEl.classList.add('is-lit');
    // Letters rise out of the line (clip from the bottom edge upwards).
    gsap.fromTo(
      this.mainEl,
      { clipPath: 'inset(100% 0 0 0)', y: 14 },
      { clipPath: 'inset(0% 0 0 0)', y: 0, duration: 0.9, ease: 'power3.out' },
    );
    gsap.fromTo(this.mainEl, { letterSpacing: '0.62em' }, { letterSpacing: '0.42em', duration: 2.4, ease: 'power2.out' });
  }

  _revealYear() {
    audio.sfx('ui_glitch', { volume: 0.9 });
    gsap.set(this.yearEl, { opacity: 1 });
    scrambleText(this.yearEl, '2050', 0.55);
    glitchText(this.yearEl, 0.6);
  }

  /** Remove the intro layer (the title element is handed to the menu first). */
  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.root.remove();
  }

  // ---------------------------------------------------------------------------
  // ECG canvas
  // ---------------------------------------------------------------------------
  _resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Vertical offset (px, up = negative) of the ECG at time t. */
  _wave(t, amp) {
    let y = 0;
    for (const b of BEATS) {
      const d = t - b;
      if (d < -0.15 || d > 0.6) continue;
      const g = (c, w, h) => h * Math.exp(-(((d - c) / w) ** 2));
      y += g(-0.08, 0.03, -0.05) + g(0.0, 0.012, 0.08) + g(0.035, 0.014, -1) + g(0.075, 0.016, 0.3) + g(0.32, 0.06, -0.14);
    }
    return y * amp;
  }

  _frame() {
    const { t } = this.state;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const amp = Math.min(h * 0.32, 260);

    // Sample the trace up to the current time (fine steps keep spikes sharp).
    const traceT = Math.min(t, TRACE_END);
    const span = TRACE_END - TRACE_START;
    for (let s = Math.max(this.lastSampleT, TRACE_START); s <= traceT; s += 1 / 480) {
      const flat = s > FLATLINE_AT ? 0 : 1;
      this.points.push({ x: (s - TRACE_START) / span, y: this._wave(s, amp) * flat });
      this.lastSampleT = s + 1 / 480;
    }
    this._draw(w, h);
    this._raf = requestAnimationFrame((tt) => this._frame(tt));
  }

  _draw(w, h) {
    const ctx = this.ctx;
    const { collapse, lineAlpha, white } = this.state;
    ctx.clearRect(0, 0, w, h);
    if (!this.points.length || lineAlpha <= 0.001) return;

    const mid = h * 0.5;
    // Width the line contracts to = width of the title text.
    const titleW = this.mainEl.getBoundingClientRect().width || w * 0.5;
    const scale = 1 + (titleW / w - 1) * collapse;
    const cx = w / 2;

    // Colour: TIME blue → white as it becomes the title.
    const r = Math.round(63 + (255 - 63) * white);
    const g = Math.round(169 + (255 - 169) * white);
    const rgba = (a) => `rgba(${r},${g},255,${a * lineAlpha})`;

    ctx.beginPath();
    this.points.forEach((p, i) => {
      const x = cx + (p.x * w - cx) * scale;
      const y = mid + p.y * (1 - collapse);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Glow = the same path stroked wide and faint, then thin and bright.
    // (Cheaper than shadowBlur, which also left ghost frames in some renderers.)
    [[14 + 6 * white, 0.06], [7 + 3 * white, 0.16], [2 + white, 1]].forEach(([width, alpha]) => {
      ctx.strokeStyle = rgba(alpha);
      ctx.lineWidth = width;
      ctx.stroke();
    });

    // Glowing head while tracing
    const head = this.points[this.points.length - 1];
    if (collapse < 0.05 && this.state.t < TRACE_END) {
      const hx = head.x * w;
      const hy = mid + head.y;
      const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, 20);
      grad.addColorStop(0, `rgba(255,255,255,${0.9 * lineAlpha})`);
      grad.addColorStop(0.35, `rgba(63,169,255,${0.5 * lineAlpha})`);
      grad.addColorStop(1, 'rgba(63,169,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(hx, hy, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    // Phosphor fade on the oldest part of the trace (only while tracing)
    if (collapse < 0.01) {
      const fade = ctx.createLinearGradient(0, 0, head.x * w, 0);
      fade.addColorStop(0, 'rgba(0,0,0,0.8)');
      fade.addColorStop(0.55, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
