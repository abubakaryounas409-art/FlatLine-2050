// =============================================================================
// FLATLINE: 2050 — vfx/crashFX.js
// One-shot impact effects (three.quarks): glass shards, sparks, the explosion
// (fireball + black smoke + debris) and stadium fireworks. Each function
// returns { systems, burst() } — call burst() to fire it at its emitter.
// Effects update with whatever dt they're given, so they slow down in slow-mo.
// =============================================================================

import * as THREE from 'three';
import {
  ParticleSystem,
  RenderMode,
  SphereEmitter,
  PointEmitter,
  ConeEmitter,
  IntervalValue,
  ConstantValue,
  RandomColor,
  ColorOverLife,
  Gradient,
  SizeOverLife,
  PiecewiseBezier,
  Bezier,
  ApplyForce,
  RotationOverLife,
  Vector3 as QVector3,
  Vector4,
} from 'three.quarks';
import { glowTexture, smokeTexture } from './particleTextures.js';

const additive = (map = glowTexture()) =>
  new THREE.MeshBasicMaterial({ map, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });

/** A system that only emits when burst() is called (count particles at once). */
function burstSystem(params, count) {
  const system = new ParticleSystem({
    duration: 1,
    looping: false,
    autoDestroy: false,
    worldSpace: true,
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [],
    ...params,
  });
  system.burstCount = count;
  return system;
}

function fire(system) {
  system.emissionBursts = [{ time: 0, count: new ConstantValue(system.burstCount), cycle: 1, interval: 0.01, probability: 1 }];
  system.restart();
  system.play?.();
}

const fadeOut = (colors) =>
  new ColorOverLife(
    new Gradient(
      colors,
      [
        [1, 0],
        [0.9, 0.6],
        [0, 1],
      ],
    ),
  );

// -----------------------------------------------------------------------------
/** Windscreen + visor shards: small bright glinting fragments with gravity. */
export function createGlassShards() {
  const sys = burstSystem(
    {
      shape: new SphereEmitter({ radius: 0.6 }),
      startLife: new IntervalValue(1.2, 2.4),
      startSpeed: new IntervalValue(3, 11),
      startSize: new IntervalValue(0.04, 0.12),
      startRotation: new IntervalValue(0, Math.PI * 2),
      startColor: new RandomColor(new Vector4(2.2, 2.6, 3.2, 1), new Vector4(1.2, 1.6, 2.2, 1)),
      material: additive(),
      renderMode: RenderMode.BillBoard,
    },
    260,
  );
  sys.addBehavior(new ApplyForce(new QVector3(0, -1, 0), new ConstantValue(9.8)));
  sys.addBehavior(new RotationOverLife(new IntervalValue(-8, 8)));
  sys.addBehavior(fadeOut([[new QVector3(1, 1, 1), 0], [new QVector3(0.6, 0.8, 1), 1]]));
  return { systems: [sys], burst: () => fire(sys) };
}

/** Metal-on-asphalt sparks: fast stretched streaks, orange-white. */
export function createSparks(count = 220) {
  const sys = burstSystem(
    {
      shape: new ConeEmitter({ radius: 0.3, angle: 0.9 }),
      startLife: new IntervalValue(0.3, 0.9),
      startSpeed: new IntervalValue(6, 22),
      startSize: new IntervalValue(0.04, 0.09),
      startLength: new IntervalValue(0.3, 0.8),
      startColor: new RandomColor(new Vector4(5, 3.2, 1.2, 1), new Vector4(4, 1.6, 0.4, 1)),
      material: additive(),
      renderMode: RenderMode.StretchedBillBoard,
      rendererEmitterSettings: { speedFactor: 0.06, lengthFactor: 1 },
    },
    count,
  );
  sys.addBehavior(new ApplyForce(new QVector3(0, -1, 0), new ConstantValue(12)));
  sys.addBehavior(fadeOut([[new QVector3(1, 1, 1), 0], [new QVector3(1, 0.45, 0.1), 1]]));
  return { systems: [sys], burst: () => fire(sys) };
}

