// =============================================================================
// FLATLINE: 2050 — core/game.js
// Owns the renderer, post-processing and the main loop, and runs one "world"
// at a time (menu garage, test scene, missions later).
//
// A world is a plain object:
//   { scene, camera,
//     update(dt, elapsed, realDt)  dt is time-scaled
//     resize?(w, h), applyGraphics?(preset), dispose?() }
//
// The main loop:
//   real dt (clamped) → timeScale → fixed 60 Hz physics → world.update → postfx
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRenderer, applyGraphicsToRenderer } from './renderer.js';
import { PostFX } from './postfx.js';
import { physics } from './physics.js';
import { input } from './input.js';
import { timeScale } from './timeScale.js';

class Game {
  constructor() {
    this.renderer = null;
    this.postfx = null;
    this.world = null;
    this.cameraOverride = null; // e.g. the cutscene camera
    this.quality = CONFIG.graphics.default;
    this.frameListeners = new Set(); // fn(realDt) — UI that animates every frame
    this.timer = new THREE.Timer();
  }

  /** Create the renderer. Throws if WebGL 2 is unavailable. */
  init() {
    this.renderer = createRenderer();
    input.attach();
    window.addEventListener('resize', () => this._resize());
  }

  /** Switch to a new world (the previous one is disposed). */
  setWorld(world) {
    const previous = this.world;
    this.world = world;
    this.cameraOverride = null;
    if (!this.postfx) {
      this.postfx = new PostFX(this.renderer, world.scene, world.camera);
    } else {
      this.postfx.setScene(world.scene);
      this.postfx.setCamera(world.camera);
    }
    previous?.dispose?.();
    this.applyGraphics(this.quality);
    this._resize();
  }

  /**
   * Render through another camera (cutscenes) while the world keeps updating
   * its own. Pass null to go back to the world's camera.
   */
  setCameraOverride(camera) {
    this.cameraOverride = camera;
    this.postfx?.setCamera(camera ?? this.world.camera);
    this._resize();
  }

  /** The camera currently on screen. */
  get activeCamera() {
    return this.cameraOverride ?? this.world?.camera;
  }

  /** Apply a Low / Medium / High preset everywhere. */
  applyGraphics(name) {
    if (!CONFIG.graphics.presets[name]) return;
    this.quality = name;
    const preset = CONFIG.graphics.presets[name];
    applyGraphicsToRenderer(this.renderer, preset);
    this.postfx?.applyGraphics(preset);
    this.world?.applyGraphics?.(preset);
    // Shadows on/off changes shader code → recompile materials once.
    this.world?.scene.traverse((o) => {
      if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true));
    });
    this._resize();
  }

  onFrame(fn) {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  /** Render one frame without advancing time (compiles shaders under the loading screen). */
  renderOnce() {
    this.postfx?.render(0);
  }

  start() {
    this.renderer.setAnimationLoop((t) => this._frame(t));
  }

  _frame(timestamp) {
    this.timer.update(timestamp);
    const realDt = Math.min(this.timer.getDelta(), CONFIG.loop.maxFrameDelta);

    timeScale.tick(realDt);
    input.pollGamepad();
    physics.update(realDt);                       // fixed 60 Hz inside
    this.world?.update(timeScale.scaled(realDt), timeScale.elapsed, realDt);
    this.frameListeners.forEach((fn) => fn(realDt));
    this.postfx?.render(realDt);
    input.endFrame();
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.postfx?.setSize(w, h);
    [this.world?.camera, this.cameraOverride].forEach((cam) => {
      if (!cam) return;
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    });
    this.world?.resize?.(w, h);
  }
}

export const game = new Game();
