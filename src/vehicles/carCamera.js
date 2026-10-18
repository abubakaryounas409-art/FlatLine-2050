// =============================================================================
// FLATLINE: 2050 — vehicles/carCamera.js
// Chase camera (CLAUDE.md Phase 3.2): smooth follow, FOV widens with speed
// (+ a kick while boosting), a slight shake near top speed, C = look back.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const K = CONFIG.carCamera;
const fwd = new THREE.Vector3();
const desired = new THREE.Vector3();
const look = new THREE.Vector3();

export class CarCamera {
  constructor(camera) {
    this.camera = camera;
    this.camera.fov = K.fovBase;
    this.smoothLook = new THREE.Vector3();
    this.initialised = false;
    this.lookingBack = false;
  }

  /** Snap behind the car (start of race / after a reset). */
  snap(car) {
    this.initialised = false;
    this.update(1, car, {});
  }

  /**
   * @param {number} dt real seconds
   * @param {CarController} car
   * @param {{ lookBack?: boolean }} o
   */
  update(dt, car, { lookBack = false } = {}) {
    const cam = this.camera;
    const pos = car.position;
    car.forward(fwd);
    const speedRatio = THREE.MathUtils.clamp(Math.abs(car.speed) / CONFIG.car.topSpeed, 0, 1.3);

    if (lookBack) {
      // Look back: in front of the car, looking behind it (instant cut feels right)
      desired.copy(pos).addScaledVector(fwd, K.distance * 0.9).setY(pos.y + K.height * 0.8);
      look.copy(pos).addScaledVector(fwd, -12).setY(pos.y + 0.8);
      cam.position.copy(desired);
      cam.lookAt(look);
      this.lookingBack = true;
    } else {
      // Pull back a little more at speed for a sense of velocity
      const dist = K.distance * (1 + speedRatio * 0.12);
      desired.copy(pos).addScaledVector(fwd, -dist).setY(pos.y + K.height);
      look.copy(pos).addScaledVector(fwd, K.lookAhead).setY(pos.y + K.lookHeight);
      if (!this.initialised || this.lookingBack) {
        cam.position.copy(desired);
        this.smoothLook.copy(look);
        this.initialised = true;
        this.lookingBack = false;
      }
      const a = 1 - Math.exp(-K.sharpness * dt);
      cam.position.lerp(desired, a);
      cam.position.y = Math.max(cam.position.y, pos.y + 0.6);
      this.smoothLook.lerp(look, 1 - Math.exp(-K.sharpness * 1.6 * dt));

      // Shake near top speed / boosting
      const shake = Math.max(0, speedRatio - K.shakeFrom) / (1 - K.shakeFrom) * K.shakeAmount + (car.boosting ? K.shakeAmount * 0.6 : 0);
      if (shake > 0) {
        cam.position.x += (Math.random() - 0.5) * shake;
        cam.position.y += (Math.random() - 0.5) * shake;
      }
      cam.lookAt(this.smoothLook);
    }

    // FOV: wider with speed, kick while boosting (smoothed)
    const targetFov = K.fovBase + (K.fovMax - K.fovBase) * Math.min(1, speedRatio) ** 1.5 + (car.boosting ? K.fovBoost : 0);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
  }
}
