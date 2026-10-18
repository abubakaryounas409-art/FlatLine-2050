// =============================================================================
// FLATLINE: 2050 — systems/settings.js
// Player settings, saved to localStorage (every access wrapped in try/catch:
// storage can be blocked in private windows or by browser policy).
//
//   settings.get('musicVolume')
//   settings.set('graphics', 'medium')        // saves + notifies listeners
//   settings.onChange((key, value) => ...)
// =============================================================================

import { CONFIG } from '../config.js';

const STORAGE_KEY = 'flatline2050.settings.v1';

export const DEFAULT_SETTINGS = {
  graphics: CONFIG.graphics.default, // 'low' | 'medium' | 'high'
  masterVolume: CONFIG.audio.master,
  musicVolume: CONFIG.audio.music,
  sfxVolume: CONFIG.audio.sfx,
  voiceVolume: CONFIG.audio.voice,
  sensitivity: 1.0,                  // mouse look multiplier (0.2 – 3)
  subtitles: true,
  subtitleSize: 'medium',            // 'small' | 'medium' | 'large'
  invertY: false,
  difficulty: 'normal',              // 'story' | 'normal' | 'hard' — scales heartbeat costs
  showFps: CONFIG.debug.showFps,
};

class Settings {
  constructor() {
    this.values = { ...DEFAULT_SETTINGS, ...this._read() };
    // Drop unknown / invalid stored values.
    if (!CONFIG.graphics.presets[this.values.graphics]) this.values.graphics = DEFAULT_SETTINGS.graphics;
    this.listeners = new Set();
  }

  _read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  _write() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch { /* storage blocked — settings just won't persist */ }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this._write();
    this.listeners.forEach((fn) => fn(key, value));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  resetToDefaults() {
    Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => this.set(k, v));
  }
}

export const settings = new Settings();
