// =============================================================================
// FLATLINE: 2050 — showcase/overlays.js
// The DOM layer of the two Settings → Media videos (teaser + gameplay reel):
//
//   card(kicker, title, sub)     big centred title-card text (over black or the image)
//   stamp(line1, line2)          typewriter location stamp, lower left ("2020 · THE CITY")
//   nameTag(name, role)          lower-third character name
//   chapter({ icon, title, sub, keys, theme, index, total })   gameplay-reel lower third
//   highlight(selector, label)   a pulsing ring around a HUD element (heart meter)
//   finalTitle(lines)            FLATLINE / 2050 + tagline lines
//   live(text) / progress(k)     "LIVE IN-ENGINE" bug + thin progress line (reel)
//   whiteout(k)                  the fire-walk white burn (0..1)
//
// Every element lives in one root that is removed by destroy().
// =============================================================================

import gsap from 'gsap';
import { glitchText, scrambleText } from '../vfx/glitchFX.js';

const THEME_COLORS = { FIRE: 'var(--fire)', SHADOWS: 'var(--shadows-glow)', TIME: 'var(--time)', HEART: '#ff3a4a', NEUTRAL: '#ffffff' };

/** Keyboard key caps: 'W A S D', 'hold R', 'LMB'… → HTML. */
export function keyCaps(keys = []) {
  return keys
    .map((k) => {
      const m = /^(hold|tap)\s+(.+)$/i.exec(k);
      const cap = (txt) => `<kbd class="sc-key${txt.length > 3 ? ' is-wide' : ''}">${txt}</kbd>`;
      if (m) return `<span class="sc-keygroup"><em>${m[1]}</em>${cap(m[2])}</span>`;
      return `<span class="sc-keygroup">${k.split(' ').map(cap).join('')}</span>`;
    })
    .join('<span class="sc-keysep"></span>');
}

