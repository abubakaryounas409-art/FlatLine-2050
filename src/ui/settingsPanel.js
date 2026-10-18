// =============================================================================
// FLATLINE: 2050 — ui/settingsPanel.js
// Settings sub-screen: Media (the two in-engine videos), then graphics,
// volumes, sensitivity, subtitles, FPS. Values are saved instantly through
// systems/settings.js (localStorage); "Record to video" lasts for the session.
//
// Keys: ↑↓ choose a row · ←→ change it · Enter on Watch / Reset / Back · Esc back
// =============================================================================

import { audio } from '../core/audio.js';
import { settings } from '../systems/settings.js';
import { FocusList } from './menuNav.js';
import { buildPanel, buildBackRow } from './panel.js';
import { modal } from './modal.js';
import { canRecord } from '../showcase/recorder.js';

const pct = (v) => `${Math.round(v * 100)}%`;

const ROWS = [
  { key: 'graphics', label: 'Graphics', type: 'choice', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
  { key: 'masterVolume', label: 'Master volume', type: 'slider', min: 0, max: 1, step: 0.05, format: pct },
  { key: 'musicVolume', label: 'Music', type: 'slider', min: 0, max: 1, step: 0.05, format: pct },
  { key: 'sfxVolume', label: 'Effects', type: 'slider', min: 0, max: 1, step: 0.05, format: pct },
  { key: 'voiceVolume', label: 'Voice', type: 'slider', min: 0, max: 1, step: 0.05, format: pct },
  { key: 'sensitivity', label: 'Mouse sensitivity', type: 'slider', min: 0.2, max: 3, step: 0.1, format: (v) => `${v.toFixed(1)}×` },
  { key: 'subtitles', label: 'Subtitles', type: 'choice', options: [[true, 'On'], [false, 'Off']] },
  { key: 'subtitleSize', label: 'Subtitle size', type: 'choice', options: [['small', 'S'], ['medium', 'M'], ['large', 'L']] },
  { key: 'invertY', label: 'Invert Y', type: 'choice', options: [[false, 'Off'], [true, 'On']] },
  { key: 'difficulty', label: 'Difficulty', type: 'choice', options: [['story', 'Story'], ['normal', 'Normal'], ['hard', 'Hard']] },
  { key: 'showFps', label: 'Show FPS', type: 'choice', options: [[false, 'Off'], [true, 'On']] },
];

// Media: watchable in-engine videos (showcase/). `record` is session-only (not saved).
const MEDIA = [
  { action: 'watch-teaser', video: 'teaser', label: 'Watch Story Teaser', note: '≈ 90 s' },
  { action: 'watch-reel', video: 'reel', label: 'Watch Gameplay (2 min)', note: '≈ 2 min' },
];
const RECORD_ROW = { key: 'record', label: 'Record to video (.webm)', type: 'choice', local: true, options: [[false, 'Off'], [true, 'On']] };

export class SettingsPanel {
  /**
   * @param {object} o
   * @param {() => void} o.onBack
   * @param {(video: 'teaser'|'reel', opts: { record: boolean }) => void} [o.onWatch]  Media rows (hidden without it)
   */
  constructor({ onBack, onWatch = null }) {
    this.onBack = onBack;
    this.onWatch = onWatch;
    this.local = { record: false };
    const { el, body } = buildPanel('System', 'Settings', 'panel-settings');
    this.el = el;
    this.refreshers = [];

    const media = [];
    if (onWatch) {
      body.appendChild(this._section('Media'));
      MEDIA.forEach((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'panel-row panel-watch';
        b.dataset.action = m.action;
        b.dataset.video = m.video;
        b.innerHTML = `<span class="panel-row-label" data-text="${m.label}">▸ ${m.label}</span><span class="panel-watch-note">${m.note}</span>`;
        media.push(b);
      });
      if (canRecord()) media.push(this._buildRow(RECORD_ROW));
      media.forEach((r) => body.appendChild(r));
      body.appendChild(this._section('Options'));
    }

    const rows = ROWS.map((row) => this._buildRow(row));
    rows.forEach((r) => body.appendChild(r));

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'panel-row panel-action';
    reset.innerHTML = '<span class="panel-row-label" data-text="Reset to defaults">Reset to defaults</span>';
    reset.dataset.action = 'reset';
    const back = buildBackRow();
    body.append(reset, back);

    this.nav = new FocusList([...media, ...rows, reset, back], {
      glitchSelector: '.panel-row-label',
      onAdjust: (rowEl, dir) => {
        const def = rowEl._def;
        if (!def) return false;
        this._step(def, dir);
        return true;
      },
      onActivate: async (rowEl) => {
        const action = rowEl.dataset.action;
        if (action === 'back') {
          audio.sfx('ui_click');
          this.onBack();
        } else if (rowEl.dataset.video) {
          audio.sfx('ui_click');
          this.onWatch?.(rowEl.dataset.video, { record: !!this.local.record });
        } else if (action === 'reset') {
          audio.sfx('ui_click');
          const ok = await modal.confirm('Reset settings?', 'Every option goes back to its default value.', [
            { label: 'Cancel', value: false },
            { label: 'Reset', value: true, primary: true },
          ]);
          if (ok) {
            settings.resetToDefaults();
            this.refresh();
          }
          this.nav.items[this.nav.index]?.focus({ preventScroll: true });
        } else if (rowEl._def?.type === 'choice') {
          this._step(rowEl._def, 1, true); // Enter cycles choices
        }
      },
    });

    settings.onChange(() => this.refresh());
  }

  open() {
    this.refresh();
    this.nav.reset(0);
  }

  handleKey(e) {
    if (e.code === 'Escape' || e.code === 'Backspace') {
      audio.sfx('ui_click', { volume: 0.7 });
      this.onBack();
      return true;
    }
    return this.nav.handleKey(e);
  }

  refresh() {
    this.refreshers.forEach((fn) => fn());
  }

  // ---------------------------------------------------------------------------
  _section(label) {
    const h = document.createElement('div');
    h.className = 'panel-section';
    h.textContent = label;
    return h;
  }

  _get(def) {
    return def.local ? this.local[def.key] : settings.get(def.key);
  }

  _buildRow(def) {
    const row = document.createElement('div');
    row.className = 'panel-row setting-row';
    row.tabIndex = -1;
    row._def = def;
    row.innerHTML = `<span class="panel-row-label" data-text="${def.label}">${def.label}</span><span class="setting-control"></span>`;
    const control = row.querySelector('.setting-control');

    if (def.type === 'choice') {
      control.classList.add('setting-choice');
      const buttons = def.options.map(([value, text]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.className = 'choice';
        b.textContent = text;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this._set(def, value);
        });
        control.appendChild(b);
        return { b, value };
      });
      this.refreshers.push(() => {
        const current = this._get(def);
        buttons.forEach(({ b, value }) => b.classList.toggle('is-active', value === current));
      });
    } else {
      control.classList.add('setting-slider');
      control.innerHTML = '<span class="slider-track"><span class="slider-fill"></span><span class="slider-knob"></span></span><span class="slider-value"></span>';
      const track = control.querySelector('.slider-track');
      const fill = control.querySelector('.slider-fill');
      const knob = control.querySelector('.slider-knob');
      const valueEl = control.querySelector('.slider-value');

      const fromPointer = (e) => {
        const r = track.getBoundingClientRect();
        const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const raw = def.min + t * (def.max - def.min);
        this._set(def, Math.round(raw / def.step) * def.step, { quiet: true });
      };
      track.addEventListener('pointerdown', (e) => {
        track.setPointerCapture(e.pointerId);
        fromPointer(e);
        const move = (ev) => fromPointer(ev);
        const up = () => {
          track.removeEventListener('pointermove', move);
          audio.sfx('ui_hover', { volume: 0.8 });
        };
        track.addEventListener('pointermove', move);
        track.addEventListener('pointerup', up, { once: true });
      });

      this.refreshers.push(() => {
        const v = settings.get(def.key);
        const t = (v - def.min) / (def.max - def.min);
        fill.style.width = `${t * 100}%`;
        knob.style.left = `${t * 100}%`;
        valueEl.textContent = def.format(v);
      });
    }
    return row;
  }

  _step(def, dir, wrap = false) {
    const current = this._get(def);
    if (def.type === 'choice') {
      const values = def.options.map(([v]) => v);
      let i = values.indexOf(current) + dir;
      if (wrap) i = (i + values.length) % values.length;
      i = Math.max(0, Math.min(values.length - 1, i));
      this._set(def, values[i]);
    } else {
      const next = Math.min(def.max, Math.max(def.min, current + dir * def.step));
      this._set(def, next);
    }
  }

  _set(def, value, { quiet = false } = {}) {
    if (def.type === 'slider') value = Number(value.toFixed(2));
    if (this._get(def) === value) return;
    if (def.local) {
      this.local[def.key] = value;
      this.refresh();
    } else settings.set(def.key, value);
    if (!quiet) audio.sfx('ui_hover', { minInterval: 30, volume: 0.8 });
  }
}

