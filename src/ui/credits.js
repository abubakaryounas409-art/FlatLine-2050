// =============================================================================
// FLATLINE: 2050 — ui/credits.js
// Credits read straight from CREDITS.md at build time, so they never go out
// of date. Phase 1: a scrolling panel in the main menu.
// Phase 10 reuses parseCredits() for the end-credits roll.
// =============================================================================

import creditsMarkdown from '../../CREDITS.md?raw';
import { CONFIG } from '../config.js';
import { audio } from '../core/audio.js';
import { FocusList } from './menuNav.js';
import { buildPanel, buildBackRow } from './panel.js';

const SCROLL_SPEED = 22; // px per second

/**
 * CREDITS.md → [{ section, items: [{ title, author, license, url }] }]
 * Item lines look like: - `path` — Title — Author — URL — License
 */
export function parseCredits(md = creditsMarkdown) {
  const sections = [];
  let current = null;
  md.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('## ')) {
      current = { section: line.slice(3).trim(), items: [] };
      sections.push(current);
      return;
    }
    if (!current || !line.startsWith('- ')) return;
    const parts = line
      .slice(2)
      .split(' — ')
      .map((p) => p.trim());
    if (parts[0].startsWith('`')) parts.shift(); // drop the file path
    const url = parts.find((p) => /^https?:\/\//.test(p)) ?? '';
    const rest = parts.filter((p) => p !== url);
    const [title = '', author = '', license = ''] = rest.length >= 3 ? rest : [rest[0], '', rest[1]];
    current.items.push({ title, author, license, url });
  });
  return sections.filter((s) => s.items.length);
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class CreditsPanel {
  constructor({ onBack }) {
    this.onBack = onBack;
    const { el, body } = buildPanel('FLATLINE: 2050', 'Credits', 'panel-credits');
    this.el = el;

    this.scroller = document.createElement('div');
    this.scroller.className = 'credits-scroll';
    this.scroller.innerHTML =
      `<div class="credits-block"><div class="credits-section">A game by</div><div class="credits-title">${escape(CONFIG.game.author)}</div></div>` +
      parseCredits()
        .map(
          (s) => `
        <div class="credits-block">
          <div class="credits-section">${escape(s.section)}</div>
          ${s.items
            .map(
              (i) => `<div class="credits-item">
                <span class="credits-title">${i.url ? `<a href="${escape(i.url)}" target="_blank" rel="noopener">${escape(i.title)}</a>` : escape(i.title)}</span>
                <span class="credits-by">${escape([i.author, i.license].filter(Boolean).join(' · '))}</span>
              </div>`,
            )
            .join('')}
        </div>`,
        )
        .join('') +
      `<div class="credits-block credits-end">He has 72 heartbeats to find his way back.</div>`;
    body.appendChild(this.scroller);

    const back = buildBackRow();
    body.appendChild(back);
    this.nav = new FocusList([back], {
      glitchSelector: '.panel-row-label',
      onActivate: () => {
        audio.sfx('ui_click');
        this.onBack();
      },
    });

    // Slow auto-scroll that pauses while the player scrolls or hovers.
    this.paused = false;
    this.scroller.addEventListener('pointerenter', () => (this.paused = true));
    this.scroller.addEventListener('pointerleave', () => (this.paused = false));
  }

  open() {
    this.scroller.scrollTop = 0;
    this._pos = 0;
    this.nav.reset(0);
    this._last = performance.now();
    const tick = (now) => {
      const dt = (now - this._last) / 1000;
      this._last = now;
      if (!this.paused) {
        this._pos += SCROLL_SPEED * dt;
        const max = this.scroller.scrollHeight - this.scroller.clientHeight;
        if (this._pos > max + 60) this._pos = 0; // loop
        this.scroller.scrollTop = this._pos;
      } else {
        this._pos = this.scroller.scrollTop;
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  close() {
    cancelAnimationFrame(this._raf);
  }

  handleKey(e) {
    if (e.code === 'Escape' || e.code === 'Backspace') {
      audio.sfx('ui_click', { volume: 0.7 });
      this.onBack();
      return true;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      this._pos = Math.max(0, this.scroller.scrollTop + (e.code === 'ArrowDown' ? 60 : -60));
      this.scroller.scrollTop = this._pos;
      return true;
    }
    return this.nav.handleKey(e);
  }
}