/** The explosion: fireball + rolling black smoke + debris sparks. */
export function createExplosion() {
  const ball = burstSystem(
    {
      shape: new SphereEmitter({ radius: 1.2 }),
      startLife: new IntervalValue(0.6, 1.4),
      startSpeed: new IntervalValue(2, 9),
      startSize: new IntervalValue(2.2, 4.5),
      startRotation: new IntervalValue(0, Math.PI * 2),
      startColor: new RandomColor(new Vector4(6, 3.2, 1.2, 1), new Vector4(4, 1.2, 0.25, 1)),
      material: additive(smokeTexture()),
      renderMode: RenderMode.BillBoard,
    },
    90,
  );
  ball.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.5, 1.2, 1.5, 1.7), 0]])));
  ball.addBehavior(new ApplyForce(new QVector3(0, 1, 0), new ConstantValue(3)));
  ball.addBehavior(fadeOut([[new QVector3(1, 1, 1), 0], [new QVector3(1, 0.4, 0.1), 0.5], [new QVector3(0.3, 0.05, 0.02), 1]]));

  const smoke = burstSystem(
    {
      shape: new SphereEmitter({ radius: 1.5 }),
      startLife: new IntervalValue(3, 6),
      startSpeed: new IntervalValue(1, 4),
      startSize: new IntervalValue(3, 6),
      startRotation: new IntervalValue(0, Math.PI * 2),
      startColor: new RandomColor(new Vector4(0.12, 0.1, 0.1, 1), new Vector4(0.03, 0.03, 0.03, 1)),
      material: new THREE.MeshBasicMaterial({ map: smokeTexture(), transparent: true, depthWrite: false }),
      renderMode: RenderMode.BillBoard,
    },
    60,
  );
  smoke.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(0.6, 1.3, 1.8, 2.2), 0]])));
  smoke.addBehavior(new ApplyForce(new QVector3(0, 1, 0), new ConstantValue(1.6)));
  smoke.addBehavior(new RotationOverLife(new IntervalValue(-0.4, 0.4)));
  smoke.addBehavior(
    new ColorOverLife(
      new Gradient(
        [[new QVector3(1, 1, 1), 0], [new QVector3(1, 1, 1), 1]],
        [[0, 0], [0.85, 0.1], [0.6, 0.6], [0, 1]],
      ),
    ),
  );

  const debris = createSparks(160);
  return {
    systems: [ball, smoke, ...debris.systems],
    burst: () => {
      fire(ball);
      fire(smoke);
      debris.burst();
    },
  };
}

/** A firework shell bursting in the sky (colour per shell). */
export function createFirework(color = new THREE.Color(0x3fa9ff)) {
  const c = color.clone().multiplyScalar(4);
  const sys = burstSystem(
    {
      shape: new PointEmitter(),
      startLife: new IntervalValue(1.2, 2.2),
      startSpeed: new IntervalValue(14, 22),
      startSize: new IntervalValue(0.35, 0.6),
      startColor: new RandomColor(new Vector4(c.r, c.g, c.b, 1), new Vector4(c.r * 0.7 + 1, c.g * 0.7 + 1, c.b * 0.7 + 1, 1)),
      material: additive(),
      renderMode: RenderMode.BillBoard,
    },
    150,
  );
  sys.shape = new SphereEmitter({ radius: 0.2, thickness: 0 });
  sys.addBehavior(new ApplyForce(new QVector3(0, -1, 0), new ConstantValue(5)));
  sys.addBehavior(fadeOut([[new QVector3(1, 1, 1), 0], [new QVector3(1, 0.8, 0.6), 1]]));
  sys.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.9, 0.6, 0.1), 0]])));
  return { systems: [sys], burst: () => fire(sys) };
}
