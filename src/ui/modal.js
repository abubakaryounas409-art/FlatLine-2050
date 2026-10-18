// =============================================================================
// FLATLINE: 2050 — ui/modal.js
// In-game confirm dialog (never the browser's confirm(), which freezes the
// game loop and looks out of place).
//
//   const ok = await modal.confirm('New game?', 'Progress will be reset.',
//                                  [{ label: 'Cancel', value: false }, { label: 'Start', value: true, primary: true }]);
// =============================================================================

import gsap from 'gsap';
import { audio } from '../core/audio.js';
import { FocusList } from './menuNav.js';

class Modal {
  constructor() {
    this.open = false;
    this.nav = null;
    this._resolve = null;
  }

  confirm(title, message, buttons = [{ label: 'No', value: false }, { label: 'Yes', value: true, primary: true }]) {
    if (this.open) this._close(undefined);
    this.open = true;

    const el = document.createElement('div');
    el.className = 'modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="modal-box">
        <h2 class="modal-title" data-text="${title}">${title}</h2>
        <p class="modal-text">${message}</p>
        <div class="modal-buttons"></div>
      </div>`;
    const row = el.querySelector('.modal-buttons');
    const btnEls = buttons.map((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `modal-button${b.primary ? ' is-primary' : ''}`;
      btn.textContent = b.label;
      btn.dataset.text = b.label;
      row.appendChild(btn);
      return btn;
    });
    document.getElementById('ui-root').appendChild(el);
    this.el = el;

    this.nav = new FocusList(btnEls, {
      axis: 'horizontal',
      onActivate: (_, i) => {
        audio.sfx('ui_click');
        this._close(buttons[i].value);
      },
    });
    // Default to the safe (non-primary) choice.
    this.nav.reset(Math.max(0, buttons.findIndex((b) => !b.primary)));

    audio.sfx('ui_glitch', { volume: 0.6 });
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2 });
    gsap.fromTo(el.querySelector('.modal-box'), { y: 16, scale: 0.98 }, { y: 0, scale: 1, duration: 0.35, ease: 'power3.out' });

    return new Promise((resolve) => (this._resolve = resolve));
  }

  /** Route a keydown while open. Escape = cancel (resolves false). */
  handleKey(e) {
    if (!this.open) return false;
    if (e.code === 'Escape') {
      audio.sfx('ui_click', { volume: 0.7 });
      this._close(false);
      return true;
    }
    this.nav.handleKey(e);
    return true; // swallow everything else while a dialog is open
  }

  _close(value) {
    const el = this.el;
    this.open = false;
    gsap.to(el, { opacity: 0, duration: 0.18, onComplete: () => el.remove() });
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(value);
  }
}

export const modal = new Modal();
