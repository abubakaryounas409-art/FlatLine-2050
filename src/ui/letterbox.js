// =============================================================================
// FLATLINE: 2050 — ui/letterbox.js
// Cinematic black bars that slide in from the top and bottom.
// =============================================================================

import gsap from 'gsap';
import { CONFIG } from '../config.js';

class Letterbox {
  constructor() {
    this.top = null;
    this.bottom = null;
    this.visible = false;
  }

  _ensure() {
    if (this.top) return;
    const root = document.getElementById('ui-root');
    this.top = document.createElement('div');
    this.bottom = document.createElement('div');
    this.top.className = 'letterbox letterbox-top';
    this.bottom.className = 'letterbox letterbox-bottom';
    root.append(this.top, this.bottom);
    const h = `${CONFIG.cutscene.letterboxHeight * 100}vh`;
    document.documentElement.style.setProperty('--letterbox-h', h);
    gsap.set(this.top, { yPercent: -100 });
    gsap.set(this.bottom, { yPercent: 100 });
  }

  show(seconds = CONFIG.cutscene.letterboxSeconds) {
    this._ensure();
    this.visible = true;
    document.body.classList.add('is-cinematic');
    return gsap.to([this.top, this.bottom], { yPercent: 0, duration: seconds, ease: 'power3.out' }).then();
  }

  hide(seconds = CONFIG.cutscene.letterboxSeconds) {
    this._ensure();
    this.visible = false;
    document.body.classList.remove('is-cinematic');
    gsap.to(this.top, { yPercent: -100, duration: seconds, ease: 'power3.in' });
    return gsap.to(this.bottom, { yPercent: 100, duration: seconds, ease: 'power3.in' }).then();
  }
}

export const letterbox = new Letterbox();
