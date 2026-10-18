// =============================================================================
// FLATLINE: 2050 — vehicles/race.js
// Race rules: countdown (red · red · red · GREEN), laps, live positions, lap
// times, wrong-way detection, player ↔ rival bumps, finish + results.
//
// Progress is "unwrapped" distance along the track: negative on the grid,
// 0 at the start line, length × laps at the finish. Laps can't be skipped
// because progress only ever changes by the distance actually driven.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';

const tmp = new THREE.Vector3();

export class Race {
  /**
   * @param {object} o
   * @param {RaceTrack} o.track
   * @param {CarController} o.player
   * @param {RivalCar[]} o.rivals
   * @param {number} o.playerStart  unwrapped start progress (negative = behind the line)
   * @param {number} o.laps
   */
  constructor({ track, player, rivals, playerStart, laps = CONFIG.race.laps }) {
    this.track = track;
    this.player = player;
    this.rivals = rivals;
    this.laps = laps;
    this.state = 'grid';         // grid → countdown → racing → finished
    this.time = 0;               // race clock (starts at green)
    this.lapStart = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.wrongWayTime = 0;
    this.listeners = {};

    this.playerEntry = { name: 'RAYNE', isPlayer: true, color: 0xff2340, progress: playerStart, wrapped: track.wrap(playerStart), finishTime: null };
    this.entries = [this.playerEntry, ...rivals.map((r) => ({ name: r.name, rival: r, color: r.color, progress: r.s, finishTime: null }))];
  }

  on(event, fn) {
    (this.listeners[event] ??= []).push(fn);
  }

  _emit(event, data) {
    (this.listeners[event] ?? []).forEach((fn) => fn(data));
  }

  /** Red lights one by one, then green. Resolves at green. */
  async startCountdown() {
    this.state = 'countdown';
    this.player.locked = true;
    const step = CONFIG.race.countdownStep * 1000;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(600);
    for (let n = 1; n <= 3; n++) {
      this.track.setStartLights(n === 3 ? 5 : n * 2 - 1);
      audio.sfx('monitor_beep', { volume: 1 });
      this._emit('light', n);
      await wait(step);
    }
    this.track.setStartLights('green');
    audio.sfx('monitor_beep', { volume: 1, rate: 2 });
    audio.sfx('crowd_cheer', { volume: 0.55 });
    this._emit('light', 'go');
    this.state = 'racing';
    this.player.locked = false;
    this.rivals.forEach((r) => (r.racing = true));
    this.time = 0;
    this.lapStart = 0;
  }

  /** Physics step: rivals drive, bumps resolve, drafting fills the shadow meter. */
  fixedUpdate(dt) {
    if (timeScale.rewinding) return; // rewind restores everyone's state instead
    this._draft(dt);
    const others = this.entries.map((e) => ({ s: e.isPlayer ? this.playerEntry.progress : e.rival.s, lateral: e.isPlayer ? this.playerLateral ?? 0 : e.rival.lateral, speed: e.isPlayer ? this.player.speed : e.rival.speed, rival: e.rival }));
    for (const r of this.rivals) {
      const rubber = THREE.MathUtils.clamp((r.s - this.playerEntry.progress) / 150, -1, 1);
      r.fixedUpdate(dt, others.filter((o) => o.rival !== r), rubber);
      // Bumps: close and closing fast → the rival shudders
      const d = r.root.position.distanceTo(this.player.position);
      if (d < 3.4) {
        const rel = Math.abs(this.player.speed - r.speed);
        if (rel > 3 && !r._bumped) {
          r.bump(rel);
          audio.sfx('bullet_impact', { volume: Math.min(1, rel / 25), minInterval: 200 });
          this._emit('bump', rel);
        }
        r._bumped = true;
      } else r._bumped = false;
    }
  }

  /** 🌑 Slipstream: close behind a rival (same lane) fills the shadow meter. */
  _draft(dt) {
    if (this.state !== 'racing' || this.player.phased) return;
    const S = CONFIG.carThemes.shadow;
    const me = this.playerEntry.progress;
    const inWake = this.rivals.some((r) => {
      const gap = r.s - me;
      return gap > 3 && gap < S.draftRange && Math.abs(r.lateral - (this.playerLateral ?? 0)) < S.draftLateral && r.speed > 15;
    });
    this.drafting = inWake;
    if (inWake) this.player.shadow = Math.min(1, this.player.shadow + S.fill * dt);
  }

