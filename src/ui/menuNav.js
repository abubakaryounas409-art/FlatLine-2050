// =============================================================================
// FLATLINE: 2050 — ui/menuNav.js
// A focus list: one selected item, moved with keys or the mouse, with the
// tick sound + glitch on every change. Used by the main menu, mission select,
// settings rows and dialogs, so they all feel the same.
//
//   const nav = new FocusList(elements, { onActivate: (el, i) => ... });
//   nav.handleKey(e)  → true if the key was used
// =============================================================================

import { audio } from '../core/audio.js';
import { glitchText } from '../vfx/glitchFX.js';

export class FocusList {
  /**
   * @param {HTMLElement[]} items
   * @param {object} o
   * @param {(el: HTMLElement, i: number) => void} [o.onActivate]
   * @param {(el: HTMLElement, i: number) => void} [o.onSelect]
   * @param {(el: HTMLElement, dir: -1|1) => boolean} [o.onAdjust]  left/right on an item
   * @param {'vertical'|'horizontal'} [o.axis]
   * @param {string} [o.glitchSelector] child to glitch on select (default: item itself)
   */
  constructor(items, { onActivate, onSelect, onAdjust, axis = 'vertical', glitchSelector } = {}) {
    this.items = items;
    this.onActivate = onActivate;
    this.onSelect = onSelect;
    this.onAdjust = onAdjust;
    this.axis = axis;
    this.glitchSelector = glitchSelector;
    this.index = -1;

    items.forEach((el, i) => {
      el.addEventListener('pointerenter', () => {
        if (!this.isDisabled(el)) this.select(i);
      });
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.isDisabled(el)) {
          this.denied(el);
          return;
        }
        this.select(i, { silent: true });
        this.activate();
      });
    });
  }

  isDisabled(el) {
    return el.classList.contains('is-disabled') || el.getAttribute('aria-disabled') === 'true';
  }

  /** Select an item (tick sound + glitch unless silent). */
  select(i, { silent = false } = {}) {
    if (i === this.index || !this.items[i]) return;
    this.items[this.index]?.classList.remove('is-selected');
    this.index = i;
    const el = this.items[i];
    el.classList.add('is-selected');
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
    if (!silent) {
      audio.sfx('ui_hover', { minInterval: 40, volume: 0.9 });
      glitchText(this.glitchSelector ? el.querySelector(this.glitchSelector) : el, 0.28);
    }
    this.onSelect?.(el, i);
  }

  /** Select the first enabled item without sound (when a screen opens). */
  reset(preferred = 0) {
    this.items[this.index]?.classList.remove('is-selected');
    this.index = -1;
    let i = preferred;
    while (this.items[i] && this.isDisabled(this.items[i])) i += 1;
    if (!this.items[i]) i = this.items.findIndex((el) => !this.isDisabled(el));
    if (i >= 0) this.select(i, { silent: true });
  }

  move(dir) {
    const n = this.items.length;
    for (let step = 1; step <= n; step++) {
      const i = (this.index + dir * step + n) % n;
      if (!this.isDisabled(this.items[i])) {
        this.select(i);
        return;
      }
    }
  }

  activate() {
    const el = this.items[this.index];
    if (!el) return;
    if (this.isDisabled(el)) {
      this.denied(el);
      return;
    }
    this.onActivate?.(el, this.index);
  }

  /** Feedback for a locked / disabled item. */
  denied(el) {
    audio.sfx('ui_glitch', { volume: 0.5, minInterval: 200 });
    el.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
      { duration: 220, easing: 'ease-out' },
    );
  }

  /** Route a keydown. Returns true if handled. */
  handleKey(e) {
    const prev = this.axis === 'vertical' ? ['ArrowUp', 'KeyW'] : ['ArrowLeft', 'KeyA'];
    const next = this.axis === 'vertical' ? ['ArrowDown', 'KeyS'] : ['ArrowRight', 'KeyD'];
    if (prev.includes(e.code)) {
      this.move(-1);
      return true;
    }
    if (next.includes(e.code)) {
      this.move(1);
      return true;
    }
    if (this.axis === 'vertical' && this.onAdjust && ['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(e.code)) {
      const dir = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : 1;
      return this.onAdjust(this.items[this.index], dir) !== false;
    }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
      this.activate();
      return true;
    }
    return false;
  }
}
