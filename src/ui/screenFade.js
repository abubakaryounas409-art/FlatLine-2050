// =============================================================================
// FLATLINE: 2050 — ui/screenFade.js
// Full-screen fade to / from black (menus now, cutscenes in Phase 2).
//
//   await screenFade.toBlack(0.8);
//   screenFade.setText('MISSION 01', 'LAST LAP');
//   await screenFade.fromBlack(0.8);
// =============================================================================

import gsap from 'gsap';

class ScreenFade {
  constructor() {
    this.el = null;
  }

  _ensure() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.className = 'screen-fade';
    this.el.innerHTML = '<div class="screen-fade-kicker"></div><div class="screen-fade-title"></div><div class="screen-fade-sub"></div>';
    document.getElementById('ui-root').appendChild(this.el);
  }

  toBlack(seconds = 0.6, color = '#000') {
    this._ensure();
    this.el.style.background = color;
    this.el.style.pointerEvents = 'auto';
    return gsap.to(this.el, { opacity: 1, duration: seconds, ease: 'power2.inOut' }).then();
  }

  fromBlack(seconds = 0.6) {
    this._ensure();
    return gsap
      .to(this.el, { opacity: 0, duration: seconds, ease: 'power2.inOut' })
      .then(() => {
        this.el.style.pointerEvents = 'none';
        this.setText();
      });
  }

  /** Quick full-screen flash (white by default) that fades away. */
  flash(color = '#ffffff', seconds = 0.5) {
    const el = document.createElement('div');
    el.className = 'screen-flash';
    el.style.background = color;
    document.getElementById('ui-root').appendChild(el);
    return gsap
      .fromTo(el, { opacity: 1 }, { opacity: 0, duration: seconds, ease: 'power2.out' })
      .then(() => el.remove());
  }

  /** Centered text on the black screen (kicker / big title / small line). */
  setText(kicker = '', title = '', sub = '') {
    this._ensure();
    const [k, t, s] = this.el.children;
    k.textContent = kicker;
    t.textContent = title;
    t.dataset.text = title;
    s.textContent = sub;
    if (title) gsap.fromTo(this.el.children, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.12 });
  }
}

export const screenFade = new ScreenFade();
