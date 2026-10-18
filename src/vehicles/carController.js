// =============================================================================
// FLATLINE: 2050 — vehicles/carController.js
// Kael's 2050 car: Rapier raycast-vehicle physics (CLAUDE.md Phase 3.1).
//   acceleration · braking / reverse · speed-sensitive steering · suspension
//   handbrake drift (refills boost) · boost · downforce · stability assist
//   auto-reset when flipped or stuck
//
// Physics frame: forward = +X, up = +Y (Rapier's vehicle default). The visual
// model (front = -Z) is rotated -90° to match.
//
//   const car = new CarController({ object, wheelNames, position, yaw });
//   car.setInput({ throttle, brake, steer, handbrake, boost });   // any time
//   physics.onFixedUpdate(dt => car.fixedUpdate(dt));            // done in ctor
//   car.syncVisual();                                            // every frame
//
// Theme abilities: car.boost = 🔥 Burn meter · car.shadow + dash() = 🌑 Shadow
// Dash (phase through cars) · car.time = ⏳ rewind meter · snapshot()/restore()
// for systems/timeRewind.js.
// Phase 4 hooks: car.locked (ignores input), car.brakesFailed, car.steerFailed.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { timeScale } from '../core/timeScale.js';

// Collision groups: (membership << 16) | filter. Walls/ground use the default (all).
export const GROUPS = {
  PLAYER: (0x0002 << 16) | 0xffff,
  PLAYER_PHASED: (0x0002 << 16) | 0x0001, // Shadow Dash: only world geometry
  RIVAL: (0x0004 << 16) | 0xffff,
};

const C = CONFIG.car;
const MODEL_YAW = -Math.PI / 2; // model front (-Z) → physics forward (+X)
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const FWD = new THREE.Vector3();
const UP = new THREE.Vector3();

export class CarController {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.object      visual model root (feet / tyres at y = 0)
   * @param {string[]} o.wheelNames        [fl, fr, rl, rr] node names inside the model
   * @param {number[]} o.position          spawn [x, y, z]
   * @param {number} o.yaw                 spawn heading (radians, 0 = +X)
   */
  constructor({ object, wheelNames = [], position = [0, 0, 0], yaw = 0 }) {
    const { RAPIER, world } = physics;

    // --- Visual: a root that follows the body, the model rotated inside it ---
    this.root = new THREE.Group();
    this.root.name = 'car';
    object.rotation.y = MODEL_YAW;
    this.root.add(object);
    this.model = object;
    this.wheels = wheelNames.map((n) => object.getObjectByName(n)).filter(Boolean);
    this.wheelRest = this.wheels.map((w) => w.position.clone());
    this.wheels.forEach((w) => (w.rotation.order = 'YXZ'));

    // --- Chassis body ---------------------------------------------------------------
    const [hx, hy, hz] = C.chassisHalf;
    const m = C.mass;
    const inertia = { x: (m / 12) * (4 * hy * hy + 4 * hz * hz), y: (m / 12) * (4 * hx * hx + 4 * hz * hz), z: (m / 12) * (4 * hx * hx + 4 * hy * hy) };
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position[0], position[1] + 0.05, position[2])
        .setRotation(quatFromYaw(yaw))
        .setCanSleep(false)
        .setLinearDamping(0.02)
        .setAngularDamping(0.4),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(0, C.colliderY, 0)
        .setMassProperties(m, { x: 0, y: C.comHeight - C.colliderY, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.3)
        .setRestitution(0.1)
        .setCollisionGroups(GROUPS.PLAYER),
      this.body,
    );

    // --- Raycast vehicle: wheels at the model's wheel positions -----------------------
    this.vehicle = world.createVehicleController(this.body);
    const W = C.wheel;
    // Model space (x, z) → physics space: x_p = -z_m, z_p = x_m
    const mounts = this.wheelRest.length === 4
      ? this.wheelRest.map((p) => ({ x: -p.z, z: p.x }))
      : [{ x: 1.16, z: 0.83 }, { x: 1.16, z: -0.83 }, { x: -1.5, z: 0.83 }, { x: -1.5, z: -0.83 }];
    this.mounts = mounts;
    mounts.forEach((p, i) => {
      this.vehicle.addWheel({ x: p.x, y: C.connY, z: p.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, W.rest, W.radius);
      this.vehicle.setWheelSuspensionStiffness(i, W.stiffness);
      this.vehicle.setWheelSuspensionCompression(i, W.compression);
      this.vehicle.setWheelSuspensionRelaxation(i, W.relaxation);
      this.vehicle.setWheelMaxSuspensionForce(i, W.maxForce);
      this.vehicle.setWheelMaxSuspensionTravel(i, W.maxTravel);
      this.vehicle.setWheelFrictionSlip(i, W.frictionSlip);
      this.vehicle.setWheelSideFrictionStiffness(i, i < 2 ? W.sideFront : W.sideRear);
    });
    // Front = the two wheels with the largest x
    const order = mounts.map((p, i) => [p.x, i]).sort((a, b) => b[0] - a[0]);
    this.frontIdx = [order[0][1], order[1][1]];
    this.rearIdx = [order[2][1], order[3][1]];

    physics.link(this.body, this.root);
    this._offFixed = physics.onFixedUpdate((dt) => this.fixedUpdate(dt));

    // --- State -------------------------------------------------------------------------
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    this.steer = 0;            // smoothed steering (-1..1)
    this.boost = 1;            // 🔥 Burn meter 0..1
    this.shadow = 0;           // 🌑 Shadow meter 0..1 (fills while drafting)
    this.time = 1;             // ⏳ Time meter 0..1 (rewind fuel)
    this.dashTime = 0;         // > 0 while phased by Shadow Dash
    this.boosting = false;
    this.drifting = false;
    this.slipAngle = 0;        // degrees
    this.speed = 0;            // m/s along the car's forward axis (signed)
    this.stuckTime = 0;
    this.locked = false;       // countdown / cutscenes: no driving
    this.brakesFailed = false; // Phase 4: brake failure
    this.steerFailed = false;  // Phase 4: steering stops responding
    this.crashed = false;      // Phase 4: airborne wreck — no tyre or assist forces
    this.onReset = null;       // fn() → { position, yaw } for auto-reset
  }

