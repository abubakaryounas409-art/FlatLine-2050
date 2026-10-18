// =============================================================================
// FLATLINE: 2050 — ai/civilianAI.js
// People in the 2020 city (CLAUDE.md Phase 8.3): they stroll between points
// in an area, panic at gunshots and explosions (run away from the noise),
// then cower for a while before walking again. They can be hurt — missions
// punish that (Mission 6 is about saving them).
//
//   const crowd = new Civilians({ scene, assets, player, weapons })
//   crowd.spawn({ position: [x, 0, z], area: { min: [x0, z0], max: [x1, z1] } })
//   crowd.panic(point)   — explosions call this too
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';

const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const rand = (a, b) => a + Math.random() * (b - a);

export class Civilians {
  constructor({ scene, assets, player, weapons, models = ['characters.civilian', 'characters.civilian_f'] }) {
    this.scene = scene;
    this.assets = assets;
    this.player = player;
    this.weapons = weapons;
    this.models = models;
    this.people = [];
    this.onHurt = null; // (person) => void — mission penalty
    this._generation = physics.generation;
    this._prevOnShot = weapons.onShot;
    weapons.onShot = (muzzle) => {
      this._prevOnShot?.(muzzle);
      this.panic(muzzle, CONFIG.civilians.hearGunshot);
    };
  }

  spawn({ position, area = null, model = null, yaw = Math.random() * Math.PI * 2 }) {
    const R = physics.RAPIER;
    const key = model ?? this.models[this.people.length % this.models.length];
    const tpl = this.assets.get(key);
    const obj = createModelInstance(tpl);
    this.scene.add(obj);
    const actor = new Actor('civilian', obj, tpl.animations);
    const pos = new THREE.Vector3(...position);
    actor.place(pos, yaw);
    actor.play('idle', 0.01);
    const collider = physics.world.createCollider(R.ColliderDesc.capsule(0.55, 0.28).setTranslation(pos.x, pos.y + 0.85, pos.z));
    const p = {
      actor, obj, collider, pos, yaw,
      area: area ? { min: new THREE.Vector2(...area.min), max: new THREE.Vector2(...area.max) } : null,
      state: 'idle', t: rand(1, 4), goal: null, speed: 0, dead: false, from: null,
    };
    p.offHit = this.weapons.register(collider, {
      surface: 'flesh',
      onHit: () => {
        this.hurt(p);
        return { killed: true, counted: false };
      },
    });
    this.people.push(p);
    return p;
  }

  hurt(p) {
    if (p.dead) return;
    p.dead = true;
    p.collider.setEnabled(false);
    p.actor.play('death', 0.1, { loop: false, clamp: true });
    this.onHurt?.(p);
    this.panic(p.pos, 15);
  }

  /** Everyone within `radius` of `point` runs away from it. */
  panic(point, radius = CONFIG.civilians.hearGunshot) {
    for (const p of this.people) {
      if (p.dead || p.pos.distanceTo(point) > radius) continue;
      if (p.state !== 'flee') audio.sfxAt('whoosh', p.pos, { volume: 0.08, rate: 1.8, minInterval: 300 }); // a gasp of movement
      p.state = 'flee';
      p.from = point.clone();
      p.t = rand(3.5, 6);
    }
  }

  _pickGoal(p) {
    if (!p.area) return null;
    return new THREE.Vector3(rand(p.area.min.x, p.area.max.x), p.pos.y, rand(p.area.min.y, p.area.max.y));
  }

  update(dt) {
    if (this._generation !== physics.generation) return;
    const C = CONFIG.civilians;
    for (const p of this.people) {
      p.actor.update(dt);
      if (p.dead) continue;
      p.t -= dt;
      let want = null;
      switch (p.state) {
        case 'idle':
          if (p.actor.currentName !== 'idle') p.actor.play('idle');
          if (p.t <= 0 && p.area) {
            p.goal = this._pickGoal(p);
            p.state = 'walk';
          }
          break;
        case 'walk':
          want = p.goal;
          p.speed = C.walkSpeed;
          if (!p.goal || p.pos.distanceTo(p.goal) < 0.5) {
            p.state = 'idle';
            p.t = rand(2, 6);
          }
          break;
        case 'flee': {
          const away = p.pos.clone().sub(p.from).setY(0);
          if (away.lengthSq() < 0.01) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
          want = p.pos.clone().addScaledVector(away.normalize(), 4);
          p.speed = C.runSpeed;
          if (p.t <= 0) {
            p.state = 'cower';
            p.t = rand(4, 8);
          }
          break;
        }
        case 'cower':
          if (p.actor.currentName !== 'sitting') p.actor.play('sitting', 0.25);
          if (p.t <= 0) {
            p.state = 'idle';
            p.t = rand(1, 3);
          }
          break;
      }
      if (want) {
        const d = want.clone().sub(p.pos).setY(0);
        if (d.lengthSq() > 0.01) {
          d.normalize();
          // walls: look ahead and turn away
          const R = physics.RAPIER;
          const eye = { x: p.pos.x, y: p.pos.y + 0.9, z: p.pos.z };
          const hit = physics.world.castRay(new R.Ray(eye, { x: d.x, y: 0, z: d.z }), 1.2, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, p.collider);
          if (hit) d.set(-d.z, 0, d.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
          p.yaw += angleDelta(p.yaw, Math.atan2(d.x, d.z)) * Math.min(1, dt * 7);
          const step = Math.min(p.speed * dt, 1);
          p.pos.x += Math.sin(p.yaw) * step;
          p.pos.z += Math.cos(p.yaw) * step;
          if (hit && p.state === 'walk') p.goal = this._pickGoal(p);
        }
        const clip = p.speed > 2.5 ? 'run' : 'walk';
        if (p.actor.currentName !== clip) p.actor.play(clip, 0.2, { timeScale: p.speed > 2.5 ? 1.1 : 1 });
      }
      p.obj.position.copy(p.pos);
      p.obj.rotation.y = p.yaw;
      p.collider.setTranslation({ x: p.pos.x, y: p.pos.y + 0.85, z: p.pos.z });
    }
  }

  dispose() {
    this.weapons.onShot = this._prevOnShot;
    for (const p of this.people) {
      p.offHit();
      p.obj.removeFromParent();
    }
  }
}
