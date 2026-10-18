// =============================================================================
// FLATLINE: 2050 — showcase/driving.js
// Driving helpers for the videos: start the 2050 race on the spot, an
// autopilot for Kael's car (race + reverse chase) that works in production
// builds (no dev hooks), the VIP box where Victor watches, and fireworks.
// =============================================================================

import * as THREE from 'three';
import { BatchedRenderer } from 'three.quarks';
import { game } from '../core/game.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { createFirework } from '../vfx/crashFX.js';
import { playFirst } from './set2020.js';

const clamp = THREE.MathUtils.clamp;

/** Steering command toward a world point (same convention as the race input: +1 = right). */
export function steerToward(car, target, gain = 1.8) {
  const fwd = car.forward();
  const tx = target.x - car.position.x;
  const tz = target.z - car.position.z;
  const ang = Math.atan2(fwd.x * tz - fwd.z * tx, fwd.x * tx + fwd.z * tz);
  return { steer: clamp(ang * gain, -1, 1), ang };
}

/** Lights out and away — no countdown (the videos cut straight into a race in progress). */
export function startRaceNow(world) {
  const { race, car, rivals, track } = world;
  world.engage();
  track.setStartLights?.('green');
  race.state = 'racing';
  race.time = 0;
  race.lapStart = 0;
  car.locked = false;
  rivals.forEach((r) => (r.racing = true));
}

/**
 * Race autopilot: follows the centre line (plus a lateral offset), lifts for
 * tight corners. Returns a per-frame function; opts can change live
 * (opts.boost, opts.lateral, opts.throttle).
 */
export function raceAutopilot(world, opts = {}) {
  const { car, race, track } = world;
  const o = Object.assign({ boost: false, lateral: 0, throttle: 1, lookahead: 16 }, opts);
  const tmp = { position: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3() };
  const fn = () => {
    if (race.state !== 'racing') return;
    const speed = Math.abs(car.speed);
    const f = track.sampleAt(race.playerEntry.wrapped + o.lookahead + speed * 0.45, tmp);
    const target = f.position.clone().addScaledVector(f.normal, o.lateral);
    const { steer, ang } = steerToward(car, target);
    const sharp = Math.abs(ang) > 0.32 && speed > 42;
    world.inputOverride = {
      throttle: sharp ? 0.35 : o.throttle,
      brake: Math.abs(ang) > 0.55 && speed > 40 ? 0.5 : 0,
      steer,
      handbrake: false,
      boost: !!o.boost && !sharp,
    };
  };
  fn.opts = o;
  return fn;
}

/** Reverse-chase autopilot (m7 chase world): along the road, in the left lane. */
export function chaseAutopilot(chase, opts = {}) {
  const o = Object.assign({ boost: true, lateral: -2.4 }, opts);
  const fn = () => {
    const car = chase.car;
    const s = chase.level.progress + 18 + Math.abs(car.speed) * 0.5;
    const a = chase.atS(s);
    const n = new THREE.Vector3(-a.t.z, 0, a.t.x);
    const target = a.p.clone().addScaledVector(n, o.lateral);
    const { steer } = steerToward(car, target);
    chase.inputOverride = { throttle: 1, brake: 0, steer, handbrake: false, boost: o.boost };
  };
  fn.opts = o;
  return fn;
}

/**
 * Victor's VIP box above the main grandstand (like Mission 1's), with a
 * tablet that can flash the clue "20.20.20". Returns positions for the shot.
 */