  setInput(input) {
    Object.assign(this.input, input);
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  get position() {
    return this.root.position;
  }

  /** World-space forward (horizontal) of the rendered car. */
  forward(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.root.quaternion).setY(0).normalize();
  }

  // ---------------------------------------------------------------------------
  // Physics (fixed 60 Hz)
  // ---------------------------------------------------------------------------
  fixedUpdate(dt) {
    const v = this.vehicle;
    const body = this.body;
    if (timeScale.rewinding || this.crashed) return; // rewind / wreck: no driving forces

    // Shadow Dash timer
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      if (this.dashTime <= 0) this.collider.setCollisionGroups(GROUPS.PLAYER);
    }
    const inp = this.locked ? { throttle: 0, brake: 1, steer: 0, handbrake: false, boost: false } : this.input;

    // Current motion in the car frame
    const r = body.rotation();
    tmpQ.set(r.x, r.y, r.z, r.w);
    FWD.set(1, 0, 0).applyQuaternion(tmpQ);
    UP.set(0, 1, 0).applyQuaternion(tmpQ);
    const lv = body.linvel();
    const planar = Math.hypot(lv.x, lv.z);
    this.speed = lv.x * FWD.x + lv.z * FWD.z;
    const fwdFlat = Math.hypot(FWD.x, FWD.z) || 1;
    const along = this.speed / fwdFlat;
    this.slipAngle = planar > 4 ? THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(along) / planar))) : 0;

    // Boost
    const wantBoost = inp.boost && inp.throttle > 0.1 && this.boost > 0.02;
    this.boosting = wantBoost;
    if (wantBoost) this.boost = Math.max(0, this.boost - C.boost.drain * dt);
    else this.boost = Math.min(1, this.boost + (C.boost.refill + (this.drifting ? C.boost.driftRefill : 0)) * dt);

    // Engine (rear-wheel drive), fading out toward the fade speed
    const fade = this.boosting ? C.boost.fadeSpeed : C.engineFadeSpeed;
    const k = Math.min(1, Math.max(0, this.speed) / fade);
    let force = 0;
    let brake = inp.brake;
    if (inp.throttle > 0) {
      force = inp.throttle * C.engineForce * Math.max(0, 1 - k * k) * (this.boosting ? C.boost.force : 1);
    }
    // Brake pedal reverses when (nearly) stopped
    if (inp.brake > 0 && this.speed < 1.5) {
      brake = 0;
      if (this.speed > -C.reverseTopSpeed) force = -inp.brake * C.reverseForce;
    }
    if (this.brakesFailed) brake = 0;
    this.rearIdx.forEach((i) => v.setWheelEngineForce(i, force));

    // Steering: smoothed, shrinks with speed
    const target = this.steerFailed ? this.steer : -inp.steer; // physics: +steer = left
    this.steer += (target - this.steer) * Math.min(1, C.steerRate * dt);
    const ks = Math.min(1, Math.abs(this.speed) / C.topSpeed);
    const steerMax = C.maxSteer * (1 - C.steerFalloff * Math.pow(ks, 0.7));
    this.frontIdx.forEach((i) => v.setWheelSteering(i, this.steer * steerMax));

    // Brakes + handbrake (rear grip drop = drift)
    const hb = inp.handbrake && !this.locked;
    const W = C.wheel;
    [...this.frontIdx, ...this.rearIdx].forEach((i) => v.setWheelBrake(i, brake * C.brakeForce));
    this.rearIdx.forEach((i) => {
      if (hb && !this.brakesFailed) v.setWheelBrake(i, C.brakeForce * C.handbrake.brake + brake * C.brakeForce);
      v.setWheelSideFrictionStiffness(i, hb ? W.sideRear * C.handbrake.side : W.sideRear);
      v.setWheelFrictionSlip(i, hb ? W.frictionSlip * C.handbrake.slip : W.frictionSlip);
    });
    this.drifting = this.slipAngle > 9 && planar > 12 && this.grounded();

    // Aerodynamics: drag + rolling resistance + downforce
    if (planar > 0.05) {
      const d = (C.drag * planar * planar + C.rolling) * dt;
      body.applyImpulse({ x: (-lv.x / planar) * d, y: 0, z: (-lv.z / planar) * d }, true);
    }
    if (this.grounded()) body.applyImpulse({ x: -UP.x * C.downforce * planar * planar * dt, y: -UP.y * C.downforce * planar * planar * dt, z: -UP.z * C.downforce * planar * planar * dt }, true);

    // Drift push: keep momentum through a throttle-on slide
    if (this.drifting && inp.throttle > 0.3) {
      const push = C.driftPush * C.mass * dt * inp.throttle;
      body.applyImpulse({ x: FWD.x * push, y: 0, z: FWD.z * push }, true);
    }

    // Stability assist: cap yaw rate (lateral g), hold drift angle
    const av = body.angvel();
    const cap = (C.maxYawG * 9.81 * (hb ? 1.6 : 1)) / Math.max(planar, 6);
    if (Math.abs(av.y) > cap) body.setAngvel({ x: av.x, y: Math.sign(av.y) * (cap + (Math.abs(av.y) - cap) * 0.6), z: av.z }, true);
    if (this.slipAngle > C.driftMaxSlip) body.setAngvel({ x: av.x, y: av.y * 0.85, z: av.z }, true);

    v.updateVehicle(dt);

    // Auto-reset when flipped or wedged
    const flipped = UP.y < 0.3;
    const wedged = !this.locked && inp.throttle > 0.5 && planar < 1 && !this.grounded();
    this.stuckTime = flipped || wedged ? this.stuckTime + dt : 0;
    if (this.stuckTime > C.resetAfterStuck && this.onReset) {
      const spot = this.onReset();
      if (spot) this.reset(spot.position, spot.yaw);
    }
  }

  /** 🌑 Shadow Dash: phase through cars with a forward lunge. Needs a full meter. */
  dash() {
    if (this.shadow < 1 || this.dashTime > 0 || this.locked) return false;
    this.shadow = 0;
    this.dashTime = CONFIG.carThemes.shadow.dashTime;
    this.collider.setCollisionGroups(GROUPS.PLAYER_PHASED);
    const r = this.body.rotation();
    FWD.set(1, 0, 0).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w)).setY(0).normalize();
    const push = CONFIG.carThemes.shadow.dashPush * C.mass;
    this.body.applyImpulse({ x: FWD.x * push, y: 0, z: FWD.z * push }, true);
    return true;
  }

  get phased() {
    return this.dashTime > 0;
  }

  /** ⏳ State for systems/timeRewind.js */
  snapshot() {
    const b = this.body;
    return { t: { ...b.translation() }, r: { ...b.rotation() }, lv: { ...b.linvel() }, av: { ...b.angvel() }, boost: this.boost, shadow: this.shadow, steer: this.steer };
  }

  restore(st) {
    const b = this.body;
    b.setTranslation(st.t, true);
    b.setRotation(st.r, true);
    b.setLinvel(st.lv, true);
    b.setAngvel(st.av, true);
    this.boost = st.boost;
    this.shadow = st.shadow;
    this.steer = st.steer;
    const lv = st.lv;
    const r = st.r;
    FWD.set(1, 0, 0).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w));
    this.speed = lv.x * FWD.x + lv.z * FWD.z;
  }

  grounded() {
    let n = 0;
    for (let i = 0; i < 4; i++) if (this.vehicle.wheelIsInContact(i)) n++;
    return n >= 2;
  }

  /** Teleport (respawn) with zero velocity. */
  reset(position, yaw) {
    this.body.setTranslation({ x: position[0], y: position[1] + 0.3, z: position[2] }, true);
    this.body.setRotation(quatFromYaw(yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.stuckTime = 0;
    this.steer = 0;
  }

  // ---------------------------------------------------------------------------
  // Visuals (every frame)
  // ---------------------------------------------------------------------------
  syncVisual() {
    if (this.wheels.length !== 4) return;
    const v = this.vehicle;
    this.wheels.forEach((w, i) => {
      // Wheel centre height in chassis space = mount height - suspension length
      const len = v.wheelSuspensionLength(i) ?? C.wheel.rest;
      w.position.y = C.connY - len;
      // Spin about the axle (model X) and steer about Y for the front wheels
      w.rotation.x = -(v.wheelRotation(i) ?? 0);
      w.rotation.y = this.frontIdx.includes(i) ? (v.wheelSteering(i) ?? 0) : 0;
    });
  }

  dispose() {
    this._offFixed?.();
    physics.unlink(this.root);
  }
}

export function quatFromYaw(yaw) {
  tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), yaw);
  return { x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w };
}
