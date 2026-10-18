// =============================================================================
// FLATLINE: 2050 — ui/hud.js
// Race HUD (CLAUDE.md Phase 3.6): speed, position, lap + times, boost bar,
// minimap, start lights, centre messages and the results screen.
// Phase 6/7 add the on-foot HUD (ammo, crosshair, heartbeat) to this file.
// =============================================================================

import gsap from 'gsap';
import { audio } from '../core/audio.js';
import { FocusList } from './menuNav.js';
import { formatTime } from '../vehicles/race.js';

const ORDINAL = (n) => (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');
const ARC = 2 * Math.PI * 70 * 0.75; // 270° arc length of the speedo ring (r = 70)
const MAX_KMH = 340;
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

export class RaceHUD {
  /**
   * @param {object} o
   * @param {RaceTrack} o.track   for the minimap outline
   * @param {number} o.laps
   */
  constructor({ track, laps }) {
    this.track = track;
    this.laps = laps;
    this.root = document.createElement('div');
    this.root.className = 'hud hud-race';
    this.root.innerHTML = `
      <div class="hud-pos"><span class="hud-pos-n">-</span><span class="hud-pos-ord"></span><span class="hud-pos-total">/ -</span></div>
      <div class="hud-lap">
        <div class="hud-lap-label">Lap <span class="hud-lap-n">1</span> / ${laps}</div>
        <div class="hud-time"><span class="hud-k">Time</span><span class="hud-time-v">0:00.000</span></div>
        <div class="hud-time"><span class="hud-k">Best</span><span class="hud-best-v">--:--.---</span></div>
      </div>
      <canvas class="hud-map" width="440" height="440"></canvas>
      <div class="hud-speedo">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <circle class="hud-ring-bg" cx="80" cy="80" r="70" stroke-dasharray="${ARC} 999" transform="rotate(135 80 80)"/>
          <circle class="hud-ring" cx="80" cy="80" r="70" stroke-dasharray="0 999" transform="rotate(135 80 80)"/>
        </svg>
        <div class="hud-speed"><span class="hud-speed-v">0</span><span class="hud-speed-u">km/h</span></div>
      </div>
      <div class="hud-themes">
        <div class="hud-meter m-fire"><span class="hud-meter-icon">🔥</span><span class="hud-meter-name">Burn</span><kbd>Shift</kbd><div class="hud-meter-bar"><i></i></div></div>
        <div class="hud-meter m-shadow"><span class="hud-meter-icon">🌑</span><span class="hud-meter-name">Shadow</span><kbd>T</kbd><div class="hud-meter-bar"><i></i></div></div>
        <div class="hud-meter m-time"><span class="hud-meter-icon">⏳</span><span class="hud-meter-name">Rewind</span><kbd>R</kbd><div class="hud-meter-bar"><i></i></div></div>
      </div>
      <div class="hud-lights" hidden><i></i><i></i><i></i></div>
      <div class="hud-msg" hidden></div>
      <div class="hud-keys">W/S drive · A/D steer · Space drift (fills Burn) · Shift Burn · draft behind a car, then T · hold R rewind · C look back · Backspace reset · Esc leave</div>
    `;
    document.getElementById('ui-root').appendChild(this.root);
    const q = (s) => this.root.querySelector(s);
    this.el = {
      posN: q('.hud-pos-n'), posOrd: q('.hud-pos-ord'), posTotal: q('.hud-pos-total'),
      lapN: q('.hud-lap-n'), time: q('.hud-time-v'), best: q('.hud-best-v'),
      ring: q('.hud-ring'), speed: q('.hud-speed-v'),
      mFire: q('.m-fire'), mShadow: q('.m-shadow'), mTime: q('.m-time'),
      lights: q('.hud-lights'), msg: q('.hud-msg'), map: q('.hud-map'), keys: q('.hud-keys'),
    };
    this._prepareMap();
    gsap.fromTo(this.root, { opacity: 0 }, { opacity: 1, duration: 0.6 });
    gsap.to(this.el.keys, { opacity: 0, duration: 1.2, delay: 9 });
  }

  // ---------------------------------------------------------------------------
  // Minimap: static track drawn once, dots each frame
  // ---------------------------------------------------------------------------
  _prepareMap() {
    const pts = this.track.outline;
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const size = 440, pad = 40;
    const k = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * k) / 2;
    const oz = (size - (maxZ - minZ) * k) / 2;
    this.mapXY = (x, z) => [ox + (x - minX) * k, oz + (z - minZ) * k];

    this.mapBase = document.createElement('canvas');
    this.mapBase.width = this.mapBase.height = size;
    const ctx = this.mapBase.getContext('2d');
    ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(...this.mapXY(...p)) : ctx.moveTo(...this.mapXY(...p))));
      ctx.closePath();
    };
    path();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 22;
    ctx.stroke();
    path();
    ctx.strokeStyle = 'rgba(63,169,255,0.85)';
    ctx.lineWidth = 4;
    ctx.stroke();
    // start line
    const start = this.track.startLinePosition ?? { x: 0, z: 0 };
    const [sx, sz] = this.mapXY(start.x, start.z);
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 2, sz - 14, 4, 28);
  }

  _drawMap(cars) {
    const ctx = this.el.map.getContext('2d');
    ctx.clearRect(0, 0, 440, 440);
    ctx.drawImage(this.mapBase, 0, 0);
    // rivals first, player on top
    [...cars].sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0)).forEach((c) => {
      const [x, y] = this.mapXY(c.x, c.z);
      ctx.beginPath();
      ctx.arc(x, y, c.isPlayer ? 11 : 8, 0, Math.PI * 2);
      ctx.fillStyle = c.isPlayer ? '#ffffff' : hex(c.color);
      ctx.fill();
      if (c.isPlayer) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ff2340';
        ctx.stroke();
      }
    });
  }

  // ---------------------------------------------------------------------------
  update(s) {
    const e = this.el;
    e.posN.textContent = s.position;
    e.posOrd.textContent = ORDINAL(s.position);
    e.posTotal.textContent = `/ ${s.total}`;
    e.lapN.textContent = s.lap;
    e.time.textContent = formatTime(s.lapTime);
    e.best.textContent = formatTime(s.bestLap);
    const kmh = Math.round(s.speedKmh);
    e.speed.textContent = kmh;
    e.ring.setAttribute('stroke-dasharray', `${(Math.min(kmh, MAX_KMH) / MAX_KMH) * ARC} 999`);
    e.ring.classList.toggle('is-boost', s.boosting);
    const meter = (el, v, ready, active) => {
      el.querySelector('i').style.transform = `scaleX(${Math.max(0, Math.min(1, v)).toFixed(3)})`;
      el.classList.toggle('is-ready', ready);
      el.classList.toggle('is-active', active);
    };
    meter(e.mFire, s.boost, s.boost > 0.98, s.boosting);
    meter(e.mShadow, s.shadow ?? 0, (s.shadow ?? 0) >= 1, !!s.phased || !!s.drafting);
    meter(e.mTime, s.time ?? 0, (s.time ?? 0) > 0.98, !!s.rewinding);
    if (s.shadow >= 1 && !this._shadowReady) this.message('Shadow ready · T', 1.2, 'shadow');
    this._shadowReady = s.shadow >= 1;
    this._drawMap(s.cars);
    if (s.wrongWay && !this._wrongWay) this.message('Wrong way', 0, 'warn');
    if (!s.wrongWay && this._wrongWay) this.hideMessage();
    this._wrongWay = s.wrongWay;
  }

  setVisible(v) {
    gsap.to(this.root, { opacity: v ? 1 : 0, duration: v ? 0.5 : 0.2 });
  }

  /** n = 1..3 red lights, 'go' = green. */
  lights(n) {
    const box = this.el.lights;
    box.hidden = false;
    const dots = [...box.children];
    if (n === 'go') {
      dots.forEach((d) => (d.className = 'is-green'));
      gsap.to(box, { opacity: 0, delay: 1.2, duration: 0.5, onComplete: () => (box.hidden = true) });
      this.message('GO', 1.1, 'go');
    } else {
      gsap.set(box, { opacity: 1 });
      dots.forEach((d, i) => (d.className = i < n ? 'is-red' : ''));
    }
  }

  /** Centre message (seconds = 0 keeps it until hideMessage). */
  message(text, seconds = 2, kind = '') {
    const m = this.el.msg;
    m.textContent = text;
    m.className = `hud-msg ${kind}`;
    m.hidden = false;
    gsap.killTweensOf(m);
    gsap.fromTo(m, { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out' });
    if (seconds > 0) gsap.to(m, { opacity: 0, delay: seconds, duration: 0.4, onComplete: () => (m.hidden = true) });
  }

  hideMessage() {
    const m = this.el.msg;
    gsap.to(m, { opacity: 0, duration: 0.3, onComplete: () => (m.hidden = true) });
  }

  /** Results screen. Resolves with 'retry' or 'menu'. */
  showResults(r) {
    const box = document.createElement('div');
    box.className = 'race-results';
    box.innerHTML = `
      <div class="rr-kicker">Race complete</div>
      <div class="rr-pos">${r.position}<span>${ORDINAL(r.position)}</span></div>
      <div class="rr-times">
        <div><span>Total</span>${formatTime(r.time)}</div>
        <div><span>Best lap</span>${formatTime(r.bestLap)}</div>
      </div>
      <ol class="rr-list">${r.standings.map((e) => `<li class="${e.isPlayer ? 'is-player' : ''}"><i style="background:${hex(e.color)}"></i>${e.name}</li>`).join('')}</ol>
      <div class="rr-buttons"><button type="button" class="modal-button is-primary">Race again</button><button type="button" class="modal-button">Main menu</button></div>`;
    document.getElementById('ui-root').appendChild(box);
    gsap.fromTo(box, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
    audio.sfx('ui_glitch', { volume: 0.6 });
    return new Promise((resolve) => {
      const choices = ['retry', 'menu'];
      const nav = new FocusList([...box.querySelectorAll('button')], {
        axis: 'horizontal',
        onActivate: (_, i) => {
          audio.sfx('ui_click');
          window.removeEventListener('keydown', onKey);
          gsap.to(box, { opacity: 0, duration: 0.3, onComplete: () => box.remove() });
          resolve(choices[i]);
        },
      });
      nav.reset(0);
      const onKey = (e) => nav.handleKey(e) && e.preventDefault();
      window.addEventListener('keydown', onKey);
    });
  }

  destroy() {
    const root = this.root;
    gsap.to(root, { opacity: 0, duration: 0.4, onComplete: () => root.remove() });
  }
}
