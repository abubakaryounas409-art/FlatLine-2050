// =============================================================================
// FLATLINE: 2050 — ui/mainMenu.js
// Main menu over the garage scene (CLAUDE.md Phase 1.2 – 1.5):
//   New Game · Continue · Mission Select · Settings · Credits · Quit
//
// Sub-screens replace the list in the left column so the car stays in view.
// Keys: ↑↓ / W S move · Enter / Space select · Esc back. Mouse works too.
// =============================================================================

import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { audio } from '../core/audio.js';
import { saveGame } from '../systems/saveGame.js';
import { glitchText, idleGlitch, scrambleText } from '../vfx/glitchFX.js';
import { FocusList } from './menuNav.js';
import { modal } from './modal.js';
import { screenFade } from './screenFade.js';
import { SettingsPanel } from './settingsPanel.js';
import { MissionSelectPanel } from './missionSelect.js';
import { CreditsPanel } from './credits.js';

const ITEMS = [
  { action: 'new', label: 'New Game' },
  { action: 'continue', label: 'Continue' },
  { action: 'missions', label: 'Mission Select' },
  { action: 'settings', label: 'Settings' },
  { action: 'credits', label: 'Credits' },
  { action: 'quit', label: 'Quit' },
];

// A tiny heartbeat trace drawn next to the selected item.
const ECG_SVG =
  '<svg viewBox="0 0 40 16" aria-hidden="true"><polyline points="0,8 12,8 15,3 18,13 21,1 24,8 40,8"/></svg>';