export function buildVipBox(world, assets) {
  const { scene, track } = world;
  const disposables = [];
  const f = track.sampleAt(40);
  const off = track.width / 2 + 46;
  const boxPos = f.position.clone().addScaledVector(f.normal, off).setY(19);
  const facing = Math.atan2(-f.normal.x, -f.normal.z);
  const box = new THREE.Group();
  box.position.copy(boxPos);
  box.rotation.y = facing;
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1020, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.3 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x15161c, metalness: 0.8, roughness: 0.3 });
  const gold = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd4af37).multiplyScalar(2) });
  const parts = [
    [new THREE.BoxGeometry(8, 0.3, 5), frame, [0, 0, 0]],
    [new THREE.BoxGeometry(8, 3.4, 0.2), frame, [0, 1.7, -2.4]],
    [new THREE.BoxGeometry(8, 3.2, 0.06), glass, [0, 1.75, 2.45]],
    [new THREE.BoxGeometry(8.2, 0.25, 5.2), frame, [0, 3.45, 0]],
    [new THREE.BoxGeometry(8.2, 0.05, 0.05), gold, [0, 3.3, 2.5]],
    [new THREE.CylinderGeometry(0.6, 0.9, 19, 10), frame, [0, -9.5, 0]],
  ];
  parts.forEach(([g, m, p]) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(...p);
    box.add(mesh);
    disposables.push(g);
  });
  disposables.push(glass, frame, gold);
  const warm = new THREE.PointLight(0xffc890, 14, 9, 2);
  warm.position.set(0, 2.8, 0.5);
  box.add(warm);
  scene.add(box);
  box.updateMatrixWorld(true);
  const local = (x, y, z) => box.localToWorld(new THREE.Vector3(x, y, z));

  // Victor (2050: the league owner)
  const tpl = assets.get('characters.victor');
  const victor = new Actor('victor', createModelInstance(tpl), tpl.animations);
  scene.add(victor.object);
  const victorPos = local(0.4, 0.15, 1.2);
  victor.place(victorPos.toArray(), facing + Math.PI);
  playFirst(victor, ['idle'], 0.01);

  // the tablet
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 160;
  const cx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (alarm) => {
    cx.fillStyle = '#06080e';
    cx.fillRect(0, 0, 256, 160);
    cx.font = '600 18px Rajdhani, sans-serif';
    cx.fillStyle = '#7fa8d9';
    cx.fillText('CAR #20 · TELEMETRY', 14, 28);
    cx.fillText('BRAKE SYS ....... OK', 14, 58);
    cx.fillStyle = alarm ? '#ff2a3a' : '#7fa8d9';
    cx.fillText(alarm ? 'OVERRIDE ARMED' : 'STEERING ....... OK', 14, 86);
    cx.font = '700 34px Rajdhani, sans-serif';
    cx.fillStyle = alarm ? '#ff2a3a' : '#3fa9ff';
    cx.fillText(alarm ? '20.20.20' : 'LAP 50', 14, 136);
    tex.needsUpdate = true;
  };
  draw(false);
  const tablet = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  tablet.position.copy(local(0.4, 1.2, 1.55));
  tablet.rotation.set(-0.6, facing + Math.PI, 0);
  scene.add(tablet);
  disposables.push(tablet.geometry, tablet.material, tex);

  const offFrame = game.onFrame((dt) => victor.update(dt));
  return {
    victor,
    alarm: () => draw(true),
    shotA: local(-0.6, 1.35, 2.15),
    shotB: local(1.5, 1.68, 2.3),
    tabletLook: tablet.position.clone(),
    faceLook: victorPos.clone().setY(victorPos.y + 1.62),
    trackLook: f.position.clone(),
    dispose() {
      offFrame();
      box.removeFromParent();
      tablet.removeFromParent();
      victor.object.removeFromParent();
      disposables.forEach((d) => d.dispose?.());
    },
  };
}

/** A small pool of firework shells over the stands. */
export function buildFireworks(world) {
  const { scene, track } = world;
  const batch = new BatchedRenderer();
  scene.add(batch);
  const shells = [0x3fa9ff, 0xff6a1a, 0x8a4dff, 0xffffff, 0xff2340].map((c) => {
    const fw = createFirework(new THREE.Color(c));
    fw.systems.forEach((s) => {
      scene.add(s.emitter);
      batch.addSystem(s);
    });
    return fw;
  });
  let next = 0;
  const offFrame = game.onFrame((dt) => batch.update(dt));
  return {
    launch(nearS = Math.random() * track.length) {
      const fw = shells[next++ % shells.length];
      const g = track.sampleAt(nearS + (Math.random() - 0.5) * 120);
      const side = Math.random() < 0.5 ? 1 : -1;
      const p = g.position.clone().addScaledVector(g.normal, side * (track.width / 2 + 30 + Math.random() * 40));
      p.y = 50 + Math.random() * 30;
      fw.systems.forEach((sys) => sys.emitter.position.copy(p));
      fw.burst();
    },
    dispose() {
      offFrame();
      batch.removeFromParent();
      shells.forEach((fw) => fw.systems.forEach((s) => s.emitter.removeFromParent()));
    },
  };
}
