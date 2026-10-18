// =============================================================================
// FLATLINE: 2050 — ui/objectiveHUD.js
// Top-left mission objective + tutorial hints (CLAUDE.md Phase 9).
//
//   objectives.set('Escape the raid')            new objective (animates in)
//   objectives.hint('Hold [T] to Shadow Step', 6) contextual hint, [X] = key cap
//   objectives.progress('Clues', 2, 5)           counter under the objective
// =============================================================================

import gsap from 'gsap';
import { audio } from '../core/audio.js';
import { scrambleText } from '../vfx/glitchFX.js';

class ObjectiveHUD {
  _ensure() {
    if (this.el?.isConnected) return;
    this.el = document.createElement('div');
    this.el.className = 'objective';
    this.el.innerHTML = '<div class="objective-k">OBJECTIVE</div><div class="objective-text"></div><div class="objective-progress"></div>';
    document.getElementById('ui-root').appendChild(this.el);
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hint';
    document.getElementById('ui-root').appendChild(this.hintEl);
    gsap.set([this.el, this.hintEl], { opacity: 0 });
  }

  set(text) {
    this._ensure();
    const t = this.el.querySelector('.objective-text');
    this.el.querySelector('.objective-progress').textContent = '';
    gsap.to(this.el, { opacity: 1, duration: 0.4 });
    gsap.fromTo(this.el, { x: -20 }, { x: 0, duration: 0.5, ease: 'power3.out' });
    scrambleText(t, text, 0.6);
    audio.sfx('ui_glitch', { volume: 0.3 });
  }

  progress(label, n, total) {
    this._ensure();
    this.el.querySelector('.objective-progress').textContent = `${label} ${n} / ${total}`;
  }

  /** A tutorial / context hint. `[KEY]` renders as a key cap. */
  hint(text, seconds = 5) {
    this._ensure();
    this.hintEl.innerHTML = text.replace(/\[([^\]]+)\]/g, '<span class="hint-key">$1</span>');
    gsap.killTweensOf(this.hintEl);
    gsap.fromTo(this.hintEl, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35 });
    gsap.to(this.hintEl, { opacity: 0, duration: 0.5, delay: seconds });
  }

  hide() {
    if (!this.el) return;
    gsap.to([this.el, this.hintEl], { opacity: 0, duration: 0.3 });
  }

  destroy() {
    this.el?.remove();
    this.hintEl?.remove();
    this.el = this.hintEl = null;
  }
}

export const objectives = new ObjectiveHUD();
