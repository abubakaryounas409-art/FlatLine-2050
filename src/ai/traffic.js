// =============================================================================
// FLATLINE: 2050 — ai/traffic.js
// 2020 traffic (CLAUDE.md Phase 8.4): cars that follow a closed road spline,
// keep their distance, brake for Kael, and knock him down if he walks into a
// moving one. Kinematic bodies, so Kael can also take cover behind them.
//
//   const traffic = new Traffic({ scene, assets, road: [[x, z], …], cars: 5, player })
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { createModelInstance } from '../assets/loader.js';
import { MODELS } from '../assets/manifest.js';

const CAR_KEYS = ['car_2020_sedan', 'suv', 'car_2020_sedan', 'police_car', 'truck'];

export class Traffic {
  /**
   * @param {object} o
   * @param {number[][]} o.road   closed loop of [x, z] points (driving direction = point order)
   * @param {number} [o.cars]
   * @param {number} [o.laneOffset]  drive on the right of the centre line (m)
   */
  constructor({ scene, assets, road, cars = 4, player, weapons = null, laneOffset = 1.8, y = 0 }) {
    const R = physics.RAPIER;
    this.player = player;
    this.curve = new THREE.CatmullRomCurve3(road.map(([x, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
    this.length = this.curve.getLength();
    this.laneOffset = laneOffset;
    this._generation = physics.generation;
    this.cars = [];
    for (let i = 0; i < cars; i++) {
      const key = CAR_KEYS[i % CAR_KEYS.length];
      const tpl = assets.get(`vehicles.${key}`);
      if (!tpl) continue;
      const root = new THREE.Group();
      const model = createModelInstance(tpl);
      // the Quaternius cars face +Z; models marked forward: -1 are turned around
      model.rotation.y = MODELS.vehicles[key]?.forward === -1 ? Math.PI : 0;
      root.add(model);
      scene.add(root);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
      const collider = physics.world.createCollider(R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(0, size.y / 2, 0), body);
      if (weapons) weapons.setSurface(collider, 'metal');
      // headlights / taillights as glowing sprites
      const glow = (color, z, x) => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4) }));
        s.position.set(x, size.y * 0.42, z);
        root.add(s);
      };
      [-1, 1].forEach((sx) => {
        glow(0xfff2d0, size.z / 2, sx * size.x * 0.32);
        glow(0xff2020, -size.z / 2, sx * size.x * 0.32);
      });
      const cruise = CONFIG.traffic.speed * (0.8 + Math.random() * 0.35);
      this.cars.push({ root, body, collider, s: (i / cars) * this.length, speed: cruise, cruise, half: size.z / 2 });
    }
    this.horn = 0;
  }

  /** Point + tangent at arc length s, shifted into the right-hand lane. */
  _at(s) {
    const u = (((s % this.length) + this.length) % this.length) / this.length;
    const p = this.curve.getPointAt(u);
    const t = this.curve.getTangentAt(u);
    const right = new THREE.Vector3(-t.z, 0, t.x).normalize(); // driving on the right
    return { p: p.addScaledVector(right, this.laneOffset), t };
  }

  update(dt) {
    if (this._generation !== physics.generation) return;
    const T = CONFIG.traffic;
    this.horn = Math.max(0, this.horn - dt);
    for (const c of this.cars) {
      // gap to the car ahead
      let gap = Infinity;
      for (const o of this.cars) {
        if (o === c) continue;
        let d = o.s - c.s;
        if (d < 0) d += this.length;
        gap = Math.min(gap, d - o.half - c.half);
      }
      // Kael in front?
      const { p, t } = this._at(c.s);
      const toP = this.player.position.clone().sub(p);
      const ahead = toP.dot(t);
      const side = Math.abs(toP.clone().addScaledVector(t, -ahead).length());
      let target = c.cruise;
      if (gap < T.followGap) target = Math.min(target, Math.max(0, (gap - 2) * 1.2));
      if (ahead > 0 && ahead < T.brakeDistance && side < 1.8) {
        target = Math.min(target, Math.max(0, (ahead - c.half - 1.5) * 1.5));
        if (this.horn <= 0 && c.speed > 3) {
          audio.sfxAt('siren', p, { volume: 0.12, rate: 2.2 }); // short horn blip
          this.horn = 2.5;
        }
      }
      c.speed += Math.max(-T.brake * dt, Math.min(T.accel * dt, target - c.speed));
      c.s += c.speed * dt;
      const at = this._at(c.s);
      c.root.position.copy(at.p);
      c.root.rotation.y = Math.atan2(at.t.x, at.t.z);
      c.body.setNextKinematicTranslation(at.p);
      c.body.setNextKinematicRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.root.rotation.y));
      // hit Kael
      if (c.speed > 4 && ahead > 0 && ahead < c.half + 0.6 && side < 1.1 && this.player.state !== 'dead') {
        this.player.hurt(c.speed * 6);
        c.speed *= 0.3;
      }
    }
  }

  dispose() {
    for (const c of this.cars) {
      c.root.removeFromParent();
      if (this._generation === physics.generation) physics.world.removeRigidBody(c.body);
    }
  }
}
