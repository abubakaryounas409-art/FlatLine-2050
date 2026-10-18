// =============================================================================
// FLATLINE: 2050 — showcase/director.js
// The engine behind the two Settings → Media videos (teaser.js, gameplayReel.js).
// Everything is rendered live in the game's own worlds; the director only
// sequences shots, owns a cinematic camera, presses virtual keys, and makes
// sure that — finished or skipped — nothing is left behind.
//
//   const sc = new Showcase('teaser');
//   await sc.run(async (sc) => {
//     await sc.setWorld(world);
//     await sc.shot(4, [ at(0, cam.cut(...)), at(0.2, cam.moveTo(...)), at(1, voice('m2_clockmaker_01')) ]);
//     await sc.card('', 'HE WOKE UP IN THE PAST.', '', 2);
//   });
//
// Shots reuse the cutscene step builders (cutscenes/steps.js). Skip: hold
// SPACE (ring) or press Esc. Every wait is abortable, so a skip unwinds the
// whole script into run()'s cleanup immediately.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { VOICE } from '../assets/manifest.js';
import { CutsceneCamera } from '../cutscenes/cutsceneCamera.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { letterbox } from '../ui/letterbox.js';
import { screenFade } from '../ui/screenFade.js';
import { objectives } from '../ui/objectiveHUD.js';
import { timeRewind } from '../systems/timeRewind.js';
import { ShowcaseOverlays } from './overlays.js';

export const ABORT = Symbol('showcase-abort');
const RING_R = 13;
const RING_C = 2 * Math.PI * RING_R;
const v3 = (p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p?.isVector3 ? p.clone() : typeof p === 'function' ? p() : new THREE.Vector3());

export class Showcase {
  /** @param {string} name  'teaser' | 'reel' (used for body classes and the beat attribute) */
  constructor(name) {
    this.name = name;
    this.aborted = false;
    this._abortFns = new Set();
    this.cam = new CutsceneCamera(40);
    this.cam.camera.far = 3000;
    this.cam.camera.updateProjectionMatrix();
    this.follow = null;          // (realDt) => void — positions this.cam every frame (tracking shots)
    this.tasks = new Set();      // per-frame callbacks (realDt) — autopilots etc.
    this.camActive = false;
    this.sounds = [];            // { category, key, id }
    this.timelines = new Set();
    this.disposers = [];         // world-scoped extras (crash FX, dressing) — run on world change / end
    this.keys = new Set();       // virtual keys held
    this.ui = new ShowcaseOverlays();
    this.world = null;
    this.startedAt = performance.now();
  }

  /** Seconds since run() started. */
  get elapsed() {
    return (performance.now() - this.startedAt) / 1000;
  }

  /** Mark the current beat (read by tests: <body data-showcase="teaser:crash">). */
  beat(name) {
    document.body.dataset.showcase = `${this.name}:${name}`;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  /** Run a script. Resolves { completed, skipped } after full cleanup (screen black). */
  async run(body) {
    this._install();
    let result = { completed: false, skipped: false };
    try {
      await body(this);
      result = { completed: true, skipped: false };
    } catch (err) {
      if (err === ABORT) result = { completed: false, skipped: true };
      else {
        console.error(`[showcase:${this.name}] failed:`, err);
        result = { completed: false, skipped: false, error: err };
      }
    }
    await this._cleanup();
    return result;
  }

  /** Skip: stop everything at once; the script unwinds through its awaits. */
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.beat('skipped');
    this.timelines.forEach((tl) => tl.kill());
    this.timelines.clear();
    [...this._abortFns].forEach((fn) => fn());
    this._abortFns.clear();
  }

  /** Throw ABORT if skipped (call between beats that don't await). */
  check() {
    if (this.aborted) throw ABORT;
  }

  /** Abortable wait (real seconds). */
  wait(seconds) {
    return new Promise((resolve, reject) => {
      if (this.aborted) return reject(ABORT);
      const off = () => {
        clearTimeout(id);
        reject(ABORT);
      };
      const id = setTimeout(() => {
        this._abortFns.delete(off);
        resolve();
      }, Math.max(0, seconds) * 1000);
      this._abortFns.add(off);
    });
  }

  /** Await any promise, but bail out on skip. */
  guard(promise) {
    return new Promise((resolve, reject) => {
      if (this.aborted) return reject(ABORT);
      const off = () => reject(ABORT);
      this._abortFns.add(off);
      Promise.resolve(promise).then(
        (v) => {
          this._abortFns.delete(off);
          resolve(v);
        },
        (e) => {
          this._abortFns.delete(off);
          reject(e);
        },
      );
    });
  }

