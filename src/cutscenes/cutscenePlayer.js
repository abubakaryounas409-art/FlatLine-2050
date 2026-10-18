// =============================================================================
// FLATLINE: 2050 — cutscenes/cutscenePlayer.js
// Plays cutscene scripts (CLAUDE.md Phase 2). A script is a plain object:
//
//   export default {
//     id: 'm1_intro',
//     mood: 'TIME',              // colour grade at the start (optional)
//     handheld: 0.012,           // subtle camera drift (optional)
//     actors: {                  // optional extra actors to spawn
//       victor: { model: 'characters.victor', position: [3, 0, 2], yaw: 0, anim: 'idle' },
//     },
//     steps: [ at(0, fade.in(1)), at(0, cam.cut(...)), ... ],   // see steps.js
//     missionCard: 1,            // show this mission's card at the end (optional)
//     onSkip(ctx) { ... },       // put the world in its end state when skipped (optional)
//   };
//
//   const { skipped } = await cutscenes.play(script, { world });
//
// The world keeps running underneath; the player renders through its own
// CutsceneCamera and directs Actors (world.actors are borrowed and put back
// afterwards; script actors are spawned and removed).
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { input } from '../core/input.js';
import { timeScale } from '../core/timeScale.js';
import { VOICE } from '../assets/manifest.js';
import { loadModel, createModelInstance } from '../assets/loader.js';
import { getMission } from '../missions/missionData.js';
import { letterbox } from '../ui/letterbox.js';
import { screenFade } from '../ui/screenFade.js';
import { SkipPrompt } from '../ui/skipPrompt.js';
import { missionCard } from '../ui/missionCard.js';
import { subtitles } from './subtitles.js';
import { CutsceneCamera } from './cutsceneCamera.js';
import { Actor } from './actor.js';

class CutscenePlayer {
  constructor() {
    this.camera = new CutsceneCamera();
    this.playing = false;
    this.sounds = [];   // { category, key, id } started by this cutscene
  }

  /**
   * Play a script. Resolves with { skipped } after cleanup (and the mission
   * card, if the script has one).
   */
  async play(script, { world = game.world } = {}) {
    if (this.playing) {
      console.warn(`[cutscene] "${script.id}" requested while another cutscene is playing — ignored`);
      return { skipped: false };
    }
    this.playing = true;
    this.skipped = false;
    this.sounds = [];

    // --- Actors ----------------------------------------------------------------
    const borrowed = { ...(world.actors ?? {}) };
    const snapshots = new Map(Object.values(borrowed).map((a) => [a, a.snapshot()]));
    const spawned = await this._spawnActors(script.actors ?? {}, world, borrowed);
    const actors = { ...borrowed };
    spawned.forEach((a) => (actors[a.name] = a));
    const ctx = { world, actors, camera: this.camera, player: this, game };

    // --- Camera, mood, chrome ------------------------------------------------
    this.camera.copyFrom(game.activeCamera);
    this.camera.handheld(script.handheld ?? 0.012);
    game.setCameraOverride(this.camera.camera);
    const prevMood = game.postfx.mood;
    if (script.mood) game.postfx.setMood(script.mood, 0);
    input.enabled = false; // gameplay input off; the skip prompt listens itself

    const offFrame = game.onFrame((realDt) => {
      this.camera.update(realDt);
      const dt = timeScale.scaled(realDt);
      spawned.forEach((a) => a.update(dt));
    });

    if (script.letterbox !== false) letterbox.show();
    const skip = script.skippable === false ? null : new SkipPrompt({ onSkip: () => this._skip(script, ctx) });

    // --- Timeline ---------------------------------------------------------------
    const steps = [...script.steps].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    const tl = gsap.timeline({ paused: true });
    steps.forEach((step) => tl.call(() => this._run(step, ctx), null, step.at ?? 0));
    tl.set({}, {}, script.duration ?? this._duration(steps)); // timeline length
    this.timeline = tl;

    await new Promise((resolve) => {
      this._finish = resolve;
      tl.eventCallback('onComplete', resolve);
      tl.play(0);
    });

    // --- Cleanup ------------------------------------------------------------------
    const endsBlack = this._endsBlack(steps);
    skip?.destroy();
    offFrame();
    subtitles.clear(0.25);
    this.sounds.forEach(({ category, key, id }) => audio.stop(category, key, id, 0.4));
    this.camera.handheld(0);
    // While on black the swap is invisible; otherwise ease the bars out.
    if (letterbox.visible) await letterbox.hide(endsBlack || this.skipped ? 0.01 : undefined);
    snapshots.forEach((s, a) => a.restore(s));
    spawned.forEach((a) => a.object.removeFromParent());
    if (!script.keepMood) game.postfx.setMood(prevMood, 0.01);
    if (timeScale.scale !== 1) timeScale.set(1, 0.01);
    if (!script.keepCamera) game.setCameraOverride(null);
    input.enabled = true;
    this.playing = false;

    if (script.missionCard) await missionCard.show(getMission(script.missionCard), { postfx: game.postfx });
    if (this.skipped && !endsBlack) await screenFade.fromBlack(0.6);
    return { skipped: this.skipped };
  }

