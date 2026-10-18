// =============================================================================
// FLATLINE: 2050 — vfx/smokeFX.js
// Smoke particle effects (three.quarks).
//   createShadowSmoke() — slow purple-black smoke (🌑 SHADOWS / Umbra)
// Phase 7 adds black smoke columns for fires.
// =============================================================================

import * as THREE from 'three';
import {
  ParticleSystem,
  RenderMode,
  RectangleEmitter,
  IntervalValue,
  ConstantValue,
  RandomColor,
  ColorOverLife,
  Gradient,
  SizeOverLife,
  RotationOverLife,
  PiecewiseBezier,
  Bezier,
  Noise,
  Vector3 as QVector3,
  Vector4,
} from 'three.quarks';
import { smokeTexture } from './particleTextures.js';

/**
 * Slow, drifting shadow smoke.
 * @param {object} o
 * @param {number} o.width  emitter width
 * @param {number} o.depth  emitter depth
 * @param {number} o.rate   puffs per second
 * @param {number} o.opacity peak opacity (0..1)
 */
export function createShadowSmoke({ width = 1.5, depth = 3, rate = 6, opacity = 0.55, worldSpace = false, prewarm = true } = {}) {
  const material = new THREE.MeshBasicMaterial({
    map: smokeTexture(),
    blending: THREE.NormalBlending,
    transparent: true,
    depthWrite: false,
  });

  const system = new ParticleSystem({
    duration: 6,
    looping: true,
    prewarm,
    worldSpace,
    shape: new RectangleEmitter({ width, height: depth }),
    startLife: new IntervalValue(6, 10),
    startSpeed: new IntervalValue(0.08, 0.25),
    startSize: new IntervalValue(1.4, 2.8),
    startRotation: new IntervalValue(0, Math.PI * 2),
    // Deep purple → near black (SHADOWS #1a0f2e), slightly lifted so it reads on black.
    startColor: new RandomColor(new Vector4(0.32, 0.16, 0.5, 1), new Vector4(0.12, 0.06, 0.2, 1)),
    emissionOverTime: new ConstantValue(rate),
    material,
    renderMode: RenderMode.BillBoard,
    renderOrder: 4,
  });

  system.addBehavior(
    new ColorOverLife(
      new Gradient(
        [
          [new QVector3(1, 1, 1), 0],
          [new QVector3(0.6, 0.55, 0.7), 1],
        ],
        [
          [0, 0],
          [opacity, 0.3],
          [opacity * 0.7, 0.7],
          [0, 1],
        ],
      ),
    ),
  );
  system.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.6, 0.85, 1.05, 1.3), 0]])));
  system.addBehavior(new RotationOverLife(new IntervalValue(-0.25, 0.25)));
  system.addBehavior(new Noise(new ConstantValue(0.25), new ConstantValue(0.15)));

  return system;
}