  _install() {
    document.body.classList.add('showcase', `showcase-${this.name}`);
    this.beat('start');
    document.exitPointerLock?.();
    input.reset();
    this._hideBelow = CONFIG.cameraRig.hideBodyBelow;
    CONFIG.cameraRig.hideBodyBelow = -1; // the gameplay camera may sit close: never hide Kael

    // Skip ring (same look as the cutscene "Hold SPACE to skip")
    this.skipEl = document.createElement('div');
    this.skipEl.className = 'skip-prompt sc-skip';
    this.skipEl.innerHTML = `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle class="skip-ring-bg" cx="16" cy="16" r="${RING_R}"/>
        <circle class="skip-ring" cx="16" cy="16" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
      </svg>
      <span>Hold <kbd>Space</kbd> to skip · <kbd>Esc</kbd></span>`;
    document.getElementById('ui-root').appendChild(this.skipEl);
    this.ring = this.skipEl.querySelector('.skip-ring');
    gsap.set(this.skipEl, { opacity: 0 });
    gsap.to(this.skipEl, { opacity: 0.5, duration: 0.6, delay: 1.2 });
    this.skipProgress = 0;
    this.skipHeld = false;

    // Input shield: real keys / clicks never reach the game while a video plays
    // (virtual keys are written straight into input). Space = hold to skip, Esc = skip.
    this._shield = (e) => {
      if (!e.isTrusted) return;
      if (e.type === 'keydown') {
        if (e.code === 'Escape') this.abort();
        if (e.code === 'Space') {
          this.skipHeld = true;
          gsap.to(this.skipEl, { opacity: 1, duration: 0.15 });
        }
        if (['Space', 'Tab', 'AltLeft', 'AltRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      } else if (e.type === 'keyup' && e.code === 'Space') {
        this.skipHeld = false;
        gsap.to(this.skipEl, { opacity: 0.5, duration: 0.3 });
      }
      e.stopImmediatePropagation();
    };
    this._shieldTypes = ['keydown', 'keyup', 'mousedown', 'mouseup', 'click', 'wheel', 'contextmenu'];
    this._shieldTypes.forEach((t) => window.addEventListener(t, this._shield, { capture: true, passive: false }));

    this._offFrame = game.onFrame((realDt) => this._frame(realDt));
  }

  _frame(realDt) {
    // skip ring
    // skip ring on the wall clock (slow frames must not make the hold longer)
    const now = performance.now();
    const wall = Math.min(0.5, (now - (this._skipT ?? now)) / 1000);
    this._skipT = now;
    const rate = 1 / CONFIG.cutscene.skipHoldSeconds;
    this.skipProgress = Math.max(0, Math.min(1, this.skipProgress + (this.skipHeld ? rate : -rate * 2) * wall));
    this.ring?.setAttribute('stroke-dashoffset', String(RING_C * (1 - this.skipProgress)));
    if (this.skipProgress >= 1) this.abort();
    if (this.aborted) return;
    this.tasks.forEach((fn) => {
      try {
        fn(realDt);
      } catch (err) {
        console.warn(`[showcase:${this.name}] frame task failed`, err);
        this.tasks.delete(fn);
      }
    });
    this.follow?.(realDt);
    if (!this.camActive) return;
    this.cam.update(realDt);
    // The world aimed its 3D sound, fire lights, heat haze and rain at its own
    // camera this frame; re-aim them at the cinematic camera that is on screen.
    const cam = this.cam.camera;
    audio.setListener(cam);
    const w = this.world;
    if (w?.fire?.scene && w.fire.fires) {
      w.fire.updateLights(cam);
      game.postfx.setHeatSources(w.fire.hazeSources(cam));
    }
    if (w?.rain?.lines?.visible && w.rain.update) w.rain.update(0, cam);
  }

  async _cleanup() {
    this.aborted = true; // stops every pending wait / task
    [...this._abortFns].forEach((fn) => fn());
    this._abortFns.clear();
    this.timelines.forEach((tl) => tl.kill());
    this.timelines.clear();
    this._offFrame?.();
    this.tasks.clear();
    this.follow = null;
    this.cam.killMoves();
    this._shieldTypes?.forEach((t) => window.removeEventListener(t, this._shield, { capture: true }));
    this.releaseAll();
    input.reset();

    this.sounds.forEach(({ category, key, id }) => audio.stop(category, key, id, 0.3));
    this.sounds = [];
    audio.stopMusic(0.8);
    subtitles.clear(0.2);
    await screenFade.toBlack(0.35);
    screenFade.setText();
    if (letterbox.visible) letterbox.hide(0.01);
    this.ui.destroy();
    this.skipEl?.remove();
    this.runDisposers();
    objectives.destroy();
    document.querySelectorAll('.mcomplete, .boss-bar').forEach((el) => el.remove());

    if (timeRewind.rewinding) timeRewind.stop();
    timeScale.reset();
    game.setCameraOverride(null);
    this.camActive = false;
    game.postfx.setMood('NEUTRAL', 0);
    game.postfx.setChromaticAberration(0, 0.01);
    game.postfx.setSpeedBlur(0);
    game.postfx.setHeatSources([]);
    CONFIG.cameraRig.hideBodyBelow = this._hideBelow;
    document.body.classList.remove('showcase', `showcase-${this.name}`, 'sc-hud-off');
    delete document.body.dataset.showcase;
  }

  // ---------------------------------------------------------------------------
  // Worlds
  // ---------------------------------------------------------------------------
  /** Switch world (screen should be black) and compile its shaders before the first shot. */
  async setWorld(world) {
    this.check();
    this.runDisposers();
    this.tasks.clear();
    this.follow = null;
    this.cam.killMoves();
    game.setWorld(world);
    this.world = world;
    if (this.camActive) game.setCameraOverride(this.cam.camera);
    // the fire system creates its fixed light pool on first use: do it now, before compiling
    if (world.fire?.scene) world.fire.updateLights(world.camera);
    await this.guard(game.renderer.compileAsync?.(world.scene, world.camera).catch(() => {}) ?? Promise.resolve());
    game.renderOnce();
    return world;
  }

  /** Register something to dispose when the world changes or the video ends. */
  own(dispose) {
    this.disposers.push(dispose);
    return dispose;
  }

  runDisposers() {
    const list = this.disposers.splice(0);
    list.reverse().forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.warn(`[showcase:${this.name}] dispose failed`, err);
      }
    });
  }

  /** A per-frame callback for the current world (autopilots, actors). Returns an off(). */
  task(fn) {
    this.tasks.add(fn);
    return () => this.tasks.delete(fn);
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------
  /** Render through the director's cinematic camera. */
  cine({ fov } = {}) {
    if (fov) {
      this.cam.camera.fov = fov;
      this.cam.camera.updateProjectionMatrix();
    }
    if (!this.camActive || game.cameraOverride !== this.cam.camera) {
      this.camActive = true;
      game.setCameraOverride(this.cam.camera);
    }
  }

  /** Back to the world's own camera (gameplay camera / chase cam). */
  gameplay() {
    this.camActive = false;
    this.follow = null;
    this.cam.killMoves();
    game.setCameraOverride(null);
  }

  /**
   * Track a moving object: camera offset and look point are given in the
   * object's local space and may animate from → to over `duration`.
   */
  track(object, { from, to = from, look = [0, 0, 0], lookTo = look, duration = 1, ease = 'sine.inOut', fov } = {}) {
    this.cine({ fov });
    this.cam.killMoves();
    const st = { k: 0 };
    const a = v3(from);
    const b = v3(to);
    const la = v3(look);
    const lb = v3(lookTo);
    const off = new THREE.Vector3();
    const lk = new THREE.Vector3();
    const tw = gsap.to(st, { k: 1, duration, ease });
    this.timelines.add(tw);
    this.follow = () => {
      object.updateMatrixWorld?.();
      off.lerpVectors(a, b, st.k);
      lk.lerpVectors(la, lb, st.k);
      this.cam.position.copy(object.localToWorld(off.clone()));
      this.cam.lookTarget.copy(object.localToWorld(lk.clone()));
    };
    this.follow();
  }

  /** Ride along with another camera (e.g. the race chase cam) through the cinematic camera. */
  ride(camera, lookDistance = 10) {
    this.cine();
    this.cam.killMoves();
    const dir = new THREE.Vector3();
    this.follow = () => {
      this.cam.position.copy(camera.position);
      camera.getWorldDirection(dir);
      this.cam.lookTarget.copy(camera.position).addScaledVector(dir, lookDistance);
      if (Math.abs(this.cam.camera.fov - camera.fov) > 0.05) {
        this.cam.camera.fov = camera.fov;
        this.cam.camera.updateProjectionMatrix();
      }
    };
    this.follow();
  }

  // ---------------------------------------------------------------------------
  // Shots
  // ---------------------------------------------------------------------------
  /** Run timed steps (cutscenes/steps.js builders) and wait `duration` seconds. */
  shot(duration, steps = []) {
    this.check();
    const tl = gsap.timeline({ onComplete: () => this.timelines.delete(tl) });
    steps.forEach((s) => tl.call(() => !this.aborted && this._run(s), null, s.at ?? 0));
    tl.set({}, {}, Math.max(duration, ...steps.map((s) => s.at ?? 0)));
    this.timelines.add(tl);
    return this.wait(duration);
  }

  _run(step) {
    const cam = this.cam;
    const camStep = () => {
      this.follow = null;
      this.cine();
    };
    switch (step.type) {
      case 'camera.cut': camStep(); return cam.cut(v3(step.position), step.lookAt && v3(step.lookAt));
      case 'camera.moveTo': camStep(); return cam.moveTo(v3(step.position), step.lookAt && v3(step.lookAt), step.duration, step.ease);
      case 'camera.orbit': camStep(); return cam.orbit(typeof step.center === 'function' ? step.center : v3(step.center), step.radius, step.from, step.to, step.height, step.duration, step.ease);
      case 'camera.dollyZoom': camStep(); return cam.dollyZoom(v3(step.target), step.toFov, step.duration, step.ease);
      case 'camera.shake': return cam.shake(step.strength, step.duration);
      case 'camera.handheld': return cam.handheld(step.amount);
      case 'camera.fov': return cam.fov(step.value, step.duration, step.ease);
      case 'subtitle': return subtitles.show(step.speaker, step.text, step.duration);
      case 'voice': return this.voice(step.key, { subtitle: step.showSubtitle, duration: step.duration });
      case 'sfx': return this.sfx(step.key, { volume: step.volume, rate: step.rate, stopAfter: step.stopAfter });
      case 'music': return step.key ? audio.playMusic(step.key, step.fade) : audio.stopMusic(step.fade);
      case 'fade': return step.to === 'black' ? screenFade.toBlack(step.duration, step.color) : screenFade.fromBlack(step.duration);
      case 'flash': return screenFade.flash(step.color, step.duration);
      case 'glitch':
        this.sfx('ui_glitch', { volume: 0.5 });
        return game.postfx.glitch(step.duration, step.strength);
      case 'mood': return game.postfx.setMood(step.theme, step.duration);
      case 'slowMo': return timeScale.slowMo(step.scale, step.duration, step.blend);
      case 'letterbox': return step.visible ? letterbox.show() : letterbox.hide();
      case 'call': return step.fn(this);
      default:
        console.warn(`[showcase] unknown step "${step.type}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // Sound (tracked so a skip silences everything)
  // ---------------------------------------------------------------------------
  sfx(key, { volume = 1, rate = 1, stopAfter } = {}) {
    if (this.aborted) return null;
    const id = audio.sfx(key, { volume, rate });
    if (id == null) return null;
    this.sounds.push({ category: 'sfx', key, id });
    if (stopAfter) setTimeout(() => audio.stop('sfx', key, id, 0.4), stopAfter * 1000);
    return id;
  }

  /** A voice line from the manifest + its subtitle (Settings → Subtitles decides). */
  voice(key, { subtitle = true, duration } = {}) {
    const entry = VOICE[key];
    if (!entry || this.aborted) return null;
    const id = audio.play('voice', key);
    if (id != null) this.sounds.push({ category: 'voice', key, id });
    const secs = duration ?? audio.duration('voice', key) ?? 1.2 + entry.text.length * 0.055;
    if (subtitle) subtitles.show(entry.speaker, entry.text, secs + 0.3);
    return id;
  }

  stopSound(key, id, fade = 0.4) {
    audio.stop('sfx', key, id, fade);
  }

  // ---------------------------------------------------------------------------
  // Virtual input (drives the real gameplay systems: rewind, Shadow Step, guns…)
  // ---------------------------------------------------------------------------
  hold(code) {
    if (code.startsWith('Mouse')) input.mouse.buttons.add(Number(code.slice(5)));
    else input.down.set(code, performance.now());
    input.pressed.add(code);
    this.keys.add(code);
  }

  release(code) {
    if (!this.keys.has(code)) return;
    if (code.startsWith('Mouse')) input.mouse.buttons.delete(Number(code.slice(5)));
    else {
      const t = input.down.get(code);
      if (t !== undefined) input.holds.set(code, (performance.now() - t) / 1000);
      input.down.delete(code);
    }
    input.released.add(code);
    this.keys.delete(code);
  }

  /** Tap a key (held for ~2 frames so a slow frame still sees it). */
  tap(code, seconds = 0.06) {
    this.hold(code);
    setTimeout(() => this.release(code), seconds * 1000);
  }

  releaseAll() {
    [...this.keys].forEach((k) => this.release(k));
  }

  // ---------------------------------------------------------------------------
  // Text beats
  // ---------------------------------------------------------------------------
  /** A title card on black: fade to black, text, hold, clear. Worlds can load meanwhile. */
  async card(kicker, title, sub = '', seconds = 2.4, opts = {}) {
    this.beat(`card:${title}`);
    await this.guard(screenFade.toBlack(opts.fade ?? 0.45));
    this.ui.card(kicker, title, sub, opts);
    await this.wait(seconds);
    await this.ui.hideCard(0.35);
  }
}