  /** Hold-SPACE skip: fade out quickly, silence everything, jump to the end state. */
  async _skip(script, ctx) {
    if (!this.playing || this.skipped) return;
    this.skipped = true;
    this.timeline.pause();
    subtitles.clear(0.2);
    this.sounds.forEach(({ category, key, id }) => audio.stop(category, key, id, 0.3));
    await screenFade.toBlack(0.35);
    this.timeline.kill();
    this.camera.finishMoves();
    script.onSkip?.(ctx);
    this._finish();
  }

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------
  _run(step, ctx) {
    const cam = this.camera;
    const act = () => {
      const a = ctx.actors[step.actor];
      if (!a) console.warn(`[cutscene] unknown actor "${step.actor}"`);
      return a;
    };
    switch (step.type) {
      // Camera
      case 'camera.cut': return cam.cut(this._point(step.position, ctx), step.lookAt && this._point(step.lookAt, ctx));
      case 'camera.moveTo': return cam.moveTo(this._point(step.position, ctx), step.lookAt && this._point(step.lookAt, ctx), step.duration, step.ease);
      case 'camera.orbit': return cam.orbit(this._point(step.center, ctx), step.radius, step.from, step.to, step.height, step.duration, step.ease);
      case 'camera.dollyZoom': return cam.dollyZoom(this._point(step.target, ctx), step.toFov, step.duration, step.ease);
      case 'camera.shake': return cam.shake(step.strength, step.duration);
      case 'camera.handheld': return cam.handheld(step.amount);
      case 'camera.fov': return cam.fov(step.value, step.duration, step.ease);

      // Actors
      case 'actor.play': return act()?.play(step.anim, step.blend, step.opts);
      case 'actor.gesture': return act()?.gesture(step.anim, step.then, step.blend);
      case 'actor.moveTo': return act()?.moveTo(this._point(step.point, ctx, 0), step.speed, step.opts);
      case 'actor.lookAt': return act()?.lookAt(this._point(step.target, ctx, 0), step.rate);
      case 'actor.place': return act()?.place(step.position, step.yaw);
      case 'actor.show': { const a = act(); if (a) a.object.visible = step.visible; return; }

      // Text & sound
      case 'subtitle': return subtitles.show(step.speaker, step.text, step.duration);
      case 'voice': return this._voice(step);
      case 'sfx': {
        const id = audio.sfx(step.key, { volume: step.volume, rate: step.rate });
        if (id != null) {
          this.sounds.push({ category: 'sfx', key: step.key, id });
          if (step.stopAfter) setTimeout(() => audio.stop('sfx', step.key, id, 0.4), step.stopAfter * 1000);
        }
        return;
      }
      case 'music': return step.key ? audio.playMusic(step.key, step.fade) : audio.stopMusic(step.fade);

      // Screen
      case 'fade': return step.to === 'black' ? screenFade.toBlack(step.duration, step.color) : screenFade.fromBlack(step.duration);
      case 'flash': return screenFade.flash(step.color, step.duration);
      case 'glitch':
        audio.sfx('ui_glitch', { volume: 0.6 });
        return game.postfx.glitch(step.duration, step.strength);
      case 'mood': return game.postfx.setMood(step.theme, step.duration);
      case 'slowMo': return timeScale.slowMo(step.scale, step.duration, step.blend);
      case 'letterbox': return step.visible ? letterbox.show() : letterbox.hide();
      case 'call': return step.fn(ctx);
      default:
        console.warn(`[cutscene] unknown step type "${step.type}"`);
    }
  }

  _voice(step) {
    const entry = VOICE[step.key];
    if (!entry) return console.warn(`[cutscene] no voice line "${step.key}" in manifest`);
    const id = audio.play('voice', step.key);
    if (id != null) this.sounds.push({ category: 'voice', key: step.key, id });
    // Subtitle as long as the audio (or a reading-speed estimate if the file is missing).
    const duration = step.duration ?? audio.duration('voice', step.key) ?? 1.2 + entry.text.length * 0.055;
    if (step.showSubtitle) subtitles.show(entry.speaker, entry.text, duration);
  }

  /**
   * Resolve a position: [x,y,z] | Vector3 | 'camera' | actor name (head
   * height, or feet when headHeight = 0).
   */
  _point(p, ctx, headHeight = 1.62) {
    if (Array.isArray(p)) return new THREE.Vector3(...p);
    if (p?.isVector3) return p.clone();
    if (p === 'camera') return this.camera.camera.position.clone();
    if (typeof p === 'string' && ctx.actors[p]) return ctx.actors[p].headPosition(new THREE.Vector3(), headHeight);
    console.warn('[cutscene] cannot resolve point', p);
    return new THREE.Vector3();
  }

  /** Natural length: last step start + its own duration. */
  _duration(steps) {
    return steps.reduce((end, s) => Math.max(end, (s.at ?? 0) + (s.duration ?? 0)), 0) + 0.05;
  }

  /** True if the last fade in the script goes to black. */
  _endsBlack(steps) {
    const fades = steps.filter((s) => s.type === 'fade');
    return fades.length > 0 && fades[fades.length - 1].to === 'black';
  }

  /** Spawn script actors (models should already be preloaded). */
  async _spawnActors(defs, world, borrowed) {
    const spawned = [];
    for (const [name, def] of Object.entries(defs)) {
      if (borrowed[name] && !def.model) {
        // Re-position a borrowed actor for this scene.
        if (def.position) borrowed[name].place(def.position, def.yaw);
        if (def.anim) borrowed[name].play(def.anim, 0.01);
        continue;
      }
      const [category, key] = def.model.split('.');
      const template = await loadModel(category, key);
      const object = createModelInstance(template);
      def.style?.(object);
      world.scene.add(object);
      const a = new Actor(name, object, template.animations, def);
      a.place(def.position ?? [0, 0, 0], def.yaw ?? 0);
      if (def.anim) a.play(def.anim, 0.01);
      spawned.push(a);
    }
    return spawned;
  }
}

export const cutscenes = new CutscenePlayer();