export class ShowcaseOverlays {
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'sc-root';
    document.getElementById('ui-root').appendChild(this.root);
    this._chapter = null;
    this._card = null;
    this._stamp = null;
    this._white = null;
  }

  _el(className, html = '') {
    const el = document.createElement('div');
    el.className = className;
    el.innerHTML = html;
    this.root.appendChild(el);
    return el;
  }

  // ---------------------------------------------------------------------------
  // Title cards
  // ---------------------------------------------------------------------------
  /** Big centred text. theme colours the kicker line. Returns a hide(seconds) promise fn. */
  card(kicker = '', title = '', sub = '', { theme = 'TIME', size = 'l', scramble = true } = {}) {
    this.hideCard(0.15);
    const el = this._el(`sc-card size-${size}`, `
      <div class="sc-card-kicker" style="color:${THEME_COLORS[theme] ?? THEME_COLORS.TIME}">${kicker}</div>
      <div class="sc-card-title" data-text="${title}">${title}</div>
      <div class="sc-card-sub">${sub}</div>`);
    const [k, t, s] = el.children;
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.35 });
    gsap.fromTo(t, { letterSpacing: '0.5em', opacity: 0 }, { letterSpacing: '0.24em', opacity: 1, duration: 1.6, ease: 'power3.out' });
    gsap.fromTo([k, s], { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.25, delay: 0.2 });
    if (scramble && title) scrambleText(t, title, 0.55);
    setTimeout(() => glitchText(t, 0.35), 380);
    this._card = el;
    return el;
  }

  hideCard(seconds = 0.4) {
    const el = this._card;
    this._card = null;
    if (!el) return Promise.resolve();
    return gsap.to(el, { opacity: 0, duration: seconds, onComplete: () => el.remove() }).then();
  }

  // ---------------------------------------------------------------------------
  // Location stamp: typed in, lower left
  // ---------------------------------------------------------------------------
  stamp(line1, line2 = '', seconds = 3.2) {
    this._stamp?.remove();
    const el = this._el('sc-stamp', '<div class="sc-stamp-a"></div><div class="sc-stamp-b"></div>');
    this._stamp = el;
    const [a, b] = el.children;
    const type = (node, text, delay) => {
      let i = 0;
      const tick = () => {
        if (!node.isConnected) return;
        node.textContent = text.slice(0, ++i) + (i < text.length ? '▌' : '');
        if (i < text.length) node._t = setTimeout(tick, 34);
      };
      node._t = setTimeout(tick, delay * 1000);
    };
    type(a, line1, 0.1);
    type(b, line2, 0.1 + line1.length * 0.034 + 0.15);
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    gsap.to(el, { opacity: 0, duration: 0.6, delay: seconds, onComplete: () => el.remove() });
    return el;
  }

  // ---------------------------------------------------------------------------
  // Name tag (lower third)
  // ---------------------------------------------------------------------------
  nameTag(name, role, seconds = 3.2, color = 'var(--fire)') {
    const el = this._el('sc-name', `<div class="sc-name-n">${name}</div><div class="sc-name-r">${role}</div>`);
    el.style.borderLeftColor = color;
    gsap.fromTo(el, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' });
    gsap.to(el, { opacity: 0, duration: 0.6, delay: seconds, onComplete: () => el.remove() });
    return el;
  }

  // ---------------------------------------------------------------------------
  // Gameplay-reel chapter caption with key caps
  // ---------------------------------------------------------------------------
  chapter({ icon = '', title, sub = '', keys = [], theme = 'NEUTRAL', index = 0, total = 0 }) {
    const old = this._chapter;
    if (old) gsap.to(old, { opacity: 0, x: -20, duration: 0.25, onComplete: () => old.remove() });
    const color = THEME_COLORS[theme] ?? '#fff';
    const el = this._el('sc-chapter', `
      <div class="sc-chapter-index">${total ? `${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : ''}</div>
      <div class="sc-chapter-title">${icon ? `<span class="sc-chapter-icon">${icon}</span>` : ''}<span class="sc-chapter-text" data-text="${title}">${title}</span></div>
      ${sub ? `<div class="sc-chapter-sub">${sub}</div>` : ''}
      ${keys.length ? `<div class="sc-chapter-keys">${keyCaps(keys)}</div>` : ''}`);
    el.style.setProperty('--sc-color', color);
    gsap.fromTo(el, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out', delay: old ? 0.15 : 0 });
    gsap.fromTo(el.querySelectorAll('.sc-keygroup'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.08, delay: 0.45 });
    setTimeout(() => glitchText(el.querySelector('.sc-chapter-text'), 0.3), 200);
    this._chapter = el;
    return el;
  }

  /** Flash one key cap as "pressed" (matching text). */
  pressKey(text) {
    const caps = [...(this._chapter?.querySelectorAll('.sc-key') ?? [])].filter((k) => k.textContent === text);
    caps.forEach((k) => {
      k.classList.remove('is-down');
      void k.offsetWidth;
      k.classList.add('is-down');
      setTimeout(() => k.classList.remove('is-down'), 260);
    });
  }

  /** Show a key cap as held down until released. */
  holdKey(text, down = true) {
    [...(this._chapter?.querySelectorAll('.sc-key') ?? [])].filter((k) => k.textContent === text).forEach((k) => k.classList.toggle('is-held', down));
  }

  hideChapter() {
    const el = this._chapter;
    this._chapter = null;
    if (el) gsap.to(el, { opacity: 0, duration: 0.3, onComplete: () => el.remove() });
  }

  // ---------------------------------------------------------------------------
  // HUD highlight ring (positioned over an existing element)
  // ---------------------------------------------------------------------------
  highlight(selector, label = '', seconds = 4) {
    const target = document.querySelector(selector);
    if (!target) return null;
    const r = target.getBoundingClientRect();
    if (!r.width) return null;
    const el = this._el('sc-highlight', label ? `<span>${label}</span>` : '');
    Object.assign(el.style, { left: `${r.left - 10}px`, top: `${r.top - 10}px`, width: `${r.width + 20}px`, height: `${r.height + 20}px` });
    gsap.fromTo(el, { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' });
    gsap.to(el, { opacity: 0, duration: 0.5, delay: seconds, onComplete: () => el.remove() });
    return el;
  }

  // ---------------------------------------------------------------------------
  // The final title: FLATLINE / 2050 + tagline lines (one by one)
  // ---------------------------------------------------------------------------
  finalTitle(lines = [], { lineGap = 1.25 } = {}) {
    const el = this._el('sc-final', `
      <div class="sc-final-logo">
        <div class="title-main" data-text="FLATLINE">FLATLINE</div>
        <div class="title-year" data-text="2050">2050</div>
      </div>
      <svg class="sc-final-ecg" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,20 240,20 256,20 266,4 278,36 288,12 296,20 600,20"/></svg>
      <div class="sc-final-lines">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`);
    const logo = el.querySelector('.sc-final-logo');
    const main = el.querySelector('.title-main');
    const year = el.querySelector('.title-year');
    const ecg = el.querySelector('.sc-final-ecg polyline');
    const len = 700;
    ecg.style.strokeDasharray = `${len}`;
    gsap.fromTo(ecg, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut' });
    gsap.fromTo(logo, { opacity: 0, scale: 1.06, filter: 'blur(8px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 1.4, ease: 'power3.out', delay: 0.2 });
    setTimeout(() => glitchText(main, 0.45), 500);
    setTimeout(() => scrambleText(year, '2050', 0.6).then(() => glitchText(year, 0.3)), 900);
    gsap.fromTo(el.querySelectorAll('.sc-final-lines > div'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.8, stagger: lineGap, delay: 1.4, ease: 'power2.out' });
    return el;
  }

  // ---------------------------------------------------------------------------
  // Reel chrome: LIVE bug + progress line
  // ---------------------------------------------------------------------------
  live(text = 'LIVE IN-ENGINE') {
    if (this._live) return this._live;
    this._live = this._el('sc-live', `<i></i>${text}`);
    gsap.fromTo(this._live, { opacity: 0 }, { opacity: 1, duration: 0.6 });
    this._bar = this._el('sc-progress', '<i></i>');
    return this._live;
  }

  progress(k) {
    if (this._bar) this._bar.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, k)).toFixed(4)})`;
  }

  // ---------------------------------------------------------------------------
  // The fire walk: the screen burns white
  // ---------------------------------------------------------------------------
  whiteout(k, seconds = 0) {
    if (!this._white) this._white = this._el('whiteout sc-white');
    if (seconds > 0) return gsap.to(this._white, { opacity: k, duration: seconds, ease: 'sine.in' }).then();
    gsap.killTweensOf(this._white);
    this._white.style.opacity = String(k);
    return Promise.resolve();
  }

  destroy() {
    gsap.killTweensOf(this.root.querySelectorAll('*'));
    this.root.remove();
  }
}
