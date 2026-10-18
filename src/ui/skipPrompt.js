// =============================================================================
// FLATLINE: 2050 — ui/skipPrompt.js
// "Hold SPACE to skip" with a circular progress ring (CLAUDE.md Phase 2.3).
// Holding fills the ring; letting go drains it. Full ring → onSkip().
// =============================================================================

import gsap from 'gsap';
import { CONFIG } from '../config.js';

const RADIUS = 13;
const CIRC = 2 * Math.PI * RADIUS;

export class SkipPrompt {
  constructor({ onSkip, holdSeconds = CONFIG.cutscene.skipHoldSeconds }) {
    this.onSkip = onSkip;
    this.holdSeconds = holdSeconds;
    this.progress = 0;
    this.holding = false;
    this.done = false;

    this.el = document.createElement('div');
    this.el.className = 'skip-prompt';
    this.el.innerHTML = `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle class="skip-ring-bg" cx="16" cy="16" r="${RADIUS}"/>
        <circle class="skip-ring" cx="16" cy="16" r="${RADIUS}" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>
      </svg>
      <span>Hold <kbd>Space</kbd> to skip</span>`;
    this.ring = this.el.querySelector('.skip-ring');
    document.getElementById('ui-root').appendChild(this.el);
    gsap.set(this.el, { opacity: 0 });
    // Appear softly after a moment (so the opening shot stays clean).
    this._appear = gsap.to(this.el, { opacity: 0.55, duration: 0.6, delay: CONFIG.cutscene.skipPromptDelay });

    this._down = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      e.preventDefault();
      this.holding = true;
      gsap.to(this.el, { opacity: 1, duration: 0.15 });
    };
    this._up = (e) => {
      if (e.code !== 'Space') return;
      this.holding = false;
      gsap.to(this.el, { opacity: 0.55, duration: 0.3 });
    };
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    this._raf = 0;
    this._last = performance.now();
    this._tick = (now) => {
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      this.update(dt);
      this._raf = requestAnimationFrame(this._tick);
    };
    this._raf = requestAnimationFrame(this._tick);
  }

  update(dt) {
    if (this.done) return;
    const rate = 1 / this.holdSeconds;
    this.progress = Math.max(0, Math.min(1, this.progress + (this.holding ? rate : -rate * 2) * dt));
    this.ring.setAttribute('stroke-dashoffset', String(CIRC * (1 - this.progress)));
    if (this.progress >= 1) {
      this.done = true;
      this.onSkip();
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._appear.kill();
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    const el = this.el;
    gsap.to(el, { opacity: 0, duration: 0.25, onComplete: () => el.remove() });
  }
}
