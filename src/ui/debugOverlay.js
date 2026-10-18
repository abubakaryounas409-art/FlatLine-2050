// =============================================================================
// FLATLINE: 2050 — ui/debugOverlay.js
// FPS / frame-time counter (top-right) and an optional help panel.
// Toggle with CONFIG.debug.showFps or the F3 key.
// =============================================================================

import { CONFIG } from '../config.js';

export class DebugOverlay {
  constructor(parent = document.getElementById('ui-root')) {
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'debug-fps';
    parent.appendChild(this.fpsEl);

    this.helpEl = document.createElement('div');
    this.helpEl.className = 'debug-help';
    this.helpEl.hidden = true;
    parent.appendChild(this.helpEl);

    this.frames = 0;
    this.accum = 0;
    this.worst = 0;
    this.extra = '';
    this.setVisible(CONFIG.debug.showFps);
  }

  setVisible(v) {
    this.visible = v;
    this.fpsEl.hidden = !v;
  }

  /** Extra line(s) under the FPS, e.g. graphics preset and mood. */
  setInfo(text) {
    this.extra = text;
  }

  setHelp(html) {
    this.helpEl.innerHTML = html;
    this.helpEl.hidden = !html;
  }

  /** Call every frame with the REAL (unscaled) delta in seconds. */
  update(dt) {
    this.frames += 1;
    this.accum += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.accum < 0.5) return; // refresh twice a second

    const fps = this.frames / this.accum;
    const ms = (this.accum / this.frames) * 1000;
    this.fpsEl.style.color = fps >= 55 ? '#7cff9a' : fps >= 30 ? '#ffd166' : '#ff5a5a';
    this.fpsEl.innerHTML =
      `${fps.toFixed(0)} FPS · ${ms.toFixed(1)} ms<br>` +
      `worst ${(this.worst * 1000).toFixed(1)} ms` +
      (this.extra ? `<br>${this.extra}` : '');
    this.frames = 0;
    this.accum = 0;
    this.worst = 0;
  }
}
