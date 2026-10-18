// =============================================================================
// FLATLINE: 2050 — cutscenes/subtitles.js
// Subtitle line at the bottom of the screen: coloured speaker name + text,
// smooth fade in/out. Follows Settings → Subtitles / Subtitle size.
//
//   subtitles.show('clockmaker', 'Your body is dying in 2050.', 3.5)
//   subtitles.clear()
// =============================================================================

import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { settings } from '../systems/settings.js';

class Subtitles {
  constructor() {
    this.el = null;
    this._hideCall = null;
    this._token = 0; // bumps on every show/clear so a late fade can't revive an old line
  }

  _ensure() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.className = 'subtitles';
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = '<div class="subtitle-speaker"></div><div class="subtitle-text"></div>';
    document.getElementById('ui-root').appendChild(this.el);
    this.speakerEl = this.el.children[0];
    this.textEl = this.el.children[1];
  }

  /**
   * @param {string} speaker  key in CONFIG.cutscene.speakers, or a display name
   * @param {string} text
   * @param {number} duration seconds on screen
   */
  show(speaker, text, duration = 3) {
    if (!settings.get('subtitles')) return;
    this._ensure();
    const speakers = CONFIG.cutscene.speakers;
    // Accept a key ('clockmaker') or a display name ('The Clockmaker').
    const info = speakers[speaker] ?? Object.values(speakers).find((s) => s.name === speaker) ?? { name: speaker, color: '#ffffff' };
    const fadeTime = CONFIG.cutscene.subtitleFade;

    this.el.dataset.size = settings.get('subtitleSize');
    gsap.killTweensOf(this.el);
    this._hideCall?.kill();
    const token = ++this._token;

    const swap = () => {
      if (token !== this._token) return; // cleared or replaced meanwhile
      this.speakerEl.textContent = info.name ?? '';
      this.speakerEl.style.color = info.color;
      this.speakerEl.hidden = !info.name;
      this.textEl.textContent = text;
      gsap.fromTo(this.el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: fadeTime, ease: 'power2.out' });
    };
    // If a line is already showing, fade it out quickly first.
    if (Number(getComputedStyle(this.el).opacity) > 0.05) {
      gsap.to(this.el, { opacity: 0, duration: fadeTime * 0.5, onComplete: swap });
    } else swap();

    this._hideCall = gsap.delayedCall(duration, () => this.clear());
  }

  clear(fadeTime = CONFIG.cutscene.subtitleFade) {
    if (!this.el) return;
    this._token++;
    this._hideCall?.kill();
    gsap.killTweensOf(this.el);
    gsap.to(this.el, { opacity: 0, duration: fadeTime, ease: 'power2.in' });
  }
}

export const subtitles = new Subtitles();
