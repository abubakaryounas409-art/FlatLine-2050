// =============================================================================
// FLATLINE: 2050 — cutscenes/cutsceneCamera.js
// The camera cutscenes direct. It always looks at `lookTarget`, so moves are
// described as "camera here, looking there".
//
//   cut(pos, look)                    instant
//   moveTo(pos, look, secs, ease)     glide
//   orbit(center, radius, from, to, height, secs)   center: point, or () => point to follow
//   dollyZoom(target, toFov, secs)    "vertigo": the subject keeps its size while the world warps
//   shake(strength, secs)             decaying shake (impacts)
//   handheld(amount)                  constant subtle drift (0 = off)
//   fov(value, secs)
//
// Moves run on GSAP (real time) so the camera keeps its pace during slow-mo.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';

const v = (p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p.clone());

export class CutsceneCamera {
  constructor(fov = 40) {
    this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.05, 400);
    this.position = new THREE.Vector3(0, 1.6, 5); // "base" position before shake
    this.lookTarget = new THREE.Vector3(0, 1, 0);
    this.roll = 0;
    this.shakeAmount = 0;
    this.handheldAmount = 0;
    this._time = 0;
    this._tweens = [];
  }

  /** Start from wherever another camera is (smooth hand-off from gameplay). */
  copyFrom(cam, lookTarget) {
    this.position.copy(cam.position);
    this.camera.fov = cam.fov;
    this.camera.updateProjectionMatrix();
    if (lookTarget) this.lookTarget.copy(lookTarget);
    else this.lookTarget.copy(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(cam.position));
  }

  _track(t) {
    this._tweens.push(t);
    return t.then();
  }

  cut(position, lookAt) {
    this.killMoves();
    this.position.copy(v(position));
    if (lookAt) this.lookTarget.copy(v(lookAt));
  }

  moveTo(position, lookAt, duration = 2, ease = 'power2.inOut') {
    const p = v(position);
    const tl = gsap.timeline();
    tl.to(this.position, { x: p.x, y: p.y, z: p.z, duration, ease }, 0);
    if (lookAt) {
      const l = v(lookAt);
      tl.to(this.lookTarget, { x: l.x, y: l.y, z: l.z, duration, ease }, 0);
    }
    return this._track(tl);
  }

  /** Circle around `center` from angle a0 to a1 (radians, 0 = +Z side). */
  orbit(center, radius, a0, a1, height = 1.6, duration = 4, ease = 'none') {
    // center may be a function → a moving subject (e.g. a tumbling wreck) stays framed
    const fixed = typeof center === 'function' ? null : v(center);
    const at = () => fixed ?? center();
    const state = { a: a0 };
    const apply = () => {
      const c = at();
      this.lookTarget.copy(c);
      this.position.set(c.x + Math.sin(state.a) * radius, c.y + height, c.z + Math.cos(state.a) * radius);
    };
    apply();
    return this._track(gsap.to(state, { a: a1, duration, ease, onUpdate: apply }));
  }

  fov(value, duration = 1, ease = 'power2.inOut') {
    return this._track(gsap.to(this.camera, { fov: value, duration, ease, onUpdate: () => this.camera.updateProjectionMatrix() }));
  }

  /**
   * Dolly zoom: change the FOV while moving along the view line so the subject
   * at `target` keeps its on-screen size.
   */
  dollyZoom(target, toFov = 70, duration = 2, ease = 'sine.inOut') {
    const t = v(target);
    this.lookTarget.copy(t);
    const dir = new THREE.Vector3().subVectors(this.position, t);
    const d0 = dir.length();
    dir.normalize();
    const f0 = THREE.MathUtils.degToRad(this.camera.fov);
    const widthAtSubject = 2 * d0 * Math.tan(f0 / 2); // keep this constant
    const state = { fov: this.camera.fov };
    return this._track(
      gsap.to(state, {
        fov: toFov,
        duration,
        ease,
        onUpdate: () => {
          const f = THREE.MathUtils.degToRad(state.fov);
          const d = widthAtSubject / (2 * Math.tan(f / 2));
          this.position.copy(t).addScaledVector(dir, d);
          this.camera.fov = state.fov;
          this.camera.updateProjectionMatrix();
        },
      }),
    );
  }

  /** Impact shake that decays over `duration` seconds. */
  shake(strength = 0.2, duration = 0.6) {
    this.shakeAmount = Math.max(this.shakeAmount, strength);
    gsap.killTweensOf(this, 'shakeAmount');
    return gsap.to(this, { shakeAmount: 0, duration, ease: 'power2.out' }).then();
  }

  /** Constant handheld drift (0 = tripod). */
  handheld(amount = 0.02) {
    this.handheldAmount = amount;
  }

  killMoves() {
    this._tweens.forEach((t) => t.kill());
    this._tweens = [];
  }

  /** Jump every running move to its end state (used when a cutscene is skipped). */
  finishMoves() {
    this._tweens.forEach((t) => t.progress(1));
    this._tweens = [];
  }

  /** Call every frame (real dt). */
  update(dt) {
    this._time += dt;
    const t = this._time;
    const cam = this.camera;
    cam.position.copy(this.position);

    // Handheld: slow layered sines. Shake: fast random jitter.
    const h = this.handheldAmount;
    const s = this.shakeAmount;
    cam.position.x += (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.9) * 0.4) * h + (Math.random() - 0.5) * s;
    cam.position.y += (Math.sin(t * 1.7 + 1) * 0.6 + Math.sin(t * 3.7) * 0.4) * h + (Math.random() - 0.5) * s;
    cam.lookAt(this.lookTarget);
    cam.rotateZ(this.roll + Math.sin(t * 0.9) * h * 0.3 + (Math.random() - 0.5) * s * 0.15);
  }
}
