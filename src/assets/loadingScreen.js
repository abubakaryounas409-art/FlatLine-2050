// =============================================================================
// FLATLINE: 2050 — assets/loadingScreen.js
// Black screen, a heart-monitor (ECG) line drawing across it, and a
// percentage counter. The trace speed follows real progress; a glowing head
// dot leads the line and the beats spike on a steady rhythm.
//
//   const ls = new LoadingScreen(); ls.show();
//   ls.setProgress(0.4);
//   await ls.hide();   // waits for the minimum display time, then fades out
// =============================================================================

import { CONFIG } from '../config.js';

export class LoadingScreen {
  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'loading-screen';
    this.root.innerHTML = `
      <canvas class="ls-ecg"></canvas>
      <div class="ls-bottom">
        <div class="ls-label">ESTABLISHING VITALS</div>
        <div class="ls-percent">0%</div>
      </div>
    `;
    this.canvas = this.root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.percentEl = this.root.querySelector('.ls-percent');

    this.target = 0;     // real progress 0..1
    this.shown = 0;      // smoothed progress drawn on screen
    this.startTime = 0;
    this._raf = 0;
    this._onResize = () => this._resize();
  }

  show(parent = document.body) {
    parent.appendChild(this.root);
    this._resize();
    window.addEventListener('resize', this._onResize);
    this.startTime = performance.now();
    this._last = this.startTime;
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  setProgress(p) {
    this.target = Math.max(this.target, Math.min(1, p));
  }

  /** Resolves once the ECG reached 100% and the fade-out finished. */
  async hide() {
    this.setProgress(1);
    const minMs = CONFIG.loading.minDisplaySeconds * 1000;
    // Wait for the minimum time AND for the trace to reach the right edge.
    await new Promise((resolve) => {
      const check = () => {
        if (performance.now() - this.startTime >= minMs && this.shown >= 0.999) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
    this.root.style.transition = `opacity ${CONFIG.loading.fadeOutSeconds}s ease`;
    this.root.style.opacity = '0';
    await new Promise((r) => setTimeout(r, CONFIG.loading.fadeOutSeconds * 1000));
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.root.remove();
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * ECG waveform. x is 0..1 across the screen; returns a vertical offset in px.
   * A beat repeats every `period` of the width: P wave, QRS spike, T wave.
   */
  _ecg(x, h) {
    const period = 0.16;
    const phase = (x % period) / period;
    const bump = (center, width, height) => height * Math.exp(-(((phase - center) / width) ** 2));
    return (
      bump(0.18, 0.035, -0.04 * h) +   // P wave
      bump(0.3, 0.012, 0.05 * h) +     // Q dip
      bump(0.335, 0.012, -0.32 * h) +  // R spike
      bump(0.37, 0.014, 0.12 * h) +    // S dip
      bump(0.6, 0.06, -0.07 * h)       // T wave
    );
  }

  _frame(now) {
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;

    // Ease toward the real progress, but always creep forward a little so the
    // line never looks frozen while a big file downloads.
    const minTime = CONFIG.loading.minDisplaySeconds;
    const capByTime = Math.min(1, (now - this.startTime) / 1000 / minTime);
    const goal = Math.min(this.target, capByTime);
    this.shown += (goal - this.shown) * Math.min(1, dt * 6);
    if (goal - this.shown < 0.002) this.shown = goal;

    this._draw(now);
    this.percentEl.textContent = `${Math.round(this.shown * 100)}%`;
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  _draw(now) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const mid = h * 0.5;
    const amp = Math.min(h, 700);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Faint monitor grid
    ctx.strokeStyle = 'rgba(63,169,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0; y < h; y += 40) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    // Trace up to the current progress, sampling every 2 px.
    const headX = this.shown * w;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let x = 0; x <= headX; x += 2) ctx.lineTo(x, mid + this._ecg(x / w, amp));
    ctx.lineTo(headX, mid + this._ecg(headX / w, amp));

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Glow = wide faint strokes under a thin bright one (no shadowBlur: slow,
    // and it can leave ghost frames in software renderers).
    [[16, 0.06], [8, 0.16], [2.5, 1]].forEach(([width, alpha]) => {
      ctx.strokeStyle = `rgba(63,169,255,${alpha})`;
      ctx.lineWidth = width;
      ctx.stroke();
    });

    // Glowing head dot, pulsing
    const headY = mid + this._ecg(headX / w, amp);
    const pulse = 0.6 + 0.4 * Math.sin(now / 120);
    const g = ctx.createRadialGradient(headX, headY, 0, headX, headY, 22);
    g.addColorStop(0, `rgba(255,255,255,${pulse})`);
    g.addColorStop(0.3, 'rgba(63,169,255,0.6)');
    g.addColorStop(1, 'rgba(63,169,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(headX, headY, 22, 0, Math.PI * 2);
    ctx.fill();

    // Fade the oldest part of the trace like a phosphor monitor.
    const fade = ctx.createLinearGradient(0, 0, w, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0.75)');
    fade.addColorStop(Math.max(0.01, this.shown * 0.6), 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
  }
}
