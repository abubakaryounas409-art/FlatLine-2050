// =============================================================================
// FLATLINE: 2050 — core/cameraRig.js
// GTA-style over-the-shoulder camera (CLAUDE.md Phase 5.2).
//
//   mouse → yaw / pitch (pointer lock), smooth follow, right mouse = aim zoom
//   (closer, narrower FOV), Q = shoulder swap, and collision: a sphere cast
//   from the head to the wanted camera spot pulls the camera in front of any
//   wall, so it never goes inside geometry.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from './physics.js';
import { settings } from '../systems/settings.js';

const UP = new THREE.Vector3(0, 1, 0);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} o
   * @param {() => any} o.excludeCollider  the player's collider (ignored by the cast)
   */
  constructor(camera, { excludeCollider = () => null } = {}) {
    this.camera = camera;
    this.excludeCollider = excludeCollider;
    this.yaw = 0;            // 0 = camera looks toward +Z
    this.pitch = -0.12;
    this.side = 1;           // +1 right shoulder, −1 left
    this._side = 1;          // smoothed
    this.aim = 0;            // 0..1 smoothed aim blend
    this.distance = CONFIG.cameraRig.distance; // smoothed, after collision
    this.pivot = new THREE.Vector3();
    this.kick = { pitch: 0, yaw: 0 }; // recoil (Phase 6)
    this.shake = 0;
    this.fovOverride = null;  // e.g. the sniper scope
    this._shape = null;
  }

  /** Point the camera along a yaw (e.g. behind the player at spawn). */
  setYaw(yaw, pitch = this.pitch) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Horizontal forward / right of the view (for camera-relative movement). */
  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  right(out = new THREE.Vector3()) {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  /** Where the crosshair points (world ray from the camera). */
  aimRay(origin = new THREE.Vector3(), dir = new THREE.Vector3()) {
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(dir);
    return { origin, dir };
  }

  /**
   * @param {number} realDt
   * @param {object} o
   * @param {THREE.Vector3} o.target    player feet position
   * @param {number} o.height           head height (lower while crouched)
   * @param {{dx:number, dy:number}} o.look  mouse delta this frame
   * @param {boolean} o.aiming
   * @param {boolean} o.swap            shoulder swap pressed
   */
  update(realDt, { target, height, look, aiming, swap }) {
    const C = CONFIG.cameraRig;
    const sens = C.sensitivity * settings.get('sensitivity') * (aiming ? C.aimSensitivityScale : 1);
    const invert = settings.get('invertY') ? -1 : 1;
    this.yaw -= look.dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy * sens * invert, C.pitchMin, C.pitchMax);
    if (swap) this.side *= -1;

    // recoil recovers by itself
    this.pitch += this.kick.pitch;
    this.yaw += this.kick.yaw;
    this.kick.pitch *= 1 - damp(18, realDt);
    this.kick.yaw *= 1 - damp(18, realDt);

    this.aim += ((aiming ? 1 : 0) - this.aim) * damp(C.aimSharpness, realDt);
    this._side += (this.side - this._side) * damp(10, realDt);

    // Pivot follows the head smoothly (vertical a little softer → no jitter on steps)
    const wanted = new THREE.Vector3(target.x, target.y + height, target.z);
    const k = damp(C.followSharpness, realDt);
    this.pivot.x += (wanted.x - this.pivot.x) * k;
    this.pivot.z += (wanted.z - this.pivot.z) * k;
    this.pivot.y += (wanted.y - this.pivot.y) * damp(C.followSharpness * 0.6, realDt);

    // View direction from yaw / pitch
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const right = this.right();
    const shoulder = THREE.MathUtils.lerp(C.shoulder, C.aimShoulder, this.aim) * this._side;
    const wantDist = THREE.MathUtils.lerp(C.distance, C.aimDistance, this.aim);

    // The shoulder offset is applied at the pivot so the cast starts outside the body
    const origin = this.pivot.clone().addScaledVector(right, shoulder * 0.35);
    const shoulderPoint = this.pivot.clone().addScaledVector(right, shoulder);
    const safeShoulder = this._cast(origin, shoulderPoint);
    const back = dir.clone().negate();
    const hitDist = this._cast(safeShoulder.point, safeShoulder.point.clone().addScaledVector(back, wantDist)).distance;

    // Pull in instantly when blocked, ease back out when clear
    if (hitDist < this.distance) this.distance = hitDist;
    else this.distance += (hitDist - this.distance) * damp(C.returnSharpness, realDt);

    const pos = safeShoulder.point.clone().addScaledVector(back, this.distance);
    this.camera.position.copy(pos);
    this.camera.up.copy(UP);
    this.camera.lookAt(pos.clone().add(dir));

    // Handheld drift + shake
    if (this.shake > 0) {
      this.camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.02;
      this.camera.rotation.y += (Math.random() - 0.5) * this.shake * 0.02;
      this.shake = Math.max(0, this.shake - realDt * 2.5);
    }

    const aimFov = this.fovOverride ?? C.aimFov;
    const fov = THREE.MathUtils.lerp(C.fov, aimFov, this.aim);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Sphere-cast from a to b. Returns the farthest safe point and its distance.
   * Ignores the player and sensors (triggers, light volumes).
   */
  _cast(a, b) {
    const R = physics.RAPIER;
    const delta = b.clone().sub(a);
    const len = delta.length();
    if (!physics.world || len < 1e-4) return { point: b.clone(), distance: len };
    delta.divideScalar(len);
    this._shape ??= new R.Ball(CONFIG.cameraRig.collisionRadius);
    const hit = physics.world.castShape(
      a, { x: 0, y: 0, z: 0, w: 1 }, delta, this._shape, 0, len, true,
      R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.excludeCollider() ?? undefined,
    );
    const d = hit ? Math.max(0.05, hit.time_of_impact) : len;
    return { point: a.clone().addScaledVector(delta, d), distance: d };
  }
}