export class MainMenu {
  /**
   * @param {object} o
   * @param {object} o.garage                  garage world (camera framing)
   * @param {(n: number) => void} o.onStartMission
   * @param {() => void} [o.onPlayRun]   bonus mode THE RUN (runner/playRun.js), listed in Mission Select
   * @param {(video: string, opts: object) => void} [o.onWatch]  Settings → Media videos (showcase/)
   */
  constructor({ garage, onStartMission, onPlayRun = null, onWatch = null, parent = document.getElementById('ui-root') }) {
    this.garage = garage;
    this.onStartMission = onStartMission;
    this.onPlayRun = onPlayRun;
    this.onWatch = onWatch;
    this.active = false;
    this.panel = null;
    this.busy = false; // ignores input during transitions

    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="menu-col">
        <div class="menu-logo">
          <div class="title-main" data-text="FLATLINE">FLATLINE</div>
          <div class="title-year" data-text="2050">2050</div>
        </div>
        <div class="menu-tagline">He crashed in the future. He woke up in the past.</div>
        <div class="menu-stage">
          <nav class="menu-list" aria-label="Main menu"></nav>
        </div>
      </div>
      <div class="menu-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>Enter</kbd> Select</span>
        <span><kbd>Esc</kbd> Back</span>
        <span class="menu-build">${CONFIG.game.build}</span>
      </div>
      <div class="menu-toast" hidden></div>
    `;
    parent.appendChild(this.root);

    this.logo = this.root.querySelector('.menu-logo');
    this.yearEl = this.root.querySelector('.title-year');
    this.stage = this.root.querySelector('.menu-stage');
    this.listEl = this.root.querySelector('.menu-list');
    this.toastEl = this.root.querySelector('.menu-toast');

    this.itemEls = ITEMS.map(({ action, label }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.dataset.action = action;
      b.innerHTML = `<span class="menu-item-ecg">${ECG_SVG}</span><span class="menu-item-label" data-text="${label}">${label}</span>`;
      this.listEl.appendChild(b);
      return b;
    });

    this.nav = new FocusList(this.itemEls, {
      glitchSelector: '.menu-item-label',
      onActivate: (el) => this._activate(el.dataset.action),
    });

    const back = () => this._closePanel();
    this.panels = {
      settings: new SettingsPanel({ onBack: back, onWatch: onWatch ? (video, opts) => !this.busy && this.active && this.onWatch(video, opts) : null }),
      missions: new MissionSelectPanel({
        onBack: back,
        onStart: (n) => {
          saveGame.startMission(n);
          this._start(n);
        },
        onRun: onPlayRun ? () => !this.busy && this.onPlayRun() : null,
      }),
      credits: new CreditsPanel({ onBack: back }),
    };

    this._onKey = (e) => this._handleKey(e);
    window.addEventListener('keydown', this._onKey);
  }

  // ---------------------------------------------------------------------------
  // Show / hide
  // ---------------------------------------------------------------------------
  /**
   * Bring the menu in. If the boot intro's title element is passed, it flies
   * into the logo position first (one continuous move from intro to menu).
   */
  async show({ introTitle = null } = {}) {
    this.root.hidden = false;
    this.active = true;
    this.busy = true;
    this._refreshContinue();

    gsap.set(this.itemEls, { opacity: 0, x: -36 });
    gsap.set([this.root.querySelector('.menu-tagline'), this.root.querySelector('.menu-footer')], { opacity: 0 });

    this.garage.setFraming(0.17, 1.6);

    if (introTitle) {
      gsap.set(this.logo, { opacity: 0 });
      await this._flyTitleToLogo(introTitle);
      gsap.set(this.logo, { opacity: 1 });
      introTitle.style.visibility = 'hidden';
    } else {
      gsap.fromTo(this.logo, { opacity: 0 }, { opacity: 1, duration: 0.6 });
      scrambleText(this.yearEl, '2050', 0.5);
    }

    const tl = gsap.timeline();
    tl.to(this.root.querySelector('.menu-tagline'), { opacity: 1, duration: 0.8 }, 0);
    tl.to(this.itemEls, { opacity: 1, x: 0, duration: 0.55, stagger: 0.07, ease: 'power3.out' }, 0.1);
    tl.to(this.root.querySelector('.menu-footer'), { opacity: 1, duration: 0.8 }, 0.5);
    await tl.then();

    this.nav.reset(saveGame.hasProgress ? 1 : 0);
    if (this.panel) this._refocus(); // back from a Settings → Media video: stay in the panel
    this._stopIdle = idleGlitch(this.yearEl, { minDelay: 2.5, maxDelay: 6 });
    this.busy = false;

    if (audio.blockedByDownloadManager) {
      this.toast('Sound is blocked by a download manager (e.g. IDM) — add "localhost" to its exceptions.');
    }
  }

  async hide() {
    this.active = false;
    this._stopIdle?.();
    await gsap.to(this.root, { opacity: 0, duration: 0.4 }).then();
    this.root.hidden = true;
    this.root.style.opacity = 1;
  }

  /** FLIP: move the centred intro title onto the logo, scaling it down. */
  _flyTitleToLogo(titleEl) {
    const from = titleEl.getBoundingClientRect();
    const to = this.logo.getBoundingClientRect();
    const scale = to.width / from.width;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    return gsap
      .to(titleEl, { x: `+=${dx}`, y: `+=${dy}`, scale, duration: 1.3, ease: 'power3.inOut' })
      .then();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  async _activate(action) {
    if (this.busy) return;
    audio.sfx('ui_click');
    switch (action) {
      case 'new': {
        if (saveGame.hasProgress) {
          const ok = await modal.confirm('Start a new game?', 'Your story progress will be reset.', [
            { label: 'Cancel', value: false },
            { label: 'New Game', value: true, primary: true },
          ]);
          if (!ok) return this._refocus();
        }
        saveGame.newGame();
        this._start(1);
        break;
      }
      case 'continue':
        this._start(saveGame.data.currentMission);
        break;
      case 'missions':
      case 'settings':
      case 'credits':
        this._openPanel(this.panels[action]);
        break;
      case 'quit':
        this._quit();
        break;
    }
  }

  _start(missionNumber) {
    if (this.busy) return;
    this.onStartMission(missionNumber);
  }

  _refocus() {
    (this.panel?.nav ?? this.nav).items[(this.panel?.nav ?? this.nav).index]?.focus({ preventScroll: true });
  }

  _refreshContinue() {
    const cont = this.itemEls.find((el) => el.dataset.action === 'continue');
    cont.classList.toggle('is-disabled', !saveGame.hasProgress);
    cont.setAttribute('aria-disabled', String(!saveGame.hasProgress));
  }

  // ---------------------------------------------------------------------------
  // Panels
  // ---------------------------------------------------------------------------
  async _openPanel(panel) {
    this.busy = true;
    await gsap.to(this.listEl, { opacity: 0, x: -30, duration: 0.22, ease: 'power2.in' }).then();
    this.listEl.hidden = true;

    this.panel = panel;
    this.stage.appendChild(panel.el);
    panel.open();
    audio.sfx('ui_glitch', { volume: 0.6 });
    glitchText(panel.el.querySelector('.panel-title'), 0.45);
    await gsap.fromTo(panel.el, { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.35, ease: 'power3.out' }).then();
    this.busy = false;
  }

  async _closePanel() {
    if (!this.panel || this.busy) return;
    this.busy = true;
    const panel = this.panel;
    await gsap.to(panel.el, { opacity: 0, x: 30, duration: 0.2, ease: 'power2.in' }).then();
    panel.close?.();
    panel.el.remove();
    this.panel = null;

    this.listEl.hidden = false;
    this._refreshContinue();
    await gsap.fromTo(this.listEl, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power3.out' }).then();
    this._refocus();
    this.busy = false;
  }

  // ---------------------------------------------------------------------------
  // Quit — a browser tab can't always close itself, so fade out politely.
  // ---------------------------------------------------------------------------
  async _quit() {
    const ok = await modal.confirm('Leave FLATLINE: 2050?', 'Your progress is saved.', [
      { label: 'Stay', value: false },
      { label: 'Leave', value: true, primary: true },
    ]);
    if (!ok) return this._refocus();

    this.busy = true;
    audio.stopMusic(1.2);
    audio.sfx('flatline', { volume: 0.35 });
    await screenFade.toBlack(1.2);
    window.close(); // only works if the game opened this tab itself
    screenFade.setText('', 'FLATLINE', 'You can close this tab now · click or press any key to return');

    await new Promise((resolve) => {
      const back = () => {
        window.removeEventListener('keydown', back, true);
        window.removeEventListener('pointerdown', back, true);
        resolve();
      };
      setTimeout(() => {
        window.addEventListener('keydown', back, true);
        window.addEventListener('pointerdown', back, true);
      }, 600);
    });
    audio.playMusic('main_theme', 3);
    await screenFade.fromBlack(1);
    this.busy = false;
    this._refocus();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  _handleKey(e) {
    if (!this.active) return;
    if (modal.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (this.busy) return;
    const handled = this.panel ? this.panel.handleKey(e) : this.nav.handleKey(e);
    if (handled) e.preventDefault();
  }

  toast(text, seconds = 7) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    gsap.fromTo(this.toastEl, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.4 });
    gsap.to(this.toastEl, { opacity: 0, duration: 0.6, delay: seconds, onComplete: () => (this.toastEl.hidden = true) });
  }
}
