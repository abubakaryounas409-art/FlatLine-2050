// =============================================================================
// FLATLINE: 2050 — vfx/fireFX.js
// Fire particle effects (three.quarks). Theme: 🔥 FIRE.
//   createEmbers() — glowing embers drifting upward (boot intro, menu, fires)
//   createExhaustFlame() — jet flame for the 🔥 Burn boost (rate 0 = off)
// Phase 7 adds flames and fire spread on top of this.
// =============================================================================

import * as THREE from 'three';
import {
  ParticleSystem,
  RenderMode,
  RectangleEmitter,
  ConeEmitter,
  IntervalValue,
  ConstantValue,
  RandomColor,
  ColorOverLife,
  Gradient,
  SizeOverLife,
  PiecewiseBezier,
  Bezier,
  TurbulenceField,
  ApplyForce,
  Vector3 as QVector3,
  Vector4,
} from 'three.quarks';
import { glowTexture } from './particleTextures.js';

/**
 * Embers rising from a flat rectangle.
 * Returns the ParticleSystem; add `system.emitter` to the scene (or the camera
 * for screen-anchored embers) and register the system with a BatchedRenderer.
 *
 * @param {object} o
 * @param {number} o.width       emitter width (metres)
 * @param {number} o.depth       emitter depth (metres)
 * @param {number} o.rate        particles per second (scale with graphics quality)
 * @param {boolean} o.worldSpace false = particles move with the emitter's parent
 * @param {boolean} o.prewarm    true = start fully populated; false = rise in from the emitter
 */
export function createEmbers({ width = 8, depth = 1, rate = 40, worldSpace = false, prewarm = true } = {}) {
  const material = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  const system = new ParticleSystem({
    duration: 5,
    looping: true,
    prewarm,
    worldSpace,
    shape: new RectangleEmitter({ width, height: depth }),
    startLife: new IntervalValue(3, 6.5),
    startSpeed: new IntervalValue(0.35, 1.1),
    startSize: new IntervalValue(0.015, 0.05),
    // HDR colors (above 1) so the hottest embers bloom.
    startColor: new RandomColor(new Vector4(3.2, 1.6, 0.5, 1), new Vector4(2.4, 0.6, 0.12, 1)),
    emissionOverTime: new ConstantValue(rate),
    material,
    renderMode: RenderMode.BillBoard,
    renderOrder: 5,
  });

  // Fade in quickly, cool from orange to deep red, fade out.
  system.addBehavior(
    new ColorOverLife(
      new Gradient(
        [
          [new QVector3(1, 1, 1), 0],
          [new QVector3(1, 0.65, 0.4), 0.5],
          [new QVector3(0.8, 0.2, 0.1), 1],
        ],
        [
          [0, 0],
          [1, 0.08],
          [0.9, 0.6],
          [0, 1],
        ],
      ),
    ),
  );
  system.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.95, 0.75, 0.3), 0]])));
  // Swirl like hot air, plus a gentle sideways breeze.
  system.addBehavior(
    new TurbulenceField(new QVector3(2.5, 2.5, 2.5), 2, new QVector3(0.6, 0.4, 0.6), new QVector3(0.15, 0.15, 0.15)),
  );
  system.addBehavior(new ApplyForce(new QVector3(1, 0, 0), new ConstantValue(0.05)));

  return system;
}

/**
 * Jet flame out of an exhaust: short-lived, fast, white-hot core cooling to
 * red. Emits along the emitter's +Z. Set system.emissionOverTime.value to turn
 * it on (≈ 180) / off (0). worldSpace so the flame streams behind a moving car.
 */
export function createExhaustFlame() {
  const material = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const system = new ParticleSystem({
    duration: 1,
    looping: true,
    worldSpace: true,
    shape: new ConeEmitter({ radius: 0.08, angle: 0.12 }),
    startLife: new IntervalValue(0.08, 0.2),
    startSpeed: new IntervalValue(9, 16),
    startSize: new IntervalValue(0.28, 0.55),
    startColor: new RandomColor(new Vector4(4, 2.6, 1.4, 1), new Vector4(3.4, 1.2, 0.3, 1)),
    emissionOverTime: new ConstantValue(0),
    material,
    renderMode: RenderMode.BillBoard,
    renderOrder: 6,
  });
  system.addBehavior(
    new ColorOverLife(
      new Gradient(
        [
          [new QVector3(1, 1, 1), 0],
          [new QVector3(1, 0.55, 0.25), 0.4],
          [new QVector3(0.7, 0.12, 0.05), 1],
        ],
        [
          [1, 0],
          [0.8, 0.5],
          [0, 1],
        ],
      ),
    ),
  );
  system.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 1.1, 0.7, 0.2), 0]])));
  return system;
}