  /** ⏳ Race clock + progress for systems/timeRewind.js */
  snapshot() {
    return { progress: this.playerEntry.progress, wrapped: this.playerEntry.wrapped, time: this.time, lapStart: this.lapStart, laps: this.lapTimes.length };
  }

  restore(st) {
    this.playerEntry.progress = st.progress;
    this.playerEntry.wrapped = st.wrapped;
    this.time = st.time;
    this.lapStart = st.lapStart;
    this.lapTimes.length = Math.min(this.lapTimes.length, st.laps);
  }

  /** Frame update: progress, laps, positions, wrong-way. */
  update(dt) {
    if ((this.state === 'racing' || this.state === 'finished') && !timeScale.rewinding) this.time += dt;

    // Player progress (unwrapped)
    const c = this.track.closest(this.player.position, this.playerEntry.wrapped);
    let delta = c.s - this.playerEntry.wrapped;
    if (delta < -this.track.length / 2) delta += this.track.length;
    if (delta > this.track.length / 2) delta -= this.track.length;
    this.playerEntry.wrapped = c.s;
    this.playerLateral = c.lateral;
    const before = this.playerEntry.progress;
    this.playerEntry.progress += delta;
    this.rivals.forEach((r, i) => (this.entries[i + 1].progress = r.s));

    // Lap completed (player)
    if (this.state === 'racing' && !this.playerEntry.finishTime) {
      const lapBefore = Math.floor(before / this.track.length);
      const lapNow = Math.floor(this.playerEntry.progress / this.track.length);
      if (lapNow > lapBefore && lapNow >= 1) {
        const lapTime = this.time - this.lapStart;
        this.lapStart = this.time;
        this.lapTimes.push(lapTime);
        this.bestLap = this.bestLap === null ? lapTime : Math.min(this.bestLap, lapTime);
        if (lapNow >= this.laps) {
          this.playerEntry.finishTime = this.time;
          this.state = 'finished';
          this._emit('finish', this.results());
        } else {
          this._emit('lap', { lap: lapNow + 1, lapTime, final: lapNow + 1 === this.laps });
        }
      }
    }
    // Rivals crossing the finish
    this.entries.forEach((e) => {
      if (!e.isPlayer && !e.finishTime && e.progress >= this.laps * this.track.length && this.state !== 'grid') e.finishTime = this.time;
    });

    // Wrong way: facing against the track while moving
    const f = this.track.sampleAt(this.playerEntry.wrapped);
    const facing = this.player.forward(tmp).dot(f.tangent);
    this.wrongWayTime = this.state === 'racing' && facing < -0.3 && Math.abs(this.player.speed) > 4 ? this.wrongWayTime + dt : 0;
  }

  /** Current standings, best first. */
  standings() {
    return [...this.entries].sort((a, b) => {
      if (a.finishTime && b.finishTime) return a.finishTime - b.finishTime;
      if (a.finishTime) return -1;
      if (b.finishTime) return 1;
      return b.progress - a.progress;
    });
  }

  get playerPosition() {
    return this.standings().indexOf(this.playerEntry) + 1;
  }

  /** Lap shown on the HUD (1-based, capped). */
  get playerLap() {
    return THREE.MathUtils.clamp(Math.floor(this.playerEntry.progress / this.track.length) + 1, 1, this.laps);
  }

  /** Player's progress through the current lap, 0..1 (Phase 4 uses it). */
  get lapFraction() {
    return this.track.wrap(this.playerEntry.progress) / this.track.length;
  }

  results() {
    return {
      position: this.playerPosition,
      total: this.entries.length,
      time: this.playerEntry.finishTime ?? this.time,
      bestLap: this.bestLap,
      lapTimes: [...this.lapTimes],
      standings: this.standings().map((e) => ({ name: e.name, isPlayer: !!e.isPlayer, color: e.color })),
    };
  }

  /** Where to put the player after a crash: on the centre line, facing forward. */
  respawnSpot() {
    const f = this.track.sampleAt(this.playerEntry.wrapped);
    return { position: [f.position.x, 0, f.position.z], yaw: Math.atan2(-f.tangent.z, f.tangent.x) };
  }
}

/** 83.4 → "1:23.400" */
export function formatTime(t) {
  if (t == null) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
